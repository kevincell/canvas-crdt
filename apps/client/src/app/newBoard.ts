/**
 * Creating boards: blank, from a template, as an independent copy, or as a
 * branch that can later merge back into its parent.
 *
 * New-board contents are handed to the next BoardSession in memory (same
 * page, so no size-limited sessionStorage round trip).
 */
import type { ShapeData } from '@crdt-canvas/engine';
import { upsertBoard } from './boards';
import { boardHash, generateBoardKey, generateRoomId, navigate } from './router';

export type InitialContent =
  | { kind: 'shapes'; shapes: Array<{ id: string; data: ShapeData }> }
  | { kind: 'update'; update: Uint8Array };

const handoff = new Map<string, InitialContent>();

export function takeInitialContent(roomId: string): InitialContent | null {
  const content = handoff.get(roomId) ?? null;
  handoff.delete(roomId);
  return content;
}

export function createBoard(options: { title?: string; content?: InitialContent; parentId?: string; open?: boolean } = {}): { id: string; key: string } {
  const id = generateRoomId();
  const key = generateBoardKey();
  upsertBoard(id, {
    title: options.title?.trim() || 'Untitled board',
    key,
    lastOpened: Date.now(),
    ...(options.parentId ? { parentId: options.parentId } : {}),
  });
  if (options.content) handoff.set(id, options.content);
  if (options.open !== false) navigate(boardHash(id, { key }));
  return { id, key };
}
