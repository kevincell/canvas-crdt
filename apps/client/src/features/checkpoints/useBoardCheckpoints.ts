import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { CURRENT_BOARD_SCHEMA_VERSION, type Shape } from '@crdt-canvas/engine';

const MAX_CHECKPOINTS = 8;
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

export interface BoardCheckpoint {
  id: string;
  name: string;
  actor: string;
  createdAt: number;
  schemaVersion: number;
  shapes: Array<{ id: string; data: Shape['data'] }>;
}

export function useBoardCheckpoints(doc: Y.Doc | null) {
  const [checkpoints, setCheckpoints] = useState<BoardCheckpoint[]>([]);

  useEffect(() => {
    if (!doc) { setCheckpoints([]); return; }
    const records = doc.getArray<Y.Map<unknown>>('boardCheckpoints');
    const sync = () => {
      const next: BoardCheckpoint[] = records.toArray().flatMap(record => {
        try {
          const id = record.get('id');
          const name = record.get('name');
          const actor = record.get('actor');
          const createdAt = record.get('createdAt');
          const schemaVersion = record.get('schemaVersion');
          const shapes = JSON.parse(String(record.get('payload') ?? 'null'));
          if (typeof id !== 'string' || typeof name !== 'string' || typeof actor !== 'string' || typeof createdAt !== 'number' || !Array.isArray(shapes)) return [];
          return [{ id, name, actor, createdAt, schemaVersion: Number(schemaVersion ?? 0), shapes } as BoardCheckpoint];
        } catch { return []; }
      });
      setCheckpoints(next.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)));
    };
    records.observeDeep(sync);
    sync();
    return () => records.unobserveDeep(sync);
  }, [doc]);

  const createCheckpoint = useCallback((name: string, actor: string, shapes: Shape[]) => {
    if (!doc) return 'The board is still loading.';
    const active = shapes.filter(shape => !shape.deleted).map(shape => ({ id: shape.id, data: shape.data }));
    if (!active.length) return 'Add some objects before saving a checkpoint.';
    const payload = JSON.stringify(active);
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > MAX_CHECKPOINT_BYTES) return `This checkpoint is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB. Export a recovery snapshot for larger boards.`;
    const records = doc.getArray<Y.Map<unknown>>('boardCheckpoints');
    if (records.length >= MAX_CHECKPOINTS) return `This board already has ${MAX_CHECKPOINTS} checkpoints. Delete one before saving another.`;
    const record = new Y.Map<unknown>();
    const createdAt = Date.now();
    record.set('id', crypto.randomUUID());
    record.set('name', name.trim().slice(0, 80) || `Checkpoint ${new Date(createdAt).toLocaleString()}`);
    record.set('actor', actor);
    record.set('createdAt', createdAt);
    record.set('schemaVersion', CURRENT_BOARD_SCHEMA_VERSION);
    record.set('payload', payload);
    doc.transact(() => {
      records.push([record]);
    }, 'board-checkpoint-create');
    return null;
  }, [doc]);

  const deleteCheckpoint = useCallback((id: string) => {
    if (!doc) return;
    const records = doc.getArray<Y.Map<unknown>>('boardCheckpoints');
    const index = records.toArray().findIndex(record => record.get('id') === id);
    if (index >= 0) doc.transact(() => records.delete(index, 1), 'board-checkpoint-delete');
  }, [doc]);

  return { checkpoints, createCheckpoint, deleteCheckpoint };
}
