/**
 * Yjs Integration Layer
 *
 * Wraps Yjs's CRDT engine with our semantic types, union-bounding-box
 * concurrent resize merging, and intent ambiguity conflict detection.
 *
 * Storage model (schema v2)
 * ─────────────────────────
 * Each shape is a `Y.XmlElement` inside the `shapes` array. Its `data`
 * attribute holds the JSON snapshot written at creation time; every later
 * edit is written as one `p:<field>` attribute per changed property. Yjs
 * attributes are independent last-writer-wins registers, so two peers that
 * concurrently change *different* properties of the same shape (Alice
 * recolours while Bob moves) both keep their edit. Readers overlay the
 * `p:` registers on top of the snapshot; a `null` register removes a field.
 * Schema v1 boards (no overlays) read unchanged.
 *
 * Causality
 * ─────────
 * Every edit also records an `actorEdit_<actor>` entry carrying a per-shape
 * sequence number and the sequence numbers of the other actors' edits it had
 * already observed (a per-shape version vector). Two edits conflict only if
 * neither had seen the other — sequential edits by different people, however
 * quick, are never reported as conflicts.
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  ShapeKind,
  type Shape,
  type ShapeVector,
  type Conflict,
  type MergeEvent,
  type ShapeData,
  createShape,
  classifyAmbiguity,
  mergeShapes,
  EMPTY_VECTOR,
  incrementVec,
} from './core';

// ─── Yjs Schema ─────────────────────────────────────────────────────────────

const SHAPE_ELEMENT_TAG = 'shape';
const ATTR_ID = 'id';
const ATTR_KIND = 'kind';
const ATTR_ACTOR = 'actor';
const ATTR_VECTOR = 'vector';
const ATTR_DELETED = 'deleted';
const ATTR_DATA = 'data';
const ATTR_CREATED = 'createdAt';
const ATTR_UPDATED = 'updatedAt';
const ATTR_RESOLVED_TS = 'resolved_ts';
const ATTR_MERGED_TS = 'merged_ts';
const ACTOR_EDIT_PREFIX = 'actorEdit_';
/** Per-property register prefix (schema v2). */
export const FIELD_PREFIX = 'p:';

export const CURRENT_BOARD_SCHEMA_VERSION = 2;

/** Edits older than this are history, not live conflicts. */
const CONFLICT_HORIZON_MS = 10 * 60_000;
/** Fallback window for legacy edits that carry no causal metadata. */
const LEGACY_CONCURRENCY_WINDOW_MS = 30_000;

/** Transaction origin used by automatic engine repairs (never undoable). */
export const ENGINE_ORIGIN = 'crdt-engine';

/**
 * Upgrade older boards in place using idempotent, additive defaults. This is
 * intentionally safe to run after both local persistence hydration and the
 * first remote sync: a peer may contribute a legacy shape after local load.
 */
export function migrateBoardDocument(doc: Y.Doc, options: { dryRun?: boolean } = {}): { fromVersion: number; toVersion: number; changedShapes: number; summary: string } {
  const metadata = doc.getMap<unknown>('boardMeta');
  const rawVersion = metadata.get('schemaVersion') ?? 0;
  const storedVersion = Number(rawVersion);
  if (!Number.isInteger(storedVersion) || storedVersion < 0) {
    throw new Error('Board migration paused: the saved schema version is invalid. No board data was changed.');
  }
  if (storedVersion > CURRENT_BOARD_SCHEMA_VERSION) {
    throw new Error(`Board migration paused: this board uses newer schema version ${storedVersion}. No board data was changed.`);
  }
  const fromVersion = storedVersion;
  const shapes = doc.getArray<Y.XmlElement>('shapes');
  const migrationPlan: Array<{ element: Y.XmlElement; serialized: string }> = [];
  let changedShapes = 0;

  // Validate and prepare every record before opening a Yjs transaction. A bad
  // record or future shape kind therefore cannot leave a half-migrated board.
  shapes.forEach((element, index) => {
    const shapeId = element.getAttribute(ATTR_ID) ?? `at index ${index}`;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(element.getAttribute(ATTR_DATA) ?? '{}') as Record<string, unknown>;
    } catch {
      throw new Error(`Board migration paused: shape ${shapeId} has invalid saved data. No board data was changed.`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.kind !== 'string') {
      throw new Error(`Board migration paused: shape ${shapeId} has an invalid data record. No board data was changed.`);
    }
    if (!Object.values(ShapeKind).includes(data.kind as ShapeKind)) {
      throw new Error(`Board migration paused: shape ${shapeId} uses an unsupported kind. No board data was changed.`);
    }

    // Defaults are decided on the effective (snapshot + overlay) record, but
    // written to the snapshot so overlays written later still take priority.
    const effective = overlayFields(element, { ...data });
    let changed = false;
    const fill = (key: string, value: unknown) => {
      const current = effective[key];
      if (typeof current !== 'number' || !Number.isFinite(current)) { data[key] = value; changed = true; }
    };
    fill('zIndex', index);
    if (data.kind === ShapeKind.Rect || data.kind === ShapeKind.Ellipse) {
      fill('fillOpacity', 0.13);
      fill('strokeWidth', 1.5);
    }
    if (data.kind === ShapeKind.Rect) fill('cornerRadius', 0);
    if (changed) {
      migrationPlan.push({ element, serialized: JSON.stringify(data) });
      changedShapes++;
    }
  });

  const summary = changedShapes
    ? `Upgraded board schema from v${fromVersion} to v${CURRENT_BOARD_SCHEMA_VERSION}; added defaults to ${changedShapes} shape${changedShapes === 1 ? '' : 's'}.`
    : `Board schema v${CURRENT_BOARD_SCHEMA_VERSION} is current; no shape data needed changes.`;
  if (!options.dryRun && (migrationPlan.length || fromVersion < CURRENT_BOARD_SCHEMA_VERSION)) {
    doc.transact(() => {
      for (const item of migrationPlan) item.element.setAttribute(ATTR_DATA, item.serialized);
      if (fromVersion < CURRENT_BOARD_SCHEMA_VERSION) metadata.set('schemaVersion', CURRENT_BOARD_SCHEMA_VERSION);
    }, 'board-schema-migration');
  }
  return { fromVersion, toVersion: CURRENT_BOARD_SCHEMA_VERSION, changedShapes, summary };
}

export type EditOp = 'move' | 'resize' | 'update' | 'create' | 'delete';

export interface ActorEdit {
  data: ShapeData;
  actor: string;
  ts: number;
  op: EditOp;
  /** Per-shape sequence number of this edit (absent on legacy edits). */
  seq?: number;
  /** Sequence numbers of other actors' edits this edit had observed. */
  seen?: Record<string, number>;
}

// ─── Shape ↔ Yjs Conversion ─────────────────────────────────────────────────

function shapeToYjsAttrs(shape: Shape): Record<string, string> {
  return {
    [ATTR_ID]: shape.id,
    [ATTR_KIND]: shape.data.kind,
    [ATTR_ACTOR]: shape.actor,
    [ATTR_VECTOR]: JSON.stringify(shape.vector),
    [ATTR_DELETED]: String(shape.deleted),
    [ATTR_DATA]: JSON.stringify(shape.data),
    [ATTR_CREATED]: String(shape.createdAt),
    [ATTR_UPDATED]: String(shape.updatedAt),
  };
}

/** Apply `p:` property registers on top of a snapshot record. */
function overlayFields<T extends Record<string, unknown>>(el: Y.XmlElement, base: T): T {
  const attrs = el.getAttributes() as Record<string, unknown>;
  for (const key in attrs) {
    if (!key.startsWith(FIELD_PREFIX)) continue;
    const field = key.slice(FIELD_PREFIX.length);
    if (field === 'kind') continue;
    const raw = attrs[key];
    if (typeof raw !== 'string') continue;
    try {
      const value = JSON.parse(raw);
      if (value === null) delete (base as Record<string, unknown>)[field];
      else (base as Record<string, unknown>)[field] = value;
    } catch {
      /* ignore a corrupt register; the snapshot value stays */
    }
  }
  return base;
}

/** Read the effective shape data of an element (snapshot + property overlays). */
export function readShapeData(el: Y.XmlElement): ShapeData | null {
  try {
    const base = JSON.parse(el.getAttribute(ATTR_DATA) ?? 'null');
    if (!base || typeof base !== 'object') return null;
    return overlayFields(el, base) as ShapeData;
  } catch {
    return null;
  }
}

/**
 * Write only the properties that actually changed, one register each.
 * Returns the effective record after the write.
 */
function writeShapeFields(el: Y.XmlElement, previous: ShapeData, patch: Partial<ShapeData>): ShapeData {
  const next = { ...previous } as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (key === 'kind') continue;
    const value = (patch as Record<string, unknown>)[key];
    const before = JSON.stringify((previous as Record<string, unknown>)[key] ?? null);
    const after = JSON.stringify(value ?? null);
    if (before === after) continue;
    el.setAttribute(FIELD_PREFIX + key, after);
    if (value === undefined || value === null) delete next[key];
    else next[key] = value;
  }
  return next as ShapeData;
}

function yjsAttrToShape(el: Y.XmlElement): Shape | null {
  try {
    const id = el.getAttribute(ATTR_ID) as string;
    const kind = el.getAttribute(ATTR_KIND) as string;
    const actor = el.getAttribute(ATTR_ACTOR) as string;
    const vector = JSON.parse(el.getAttribute(ATTR_VECTOR) ?? '{}') as ShapeVector;
    const deleted = el.getAttribute(ATTR_DELETED) === 'true';
    const data = readShapeData(el);
    const createdAt = Number(el.getAttribute(ATTR_CREATED) ?? 0);
    const updatedAt = Number(el.getAttribute(ATTR_UPDATED) ?? 0);

    if (!id || !kind || !data) return null;

    return { id, kind: kind as ShapeKind, data, actor, vector, deleted, createdAt, updatedAt };
  } catch {
    return null;
  }
}

/** Convert a single element; exported for incremental stores. */
export function elementToShape(el: Y.XmlElement): Shape | null {
  return yjsAttrToShape(el);
}

// ─── Element index ──────────────────────────────────────────────────────────

const elementIndexes = new WeakMap<Y.Array<Y.XmlElement>, Map<string, Y.XmlElement>>();

function isLive(el: Y.XmlElement): boolean {
  // Elements removed from the array (e.g. an undone creation) keep a deleted item.
  return Boolean(el.doc) && !(el as unknown as { _item?: { deleted: boolean } })._item?.deleted;
}

/** O(1) id → element lookup, rebuilt lazily when the array changes shape. */
export function findShapeElement(shapesArray: Y.Array<Y.XmlElement>, id: string): Y.XmlElement | undefined {
  let index = elementIndexes.get(shapesArray);
  const cached = index?.get(id);
  if (cached && isLive(cached) && cached.getAttribute(ATTR_ID) === id) return cached;
  index = new Map();
  for (const el of shapesArray) {
    const elId = el.getAttribute(ATTR_ID);
    if (elId) index.set(elId, el);
  }
  elementIndexes.set(shapesArray, index);
  return index.get(id);
}

// ─── Yjs Canvas State ────────────────────────────────────────────────────────

export interface YjsCanvasState {
  doc: Y.Doc;
  shapesArray: Y.Array<Y.XmlElement>;
  awareness: Awareness;
  onChange: (callback: (shapes: Shape[], conflicts: Conflict[]) => void) => void;
  dispose: () => void;
}

/** Bind engine operations to an existing document (e.g. one owned by a provider). */
export function bindYjsCanvas(doc: Y.Doc, awareness?: Awareness): YjsCanvasState {
  const shapesArray = doc.getArray<Y.XmlElement>('shapes');
  const ownAwareness = awareness ?? new Awareness(doc);
  return {
    doc,
    shapesArray,
    awareness: ownAwareness,
    onChange: () => {},
    dispose: () => { if (!awareness) ownAwareness.destroy(); },
  };
}

// ─── Create Yjs Canvas ───────────────────────────────────────────────────────

export function createYjsCanvas(actor: string, onConflict?: (c: Conflict[]) => void): YjsCanvasState {
  const doc = new Y.Doc();
  const shapesArray = doc.getArray<Y.XmlElement>('shapes');
  const awareness = new Awareness(doc);

  awareness.setLocalStateField('cursor', { x: 0, y: 0 });
  awareness.setLocalStateField('actor', actor);

  const defaultOnChange = (_shapes: Shape[], conflicts: Conflict[]) => {
    onConflict?.(conflicts);
  };

  let onChangeCallback = defaultOnChange;

  const onChange = (callback: (shapes: Shape[], conflicts: Conflict[]) => void) => {
    onChangeCallback = callback;
  };

  doc.on('update', () => {
    const currentShapes = yjsShapesToShapes(shapesArray);
    const conflicts = detectCanvasConflicts(shapesArray, currentShapes);
    onChangeCallback(currentShapes, conflicts);
  });

  return {
    doc,
    shapesArray,
    awareness,
    onChange,
    dispose: () => {
      doc.destroy();
      awareness.destroy();
    },
  };
}

// ─── Causal edit records ─────────────────────────────────────────────────────

function nextActorEdit(el: Y.XmlElement, actor: string, data: ShapeData, ts: number, op: EditOp): ActorEdit {
  const edits = getActorEdits(el);
  const seen: Record<string, number> = {};
  let maxSeq = 0;
  for (const edit of edits) {
    const seq = edit.seq ?? 0;
    maxSeq = Math.max(maxSeq, seq);
    if (edit.actor !== actor) seen[edit.actor] = seq;
  }
  return { data, actor, ts, op, seq: maxSeq + 1, seen };
}

function recordActorEdit(el: Y.XmlElement, edit: ActorEdit) {
  el.setAttribute(`${ACTOR_EDIT_PREFIX}${edit.actor}`, JSON.stringify(edit));
}

/** True when neither edit causally observed the other. */
export function editsAreConcurrent(a: ActorEdit, b: ActorEdit): boolean {
  if (a.actor === b.actor) return false;
  if (typeof a.seq === 'number' && typeof b.seq === 'number') {
    const aSawB = (a.seen?.[b.actor] ?? 0) >= b.seq;
    const bSawA = (b.seen?.[a.actor] ?? 0) >= a.seq;
    return !aSawB && !bSawA;
  }
  return Math.abs(a.ts - b.ts) < LEGACY_CONCURRENCY_WINDOW_MS;
}

// ─── Shape Operations ────────────────────────────────────────────────────────

export function createShapeInCanvas(
  canvas: YjsCanvasState,
  kind: ShapeKind,
  data: Partial<ShapeData>,
  actor: string,
  options: { id?: string } = {}
): string {
  let zIndex = data.zIndex;
  if (typeof zIndex !== 'number') {
    // Only scan for the top layer when the caller didn't choose one (bulk
    // inserts pass explicit layers, keeping them O(n) instead of O(n²)).
    let maxLayer = -1;
    canvas.shapesArray.forEach((el, index) => {
      const layer = readShapeData(el)?.zIndex ?? index;
      if (layer > maxLayer) maxLayer = layer;
    });
    zIndex = maxLayer + 1;
  }
  const shape = createShape(kind, { ...data, kind, zIndex } as ShapeData, actor, EMPTY_VECTOR);
  if (options.id) shape.id = options.id;
  const el = new Y.XmlElement(SHAPE_ELEMENT_TAG);
  const attrs = shapeToYjsAttrs(shape);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  recordActorEdit(el, { data: shape.data, actor, ts: shape.createdAt, op: 'create', seq: 1, seen: {} });

  canvas.shapesArray.push([el]);
  return shape.id;
}

export function updateShapeInCanvas(
  canvas: YjsCanvasState,
  shapeId: string,
  data: Partial<ShapeData>,
  actor: string,
  op: EditOp = 'update'
): void {
  const el = findShapeElement(canvas.shapesArray, shapeId);
  if (!el) return;
  const current = yjsAttrToShape(el);
  if (!current) return;
  const now = Date.now();
  const mergedData = writeShapeFields(el, current.data, data);
  if (JSON.stringify(mergedData) === JSON.stringify(current.data)) return;

  el.setAttribute(ATTR_ACTOR, actor);
  el.setAttribute(ATTR_UPDATED, String(now));
  el.setAttribute(ATTR_VECTOR, JSON.stringify(incrementVec(current.vector, actor)));
  // Record per-actor edit to preserve intent for CRDT semantic merging
  recordActorEdit(el, nextActorEdit(el, actor, mergedData, now, op));
}

export function deleteShapeInCanvas(canvas: YjsCanvasState, shapeId: string, actor: string): void {
  const el = findShapeElement(canvas.shapesArray, shapeId);
  if (!el) return;
  const now = Date.now();
  el.setAttribute(ATTR_DELETED, 'true');
  el.setAttribute(ATTR_UPDATED, String(now));
  el.setAttribute(ATTR_ACTOR, actor);
  const data = readShapeData(el);
  if (data) recordActorEdit(el, nextActorEdit(el, actor, data, now, 'delete'));
}

/** Restore a soft-deleted shape (used by undo-free flows such as "keep" on delete conflicts). */
export function restoreShapeInCanvas(canvas: YjsCanvasState, shapeId: string, actor: string): void {
  const el = findShapeElement(canvas.shapesArray, shapeId);
  if (!el) return;
  const now = Date.now();
  el.setAttribute(ATTR_DELETED, 'false');
  el.setAttribute(ATTR_UPDATED, String(now));
  el.setAttribute(ATTR_ACTOR, actor);
  const data = readShapeData(el);
  if (data) recordActorEdit(el, nextActorEdit(el, actor, data, now, 'update'));
}

// ─── Conflict Resolution ─────────────────────────────────────────────────────

export function resolveConflictInCanvas(
  canvas: YjsCanvasState,
  shapeId: string,
  action: 'merge' | 'keep-local' | 'keep-remote',
  actor: string
): void {
  const el = findShapeElement(canvas.shapesArray, shapeId);
  if (!el) return;
  const current = yjsAttrToShape(el);
  if (!current) return;

  const actorEdits = getActorEdits(el);
  const now = Date.now();

  if (action === 'merge') {
    const editsToMerge = actorEdits.map(e => ({
      ...current,
      data: e.data,
      actor: e.actor,
      updatedAt: e.ts,
    }));
    if (editsToMerge.length > 0) {
      const mergedShape = mergeShapes(current, editsToMerge);
      writeShapeFields(el, current.data, mergedShape.data);
    }
  } else if (action === 'keep-local') {
    const localEdit = actorEdits.find(e => e.actor === actor);
    if (localEdit) writeShapeFields(el, current.data, localEdit.data);
    if (localEdit && localEdit.op !== 'delete' && current.deleted) el.setAttribute(ATTR_DELETED, 'false');
  } else if (action === 'keep-remote') {
    const remoteEdit = actorEdits
      .filter(e => e.actor !== actor)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || b.ts - a.ts)[0];
    if (remoteEdit) writeShapeFields(el, current.data, remoteEdit.data);
    if (remoteEdit && remoteEdit.op !== 'delete' && current.deleted) el.setAttribute(ATTR_DELETED, 'false');
  }

  el.setAttribute(ATTR_RESOLVED_TS, String(now));
  el.setAttribute(ATTR_UPDATED, String(now));
}

// ─── Semantic Merge & Conflict Detection ─────────────────────────────────────

export function getActorEdits(el: Y.XmlElement): ActorEdit[] {
  const edits: ActorEdit[] = [];
  const attrs = el.getAttributes() as Record<string, unknown>;
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith(ACTOR_EDIT_PREFIX) && typeof v === 'string') {
      try {
        const edit = JSON.parse(v) as ActorEdit;
        edits.push(edit);
      } catch {
        /* ignore invalid edit */
      }
    }
  }
  return edits;
}

/**
 * Inspect one element for semantic conflicts. Concurrent resizes are merged
 * in place with the union-bounding-box rule (deterministic on every peer).
 */
export function detectElementConflict(el: Y.XmlElement, now: number = Date.now()): Conflict | null {
  const shape = yjsAttrToShape(el);
  if (!shape) return null;

  const resolvedTs = Number(el.getAttribute(ATTR_RESOLVED_TS) || 0);
  const mergedTs = Number(el.getAttribute(ATTR_MERGED_TS) || 0);

  // Latest unresolved edit per actor, within the live-conflict horizon.
  const latest = new Map<string, ActorEdit>();
  for (const edit of getActorEdits(el)) {
    if (edit.op === 'create' || now - edit.ts > CONFLICT_HORIZON_MS || edit.ts <= resolvedTs) continue;
    const existing = latest.get(edit.actor);
    if (!existing || (edit.seq ?? edit.ts) > (existing.seq ?? existing.ts)) latest.set(edit.actor, edit);
  }
  const candidates = Array.from(latest.values()).sort((a, b) => a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
  if (candidates.length < 2) return null;

  // Pick the first causally concurrent pair (deterministic ordering).
  let pair: [ActorEdit, ActorEdit] | null = null;
  for (let i = 0; i < candidates.length && !pair; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (editsAreConcurrent(candidates[i], candidates[j])) { pair = [candidates[i], candidates[j]]; break; }
    }
  }
  if (!pair) return null;
  const [editA, editB] = pair;

  const isConcurrentResize = (editA.op === 'resize' && editB.op === 'resize') ||
    ((editA.op === 'resize' || editB.op === 'resize') &&
     (shape.kind === ShapeKind.Rect || shape.kind === ShapeKind.Image || shape.kind === ShapeKind.Note));

  if (isConcurrentResize && editA.op !== 'delete' && editB.op !== 'delete') {
    // Apply Union-Bounding-Box Merge Rule automatically
    const latestEditTs = Math.max(editA.ts, editB.ts);
    if (mergedTs < latestEditTs) {
      const shapeA = { ...shape, data: editA.data, actor: editA.actor, updatedAt: editA.ts };
      const shapeB = { ...shape, data: editB.data, actor: editB.actor, updatedAt: editB.ts };
      const merged = mergeShapes(shapeA, [shapeB]);
      const apply = () => {
        writeShapeFields(el, shape.data, merged.data);
        el.setAttribute(ATTR_MERGED_TS, String(latestEditTs));
      };
      if (el.doc) el.doc.transact(apply, ENGINE_ORIGIN); else apply();
    }
    return null;
  }

  // Check for delete vs edit
  if (editA.op === 'delete' || editB.op === 'delete') {
    if (editA.op === 'delete' && editB.op === 'delete') return null;
    return {
      shapeId: shape.id,
      type: 'delete_vs_edit',
      actors: [editA.actor, editB.actor],
      level: 'high',
      description: `Shape edited while deleted by another peer`,
      ts: Math.max(editA.ts, editB.ts),
    };
  }

  // Check for divergent moves / positions
  const level = classifyAmbiguity(
    { ...shape, data: editA.data, actor: editA.actor },
    { ...shape, data: editB.data, actor: editB.actor },
  );
  if (level === 'medium' || level === 'high') {
    return {
      shapeId: shape.id,
      type: 'concurrent_edit',
      actors: [editA.actor, editB.actor],
      level,
      description: `Divergent moves by ${editA.actor} and ${editB.actor} (${level} ambiguity)`,
      ts: Math.max(editA.ts, editB.ts),
    };
  }
  return null;
}

export function detectCanvasConflicts(
  shapesArray: Y.Array<Y.XmlElement>,
  _activeShapes?: Shape[]
): Conflict[] {
  const conflicts: Conflict[] = [];
  const now = Date.now();
  for (const el of shapesArray) {
    const conflict = detectElementConflict(el, now);
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}

// ─── Read Shapes ─────────────────────────────────────────────────────────────

export function yjsShapesToShapes(shapesArray: Y.Array<Y.XmlElement>): Shape[] {
  const shapes: Shape[] = [];
  for (const el of shapesArray) {
    const shape = yjsAttrToShape(el);
    if (shape) shapes.push(shape);
  }
  return shapes;
}

export function getActiveShapes(canvas: YjsCanvasState): Shape[] {
  return yjsShapesToShapes(canvas.shapesArray).filter(s => !s.deleted);
}

// ─── Merge History from Yjs Changes ──────────────────────────────────────────

export function computeChangeEvents(
  _doc: Y.Doc,
  shapesArray: Y.Array<Y.XmlElement>,
  previousShapes: Shape[],
  localActor: string
): MergeEvent[] {
  return diffToEvents(previousShapes, yjsShapesToShapes(shapesArray), localActor);
}

/** Convert two shape snapshots into history events. */
export function diffToEvents(previousShapes: Shape[], current: Shape[], localActor: string): MergeEvent[] {
  const events: MergeEvent[] = [];
  const prevMap = new Map(previousShapes.map(s => [s.id, s]));
  const currMap = new Map(current.map(s => [s.id, s]));

  for (const [id, shape] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      events.push({ type: 'create', shape, actor: shape.actor, ts: shape.createdAt });
    } else if (prev !== shape && (JSON.stringify(prev.data) !== JSON.stringify(shape.data) || prev.actor !== shape.actor)) {
      events.push({ type: 'update', shape, actor: shape.actor, previous: prev, ts: shape.updatedAt });
    }
  }

  for (const id of prevMap.keys()) {
    if (!currMap.has(id)) {
      events.push({ type: 'delete', shapeId: id, actor: localActor, ts: Date.now() });
    }
  }

  return events;
}
