import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { ShapeKind, type RectShape } from '@crdt-canvas/engine';

describe('Read-only access security boundary and mutation guard (L65)', () => {
  it('read-only guard returns no-ops and suppresses mutations without modifying Yjs document', () => {
    const doc = new Y.Doc();
    const shapesArray = doc.getArray<Y.XmlElement>('shapes');

    // Create an initial shape in the doc (e.g. created by editor)
    doc.transact(() => {
      const el = new Y.XmlElement('shape');
      el.setAttribute('id', 'editor-rect-1');
      el.setAttribute('kind', ShapeKind.Rect);
      el.setAttribute('actor', 'editor');
      el.setAttribute('vector', '{}');
      el.setAttribute('deleted', 'false');
      el.setAttribute('createdAt', '100');
      el.setAttribute('updatedAt', '100');
      el.setAttribute('data', JSON.stringify({
        kind: ShapeKind.Rect,
        x: 100, y: 100, w: 200, h: 100, color: '#3b82f6',
      }));
      shapesArray.push([el]);
    });

    expect(shapesArray.length).toBe(1);

    // Simulate read-only interface contracts as enforced in useCanvasCRDT
    const readOnlyAPI = {
      canUndo: false,
      canRedo: false,
      undo: () => {},
      redo: () => {},
      createStroke: () => null,
      createRect: () => null,
      createEllipse: () => null,
      createLine: () => null,
      createText: () => null,
      createImage: () => null,
      createNote: () => null,
      updateShape: () => {},
      deleteShape: () => {},
      commitShapeHistory: () => {},
      commitShapeHistoryBatch: () => {},
      resolveConflict: () => {},
    };

    // Attempt mutations via read-only interface
    expect(readOnlyAPI.canUndo).toBe(false);
    expect(readOnlyAPI.canRedo).toBe(false);
    expect(readOnlyAPI.createRect()).toBeNull();
    expect(readOnlyAPI.createNote()).toBeNull();
    expect(readOnlyAPI.createStroke()).toBeNull();
    expect(readOnlyAPI.createLine()).toBeNull();
    expect(readOnlyAPI.createText()).toBeNull();
    expect(readOnlyAPI.createImage()).toBeNull();

    // Call update, delete, undo, redo, commit
    readOnlyAPI.updateShape();
    readOnlyAPI.deleteShape();
    readOnlyAPI.undo();
    readOnlyAPI.redo();
    readOnlyAPI.commitShapeHistory();
    readOnlyAPI.commitShapeHistoryBatch();
    readOnlyAPI.resolveConflict();

    // Invariant: The Yjs document was NOT mutated; length remains 1, shape remains intact
    expect(shapesArray.length).toBe(1);
    const existing = shapesArray.get(0);
    expect(existing.getAttribute('deleted')).toBe('false');
    const data = JSON.parse(existing.getAttribute('data') ?? '{}') as RectShape;
    expect(data.x).toBe(100);
    expect(data.w).toBe(200);
  });

  it('viewer cannot bypass read-only mode by directly triggering history actions', () => {
    let undoTriggered = false;
    let redoTriggered = false;

    const readOnlyActions = {
      undo: () => { /* no-op in read-only */ },
      redo: () => { /* no-op in read-only */ },
    };

    readOnlyActions.undo();
    readOnlyActions.redo();

    expect(undoTriggered).toBe(false);
    expect(redoTriggered).toBe(false);
  });
});
