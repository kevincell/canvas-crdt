/**
 * Yjs Integration Layer
 *
 * Wraps Yjs's CRDT engine with our semantic types, union-bounding-box
 * concurrent resize merging, and intent ambiguity conflict detection.
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  ShapeKind,
  type Shape,
  type ShapeVector,
  type Conflict,
  type MergeEvent,
  type AmbiguityLevel,
  type MergeHistory,
  type HistoryEntry,
  type ShapeData,
  type StrokeShape,
  type RectShape,
  type TextShape,
  type Point,
  createShape,
  shapeId,
  shapeCenter,
  shapeBBox,
  shapeSize,
  detectConflicts,
  classifyAmbiguity,
  unionBBox,
  mergeShapes,
  buildMergeHistory,
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

export const CURRENT_BOARD_SCHEMA_VERSION = 1;

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

    let changed = false;
    if (typeof data.zIndex !== 'number' || !Number.isFinite(data.zIndex)) { data.zIndex = index; changed = true; }
    if (data.kind === ShapeKind.Rect || data.kind === ShapeKind.Ellipse) {
      if (typeof data.fillOpacity !== 'number' || !Number.isFinite(data.fillOpacity)) { data.fillOpacity = 0.13; changed = true; }
      if (typeof data.strokeWidth !== 'number' || !Number.isFinite(data.strokeWidth)) { data.strokeWidth = 1.5; changed = true; }
    }
    if (data.kind === ShapeKind.Rect && (typeof data.cornerRadius !== 'number' || !Number.isFinite(data.cornerRadius))) {
      data.cornerRadius = 0;
      changed = true;
    }
    if (changed) {
      migrationPlan.push({ element, serialized: JSON.stringify(data) });
      changedShapes++;
    }
  });

  const summary = changedShapes
    ? `Upgraded board schema from v${fromVersion} to v${CURRENT_BOARD_SCHEMA_VERSION}; added defaults to ${changedShapes} shape${changedShapes === 1 ? '' : 's'}.`
    : `Board schema v${CURRENT_BOARD_SCHEMA_VERSION} is current; no shape data needed changes.`;
  if (!options.dryRun) {
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

function yjsAttrToShape(el: Y.XmlElement): Shape | null {
  try {
    const id = el.getAttribute(ATTR_ID) as string;
    const kind = el.getAttribute(ATTR_KIND) as string;
    const actor = el.getAttribute(ATTR_ACTOR) as string;
    const vector = JSON.parse(el.getAttribute(ATTR_VECTOR) ?? '{}') as ShapeVector;
    const deleted = el.getAttribute(ATTR_DELETED) === 'true';
    const data = JSON.parse(el.getAttribute(ATTR_DATA) ?? '{}') as ShapeData;
    const createdAt = Number(el.getAttribute(ATTR_CREATED) ?? 0);
    const updatedAt = Number(el.getAttribute(ATTR_UPDATED) ?? 0);

    if (!id || !kind || !data) return null;

    return { id, kind: kind as ShapeKind, data, actor, vector, deleted, createdAt, updatedAt };
  } catch {
    return null;
  }
}

// ─── Yjs Canvas State ────────────────────────────────────────────────────────

export interface YjsCanvasState {
  doc: Y.Doc;
  shapesArray: Y.Array<Y.XmlElement>;
  awareness: Awareness;
  onChange: (callback: (shapes: Shape[], conflicts: Conflict[]) => void) => void;
  dispose: () => void;
}

// ─── Create Yjs Canvas ───────────────────────────────────────────────────────

export function createYjsCanvas(actor: string, onConflict?: (c: Conflict[]) => void): YjsCanvasState {
  const doc = new Y.Doc();
  const shapesArray = doc.getArray<Y.XmlElement>('shapes');
  const awareness = new Awareness(doc);

  awareness.setLocalStateField('cursor', { x: 0, y: 0 });
  awareness.setLocalStateField('actor', actor);

  let lastShapes: Shape[] = [];
  let lastEvents: MergeEvent[] = [];

  const defaultOnChange = (shapes: Shape[], conflicts: Conflict[]) => {
    onConflict?.(conflicts);
  };

  let onChangeCallback = defaultOnChange;

  const onChange = (callback: (shapes: Shape[], conflicts: Conflict[]) => void) => {
    onChangeCallback = callback;
  };

  doc.on('update', () => {
    const currentShapes = yjsShapesToShapes(shapesArray);
    const conflicts = detectCanvasConflicts(shapesArray, currentShapes);
    const newEvents = computeChangeEvents(doc, shapesArray, lastShapes, actor);
    lastEvents = [...lastEvents, ...newEvents];
    lastShapes = currentShapes;
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

// ─── Shape Operations ────────────────────────────────────────────────────────

export function createShapeInCanvas(
  canvas: YjsCanvasState,
  kind: ShapeKind,
  data: Partial<ShapeData>,
  actor: string
): string {
  const currentShapes = yjsShapesToShapes(canvas.shapesArray);
  const maxLayer = currentShapes.reduce((max, current, index) => Math.max(max, current.data.zIndex ?? index), -1);
  const shape = createShape(kind, { ...data, kind, zIndex: data.zIndex ?? maxLayer + 1 } as ShapeData, actor, canvas.doc.share ? {} : EMPTY_VECTOR);
  const el = new Y.XmlElement(SHAPE_ELEMENT_TAG);
  const attrs = shapeToYjsAttrs(shape);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  // Store initial actor edit
  el.setAttribute(`actorEdit_${actor}`, JSON.stringify({
    data: shape.data,
    actor,
    ts: shape.createdAt,
    op: 'create',
  } satisfies ActorEdit));

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
  for (const el of canvas.shapesArray) {
    if (el.getAttribute(ATTR_ID) === shapeId) {
      const current = yjsAttrToShape(el);
      if (!current) return;
      const mergedData = { ...current.data, ...data } as ShapeData;
      const now = Date.now();
      const updatedVector = incrementVec(current.vector, actor);

      el.setAttribute(ATTR_DATA, JSON.stringify(mergedData));
      el.setAttribute(ATTR_ACTOR, actor);
      el.setAttribute(ATTR_UPDATED, String(now));
      el.setAttribute(ATTR_VECTOR, JSON.stringify(updatedVector));

      // Record per-actor edit to preserve intent for CRDT semantic merging
      el.setAttribute(`actorEdit_${actor}`, JSON.stringify({
        data: mergedData,
        actor,
        ts: now,
        op,
      } satisfies ActorEdit));

      break;
    }
  }
}

export function deleteShapeInCanvas(canvas: YjsCanvasState, shapeId: string, actor: string): void {
  for (const el of canvas.shapesArray) {
    if (el.getAttribute(ATTR_ID) === shapeId) {
      const now = Date.now();
      el.setAttribute(ATTR_DELETED, 'true');
      el.setAttribute(ATTR_UPDATED, String(now));
      el.setAttribute(ATTR_ACTOR, actor);
      el.setAttribute(`actorEdit_${actor}`, JSON.stringify({
        data: JSON.parse(el.getAttribute(ATTR_DATA) ?? '{}'),
        actor,
        ts: now,
        op: 'delete',
      } satisfies ActorEdit));
      break;
    }
  }
}

// ─── Conflict Resolution ─────────────────────────────────────────────────────

export function resolveConflictInCanvas(
  canvas: YjsCanvasState,
  shapeId: string,
  action: 'merge' | 'keep-local' | 'keep-remote',
  actor: string
): void {
  for (const el of canvas.shapesArray) {
    if (el.getAttribute(ATTR_ID) === shapeId) {
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
          el.setAttribute(ATTR_DATA, JSON.stringify(mergedShape.data));
        }
      } else if (action === 'keep-local') {
        const localEdit = actorEdits.find(e => e.actor === actor);
        if (localEdit) {
          el.setAttribute(ATTR_DATA, JSON.stringify(localEdit.data));
        }
      } else if (action === 'keep-remote') {
        const remoteEdit = actorEdits.find(e => e.actor !== actor);
        if (remoteEdit) {
          el.setAttribute(ATTR_DATA, JSON.stringify(remoteEdit.data));
        }
      }

      el.setAttribute(ATTR_RESOLVED_TS, String(now));
      el.setAttribute(ATTR_UPDATED, String(now));
      break;
    }
  }
}

// ─── Semantic Merge & Conflict Detection ─────────────────────────────────────

function getActorEdits(el: Y.XmlElement): ActorEdit[] {
  const edits: ActorEdit[] = [];
  const attrs = el.getAttributes();
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('actorEdit_') && typeof v === 'string') {
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

export function detectCanvasConflicts(
  shapesArray: Y.Array<Y.XmlElement>,
  activeShapes: Shape[]
): Conflict[] {
  const conflicts: Conflict[] = [];
  const now = Date.now();

  for (const el of shapesArray) {
    const shape = yjsAttrToShape(el);
    if (!shape) continue;

    const resolvedTs = Number(el.getAttribute(ATTR_RESOLVED_TS) || 0);
    const mergedTs = Number(el.getAttribute(ATTR_MERGED_TS) || 0);

    // Collect recent edits from different actors that have not been resolved
    const allEdits = getActorEdits(el);
    const recentEdits = allEdits.filter(e => now - e.ts < 30000 && e.ts > resolvedTs);

    // Group by distinct actors
    const actorMap = new Map<string, ActorEdit>();
    for (const edit of recentEdits) {
      const existing = actorMap.get(edit.actor);
      if (!existing || edit.ts > existing.ts) {
        actorMap.set(edit.actor, edit);
      }
    }

    const distinctEdits = Array.from(actorMap.values());
    if (distinctEdits.length < 2) continue;

    const [editA, editB] = distinctEdits;
    const isConcurrentResize = (editA.op === 'resize' && editB.op === 'resize') ||
      ((editA.op === 'resize' || editB.op === 'resize') &&
       (shape.kind === ShapeKind.Rect || shape.kind === ShapeKind.Image || shape.kind === ShapeKind.Note));

    if (isConcurrentResize) {
      // Apply Union-Bounding-Box Merge Rule automatically
      const latestEditTs = Math.max(editA.ts, editB.ts);
      if (mergedTs < latestEditTs) {
        const shapeA = { ...shape, data: editA.data, actor: editA.actor, updatedAt: editA.ts };
        const shapeB = { ...shape, data: editB.data, actor: editB.actor, updatedAt: editB.ts };
        const merged = mergeShapes(shape, [shapeA, shapeB]);

        el.setAttribute(ATTR_DATA, JSON.stringify(merged.data));
        el.setAttribute(ATTR_MERGED_TS, String(latestEditTs));
        shape.data = merged.data;
        console.log(`[crdt-engine] Merged concurrent resizes via Union-Bounding-Box on ${shape.id} (${editA.actor} + ${editB.actor})`);
      }
      continue;
    }

    // Check for delete vs edit
    const hasDelete = distinctEdits.some(e => e.op === 'delete');
    if (hasDelete) {
      conflicts.push({
        shapeId: shape.id,
        type: 'delete_vs_edit',
        actors: distinctEdits.map(e => e.actor),
        level: 'high',
        description: `Shape edited while deleted by another peer`,
        ts: Math.max(...distinctEdits.map(e => e.ts)),
      });
      continue;
    }

    // Check for divergent moves / positions
    const shapeA = { ...shape, data: editA.data, actor: editA.actor };
    const shapeB = { ...shape, data: editB.data, actor: editB.actor };
    const level = classifyAmbiguity(shapeA, shapeB);

    if (level === 'medium' || level === 'high') {
      conflicts.push({
        shapeId: shape.id,
        type: 'concurrent_edit',
        actors: [editA.actor, editB.actor],
        level,
        description: `Divergent moves by ${editA.actor} and ${editB.actor} (${level} ambiguity)`,
        ts: Math.max(editA.ts, editB.ts),
      });
    }
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
  doc: Y.Doc,
  shapesArray: Y.Array<Y.XmlElement>,
  previousShapes: Shape[],
  localActor: string
): MergeEvent[] {
  const current = yjsShapesToShapes(shapesArray);
  const events: MergeEvent[] = [];
  const prevMap = new Map(previousShapes.map(s => [s.id, s]));
  const currMap = new Map(current.map(s => [s.id, s]));

  for (const [id, shape] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      events.push({ type: 'create', shape, actor: shape.actor, ts: shape.createdAt });
    } else if (JSON.stringify(prev.data) !== JSON.stringify(shape.data) || prev.actor !== shape.actor) {
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
