import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  ShapeKind,
  type Shape,
  type RectShape,
  type TextShape,
  type NoteShape,
  type LineShape,
  type EllipseShape,
  scaleFrameMember,
  frameDescendants,
  createShape,
} from '../core';
import { createYjsCanvas, createShapeInCanvas, updateShapeInCanvas, getActiveShapes } from '../yjs-canvas';

describe('Frame member transforms and text-scale design decision (L32)', () => {
  const fromBounds = { minX: 100, minY: 100, maxX: 500, maxY: 400 }; // 400 x 300
  const toBounds = { minX: 100, minY: 100, maxX: 900, maxY: 700 };   // 800 x 600 (2x horizontal, 2x vertical)

  it('DESIGN DECISION (L32): text glyphs do not scale font size; only position anchors scale', () => {
    const textData: TextShape = {
      kind: ShapeKind.Text,
      x: 200,
      y: 200,
      text: 'Preserve font readability across frame resize',
      color: '#fff',
      frameId: 'parent-frame',
    };

    const scaled = scaleFrameMember(textData, fromBounds, toBounds);

    // Initial position was (200, 200) inside [100, 100] -> relative offset (100, 100)
    // Scaled frame width is 2x, so offset becomes (200, 200) -> new pos (300, 300)
    expect(scaled.kind).toBe(ShapeKind.Text);
    const scaledText = scaled as TextShape;
    expect(scaledText.x).toBe(300);
    expect(scaledText.y).toBe(300);
    expect(scaledText.text).toBe('Preserve font readability across frame resize');
    // Invariant: no fontSize or glyph transform property is injected — text retains readable typography
    expect((scaledText as any).fontSize).toBeUndefined();
    expect((scaledText as any).scale).toBeUndefined();
  });

  it('note shapes scale outer bounds (w, h) while preserving text content to allow re-flow', () => {
    const noteData: NoteShape = {
      kind: ShapeKind.Note,
      x: 200,
      y: 150,
      w: 120,
      h: 80,
      text: 'Sticky note inside frame\nsecond line of notes',
      color: '#1e293b',
      bgColor: '#fde047',
      frameId: 'parent-frame',
    };

    const scaled = scaleFrameMember(noteData, fromBounds, toBounds) as NoteShape;

    expect(scaled.kind).toBe(ShapeKind.Note);
    // Width and height scale by 2x
    expect(scaled.w).toBe(240);
    expect(scaled.h).toBe(160);
    // Position scales
    expect(scaled.x).toBe(300);
    expect(scaled.y).toBe(200);
    // Content unchanged for native wrapping
    expect(scaled.text).toBe('Sticky note inside frame\nsecond line of notes');
  });

  it('nested frames and child rectangles scale coordinates and dimensions', () => {
    const nestedFrame: RectShape = {
      kind: ShapeKind.Rect,
      x: 150,
      y: 150,
      w: 200,
      h: 150,
      color: '#6366f1',
      frameTitle: 'Nested Child Frame',
      frameId: 'parent-frame',
    };

    const scaled = scaleFrameMember(nestedFrame, fromBounds, toBounds) as RectShape;

    expect(scaled.kind).toBe(ShapeKind.Rect);
    expect(scaled.w).toBe(400);
    expect(scaled.h).toBe(300);
    expect(scaled.x).toBe(200);
    expect(scaled.y).toBe(200);
    expect(scaled.frameTitle).toBe('Nested Child Frame');
  });

  it('frameDescendants recursively identifies nested frame members and grouped peers', () => {
    const parentFrame = createShape(ShapeKind.Rect, {
      x: 0, y: 0, w: 600, h: 400, color: '#333', frameTitle: 'Parent Frame',
    }, 'alice');

    const childFrame = createShape(ShapeKind.Rect, {
      x: 50, y: 50, w: 200, h: 200, color: '#444', frameTitle: 'Inner Frame', frameId: parentFrame.id,
    }, 'alice');

    const deepNote = createShape(ShapeKind.Note, {
      x: 70, y: 70, w: 100, h: 100, text: 'Deep note', color: '#000', bgColor: '#ff0', frameId: childFrame.id,
    }, 'alice');

    const groupedNote = createShape(ShapeKind.Note, {
      x: 350, y: 100, w: 100, h: 100, text: 'Grouped', color: '#000', bgColor: '#fff', frameId: parentFrame.id, groupId: 'grp-1',
    }, 'alice');

    const peerGroupedNote = createShape(ShapeKind.Note, {
      x: 460, y: 100, w: 100, h: 100, text: 'Peer', color: '#000', bgColor: '#fff', groupId: 'grp-1',
    }, 'alice');

    const outsideNote = createShape(ShapeKind.Note, {
      x: 800, y: 800, w: 100, h: 100, text: 'Outside', color: '#000', bgColor: '#fff',
    }, 'alice');

    const allShapes: Shape[] = [parentFrame, childFrame, deepNote, groupedNote, peerGroupedNote, outsideNote];

    const descendants = frameDescendants(allShapes, parentFrame.id);
    const descendantIds = new Set(descendants.map(s => s.id));

    // Must include childFrame, deepNote, groupedNote, and peerGroupedNote (via transitive group)
    expect(descendantIds.has(childFrame.id)).toBe(true);
    expect(descendantIds.has(deepNote.id)).toBe(true);
    expect(descendantIds.has(groupedNote.id)).toBe(true);
    expect(descendantIds.has(peerGroupedNote.id)).toBe(true);
    // Must NOT include parentFrame or outsideNote
    expect(descendantIds.has(parentFrame.id)).toBe(false);
    expect(descendantIds.has(outsideNote.id)).toBe(false);
  });

  it('transforms applied to frame members sync cleanly to peer Yjs document', () => {
    const peerA = createYjsCanvas('alice');
    const peerB = createYjsCanvas('bob');

    // Create frame and member on Peer A
    const frameId = createShapeInCanvas(peerA, ShapeKind.Rect, {
      x: 0, y: 0, w: 400, h: 300, color: '#444', frameTitle: 'Team Board',
    }, 'alice');

    const noteId = createShapeInCanvas(peerA, ShapeKind.Note, {
      x: 40, y: 40, w: 160, h: 120, text: 'Sync test note', color: '#1e293b', bgColor: '#fef3c7', frameId,
    }, 'alice');

    // Sync initial state
    const update1 = Y.encodeStateAsUpdate(peerA.doc);
    Y.applyUpdate(peerB.doc, update1);

    // Peer A resizes frame and scales member note
    const scaledNote = scaleFrameMember(
      { kind: ShapeKind.Note, x: 40, y: 40, w: 160, h: 120, text: 'Sync test note', color: '#1e293b', bgColor: '#fef3c7', frameId },
      { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      { minX: 0, minY: 0, maxX: 800, maxY: 600 }
    );
    updateShapeInCanvas(peerA, noteId, scaledNote as Partial<NoteShape>, 'alice', 'resize');

    // Sync update to Peer B
    const update2 = Y.encodeStateAsUpdate(peerA.doc);
    Y.applyUpdate(peerB.doc, update2);

    const bobShapes = getActiveShapes(peerB);
    const bobNote = bobShapes.find(s => s.id === noteId);
    expect(bobNote).toBeDefined();
    const bobNoteData = bobNote!.data as NoteShape;
    expect(bobNoteData.w).toBe(320);
    expect(bobNoteData.h).toBe(240);
    expect(bobNoteData.text).toBe('Sync test note');

    peerA.dispose();
    peerB.dispose();
  });
});
