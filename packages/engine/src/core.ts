/**
 * CRDT Canvas Engine — Semantic conflict detection and merge rules for 2D collaborative drawing.
 *
 * This module defines the shape types, vector clocks, conflict detection,
 * ambiguity classification, and semantic merge strategies used by the canvas.
 */

// ─── Shape Kinds ────────────────────────────────────────────────────────────

export enum ShapeKind {
  Stroke = 'stroke',
  Rect = 'rect',
  Ellipse = 'ellipse',
  Line = 'line',
  Text = 'text',
  Image = 'image',
  Note = 'note',
}

// ─── Shape Data ─────────────────────────────────────────────────────────────

export type Point = { x: number; y: number };

export type ShapeMetadata = {
  /** Optional shared grouping membership for related board objects. */
  groupId?: string;
  /** Optional shared layer order. Shapes without a value keep legacy array order. */
  zIndex?: number;
  /** Prevents accidental local manipulation; unlocking remains an explicit action. */
  locked?: boolean;
  /** A named rectangle used as a visual board frame. */
  frameTitle?: string;
  /** Optional parent frame membership for future frame-aware navigation. */
  frameId?: string;
};

export type StrokeShape = ShapeMetadata & {
  kind: ShapeKind.Stroke;
  points: Point[];
  color: string;
  width: number;
};

export type RectShape = ShapeMetadata & {
  kind: ShapeKind.Rect;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  fillOpacity?: number;
  strokeWidth?: number;
  cornerRadius?: number;
};

export type TextShape = ShapeMetadata & {
  kind: ShapeKind.Text;
  x: number;
  y: number;
  text: string;
  color: string;
};

export type EllipseShape = ShapeMetadata & {
  kind: ShapeKind.Ellipse;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  fillOpacity?: number;
  strokeWidth?: number;
};

export type LineShape = ShapeMetadata & {
  kind: ShapeKind.Line;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  arrowEnd?: boolean;
  /** Optional live endpoint bindings to rectangular/elliptical board objects. */
  startShapeId?: string;
  endShapeId?: string;
};

export type ImageShape = ShapeMetadata & {
  kind: ShapeKind.Image;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
};

export type NoteShape = ShapeMetadata & {
  kind: ShapeKind.Note;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  bgColor: string;
};

export type ShapeData = StrokeShape | RectShape | EllipseShape | LineShape | TextShape | ImageShape | NoteShape;
type ShapePayload<T = ShapeData> = T extends ShapeData ? Omit<T, 'kind'> : never;

// ─── Shape (with CRDT metadata) ─────────────────────────────────────────────

export type ShapeVector = Record<string, number>;

export const EMPTY_VECTOR: ShapeVector = {};

export function incrementVec(vec: ShapeVector, actor: string): ShapeVector {
  return { ...vec, [actor]: (vec[actor] ?? 0) + 1 };
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  data: ShapeData;
  actor: string;
  vector: ShapeVector;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Return all assigned descendants and their grouped peers for frame transforms. */
export function frameDescendants(shapes: Shape[], frameId: string): Shape[] {
  const parentFrameIds = new Set([frameId]);
  const groupIds = new Set<string>();
  const members = new Map<string, Shape>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const shape of shapes) {
      if (shape.deleted || shape.id === frameId || members.has(shape.id)) continue;
      const parent = shape.data.frameId;
      const group = shape.data.groupId;
      if ((!parent || !parentFrameIds.has(parent)) && (!group || !groupIds.has(group))) continue;
      members.set(shape.id, shape);
      if (group) groupIds.add(group);
      if (shape.data.kind === ShapeKind.Rect && shape.data.frameTitle) parentFrameIds.add(shape.id);
      changed = true;
    }
  }
  return Array.from(members.values());
}

// ─── Shape Creation ─────────────────────────────────────────────────────────

export function createShape<T extends ShapePayload>(
  kind: ShapeKind,
  data: T,
  actor: string,
  vector: ShapeVector = EMPTY_VECTOR
): Shape {
  const now = Date.now();
  return {
    id: crypto.randomUUID().slice(0, 8) + '-' + now.toString(36),
    kind,
    data: { ...data, kind } as unknown as ShapeData,
    actor,
    vector,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Shape Geometry Helpers ──────────────────────────────────────────────────

export function shapeId(s: Shape): string {
  return s.id;
}

export function shapeCenter(s: Shape): Point {
  const b = shapeBBox(s);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function shapeBBox(s: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
  const d = s.data;
  if (d.kind === ShapeKind.Stroke) {
    if (d.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of d.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }
  if (d.kind === ShapeKind.Rect) {
    return { minX: d.x, minY: d.y, maxX: d.x + d.w, maxY: d.y + d.h };
  }
  if (d.kind === ShapeKind.Ellipse) {
    return { minX: d.cx - d.rx, minY: d.cy - d.ry, maxX: d.cx + d.rx, maxY: d.cy + d.ry };
  }
  if (d.kind === ShapeKind.Line) {
    return { minX: Math.min(d.x1, d.x2), minY: Math.min(d.y1, d.y2), maxX: Math.max(d.x1, d.x2), maxY: Math.max(d.y1, d.y2) };
  }
  if (d.kind === ShapeKind.Text) {
    const lines = d.text.split('\n');
    const estW = Math.max(1, ...lines.map(line => line.length)) * 9;
    const estH = Math.max(1, lines.length) * 20;
    return { minX: d.x, minY: d.y - 16, maxX: d.x + estW, maxY: d.y - 16 + estH };
  }
  if (d.kind === ShapeKind.Image) {
    return { minX: d.x, minY: d.y, maxX: d.x + d.w, maxY: d.y + d.h };
  }
  if (d.kind === ShapeKind.Note) {
    return { minX: d.x, minY: d.y, maxX: d.x + d.w, maxY: d.y + d.h };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export function attachedLineEndpoints(line: LineShape, shapes: Shape[] | ReadonlyMap<string, Shape>): { start: Point; end: Point } {
  const byId = Array.isArray(shapes)
    ? new Map(shapes.filter(shape => !shape.deleted).map(shape => [shape.id, shape]))
    : shapes as ReadonlyMap<string, Shape>;
  const startTarget = line.startShapeId ? byId.get(line.startShapeId) : undefined;
  const endTarget = line.endShapeId ? byId.get(line.endShapeId) : undefined;
  const startCenter = startTarget ? shapeCenter(startTarget) : { x: line.x1, y: line.y1 };
  const endCenter = endTarget ? shapeCenter(endTarget) : { x: line.x2, y: line.y2 };
  return {
    start: startTarget ? boundaryPoint(startTarget, endCenter.x, endCenter.y, line.x1, line.y1) : { x: line.x1, y: line.y1 },
    end: endTarget ? boundaryPoint(endTarget, startCenter.x, startCenter.y, line.x2, line.y2) : { x: line.x2, y: line.y2 },
  };
}

function boundaryPoint(shape: Shape, towardX: number, towardY: number, fallbackX: number, fallbackY: number): Point {
  const center = shapeCenter(shape);
  let dx = towardX - center.x, dy = towardY - center.y;
  if (Math.hypot(dx, dy) < 0.001) { dx = fallbackX - center.x; dy = fallbackY - center.y; }
  if (Math.hypot(dx, dy) < 0.001) dx = 1;
  const data = shape.data;
  if (data.kind === ShapeKind.Ellipse && data.rx > 0 && data.ry > 0) {
    const t = 1 / Math.sqrt((dx * dx) / (data.rx * data.rx) + (dy * dy) / (data.ry * data.ry));
    return { x: center.x + dx * t, y: center.y + dy * t };
  }
  const bounds = shapeBBox(shape);
  const halfWidth = Math.max((bounds.maxX - bounds.minX) / 2, 0.001);
  const halfHeight = Math.max((bounds.maxY - bounds.minY) / 2, 0.001);
  const t = Math.min(halfWidth / Math.abs(dx || 0.000001), halfHeight / Math.abs(dy || 0.000001));
  return { x: center.x + dx * t, y: center.y + dy * t };
}

export function shapeSize(s: Shape): { w: number; h: number } {
  const b = shapeBBox(s);
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// ─── Union Bounding Box (Novel Semantic Merge Rule) ─────────────────────────

export function unionBBox(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Transforms member shape coordinates when its parent frame is resized.
 *
 * DESIGN DECISION (L32):
 * Text glyphs and font sizes do NOT scale when a frame is resized. Frame resize updates
 * positional coordinates (x, y) so text remains anchored relative to the frame boundary,
 * while keeping typography crisp, legible, and uniform across devices. Notes scale their
 * outer bounding box (w, h) while letting internal text re-flow naturally rather than
 * distorting letterforms.
 */
export function scaleFrameMember(
  data: ShapeData,
  from: { minX: number; minY: number; maxX: number; maxY: number },
  to: { minX: number; minY: number; maxX: number; maxY: number }
): ShapeData {
  const scaleX = (to.maxX - to.minX) / Math.max(1, from.maxX - from.minX);
  const scaleY = (to.maxY - to.minY) / Math.max(1, from.maxY - from.minY);
  const mapX = (x: number) => to.minX + (x - from.minX) * scaleX;
  const mapY = (y: number) => to.minY + (y - from.minY) * scaleY;
  if (data.kind === ShapeKind.Rect || data.kind === ShapeKind.Note || data.kind === ShapeKind.Image) {
    return { ...data, x: mapX(data.x), y: mapY(data.y), w: data.w * scaleX, h: data.h * scaleY };
  }
  if (data.kind === ShapeKind.Ellipse) {
    return { ...data, cx: mapX(data.cx), cy: mapY(data.cy), rx: data.rx * scaleX, ry: data.ry * scaleY };
  }
  if (data.kind === ShapeKind.Line) {
    return { ...data, x1: mapX(data.x1), y1: mapY(data.y1), x2: mapX(data.x2), y2: mapY(data.y2) };
  }
  if (data.kind === ShapeKind.Stroke) {
    return { ...data, points: data.points.map(point => ({ x: mapX(point.x), y: mapY(point.y) })) };
  }
  // ShapeKind.Text preserves font size / glyphs; only position scales
  return { ...data, x: mapX(data.x), y: mapY(data.y) };
}


// ─── Ambiguity Classification (Novel Contribution) ──────────────────────────

export type AmbiguityLevel = 'none' | 'low' | 'medium' | 'high';

export function classifyAmbiguity(a: Shape, b: Shape): AmbiguityLevel {
  if (a.id !== b.id) return 'none';
  if (a.deleted || b.deleted) return 'none';

  const centerA = shapeCenter(a);
  const centerB = shapeCenter(b);
  const sizeA = shapeSize(a);
  const sizeB = shapeSize(b);

  const dx = Math.abs(centerA.x - centerB.x);
  const dy = Math.abs(centerA.y - centerB.y);
  const avgSize = Math.max(sizeA.w, sizeB.w, sizeA.h, sizeB.h, 1);

  const displacement = Math.sqrt(dx * dx + dy * dy);
  const ratio = displacement / avgSize;

  if (ratio < 0.1) return 'none';
  if (ratio < 0.5) return 'low';
  if (ratio < 1.5) return 'medium';
  return 'high';
}

// ─── Conflict Types ─────────────────────────────────────────────────────────

export type ConflictType =
  | 'concurrent_edit'
  | 'delete_vs_edit'
  | 'concurrent_delete'
  | 'connector_orphan';

export interface Conflict {
  shapeId: string;
  type: ConflictType;
  actors: string[];
  level: AmbiguityLevel;
  description: string;
  ts: number;
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

export function detectConflicts(shapes: Shape[], conflicts: Conflict[] = []): Conflict[] {
  const byId = new Map<string, Shape[]>();
  for (const s of shapes) {
    if (!byId.has(s.id)) byId.set(s.id, []);
    byId.get(s.id)!.push(s);
  }

  const detected: Conflict[] = [...conflicts];

  for (const [id, versions] of byId) {
    const active = versions.filter(s => !s.deleted);
    const deleted = versions.filter(s => s.deleted);

    if (active.length > 1) {
      const actors = [...new Set(active.map(s => s.actor))];
      if (actors.length > 1) {
        const level = classifyAmbiguity(active[0], active[1]);
        detected.push({
          shapeId: id,
          type: 'concurrent_edit',
          actors,
          level,
          description: `Concurrent edits by ${actors.join(', ')}`,
          ts: Date.now(),
        });
      }
    }

    if (active.length > 0 && deleted.length > 0) {
      detected.push({
        shapeId: id,
        type: 'delete_vs_edit',
        actors: [...new Set([...active.map(s => s.actor), ...deleted.map(s => s.actor)])],
        level: classifyAmbiguity(active[0], deleted[0]),
        description: 'Shape was edited after deletion intent',
        ts: Date.now(),
      });
    }
  }

  return detected;
}

// ─── Semantic Merge (Union-BBox for concurrent resizes) ─────────────────────

export function mergeShapes(base: Shape, edits: Shape[]): Shape {
  if (edits.length === 0) return base;

  const d = base.data;

  if (d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse || d.kind === ShapeKind.Line || d.kind === ShapeKind.Image || d.kind === ShapeKind.Note) {
    const bbox = edits.reduce(
      (acc, e) => {
        if (e.data.kind !== d.kind) return acc;
        return unionBBox(acc, shapeBBox(e));
      },
      shapeBBox(base)
    );
    if (d.kind === ShapeKind.Rect) {
      return {
        ...base,
        data: { ...d, x: bbox.minX, y: bbox.minY, w: bbox.maxX - bbox.minX, h: bbox.maxY - bbox.minY } as RectShape,
        updatedAt: Date.now(),
        vector: edits.reduce((v, e) => ({ ...v, ...e.vector }), base.vector),
      };
    }
    if (d.kind === ShapeKind.Ellipse) {
      return {
        ...base,
        data: { ...d, cx: (bbox.minX + bbox.maxX) / 2, cy: (bbox.minY + bbox.maxY) / 2, rx: (bbox.maxX - bbox.minX) / 2, ry: (bbox.maxY - bbox.minY) / 2 } as EllipseShape,
        updatedAt: Date.now(),
        vector: edits.reduce((v, e) => ({ ...v, ...e.vector }), base.vector),
      };
    }
    if (d.kind === ShapeKind.Line) {
      // Just keep LWW for endpoints but maybe apply bbox bounds in a smart way. For simplicity, LWW:
      const latest = edits.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b), edits[0]);
      return {
        ...base,
        data: { ...latest.data } as LineShape,
        updatedAt: Date.now(),
        vector: { ...base.vector, ...latest.vector },
      };
    }
    if (d.kind === ShapeKind.Image) {
      return {
        ...base,
        data: { ...d, x: bbox.minX, y: bbox.minY, w: bbox.maxX - bbox.minX, h: bbox.maxY - bbox.minY } as ImageShape,
        updatedAt: Date.now(),
        vector: edits.reduce((v, e) => ({ ...v, ...e.vector }), base.vector),
      };
    }
    if (d.kind === ShapeKind.Note) {
      return {
        ...base,
        data: { ...d, x: bbox.minX, y: bbox.minY, w: bbox.maxX - bbox.minX, h: bbox.maxY - bbox.minY } as NoteShape,
        updatedAt: Date.now(),
        vector: edits.reduce((v, e) => ({ ...v, ...e.vector }), base.vector),
      };
    }
  }

  if (d.kind === ShapeKind.Stroke) {
    const allPoints = [...d.points];
    for (const e of edits) {
      if (e.data.kind === ShapeKind.Stroke) {
        allPoints.push(...e.data.points);
      }
    }
    const unique = dedupPoints(allPoints);
    return {
      ...base,
      data: { ...d, points: unique } as StrokeShape,
      updatedAt: Date.now(),
      vector: edits.reduce((v, e) => ({ ...v, ...e.vector }), base.vector),
    };
  }

  // For text and notes: last writer wins
  const latest = edits.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b), edits[0]);
  return {
    ...base,
    data: { ...latest.data } as TextShape,
    updatedAt: Date.now(),
    vector: { ...base.vector, ...latest.vector },
  };
}

export function dedupPoints(points: Point[], threshold = 0.5): Point[] {
  if (points.length <= 1) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    const dx = points[i].x - last.x;
    const dy = points[i].y - last.y;
    if (dx * dx + dy * dy > threshold * threshold) {
      result.push(points[i]);
    }
  }
  return result;
}

// ─── Merge History ───────────────────────────────────────────────────────────

export type HistoryEventType = 'create' | 'update' | 'delete' | 'conflict' | 'merge';

export interface HistoryEntry {
  type: HistoryEventType;
  shapeId?: string;
  shape?: Shape;
  previous?: Shape;
  actors?: string[];
  level?: AmbiguityLevel;
  description?: string;
  ts: number;
}

export type MergeEvent =
  | { type: 'create'; shape: Shape; actor: string; ts: number }
  | { type: 'update'; shape: Shape; actor: string; previous: Shape; ts: number }
  | { type: 'delete'; shapeId: string; actor: string; ts: number }
  | { type: 'conflict'; shapeId: string; actors: string[]; level: AmbiguityLevel; description: string; ts: number }
  | { type: 'merge'; shapeId: string; actors: string[]; method: string; ts: number };

export interface MergeHistory {
  entries: HistoryEntry[];
  totalSteps: number;
  playback(step: number): Shape[];
  conflicts(): Conflict[];
}

export function buildMergeHistory(events: MergeEvent[]): MergeHistory {
  const entries: HistoryEntry[] = [];
  const state = new Map<string, Shape>();

  for (const ev of events) {
    if (ev.type === 'create') {
      state.set(ev.shape.id, ev.shape);
      entries.push({ type: 'create', shape: ev.shape, ts: ev.ts });
    } else if (ev.type === 'update') {
      const prev = state.get(ev.shape.id);
      if (prev) {
        state.set(ev.shape.id, ev.shape);
        entries.push({ type: 'update', shape: ev.shape, previous: prev, ts: ev.ts });
      }
    } else if (ev.type === 'delete') {
      const shape = state.get(ev.shapeId);
      if (shape) {
        state.set(ev.shapeId, { ...shape, deleted: true, updatedAt: ev.ts });
        entries.push({ type: 'delete', shapeId: ev.shapeId, ts: ev.ts });
      }
    } else if (ev.type === 'conflict') {
      entries.push({
        type: 'conflict',
        shapeId: ev.shapeId,
        actors: ev.actors,
        level: ev.level,
        description: ev.description,
        ts: ev.ts,
      });
    } else if (ev.type === 'merge') {
      entries.push({
        type: 'merge',
        shapeId: ev.shapeId,
        actors: ev.actors,
        ts: ev.ts,
      });
    }
  }

  return {
    entries,
    totalSteps: entries.length,
    playback(step: number): Shape[] {
      const snapshot = new Map<string, Shape>();
      for (let i = 0; i < step && i < entries.length; i++) {
        const entry = entries[i];
        if (entry.shape) {
          snapshot.set(entry.shape.id, entry.shape);
        }
        if (entry.type === 'delete' && entry.shapeId) {
          const s = snapshot.get(entry.shapeId);
          if (s) snapshot.set(entry.shapeId, { ...s, deleted: true });
        }
      }
      return [...snapshot.values()].filter(s => !s.deleted);
    },
    conflicts(): Conflict[] {
      return entries
        .filter(e => e.type === 'conflict')
        .map(e => ({
          shapeId: e.shapeId!,
          type: 'concurrent_edit' as ConflictType,
          actors: e.actors ?? [],
          level: e.level ?? 'medium',
          description: e.description ?? '',
          ts: e.ts,
        }));
    },
  };
}
