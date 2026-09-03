import { describe, it, expect } from 'vitest';
import {
  ShapeKind,
  type Shape,
  type Conflict,
  type AmbiguityLevel,
  type ShapeVector,
  type RectShape,
  type TextShape,
  createShape,
  shapeId,
  shapeCenter,
  shapeBBox,
  shapeSize,
  detectConflicts,
  classifyAmbiguity,
  unionBBox,
  mergeShapes,
  EMPTY_VECTOR,
  incrementVec,
} from '../index';

describe('Shape creation and identity', () => {
  it('creates a stroke with a unique ID', () => {
    const s = createShape(ShapeKind.Stroke, {
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      color: '#ff0000',
      width: 2,
    }, 'alice');
    expect(s.id).toMatch(/^[0-9a-f]{8}-/);
    expect(s.kind).toBe(ShapeKind.Stroke);
    expect(s.actor).toBe('alice');
  });

  it('creates a rect', () => {
    const s = createShape(ShapeKind.Rect, { x: 10, y: 20, w: 100, h: 50, color: '#00ff00' }, 'bob');
    expect(s.kind).toBe(ShapeKind.Rect);
    expect((s.data as RectShape).x).toBe(10);
    expect((s.data as RectShape).y).toBe(20);
  });

  it('creates text', () => {
    const s = createShape(ShapeKind.Text, { x: 0, y: 0, text: 'hello', color: '#0000ff' }, 'carol');
    expect(s.kind).toBe(ShapeKind.Text);
    expect((s.data as TextShape).text).toBe('hello');
  });

  it('shapeId returns the ID', () => {
    const s = createShape(ShapeKind.Stroke, { points: [], color: '#fff', width: 1 }, 'a');
    expect(shapeId(s)).toBe(s.id);
  });
});

describe('Vector math', () => {
  it('increments a vector', () => {
    const v = incrementVec(EMPTY_VECTOR, 'alice');
    expect(v).toEqual({ alice: 1 });
  });

  it('increments multiple times', () => {
    const v = incrementVec(incrementVec(EMPTY_VECTOR, 'alice'), 'bob');
    expect(v).toEqual({ alice: 1, bob: 1 });
  });
});

describe('Shape geometry', () => {
  it('computes center of a rect', () => {
    const s = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 60, color: '#fff' }, 'a');
    expect(shapeCenter(s)).toEqual({ x: 50, y: 30 });
  });

  it('computes bbox of a rect', () => {
    const s = createShape(ShapeKind.Rect, { x: 10, y: 20, w: 80, h: 40, color: '#fff' }, 'a');
    const b = shapeBBox(s);
    expect(b).toEqual({ minX: 10, minY: 20, maxX: 90, maxY: 60 });
  });

  it('computes bbox of a stroke', () => {
    const s = createShape(ShapeKind.Stroke, {
      points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 3, y: 8 }],
      color: '#f00', width: 2,
    }, 'a');
    const b = shapeBBox(s);
    expect(b.minX).toBe(0);
    expect(b.maxX).toBe(10);
    expect(b.minY).toBe(0);
    expect(b.maxY).toBe(8);
  });

  it('computes size from bbox', () => {
    const s = createShape(ShapeKind.Rect, { x: 10, y: 20, w: 80, h: 40, color: '#fff' }, 'a');
    const sz = shapeSize(s);
    expect(sz).toEqual({ w: 80, h: 40 });
  });
});

describe('Union bounding box', () => {
  it('returns the enclosing box of two overlapping rects', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b = { minX: 5, minY: 5, maxX: 15, maxY: 15 };
    expect(unionBBox(a, b)).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 15 });
  });

  it('handles disjoint boxes', () => {
    const a = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    const b = { minX: 10, minY: 10, maxX: 12, maxY: 12 };
    expect(unionBBox(a, b)).toEqual({ minX: 0, minY: 0, maxX: 12, maxY: 12 });
  });
});

describe('Conflict detection', () => {
  it('detects concurrent modification of the same shape', () => {
    const s = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    const conflict: Conflict = {
      shapeId: s.id,
      type: 'concurrent_edit',
      actors: ['alice', 'bob'],
      level: 'medium',
      description: 'Two users edited the same shape',
      ts: Date.now(),
    };
    const conflicts = detectConflicts([s], [conflict]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].shapeId).toBe(s.id);
  });

  it('returns empty conflicts when none exist', () => {
    const s = createShape(ShapeKind.Stroke, { points: [], color: '#fff', width: 1 }, 'alice');
    const conflicts = detectConflicts([s]);
    expect(conflicts).toHaveLength(0);
  });
});

describe('Ambiguity classification', () => {
  it('classifies low ambiguity for same-position moves', () => {
    const s1 = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    const s2 = { ...s1, data: { ...s1.data, x: 8, y: 8 } as RectShape, actor: 'bob', updatedAt: s1.updatedAt + 1 };
    const level = classifyAmbiguity(s1, s2);
    expect(level).toBe('low');
  });

  it('classifies high ambiguity for divergent moves', () => {
    const s1 = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 50, h: 50, color: '#fff' }, 'alice');
    const s2 = { ...s1, data: { ...s1.data, x: 200, y: 200 } as RectShape, actor: 'bob', updatedAt: s1.updatedAt + 1 };
    const level = classifyAmbiguity(s1, s2);
    expect(level).toBe('high');
  });

  it('returns none for identical shapes', () => {
    const s1 = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    const s2 = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'bob');
    const level = classifyAmbiguity(s1, s2);
    expect(level).toBe('none');
  });
});

describe('Merge shapes with union-bbox for concurrent resizes', () => {
  it('unions bounding boxes when two users resize concurrently', () => {
    const base = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    const resizeA = { ...base, data: { ...base.data, w: 150 } as RectShape, updatedAt: base.updatedAt + 1 };
    const resizeB = { ...base, data: { ...base.data, h: 200 } as RectShape, updatedAt: base.updatedAt + 2 };
    const merged = mergeShapes(base, [resizeA, resizeB]);
    expect((merged.data as RectShape).w).toBeGreaterThanOrEqual(150);
    expect((merged.data as RectShape).h).toBeGreaterThanOrEqual(200);
  });
});
