/**
 * CRDT Lab: real concurrency, simulated locally.
 *
 * Each experiment forks the live document into a "phantom peer", performs an
 * edit there, performs a different edit locally, then merges the phantom's
 * update back — exactly what happens when two people edit while apart. No
 * shortcuts: the same merge path and conflict detection as real peers.
 */
import * as Y from 'yjs';
import {
  ShapeKind,
  bindYjsCanvas,
  deleteShapeInCanvas,
  shapeBBox,
  updateShapeInCanvas,
  type EditOp,
  type ShapeData,
} from '@crdt-canvas/engine';
import type { BoardSession } from './session';

export const PHANTOM_ACTOR = 'Phantom peer#lab0';

export type Experiment = 'union-resize' | 'divergent-move' | 'per-property' | 'edit-vs-delete';

export const EXPERIMENTS: Array<{ id: Experiment; title: string; description: string }> = [
  { id: 'per-property', title: 'Different properties, same object', description: 'You recolour while a peer moves it. Per-property registers keep both edits.' },
  { id: 'union-resize', title: 'Concurrent resize', description: 'You widen it to the right while a peer grows it left and down. The union-bounding-box rule keeps both intents.' },
  { id: 'divergent-move', title: 'Divergent moves', description: 'You and a peer drag it in opposite directions. The engine converges, then flags high intent ambiguity for a human decision.' },
  { id: 'edit-vs-delete', title: 'Edit vs delete', description: 'A peer deletes it while you edit it. Nothing is silently lost: the conflict is surfaced with a one-click restore.' },
];

/** Run an experiment on `shapeId` (or on a fresh demo shape). Returns the shape id. */
export function runExperiment(session: BoardSession, experiment: Experiment, shapeId: string | null, at: { x: number; y: number }): string | null {
  const store = session.store;
  let id = shapeId;
  let shape = id ? store.read(id) : undefined;
  if (!shape || shape.deleted || !isBoxy(shape.data)) {
    id = store.create(ShapeKind.Note, { x: at.x - 100, y: at.y - 100, w: 200, h: 200, text: 'Lab subject', bgColor: '#d0bfff', color: '#1e1e1e', fontSize: 20 });
    store.stopCapturing();
    if (!id) return null;
    shape = store.read(id);
  }
  if (!shape || !id) return null;

  // Fork: the phantom starts from exactly what we have now.
  const phantom = new Y.Doc();
  Y.applyUpdate(phantom, Y.encodeStateAsUpdate(session.doc));
  const forkVector = Y.encodeStateVector(phantom);
  const remote = bindYjsCanvas(phantom);
  const b = shapeBBox(shape);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const box = (x: number, y: number, bw: number, bh: number): Partial<ShapeData> => shape!.data.kind === ShapeKind.Ellipse
    ? { cx: x + bw / 2, cy: y + bh / 2, rx: bw / 2, ry: bh / 2 } as Partial<ShapeData>
    : { x, y, w: bw, h: bh } as Partial<ShapeData>;
  const remoteEdit = (patch: Partial<ShapeData>, op: EditOp) => updateShapeInCanvas(remote, id!, patch, PHANTOM_ACTOR, op);

  switch (experiment) {
    case 'per-property':
      remoteEdit(box(b.minX + 220, b.minY + 40, w, h), 'move');
      store.update(id, { ...(shape.data.kind === ShapeKind.Note ? { bgColor: '#b2f2bb' } : { color: '#2f9e44' }) } as Partial<ShapeData>, 'update');
      break;
    case 'union-resize':
      remoteEdit(box(b.minX - 90, b.minY, w + 90, h + 80), 'resize');
      store.update(id, box(b.minX, b.minY, w + 140, h), 'resize');
      break;
    case 'divergent-move':
      remoteEdit(box(b.minX + 3 * w, b.minY + 60, w, h), 'move');
      store.update(id, box(b.minX - 3 * w, b.minY - 60, w, h), 'move');
      break;
    case 'edit-vs-delete':
      deleteShapeInCanvas(remote, id, PHANTOM_ACTOR);
      store.update(id, shape.data.kind === ShapeKind.Note ? { text: `${shape.data.text}\n(edited)` } as Partial<ShapeData> : { color: '#e03131' } as Partial<ShapeData>, 'update');
      break;
  }
  store.stopCapturing();
  // Merge the phantom's concurrent operations, as a real peer would deliver them.
  Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(phantom, forkVector), 'lab-phantom');
  phantom.destroy();
  return id;
}

function isBoxy(data: ShapeData) {
  return data.kind === ShapeKind.Rect || data.kind === ShapeKind.Note || data.kind === ShapeKind.Ellipse || data.kind === ShapeKind.Image;
}
