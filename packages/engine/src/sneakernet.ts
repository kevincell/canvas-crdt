/**
 * Sneakernet Merge — portable board files that merge instead of overwrite.
 *
 * A `.crdtcanvas` file carries the board's full CRDT state (not a flattened
 * snapshot). Importing a colleague's copy — received by email, USB stick or a
 * shared drive — merges both histories losslessly: nothing is duplicated and
 * nothing is overwritten, whichever order the files are opened in. A dry-run
 * preview reports exactly what would change before anything is applied.
 *
 * Layout: MAGIC (8 bytes) | header length (u32 LE) | header JSON | Yjs update
 */

import * as Y from 'yjs';
import { yjsShapesToShapes } from './yjs-canvas';
import { diffBoards, type BoardDiff } from './diff';

const MAGIC = new Uint8Array([0x43, 0x52, 0x44, 0x54, 0x43, 0x4e, 0x56, 0x01]); // "CRDTCNV\x01"
export const BOARD_FILE_EXTENSION = '.crdtcanvas';
const MAX_HEADER_BYTES = 64 * 1024;

export interface BoardFileHeader {
  format: 'crdt-canvas-merge';
  version: 1;
  title: string;
  roomId?: string;
  exportedAt: string;
  exportedBy?: string;
  shapeCount: number;
}

export function encodeBoardFile(doc: Y.Doc, header: Omit<BoardFileHeader, 'format' | 'version' | 'exportedAt' | 'shapeCount'> & { exportedAt?: string }): Uint8Array {
  const update = Y.encodeStateAsUpdate(doc);
  const shapeCount = yjsShapesToShapes(doc.getArray('shapes')).filter(s => !s.deleted).length;
  const fullHeader: BoardFileHeader = {
    format: 'crdt-canvas-merge',
    version: 1,
    exportedAt: header.exportedAt ?? new Date().toISOString(),
    shapeCount,
    title: header.title,
    ...(header.roomId ? { roomId: header.roomId } : {}),
    ...(header.exportedBy ? { exportedBy: header.exportedBy } : {}),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(fullHeader));
  const out = new Uint8Array(MAGIC.length + 4 + headerBytes.length + update.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, headerBytes.length, true);
  out.set(headerBytes, MAGIC.length + 4);
  out.set(update, MAGIC.length + 4 + headerBytes.length);
  return out;
}

export function isBoardFile(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length + 4) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

export function decodeBoardFile(bytes: Uint8Array): { header: BoardFileHeader; update: Uint8Array } {
  if (!isBoardFile(bytes)) throw new Error('This is not a CRDT Canvas merge file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(MAGIC.length, true);
  if (headerLength > MAX_HEADER_BYTES || MAGIC.length + 4 + headerLength > bytes.length) {
    throw new Error('This merge file is damaged (invalid header).');
  }
  const headerStart = MAGIC.length + 4;
  let header: BoardFileHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLength)));
  } catch {
    throw new Error('This merge file is damaged (unreadable header).');
  }
  if (header?.format !== 'crdt-canvas-merge' || header.version !== 1) {
    throw new Error('This merge file was written by an unsupported version.');
  }
  return { header, update: bytes.slice(headerStart + headerLength) };
}

export interface MergePreview {
  diff: BoardDiff;
  /** True if the file contains operations this document has not seen. */
  hasNewOperations: boolean;
  /** True if the file has never been merged with this board's history before. */
  unrelatedHistory: boolean;
}

/** Simulate a merge on a throwaway copy and report what would change. */
export function previewMerge(doc: Y.Doc, update: Uint8Array): MergePreview {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const before = yjsShapesToShapes(scratch.getArray('shapes'));
    const beforeVector = Y.encodeStateVector(scratch);
    const incomingVector = Y.encodeStateVectorFromUpdate(update);
    Y.applyUpdate(scratch, update);
    const after = yjsShapesToShapes(scratch.getArray('shapes'));
    const afterVector = Y.encodeStateVector(scratch);
    const localClients = Y.decodeStateVector(beforeVector);
    const incomingClients = Y.decodeStateVector(incomingVector);
    let shared = false;
    for (const client of incomingClients.keys()) if (localClients.has(client)) { shared = true; break; }
    return {
      diff: diffBoards(before, after),
      hasNewOperations: !equalBytes(beforeVector, afterVector),
      unrelatedHistory: !shared && localClients.size > 0 && incomingClients.size > 0,
    };
  } finally {
    scratch.destroy();
  }
}

/** Apply a merge file's operations. Idempotent: merging the same file twice is a no-op. */
export function applyMerge(doc: Y.Doc, update: Uint8Array, origin: unknown = 'sneakernet-merge') {
  Y.applyUpdate(doc, update, origin);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
