/**
 * Schema v2 engine guarantees:
 *  - per-property merge (concurrent edits to different properties both survive)
 *  - causal conflict detection (sequential edits are never conflicts)
 *  - CanvasStore incremental identity, per-user undo, id-preserving undo
 *  - semantic diff, ink recognition, precise hit testing, sneakernet merge files
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createYjsCanvas,
  createShapeInCanvas,
  updateShapeInCanvas,
  deleteShapeInCanvas,
  getActiveShapes,
  detectCanvasConflicts,
  migrateBoardDocument,
  CURRENT_BOARD_SCHEMA_VERSION,
} from '../yjs-canvas';
import { ShapeKind, translateShapeData, textMetrics, type RectShape, type Shape, type NoteShape } from '../core';
import { CanvasStore } from '../store';
import { diffBoards, summarizeDiff } from '../diff';
import { recognizeStroke } from '../recognize';
import { hitTestShape, shapeInsideBounds } from '../geometry';
import { encodeBoardFile, decodeBoardFile, previewMerge, applyMerge, isBoardFile } from '../sneakernet';

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('per-property merge (schema v2)', () => {
  it('keeps both edits when peers change different properties concurrently', () => {
    const alice = createYjsCanvas('alice');
    const bob = createYjsCanvas('bob');
    const id = createShapeInCanvas(alice, ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#000000' }, 'alice');
    sync(alice.doc, bob.doc);

    updateShapeInCanvas(alice, id, { color: '#ff0000' } as Partial<RectShape>, 'alice', 'update');
    updateShapeInCanvas(bob, id, { x: 300, y: 200 } as Partial<RectShape>, 'bob', 'move');
    sync(alice.doc, bob.doc);

    for (const peer of [alice, bob]) {
      const rect = getActiveShapes(peer).find(s => s.id === id)!.data as RectShape;
      expect(rect.color).toBe('#ff0000');
      expect(rect.x).toBe(300);
      expect(rect.y).toBe(200);
    }
  });

  it('removes a field when it is patched to undefined', () => {
    const c = createYjsCanvas('a');
    const id = createShapeInCanvas(c, ShapeKind.Rect, { x: 0, y: 0, w: 1, h: 1, color: '#000', groupId: 'g1' }, 'a');
    updateShapeInCanvas(c, id, { groupId: undefined } as Partial<RectShape>, 'a');
    expect(getActiveShapes(c)[0].data.groupId).toBeUndefined();
  });

  it('reads legacy v1 records (no overlays) and migrates to the current schema', () => {
    const c = createYjsCanvas('a');
    const el = new Y.XmlElement('shape');
    el.setAttribute('id', 'legacy');
    el.setAttribute('kind', ShapeKind.Rect);
    el.setAttribute('actor', 'old');
    el.setAttribute('vector', '{}');
    el.setAttribute('deleted', 'false');
    el.setAttribute('createdAt', '1');
    el.setAttribute('updatedAt', '1');
    el.setAttribute('data', JSON.stringify({ kind: ShapeKind.Rect, x: 5, y: 5, w: 10, h: 10, color: '#123456', zIndex: 0, fillOpacity: 0.1, strokeWidth: 1, cornerRadius: 0 }));
    c.shapesArray.push([el]);
    c.doc.getMap('boardMeta').set('schemaVersion', 1);
    const result = migrateBoardDocument(c.doc);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(CURRENT_BOARD_SCHEMA_VERSION);
    expect((getActiveShapes(c)[0].data as RectShape).color).toBe('#123456');
  });
});

describe('causal conflict detection', () => {
  it('does not flag sequential edits by different people as a conflict', () => {
    const alice = createYjsCanvas('alice');
    const bob = createYjsCanvas('bob');
    const id = createShapeInCanvas(alice, ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    sync(alice.doc, bob.doc);
    updateShapeInCanvas(alice, id, { x: 900, y: 900 } as Partial<RectShape>, 'alice', 'move');
    sync(alice.doc, bob.doc);
    // Bob saw Alice's move, then moved it far away: a hand-off, not a conflict.
    updateShapeInCanvas(bob, id, { x: -900, y: -900 } as Partial<RectShape>, 'bob', 'move');
    sync(alice.doc, bob.doc);
    expect(detectCanvasConflicts(alice.shapesArray)).toHaveLength(0);
  });

  it('flags truly concurrent divergent moves with high ambiguity', () => {
    const alice = createYjsCanvas('alice');
    const bob = createYjsCanvas('bob');
    const id = createShapeInCanvas(alice, ShapeKind.Rect, { x: 0, y: 0, w: 100, h: 100, color: '#fff' }, 'alice');
    sync(alice.doc, bob.doc);
    updateShapeInCanvas(alice, id, { x: -900, y: 0 } as Partial<RectShape>, 'alice', 'move');
    updateShapeInCanvas(bob, id, { x: 900, y: 0 } as Partial<RectShape>, 'bob', 'move');
    sync(alice.doc, bob.doc);
    const conflicts = detectCanvasConflicts(bob.shapesArray);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].level).toBe('high');
    // Every peer derives the same verdict without coordination.
    expect(detectCanvasConflicts(alice.shapesArray)).toEqual(conflicts);
  });

  it('merges concurrent resizes on both sides of a shape into their union', () => {
    const alice = createYjsCanvas('alice');
    const bob = createYjsCanvas('bob');
    const id = createShapeInCanvas(alice, ShapeKind.Rect, { x: 100, y: 100, w: 100, h: 100, color: '#fff' }, 'alice');
    sync(alice.doc, bob.doc);
    updateShapeInCanvas(alice, id, { x: 50, w: 150 } as Partial<RectShape>, 'alice', 'resize'); // grows left
    updateShapeInCanvas(bob, id, { w: 200 } as Partial<RectShape>, 'bob', 'resize');            // grows right
    sync(alice.doc, bob.doc);
    detectCanvasConflicts(alice.shapesArray);
    detectCanvasConflicts(bob.shapesArray);
    sync(alice.doc, bob.doc);
    for (const peer of [alice, bob]) {
      const rect = getActiveShapes(peer)[0].data as RectShape;
      expect(rect.x).toBe(50);
      expect(rect.x + rect.w).toBe(300);
    }
  });
});

describe('CanvasStore', () => {
  it('keeps object identity for untouched shapes across updates', async () => {
    const doc = new Y.Doc();
    const store = new CanvasStore(doc, 'a');
    const a = store.create(ShapeKind.Rect, { x: 0, y: 0, w: 10, h: 10, color: '#000' })!;
    const b = store.create(ShapeKind.Rect, { x: 50, y: 0, w: 10, h: 10, color: '#000' })!;
    const before = store.flush();
    store.update(a, { x: 5 } as Partial<RectShape>, 'move');
    const after = store.flush();
    expect(after.byId.get(b)).toBe(before.byId.get(b));
    expect(after.byId.get(a)).not.toBe(before.byId.get(a));
    store.dispose();
  });

  it('undo restores a deleted shape with the same id so connectors stay attached', () => {
    const doc = new Y.Doc();
    const store = new CanvasStore(doc, 'a');
    const box = store.create(ShapeKind.Rect, { x: 0, y: 0, w: 10, h: 10, color: '#000' })!;
    store.stopCapturing();
    const arrow = store.create(ShapeKind.Line, { x1: 0, y1: 0, x2: 50, y2: 50, color: '#000', width: 2, endShapeId: box })!;
    store.stopCapturing();
    store.remove([box]);
    store.stopCapturing();
    expect(store.flush().shapes.map(s => s.id)).toEqual([arrow]);
    store.undo();
    expect(store.flush().shapes.map(s => s.id).sort()).toEqual([box, arrow].sort());
    store.dispose();
  });

  it('undo never reverts a collaborator\'s edits', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const alice = new CanvasStore(docA, 'alice');
    const bob = new CanvasStore(docB, 'bob');
    const id = alice.create(ShapeKind.Rect, { x: 0, y: 0, w: 10, h: 10, color: '#000' })!;
    alice.stopCapturing();
    sync(docA, docB);
    bob.update(id, { color: '#00ff00' } as Partial<RectShape>);
    sync(docA, docB);
    alice.update(id, { x: 100 } as Partial<RectShape>, 'move');
    alice.stopCapturing();
    alice.undo();
    const rect = alice.flush().byId.get(id)!.data as RectShape;
    expect(rect.x).toBe(0);
    expect(rect.color).toBe('#00ff00');
    alice.dispose(); bob.dispose();
  });

  it('groups a continuous drag into a single undo step', () => {
    const doc = new Y.Doc();
    const store = new CanvasStore(doc, 'a', { captureTimeout: 10_000 });
    const id = store.create(ShapeKind.Rect, { x: 0, y: 0, w: 10, h: 10, color: '#000' })!;
    store.stopCapturing();
    for (let i = 1; i <= 20; i++) store.update(id, { x: i * 5 } as Partial<RectShape>, 'move');
    store.stopCapturing();
    store.undo();
    expect((store.flush().byId.get(id)!.data as RectShape).x).toBe(0);
    store.dispose();
  });

  it('ignores writes in read-only mode', () => {
    const store = new CanvasStore(new Y.Doc(), 'viewer', { readOnly: true });
    expect(store.create(ShapeKind.Rect, { x: 0, y: 0, w: 1, h: 1, color: '#000' })).toBeNull();
    expect(store.flush().shapes).toHaveLength(0);
    store.dispose();
  });
});

describe('semantic diff', () => {
  const rect = (id: string, x: number, color = '#000', actor = 'a'): Shape => ({
    id, kind: ShapeKind.Rect, actor, vector: {}, deleted: false, createdAt: 0, updatedAt: 0,
    data: { kind: ShapeKind.Rect, x, y: 0, w: 10, h: 10, color },
  });
  it('classifies adds, moves, restyles and removals by actor', () => {
    const before = [rect('1', 0), rect('2', 0), rect('3', 0)];
    const after = [rect('1', 40, '#000', 'bob'), rect('2', 0, '#f00', 'bob'), rect('4', 0, '#000', 'ana')];
    const diff = diffBoards(before, after);
    expect(diff.added.map(s => s.id)).toEqual(['4']);
    expect(diff.removed.map(s => s.id)).toEqual(['3']);
    expect(diff.changed.find(c => c.id === '1')!.aspects).toEqual(['moved']);
    expect(diff.changed.find(c => c.id === '2')!.aspects).toEqual(['restyled']);
    expect(diff.byActor.get('bob')).toBe(2);
    expect(summarizeDiff(diff)).toMatch(/1 added, 1 moved, 1 restyled, 1 removed/);
  });
});

describe('ink recognition', () => {
  const circle = Array.from({ length: 60 }, (_, i) => ({ x: 100 + 50 * Math.cos(i / 59 * Math.PI * 2), y: 100 + 30 * Math.sin(i / 59 * Math.PI * 2) }));
  const box = [
    ...Array.from({ length: 15 }, (_, i) => ({ x: i * 10, y: 0 })),
    ...Array.from({ length: 10 }, (_, i) => ({ x: 150, y: i * 10 })),
    ...Array.from({ length: 15 }, (_, i) => ({ x: 150 - i * 10, y: 100 })),
    ...Array.from({ length: 11 }, (_, i) => ({ x: 0, y: 100 - i * 10 })),
  ];
  const wobblyLine = Array.from({ length: 30 }, (_, i) => ({ x: i * 10, y: (i % 2) * 2 }));
  const arrow = [
    ...Array.from({ length: 30 }, (_, i) => ({ x: i * 10, y: 0 })),
    ...Array.from({ length: 6 }, (_, i) => ({ x: 290 - i * 6, y: -i * 6 })),
  ];
  it('recognises ellipses', () => expect(recognizeStroke(circle)?.kind).toBe('ellipse'));
  it('recognises rectangles', () => expect(recognizeStroke(box)?.kind).toBe('rect'));
  it('recognises straight lines', () => expect(recognizeStroke(wobblyLine)?.kind).toBe('line'));
  it('recognises arrows', () => {
    const result = recognizeStroke(arrow);
    expect(result?.kind).toBe('line');
    expect(result && result.kind === 'line' && result.arrow).toBe(true);
  });
  it('leaves scribbles alone', () => {
    const scribble = Array.from({ length: 80 }, (_, i) => ({ x: (i * 37) % 120, y: (i * 53) % 90 }));
    expect(recognizeStroke(scribble)).toBeNull();
  });
});

describe('precise hit testing', () => {
  const stroke: Shape = {
    id: 's', kind: ShapeKind.Stroke, actor: 'a', vector: {}, deleted: false, createdAt: 0, updatedAt: 0,
    data: { kind: ShapeKind.Stroke, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], color: '#000', width: 4 },
  };
  it('hits a diagonal stroke on its ink but not in its empty corner', () => {
    expect(hitTestShape(stroke, { x: 50, y: 51 }, 4)).toBe(true);
    expect(hitTestShape(stroke, { x: 95, y: 5 }, 4)).toBe(false);
  });
  it('treats frame interiors as empty space but grabs their border and title', () => {
    const frame: Shape = { ...stroke, id: 'f', kind: ShapeKind.Rect, data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 400, h: 300, color: '#000', fillOpacity: 0.02, frameTitle: 'Plan' } };
    expect(hitTestShape(frame, { x: 200, y: 150 }, 4)).toBe(false);
    expect(hitTestShape(frame, { x: 0, y: 150 }, 4)).toBe(true);
    expect(hitTestShape(frame, { x: 20, y: -10 }, 4)).toBe(true);
  });
  it('marquee selects only fully enclosed shapes', () => {
    expect(shapeInsideBounds(stroke, { minX: -5, minY: -5, maxX: 105, maxY: 105 })).toBe(true);
    expect(shapeInsideBounds(stroke, { minX: -5, minY: -5, maxX: 50, maxY: 50 })).toBe(false);
  });
});

describe('sneakernet merge files', () => {
  it('round-trips header and state', () => {
    const c = createYjsCanvas('a');
    createShapeInCanvas(c, ShapeKind.Note, { x: 0, y: 0, w: 10, h: 10, text: 'hi', color: '#000', bgColor: '#fff' }, 'a');
    const bytes = encodeBoardFile(c.doc, { title: 'Plan' });
    expect(isBoardFile(bytes)).toBe(true);
    const { header, update } = decodeBoardFile(bytes);
    expect(header.title).toBe('Plan');
    expect(header.shapeCount).toBe(1);
    const copy = new Y.Doc();
    applyMerge(copy, update);
    expect(copy.getArray('shapes').length).toBe(1);
  });

  it('merges two offline copies losslessly, commutatively and idempotently', () => {
    const origin = createYjsCanvas('a');
    const shared = createShapeInCanvas(origin, ShapeKind.Note, { x: 0, y: 0, w: 10, h: 10, text: 'v1', color: '#000', bgColor: '#fff' }, 'a');
    const fileA = new Y.Doc(); Y.applyUpdate(fileA, Y.encodeStateAsUpdate(origin.doc));
    const fileB = new Y.Doc(); Y.applyUpdate(fileB, Y.encodeStateAsUpdate(origin.doc));
    const a = { doc: fileA, shapesArray: fileA.getArray<Y.XmlElement>('shapes'), awareness: origin.awareness, onChange: () => {}, dispose: () => {} };
    const b = { doc: fileB, shapesArray: fileB.getArray<Y.XmlElement>('shapes'), awareness: origin.awareness, onChange: () => {}, dispose: () => {} };
    updateShapeInCanvas(a, shared, { text: 'edited by A' } as Partial<NoteShape>, 'a');
    createShapeInCanvas(b, ShapeKind.Note, { x: 50, y: 0, w: 10, h: 10, text: 'new from B', color: '#000', bgColor: '#fff' }, 'b');
    updateShapeInCanvas(b, shared, { bgColor: '#ff0' } as Partial<NoteShape>, 'b');

    const fromB = decodeBoardFile(encodeBoardFile(fileB, { title: 'B' })).update;
    const preview = previewMerge(fileA, fromB);
    expect(preview.hasNewOperations).toBe(true);
    expect(preview.unrelatedHistory).toBe(false);
    expect(preview.diff.added).toHaveLength(1);
    expect(preview.diff.changed.map(c => c.id)).toEqual([shared]);

    applyMerge(fileA, fromB);
    applyMerge(fileA, fromB); // idempotent
    const fromA = Y.encodeStateAsUpdate(fileA);
    applyMerge(fileB, fromA);
    for (const peer of [a, b]) {
      const shapes = getActiveShapes(peer);
      expect(shapes).toHaveLength(2);
      const note = shapes.find(s => s.id === shared)!.data as NoteShape;
      expect(note.text).toBe('edited by A');
      expect(note.bgColor).toBe('#ff0');
    }
    expect(previewMerge(fileA, fromB).hasNewOperations).toBe(false);
  });
});

describe('geometry helpers', () => {
  it('translates every kind', () => {
    expect(translateShapeData({ kind: ShapeKind.Line, x1: 0, y1: 0, x2: 1, y2: 1, color: '', width: 1 }, 2, 3)).toMatchObject({ x1: 2, y1: 3, x2: 3, y2: 4 });
  });
  it('scales text metrics with font size', () => {
    expect(textMetrics('ab', 32).width).toBe(textMetrics('ab', 16).width * 2);
  });
});

describe('legacy delete-vs-edit still detected', () => {
  it('flags a concurrent delete and edit', () => {
    const alice = createYjsCanvas('alice');
    const bob = createYjsCanvas('bob');
    const id = createShapeInCanvas(alice, ShapeKind.Rect, { x: 0, y: 0, w: 10, h: 10, color: '#fff' }, 'alice');
    sync(alice.doc, bob.doc);
    deleteShapeInCanvas(alice, id, 'alice');
    updateShapeInCanvas(bob, id, { color: '#f00' } as Partial<RectShape>, 'bob');
    sync(alice.doc, bob.doc);
    expect(detectCanvasConflicts(alice.shapesArray)[0]?.type).toBe('delete_vs_edit');
  });
});
