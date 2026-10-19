/**
 * Board activity logs, stored in the board's shared document:
 *
 *  • Checkpoints — every edit session gets a START checkpoint (board just before the first edit)
 *    and an END checkpoint (when the person goes idle for 60 s or leaves). Each one stores a
 *    snapshot of the board so it can be viewed, and reverted to via a room vote.
 *  • Conflict log — every conflict, with BEFORE / AFTER snapshots and the affected area:
 *      - the engine's existing semantic conflicts (concurrent edits, delete-vs-edit), unchanged
 *      - union-bounding-box auto-merges (logged as already resolved)
 *      - NEW "drew over" rule: a new / moved object covers ≥ 30 % of another person's object
 *        that was made or edited in the last 10 minutes. Computed from shared state only, so
 *        every peer would reach the same verdict — no voting / consensus involved.
 *  • Comments — notes attached to a selection of objects.
 *
 * Snapshots store images once (by hash) so repeated checkpoints don't duplicate big pictures.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { type Conflict, type Shape, yjsShapesToShapes } from '@crdt-canvas/engine';
import { type Bounds, boundsOf, overlapArea, area, unionBounds } from './geometry';
import { type BoardData } from './model';
import { randomId } from '../../app/identity';

export const SESSION_IDLE_MS = 60_000;
const MAX_CHECKPOINTS = 150;
const OVERLAP_RATIO = 0.3;
const OVERLAP_RECENT_MS = 10 * 60_000;

export interface Checkpoint {
  id: string;
  sessionId: string;
  kind: 'start' | 'end' | 'merge' | 'revert';
  actor: string;
  actorId: string;
  ts: number;
  snapshotKey: string;
  note?: string;
}

export type ConflictKind = 'concurrent_edit' | 'delete_vs_edit' | 'concurrent_delete' | 'connector_orphan' | 'overlap' | 'auto_merge';

export interface ConflictEntry {
  id: string;
  ts: number;
  kind: ConflictKind;
  level: string;
  description: string;
  shapeIds: string[];
  causedBy: string[];
  area: Bounds | null;
  beforeKey: string;
  afterKey: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
}

export interface BoardComment {
  id: string;
  text: string;
  author: string;
  authorId: string;
  ts: number;
  shapeIds: string[];
  anchor: { x: number; y: number } | null;
}

type SnapshotShape = { id: string; kind: string; data: any; actor: string };

function hash(str: string): string {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < str.length; i += Math.max(1, Math.floor(str.length / 4096))) {
    h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 16777619);
    h2 = (h2 * 31 + str.charCodeAt(i)) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${str.length.toString(36)}`;
}

function activeShapes(doc: Y.Doc): Shape[] {
  return yjsShapesToShapes(doc.getArray('shapes') as any).filter(s => !s.deleted);
}

/** Store a board snapshot; returns its key */
function saveSnapshot(doc: Y.Doc, shapes: Shape[]): string {
  const images = doc.getMap<string>('snapshotImages');
  const list: SnapshotShape[] = shapes.map(s => {
    const data: any = { ...s.data };
    if (typeof data.src === 'string' && data.src.length > 200) {
      const key = hash(data.src);
      if (!images.has(key)) images.set(key, data.src);
      data.src = `img:${key}`;
    }
    return { id: s.id, kind: s.kind, data, actor: s.actor };
  });
  const json = JSON.stringify(list);
  const key = hash(json);
  const snaps = doc.getMap<string>('snapshots');
  if (!snaps.has(key)) snaps.set(key, json);
  return key;
}

export function loadSnapshot(doc: Y.Doc | null, key: string): Shape[] | null {
  if (!doc || !key) return null;
  const json = doc.getMap<string>('snapshots').get(key);
  if (!json) return null;
  const images = doc.getMap<string>('snapshotImages');
  try {
    const list = JSON.parse(json) as SnapshotShape[];
    return list.map(s => {
      const data = { ...s.data };
      if (typeof data.src === 'string' && data.src.startsWith('img:')) data.src = images.get(data.src.slice(4)) ?? '';
      return { id: s.id, kind: s.kind as any, data, actor: s.actor, vector: {}, deleted: false, createdAt: 0, updatedAt: 0 };
    });
  } catch {
    return null;
  }
}

/** Restore the board to a snapshot in one transaction (used when a revert vote passes) */
export function restoreSnapshot(doc: Y.Doc, key: string, actor: string): boolean {
  const snap = loadSnapshot(doc, key);
  if (!snap) return false;
  const byId = new Map(snap.map(s => [s.id, s]));
  const arr = doc.getArray<Y.XmlElement>('shapes');
  const now = String(Date.now());
  doc.transact(() => {
    for (const el of arr) {
      const id = el.getAttribute('id') as string;
      const target = byId.get(id);
      const isDeleted = el.getAttribute('deleted') === 'true';
      if (target) {
        el.setAttribute('data', JSON.stringify(target.data));
        if (isDeleted) el.setAttribute('deleted', 'false');
        el.setAttribute('updatedAt', now);
        el.setAttribute('actor', actor);
      } else if (!isDeleted) {
        el.setAttribute('deleted', 'true');
        el.setAttribute('updatedAt', now);
        el.setAttribute('actor', actor);
      }
    }
  }, 'revert');
  return true;
}

function bump(doc: Y.Doc) {
  // Trim oldest checkpoints & their unreferenced snapshots
  const cps = doc.getArray<Checkpoint>('checkpoints');
  if (cps.length <= MAX_CHECKPOINTS) return;
  const removeCount = cps.length - MAX_CHECKPOINTS;
  cps.delete(0, removeCount);
  const used = new Set<string>(cps.toArray().map(c => c.snapshotKey));
  doc.getMap<ConflictEntry>('conflictLog').forEach(c => { used.add(c.beforeKey); used.add(c.afterKey); });
  const snaps = doc.getMap<string>('snapshots');
  [...snaps.keys()].forEach(k => { if (!used.has(k)) snaps.delete(k); });
}

export function useBoardLogs(
  doc: Y.Doc | null,
  me: { name: string; deviceId: string },
  engineConflicts: Conflict[],
  enabled: boolean,
) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [conflictLog, setConflictLog] = useState<ConflictEntry[]>([]);
  const [comments, setComments] = useState<BoardComment[]>([]);

  const prevShapesRef = useRef<Shape[]>([]);
  const historyRef = useRef<Array<{ ts: number; key: string | null; shapes: Shape[] }>>([]);
  const sessionRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const mergedSeenRef = useRef<Map<string, number>>(new Map());
  const meRef = useRef(me);
  meRef.current = me;

  // ── Observe lists ──
  useEffect(() => {
    if (!doc) { setCheckpoints([]); setConflictLog([]); setComments([]); return; }
    const cps = doc.getArray<Checkpoint>('checkpoints');
    const log = doc.getMap<ConflictEntry>('conflictLog');
    const cm = doc.getArray<BoardComment>('boardComments');
    const syncCps = () => setCheckpoints(cps.toArray().slice().sort((a, b) => b.ts - a.ts));
    const syncLog = () => setConflictLog([...log.values()].sort((a, b) => b.ts - a.ts));
    const syncCm = () => setComments(cm.toArray().slice().sort((a, b) => a.ts - b.ts));
    cps.observe(syncCps); log.observe(syncLog); cm.observe(syncCm);
    syncCps(); syncLog(); syncCm();
    prevShapesRef.current = activeShapes(doc);
    return () => { cps.unobserve(syncCps); log.unobserve(syncLog); cm.unobserve(syncCm); };
  }, [doc]);

  const endSession = useCallback(() => {
    const session = sessionRef.current;
    if (!doc || !session) return;
    if (session.timer) clearTimeout(session.timer);
    sessionRef.current = null;
    doc.transact(() => {
      const key = saveSnapshot(doc, activeShapes(doc));
      doc.getArray<Checkpoint>('checkpoints').push([{
        id: randomId(10), sessionId: session.id, kind: 'end', actor: meRef.current.name,
        actorId: meRef.current.deviceId, ts: Date.now(), snapshotKey: key,
      }]);
      bump(doc);
    }, 'log');
  }, [doc]);

  const logConflict = useCallback((entry: ConflictEntry) => {
    if (!doc) return;
    const log = doc.getMap<ConflictEntry>('conflictLog');
    if (log.has(entry.id)) return;
    log.set(entry.id, entry);
  }, [doc]);

  // ── Watch every change: sessions, auto-merges, overlap rule ──
  useEffect(() => {
    if (!doc || !enabled) return;
    const arr = doc.getArray<Y.XmlElement>('shapes');

    const onUpdate = (_u: Uint8Array, origin: unknown, _d: Y.Doc, tr: Y.Transaction) => {
      if (origin === 'log' || origin === 'revert-log') return;
      const before = prevShapesRef.current;
      const after = activeShapes(doc);
      const changedShapes = tr.changedParentTypes.has(arr as any);

      if (!changedShapes) return;
      prevShapesRef.current = after;
      historyRef.current.push({ ts: Date.now(), key: null, shapes: before });
      if (historyRef.current.length > 40) historyRef.current.shift();

      const isLocal = tr.local && origin !== 'revert';

      // Session checkpoints (only for my own edits)
      if (isLocal) {
        if (!sessionRef.current) {
          const id = randomId(10);
          sessionRef.current = { id, timer: null };
          const startKey = saveSnapshot(doc, before);
          doc.transact(() => {
            doc.getArray<Checkpoint>('checkpoints').push([{
              id: randomId(10), sessionId: id, kind: 'start', actor: meRef.current.name,
              actorId: meRef.current.deviceId, ts: Date.now(), snapshotKey: startKey,
            }]);
            bump(doc);
          }, 'log');
        }
        if (sessionRef.current.timer) clearTimeout(sessionRef.current.timer);
        sessionRef.current.timer = setTimeout(endSession, SESSION_IDLE_MS);
      }

      // Union-bounding-box auto merges (engine stamps merged_ts on the element)
      for (const el of arr) {
        const mts = Number(el.getAttribute('merged_ts') || 0);
        if (!mts) continue;
        const id = el.getAttribute('id') as string;
        if ((mergedSeenRef.current.get(id) ?? 0) >= mts) continue;
        const firstSeen = !mergedSeenRef.current.has(id);
        mergedSeenRef.current.set(id, mts);
        if (firstSeen && Date.now() - mts > 30_000) continue; // old merge from before this session
        const shape = after.find(s => s.id === id);
        const beforeKey = saveSnapshot(doc, before);
        const afterKey = saveSnapshot(doc, after);
        doc.transact(() => {
          logConflict({
            id: `merge:${id}:${mts}`, ts: mts, kind: 'auto_merge', level: 'none',
            description: 'Two people resized the same object at once — merged automatically (union bounding box).',
            shapeIds: [id], causedBy: shape ? [shape.actor] : [], area: shape ? boundsOf(shape) : null,
            beforeKey, afterKey, resolved: true, resolvedBy: 'auto', resolvedAt: mts,
          });
          doc.getArray<Checkpoint>('checkpoints').push([{
            id: `merge-${id}-${mts}`, sessionId: 'merge', kind: 'merge', actor: shape?.actor ?? 'auto',
            actorId: '', ts: mts, snapshotKey: afterKey, note: 'Auto-merged concurrent resize',
          }]);
        }, 'log');
      }

      // "Drew over" rule — evaluated by the person who drew / moved
      if (isLocal) {
        const beforeById = new Map(before.map(s => [s.id, s]));
        const touched = after.filter(s => {
          const prev = beforeById.get(s.id);
          if (!prev) return true;
          return JSON.stringify(prev.data) !== JSON.stringify(s.data);
        });
        const now = Date.now();
        for (const s of touched) {
          const sb = boundsOf(s);
          for (const t of after) {
            if (t.id === s.id) continue;
            const td = t.data as BoardData;
            const owner = td.createdById || td.createdBy || t.actor;
            if (!owner || owner === meRef.current.deviceId || owner === meRef.current.name) continue;
            if (now - Math.max(t.updatedAt || 0, t.createdAt || 0) > OVERLAP_RECENT_MS) continue;
            const tb = boundsOf(t);
            const tArea = Math.max(area(tb), 1);
            if (overlapArea(sb, tb) / tArea < OVERLAP_RATIO) continue;
            const id = `overlap:${s.id}:${t.id}`;
            const log = doc.getMap<ConflictEntry>('conflictLog');
            const existing = log.get(id);
            if (existing && !existing.resolved) continue;
            const beforeKey = saveSnapshot(doc, before);
            const afterKey = saveSnapshot(doc, after);
            doc.transact(() => {
              log.set(id + (existing ? `:${now}` : ''), {
                id: id + (existing ? `:${now}` : ''), ts: now, kind: 'overlap', level: 'medium',
                description: `${meRef.current.name} drew over ${td.createdBy || t.actor}'s ${t.kind}.`,
                shapeIds: [s.id, t.id], causedBy: [meRef.current.name], area: unionBounds([sb, tb]),
                beforeKey, afterKey, resolved: false,
              });
            }, 'log');
          }
        }
      }

      // Overlap conflicts resolve themselves once the objects no longer overlap (or one is gone)
      const log = doc.getMap<ConflictEntry>('conflictLog');
      const afterById = new Map(after.map(s => [s.id, s]));
      log.forEach((entry, key) => {
        if (entry.kind !== 'overlap' || entry.resolved) return;
        const [a, b] = entry.shapeIds.map(id => afterById.get(id));
        const stillOverlapping = a && b && overlapArea(boundsOf(a), boundsOf(b)) / Math.max(area(boundsOf(b)), 1) >= OVERLAP_RATIO;
        if (!stillOverlapping) {
          doc.transact(() => log.set(key, { ...entry, resolved: true, resolvedBy: 'auto (no longer overlapping)', resolvedAt: Date.now() }), 'log');
        }
      });
    };

    doc.on('update', onUpdate);
    const onUnload = () => endSession();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      doc.off('update', onUpdate);
      window.removeEventListener('beforeunload', onUnload);
      endSession();
    };
  }, [doc, enabled, endSession, logConflict]);

  // ── Engine conflicts → log (with before / after) ──
  useEffect(() => {
    if (!doc || !enabled) return;
    for (const c of engineConflicts) {
      const id = `${c.type}:${c.shapeId}:${Math.floor(c.ts / 1000)}`;
      if (doc.getMap('conflictLog').has(id)) continue;
      const now = activeShapes(doc);
      const prior = [...historyRef.current].reverse().find(h => h.ts < c.ts)?.shapes ?? historyRef.current[0]?.shapes ?? now;
      const shape = now.find(s => s.id === c.shapeId) ?? prior.find(s => s.id === c.shapeId);
      const prevShape = prior.find(s => s.id === c.shapeId);
      const areaB = unionBounds([shape, prevShape].filter(Boolean).map(s => boundsOf(s as Shape)));
      doc.transact(() => {
        logConflict({
          id, ts: c.ts, kind: c.type as ConflictKind, level: c.level, description: c.description,
          shapeIds: [c.shapeId], causedBy: c.actors, area: areaB,
          beforeKey: saveSnapshot(doc, prior), afterKey: saveSnapshot(doc, now), resolved: false,
        });
      }, 'log');
    }
  }, [doc, enabled, engineConflicts, logConflict]);

  // ── Actions ──
  const resolveConflict = useCallback((id: string) => {
    if (!doc) return;
    const log = doc.getMap<ConflictEntry>('conflictLog');
    const e = log.get(id);
    if (e && !e.resolved) log.set(id, { ...e, resolved: true, resolvedBy: meRef.current.name, resolvedAt: Date.now() });
  }, [doc]);

  /** When the engine's own resolve widget is used for a shape, close its open log entries */
  const resolveConflictsForShape = useCallback((shapeId: string) => {
    if (!doc) return;
    const log = doc.getMap<ConflictEntry>('conflictLog');
    doc.transact(() => log.forEach((e, k) => {
      if (!e.resolved && e.kind !== 'overlap' && e.shapeIds.includes(shapeId)) {
        log.set(k, { ...e, resolved: true, resolvedBy: meRef.current.name, resolvedAt: Date.now() });
      }
    }), 'log');
  }, [doc]);

  const addComment = useCallback((text: string, shapeIds: string[], anchor: { x: number; y: number } | null) => {
    if (!doc || !text.trim()) return;
    doc.getArray<BoardComment>('boardComments').push([{
      id: randomId(10), text: text.trim(), author: meRef.current.name, authorId: meRef.current.deviceId,
      ts: Date.now(), shapeIds, anchor,
    }]);
  }, [doc]);

  const deleteComment = useCallback((id: string) => {
    if (!doc) return;
    const arr = doc.getArray<BoardComment>('boardComments');
    const idx = arr.toArray().findIndex(c => c.id === id && c.authorId === meRef.current.deviceId);
    if (idx >= 0) arr.delete(idx, 1);
  }, [doc]);

  const logRevert = useCallback((checkpoint: Checkpoint) => {
    if (!doc) return;
    doc.transact(() => {
      const key = saveSnapshot(doc, activeShapes(doc));
      doc.getArray<Checkpoint>('checkpoints').push([{
        id: randomId(10), sessionId: 'revert', kind: 'revert', actor: meRef.current.name, actorId: meRef.current.deviceId,
        ts: Date.now(), snapshotKey: key, note: `Reverted to ${checkpoint.actor}'s ${checkpoint.kind} checkpoint (${new Date(checkpoint.ts).toLocaleString()})`,
      }]);
    }, 'log');
  }, [doc]);

  const openConflicts = useMemo(() => conflictLog.filter(c => !c.resolved), [conflictLog]);

  return {
    checkpoints,
    conflictLog,
    openConflicts,
    comments,
    resolveConflict,
    resolveConflictsForShape,
    addComment,
    deleteComment,
    logRevert,
    endSession,
  };
}
