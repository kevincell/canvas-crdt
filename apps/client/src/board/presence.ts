/**
 * Presence over Yjs awareness: cursors, selections, live drag previews,
 * viewports (for "follow"), lasers and typing indicators.
 *
 * Previews are the key to seamless motion: while someone drags, only a tiny
 * ephemeral transform travels over awareness; the CRDT is written once on
 * release. Peers render the motion live, and the document history stays
 * compact.
 */
import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { Bounds, Point } from './canvas/camera';
import type { PeerView } from './canvas/renderer';
import type { Preview } from './canvas/transform';

export interface LocalPresence {
  user: { name: string; color: string; actor: string };
  // Legacy field names read by v0.1 clients.
  actor: string;
  color: string;
  cursor: Point | null;
  selection: string[];
  preview: Preview | null;
  laser: { points: Point[] } | null;
  viewport: Bounds | null;
  editing: string | null;
}

export interface Participant {
  clientId: number;
  name: string;
  color: string;
  actor: string;
  isSelf: boolean;
  viewport: Bounds | null;
  editing: string | null;
}

type RawState = Partial<LocalPresence> & { user?: { name?: string; color?: string; actor?: string } };

export function readPeer(clientId: number, raw: RawState): Omit<PeerView, 'laser'> & { viewport: Bounds | null; actor: string } {
  const name = String(raw.user?.name ?? raw.actor ?? 'Guest').slice(0, 40);
  const color = /^#[0-9a-f]{6}$/i.test(raw.user?.color ?? raw.color ?? '') ? (raw.user?.color ?? raw.color)! : '#6741d9';
  const cursor = raw.cursor && Number.isFinite(raw.cursor.x) && Number.isFinite(raw.cursor.y) ? raw.cursor : null;
  const preview = isPreview(raw.preview) ? raw.preview : null;
  return {
    clientId,
    name,
    color,
    actor: String(raw.user?.actor ?? name),
    cursor,
    selection: Array.isArray(raw.selection) ? raw.selection.filter((id): id is string => typeof id === 'string').slice(0, 500) : [],
    preview,
    viewport: raw.viewport && Number.isFinite(raw.viewport.minX) ? raw.viewport : null,
    editing: typeof raw.editing === 'string' ? raw.editing : null,
  };
}

function isPreview(value: unknown): value is Preview {
  if (!value || typeof value !== 'object') return false;
  const p = value as Preview;
  if (!Array.isArray(p.ids)) return false;
  if (p.kind === 'translate') return Number.isFinite(p.dx) && Number.isFinite(p.dy);
  if (p.kind === 'scale') return Boolean(p.from && p.to && Number.isFinite(p.from.minX) && Number.isFinite(p.to.minX));
  return false;
}

/** Laser trails are timestamped on arrival so clock skew never matters. */
export class LaserTrails {
  private trails = new Map<number, Array<Point & { t: number }>>();
  update(clientId: number, raw: RawState) {
    const points = raw.laser?.points;
    if (!Array.isArray(points) || !points.length) return;
    const head = points[points.length - 1];
    if (!head || !Number.isFinite(head.x)) return;
    const trail = this.trails.get(clientId) ?? [];
    const last = trail[trail.length - 1];
    if (!last || last.x !== head.x || last.y !== head.y) trail.push({ x: head.x, y: head.y, t: performance.now() });
    while (trail.length > 80) trail.shift();
    this.trails.set(clientId, trail);
  }
  get(clientId: number) { return this.trails.get(clientId) ?? []; }
  remove(clientId: number) { this.trails.delete(clientId); }
}

/** React view of who is here (changes rarely; cursor motion does not re-render). */
export function useParticipants(awareness: Awareness | null): Participant[] {
  const [participants, setParticipants] = useState<Participant[]>([]);
  useEffect(() => {
    if (!awareness) return;
    let last = '';
    const update = () => {
      const list: Participant[] = [];
      awareness.getStates().forEach((raw, clientId) => {
        if (!raw || (!(raw as RawState).user && !(raw as RawState).actor)) return;
        const peer = readPeer(clientId, raw as RawState);
        list.push({ clientId, name: peer.name, color: peer.color, actor: peer.actor, isSelf: clientId === awareness.clientID, viewport: peer.viewport, editing: peer.editing });
      });
      list.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name));
      const key = list.map(p => `${p.clientId}:${p.name}:${p.color}:${p.editing ?? ''}`).join('|');
      if (key !== last) { last = key; setParticipants(list); }
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness]);
  return participants;
}

/** Throttle helper for high-frequency awareness fields. */
export function throttle<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;
  const run = () => { last = performance.now(); timer = null; if (pending) { const args = pending; pending = null; fn(...args); } };
  const wrapped = (...args: T) => {
    pending = args;
    const wait = ms - (performance.now() - last);
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  wrapped.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  return wrapped;
}
