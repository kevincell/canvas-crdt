import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  type ShapeData,
  ShapeKind,
  yjsShapesToShapes,
} from '@crdt-canvas/engine';
import { type ImportedBoardSnapshot } from './boardSnapshot';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateRoomId(): string {
  return generateId().replace(/-/g, '').slice(0, 8);
}

/**
 * Deep clones shapes and remaps internal identifiers (shape IDs, group IDs,
 * frame IDs, and connector start/end shape IDs) so that the duplicated board
 * contains completely independent, native editable objects with zero shared
 * CRDT state or references to the source board.
 */
export function cloneBoardShapes(
  sourceShapes: Array<{ id: string; data: ShapeData }>,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 }
): Array<{ id: string; data: ShapeData }> {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();

  // 1. Assign fresh IDs for every shape and group
  for (const shape of sourceShapes) {
    idMap.set(shape.id, generateId());
    if (shape.data.groupId && !groupMap.has(shape.data.groupId)) {
      groupMap.set(shape.data.groupId, generateId());
    }
  }

  // 2. Clone and remap references
  return sourceShapes.map(({ id: oldId, data: originalData }) => {
    const newId = idMap.get(oldId) || generateId();
    const data = structuredClone(originalData);

    // Remap groupId if present
    if (data.groupId && groupMap.has(data.groupId)) {
      data.groupId = groupMap.get(data.groupId);
    }

    // Remap frameId if present and points to a cloned frame
    if (data.frameId && idMap.has(data.frameId)) {
      data.frameId = idMap.get(data.frameId);
    }

    // Apply coordinate offset if requested
    if (offset.dx !== 0 || offset.dy !== 0) {
      if (data.kind === ShapeKind.Stroke) {
        data.points = data.points.map(pt => ({ x: pt.x + offset.dx, y: pt.y + offset.dy }));
      } else if (data.kind === ShapeKind.Ellipse) {
        data.cx += offset.dx;
        data.cy += offset.dy;
      } else if (data.kind === ShapeKind.Line) {
        data.x1 += offset.dx;
        data.y1 += offset.dy;
        data.x2 += offset.dx;
        data.y2 += offset.dy;
      } else {
        data.x += offset.dx;
        data.y += offset.dy;
      }
    }

    // Remap connector endpoint targets
    if (data.kind === ShapeKind.Line) {
      if (data.startShapeId && idMap.has(data.startShapeId)) {
        data.startShapeId = idMap.get(data.startShapeId);
      }
      if (data.endShapeId && idMap.has(data.endShapeId)) {
        data.endShapeId = idMap.get(data.endShapeId);
      }
    }

    return { id: newId, data };
  });
}

export interface DuplicateBoardOptions {
  sourceRoomId: string;
  sourceTitle: string;
  shapes?: Array<{ id: string; data: ShapeData }>;
  targetTitle?: string;
}

export interface DuplicateBoardResult {
  newRoomId: string;
  newTitle: string;
  shapeCount: number;
}

/**
 * Loads shapes from IndexedDB for a given room ID.
 */
export async function loadShapesFromRoomIndexedDB(
  roomId: string
): Promise<Array<{ id: string; data: ShapeData }>> {
  const tempDoc = new Y.Doc();
  let persistence: IndexeddbPersistence | null = null;
  try {
    persistence = new IndexeddbPersistence(`crdt-canvas-${roomId}`, tempDoc);
    await persistence.whenSynced;
    const shapeArray = tempDoc.getArray<Y.XmlElement>('shapes');
    const rawShapes = yjsShapesToShapes(shapeArray).filter(s => !s.deleted);
    return rawShapes.map(s => ({ id: s.id, data: structuredClone(s.data) }));
  } catch (err) {
    console.warn(`Could not load shapes from room ${roomId} IndexedDB:`, err);
    return [];
  } finally {
    try {
      persistence?.destroy();
      tempDoc.destroy();
    } catch {
      // ignore destruction errors
    }
  }
}

/**
 * Duplicates a board into a fresh room with clean, remapped native shapes
 * and copies local metadata (title, folder, tags, description).
 */
export async function duplicateBoard({
  sourceRoomId,
  sourceTitle,
  shapes: providedShapes,
  targetTitle,
}: DuplicateBoardOptions): Promise<DuplicateBoardResult> {
  let sourceShapes = providedShapes;
  if (!sourceShapes || sourceShapes.length === 0) {
    sourceShapes = await loadShapesFromRoomIndexedDB(sourceRoomId);
  }

  const cleanTitle = (sourceTitle.trim() || sourceRoomId);
  const newTitle = targetTitle?.trim() || `Copy of ${cleanTitle}`;
  const newRoomId = generateRoomId();

  // Clone and remap all shape IDs, frame references, group IDs, and connector endpoints
  const clonedShapes = cloneBoardShapes(sourceShapes);

  // Copy local board metadata if available
  try {
    const sourceMetaRaw = localStorage.getItem(`crdt-canvas-meta-${sourceRoomId}`);
    if (sourceMetaRaw) {
      localStorage.setItem(`crdt-canvas-meta-${newRoomId}`, sourceMetaRaw);
    }
  } catch {
    // ignore
  }

  // Set new board title
  try {
    localStorage.setItem(`crdt-canvas-title-${newRoomId}`, newTitle);
  } catch {
    // ignore
  }

  // Update recent boards list
  try {
    const rawRecents = localStorage.getItem('crdt-canvas-recent-boards') || '[]';
    const recentBoards: Array<{ roomId: string; title: string }> = JSON.parse(rawRecents);
    const updated = [
      { roomId: newRoomId, title: newTitle },
      ...recentBoards.filter(b => b.roomId !== newRoomId),
    ].slice(0, 10);
    localStorage.setItem('crdt-canvas-recent-boards', JSON.stringify(updated));
  } catch {
    // ignore
  }

  // Save the initial snapshot in sessionStorage so the new room hydrator can restore it
  const snapshot: ImportedBoardSnapshot = {
    title: newTitle,
    shapes: clonedShapes,
  };

  try {
    sessionStorage.setItem(
      `crdt-canvas-initial-snapshot-${newRoomId}`,
      JSON.stringify(snapshot)
    );
  } catch (err) {
    console.warn('Could not cache initial snapshot in sessionStorage:', err);
  }

  return {
    newRoomId,
    newTitle,
    shapeCount: clonedShapes.length,
  };
}

/**
 * Checks for and consumes an initial board snapshot cached during duplication.
 */
export function consumeInitialBoardSnapshot(roomId: string): ImportedBoardSnapshot | null {
  try {
    const key = `crdt-canvas-initial-snapshot-${roomId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.shapes)) {
      return parsed as ImportedBoardSnapshot;
    }
  } catch (err) {
    console.warn(`Failed to consume initial snapshot for room ${roomId}:`, err);
  }
  return null;
}
