import { describe, it, expect } from 'vitest';
import {
  buildMergeHistory,
  type HistoryEntry,
  type MergeEvent,
  type RectShape,
  ShapeKind,
  createShape,
} from '../index';

describe('Merge history building', () => {
  it('records shape creation events', () => {
    const s = createShape(ShapeKind.Stroke, { points: [], color: '#f00', width: 2 }, 'alice');
    const events: MergeEvent[] = [{ type: 'create', shape: s, actor: 'alice', ts: 1000 }];
    const history = buildMergeHistory(events);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].type).toBe('create');
  });

  it('records shape updates', () => {
    const base = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    const updated = { ...base, data: { ...base.data, x: 10, y: 10, w: 120, h: 120 } as RectShape, actor: 'bob', updatedAt: 2000 };
    const events: MergeEvent[] = [
      { type: 'create', shape: base, actor: 'alice', ts: 1000 },
      { type: 'update', shape: updated, actor: 'bob', previous: base, ts: 2000 },
    ];
    const history = buildMergeHistory(events);
    expect(history.entries).toHaveLength(2);
    expect(history.entries[1].type).toBe('update');
  });

  it('records conflicts with ambiguity level', () => {
    const s1 = createShape(ShapeKind.Rect, { x: 0, y: 0, w: 50, h: 50, color: '#fff' }, 'alice');
    const s2 = createShape(ShapeKind.Rect, { x: 200, y: 200, w: 50, h: 50, color: '#fff' }, 'bob');
    const events: MergeEvent[] = [
      { type: 'create', shape: s1, actor: 'alice', ts: 1000 },
      { type: 'create', shape: s2, actor: 'bob', ts: 1001 },
      { type: 'conflict', shapeId: s1.id, actors: ['alice', 'bob'], level: 'high', description: 'Divergent positions', ts: 1002 },
    ];
    const history = buildMergeHistory(events);
    const conflictEntry = history.entries.find(e => e.type === 'conflict');
    expect(conflictEntry).toBeDefined();
    expect(conflictEntry!.level).toBe('high');
  });

  it('supports playback at a given step', () => {
    const s1 = createShape(ShapeKind.Stroke, { points: [], color: '#f00', width: 2 }, 'alice');
    const s2 = createShape(ShapeKind.Stroke, { points: [], color: '#0f0', width: 2 }, 'bob');
    const events: MergeEvent[] = [
      { type: 'create', shape: s1, actor: 'alice', ts: 1000 },
      { type: 'create', shape: s2, actor: 'bob', ts: 2000 },
    ];
    const history = buildMergeHistory(events);
    expect(history.playback(0)).toEqual([]);
    expect(history.playback(1)).toHaveLength(1);
    expect(history.playback(1)[0]?.id).toBe(s1.id);
    expect(history.playback(2)).toHaveLength(2);
  });

  it('returns total step count', () => {
    const s = createShape(ShapeKind.Stroke, { points: [], color: '#f00', width: 2 }, 'alice');
    const history = buildMergeHistory([{ type: 'create', shape: s, actor: 'alice', ts: 0 }]);
    expect(history.totalSteps).toBe(1);
  });
});
