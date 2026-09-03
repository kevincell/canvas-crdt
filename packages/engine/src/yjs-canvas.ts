/**
 * Yjs Integration Layer
 *
 * Wraps Yjs's CRDT engine with our semantic types and conflict detection.
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
    const conflicts = detectConflicts(currentShapes);
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
  const shape = createShape(kind, { ...data, kind } as ShapeData, actor, canvas.doc.share ? {} : EMPTY_VECTOR);
  const el = new Y.XmlElement(SHAPE_ELEMENT_TAG);
  const attrs = shapeToYjsAttrs(shape);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  canvas.shapesArray.push([el]);
  return shape.id;
}

export function updateShapeInCanvas(
  canvas: YjsCanvasState,
  shapeId: string,
  data: Partial<ShapeData>,
  actor: string
): void {
  for (const el of canvas.shapesArray) {
    if (el.getAttribute(ATTR_ID) === shapeId) {
      const current = yjsAttrToShape(el);
      if (!current) return;
      const merged = { ...current.data, ...data } as ShapeData;
      const attrs = shapeToYjsAttrs({ ...current, data: merged, actor, updatedAt: Date.now() });
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
      }
      break;
    }
  }
}

export function deleteShapeInCanvas(canvas: YjsCanvasState, shapeId: string, actor: string): void {
  for (const el of canvas.shapesArray) {
    if (el.getAttribute(ATTR_ID) === shapeId) {
      el.setAttribute(ATTR_DELETED, 'true');
      el.setAttribute(ATTR_UPDATED, String(Date.now()));
      el.setAttribute(ATTR_ACTOR, actor);
      break;
    }
  }
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

function computeChangeEvents(
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
