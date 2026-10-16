/**
 * Local-first branches.
 *
 * A branch is a new board whose document starts as a full copy of the
 * parent's CRDT state. Because both share history, the branch can later be
 * merged back: the parent's on-device copy is opened in the background, the
 * branch's operations are applied (previewed first), and the parent's peers
 * receive them the next time anyone opens it. No server is involved.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { previewMerge, type MergePreview } from '@crdt-canvas/engine';

export async function openStoredBoard(roomId: string): Promise<{ doc: Y.Doc; close: () => Promise<void> }> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`crdt-canvas-${roomId}`, doc);
  await persistence.whenSynced;
  return {
    doc,
    close: async () => {
      // Closing waits for pending IndexedDB writes to finish.
      await persistence.destroy();
      doc.destroy();
    },
  };
}

export async function previewBranchMerge(parentId: string, branch: Y.Doc): Promise<MergePreview> {
  const parent = await openStoredBoard(parentId);
  try {
    return previewMerge(parent.doc, Y.encodeStateAsUpdate(branch, Y.encodeStateVector(parent.doc)));
  } finally {
    await parent.close();
  }
}

export async function mergeBranchInto(parentId: string, branch: Y.Doc): Promise<void> {
  const parent = await openStoredBoard(parentId);
  try {
    Y.applyUpdate(parent.doc, Y.encodeStateAsUpdate(branch, Y.encodeStateVector(parent.doc)), 'branch-merge');
  } finally {
    await parent.close();
  }
}
