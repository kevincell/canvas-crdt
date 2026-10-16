import { describe, expect, it, beforeAll } from 'vitest';
import * as Y from 'yjs';
import { CanvasStore, ShapeKind, type NoteShape, type RectShape, type LineShape } from '@crdt-canvas/engine';
import { Editor } from '../board/editor';
import type { BoardSession } from '../board/session';
import { actorLabel, makeActor } from '../app/identity';
import { contrastText, displayColor } from '../board/canvas/palette';
import { resizeBounds, snapBox } from '../board/canvas/transform';

beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = {
    location: { hash: '', search: '', origin: 'https://canvas.example', pathname: '/' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  };
});

function makeEditor() {
  const doc = new Y.Doc();
  const store = new CanvasStore(doc, 'Tester#test');
  const session = { store, roomId: 'test-room', doc } as unknown as BoardSession;
  return { editor: new Editor(session), store };
}

describe('routing', () => {
  it('parses board links and keeps the key in the fragment', async () => {
    const { parseRoute, boardHash, boardUrl } = await import('../app/router');
    expect(parseRoute('#/b/amber-otter-abc?k=SECRET&view=1')).toEqual({ name: 'board', roomId: 'amber-otter-abc', key: 'SECRET', viewOnly: true, present: false, as: undefined });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(boardHash('room', { key: 'k1' })).toBe('#/b/room?k=k1');
    // The key lives after '#', which browsers never send to servers.
    expect(boardUrl('room', { key: 'k1' }).split('#')[0]).not.toContain('k1');
  });

  it('sanitises room ids and generates unguessable ones', async () => {
    const { sanitizeRoomId, generateRoomId, generateBoardKey } = await import('../app/router');
    expect(sanitizeRoomId(' my room/../x ')).toBe('my-room-..-x');
    expect(generateRoomId()).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{6}$/);
    expect(generateBoardKey()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('identity', () => {
  it('gives same-named people distinct actor ids but the same label', () => {
    const a = makeActor('Alex', 'aaaa1111');
    const b = makeActor('Alex', 'bbbb2222');
    expect(a).not.toBe(b);
    expect(actorLabel(a)).toBe('Alex');
    expect(actorLabel('legacy-name')).toBe('legacy-name');
  });
});

describe('palette', () => {
  it('adapts near-black ink for dark mode but keeps saturated colours', () => {
    expect(displayColor('#1e1e1e', true)).toBe('#e9eaee');
    expect(displayColor('#e03131', true)).toBe('#e03131');
    expect(displayColor('#1e1e1e', false)).toBe('#1e1e1e');
    expect(contrastText('#fff3bf')).toBe('#1e1e1e');
    expect(contrastText('#1971c2')).toBe('#ffffff');
  });
});

describe('transform helpers', () => {
  it('resizes from a corner keeping aspect ratio', () => {
    const b = resizeBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 'se', 100, 0, { keepAspect: true, fromCenter: false });
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
  });
  it('snaps to a neighbour edge within the threshold', () => {
    const snap = snapBox({ minX: 103, minY: 300, maxX: 153, maxY: 350 }, [{ minX: 100, minY: 0, maxX: 200, maxY: 50 }], 6);
    expect(snap.dx).toBe(-3);
    expect(snap.guides.length).toBeGreaterThan(0);
  });
});

describe('Editor', () => {
  it('inserts copies with fresh ids and remaps groups, frames and connectors', () => {
    const { editor, store } = makeEditor();
    const ids = editor.insertShapes([
      { id: 'frame', data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 400, h: 300, color: '#868e96', frameTitle: 'F' } },
      { id: 'a', data: { kind: ShapeKind.Rect, x: 20, y: 20, w: 50, h: 50, color: '#000', groupId: 'g', frameId: 'frame' } },
      { id: 'b', data: { kind: ShapeKind.Rect, x: 200, y: 20, w: 50, h: 50, color: '#000', groupId: 'g', frameId: 'frame' } },
      { id: 'arrow', data: { kind: ShapeKind.Line, x1: 70, y1: 45, x2: 200, y2: 45, color: '#000', width: 2, startShapeId: 'a', endShapeId: 'b', frameId: 'frame' } },
    ]);
    const snap = store.flush();
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('a');
    const [frame, a, b, arrow] = ids.map(id => snap.byId.get(id)!);
    expect(a.data.frameId).toBe(frame.id);
    expect(a.data.groupId).toBeDefined();
    expect(a.data.groupId).not.toBe('g');
    expect(a.data.groupId).toBe(b.data.groupId);
    expect((arrow.data as LineShape).startShapeId).toBe(a.id);
    expect((arrow.data as LineShape).endShapeId).toBe(b.id);
    // One user action, one undo step.
    store.undo();
    expect(store.flush().shapes).toHaveLength(0);
  });

  it('moves a frame together with its contents', () => {
    const { editor, store } = makeEditor();
    const [frame, child] = editor.insertShapes([
      { id: 'f', data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 300, h: 300, color: '#888', frameTitle: 'F' } },
      { id: 'c', data: { kind: ShapeKind.Note, x: 50, y: 50, w: 100, h: 100, text: 'hi', color: '#000', bgColor: '#fff3bf' } },
    ]);
    expect(store.flush().byId.get(child)!.data.frameId).toBe(frame);
    editor.translate([{ id: frame, dx: 100, dy: 0 }]);
    expect((store.flush().byId.get(child)!.data as NoteShape).x).toBe(150);
  });

  it('applies style changes to the selection in one step', () => {
    const { editor, store } = makeEditor();
    const ids = editor.insertShapes([
      { id: 'r', data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 10, h: 10, color: '#000', fillOpacity: 0 } },
      { id: 'n', data: { kind: ShapeKind.Note, x: 50, y: 0, w: 100, h: 100, text: '', color: '#000', bgColor: '#fff3bf' } },
    ]);
    editor.select(ids);
    editor.setStyle({ color: '#e03131', noteColor: '#a5d8ff', fill: 0.9 });
    const snap = store.flush();
    const rect = snap.byId.get(ids[0])!.data as RectShape;
    const note = snap.byId.get(ids[1])!.data as NoteShape;
    expect(rect.color).toBe('#e03131');
    expect(rect.fillOpacity).toBe(0.9);
    expect(note.bgColor).toBe('#a5d8ff');
  });

  it('aligns and distributes the selection', () => {
    const { editor, store } = makeEditor();
    const ids = editor.insertShapes([0, 37, 200].map((x, i) => ({ id: `s${i}`, data: { kind: ShapeKind.Rect, x, y: i * 13, w: 20, h: 20, color: '#000' } })));
    editor.select(ids);
    editor.align('top');
    const ys = ids.map(id => (store.flush().byId.get(id)!.data as RectShape).y);
    expect(new Set(ys).size).toBe(1);
    editor.align('distributeX');
    const xs = ids.map(id => (store.flush().byId.get(id)!.data as RectShape).x);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]);
  });

  it('round-trips the clipboard through paste with new ids', async () => {
    const { editor, store } = makeEditor();
    const [id] = editor.insertShapes([{ id: 'x', data: { kind: ShapeKind.Note, x: 0, y: 0, w: 100, h: 100, text: 'copy me', color: '#000', bgColor: '#fff3bf' } }]);
    editor.select([id]);
    await editor.copy();
    editor.pointer = { x: 500, y: 500 };
    editor.isPointVisible = () => true;
    await editor.paste();
    const notes = store.flush().shapes.filter(s => s.data.kind === ShapeKind.Note);
    expect(notes).toHaveLength(2);
    expect(notes.map(n => (n.data as NoteShape).text)).toEqual(['copy me', 'copy me']);
  });

  it('reverts to an earlier version as one undoable step', () => {
    const { editor, store } = makeEditor();
    const [id] = editor.insertShapes([{ id: 'x', data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 10, h: 10, color: '#000' } }]);
    const past = store.flush().all;
    store.update(id, { x: 500 } as Partial<RectShape>, 'move');
    store.stopCapturing();
    editor.insertShapes([{ id: 'y', data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 10, h: 10, color: '#000' } }]);
    editor.revertTo(past);
    const snap = store.flush();
    expect(snap.shapes).toHaveLength(1);
    expect((snap.byId.get(id)!.data as RectShape).x).toBe(0);
    store.undo();
    expect(store.flush().shapes).toHaveLength(2);
  });
});
