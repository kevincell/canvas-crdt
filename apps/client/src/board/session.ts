/**
 * BoardSession — one open board.
 *
 * Owns the Yjs document, local IndexedDB persistence, the (optionally
 * end-to-end encrypted) WebRTC provider, schema migration, sync pausing and
 * the catch-up baseline used by the "While you were away" replay.
 *
 * Local-first contract: the board is fully usable the moment IndexedDB has
 * loaded. Networking only ever adds collaborators; losing it is a normal,
 * quiet state ("Saved on this device"), never an error.
 */
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import {
  CanvasStore,
  CURRENT_BOARD_SCHEMA_VERSION,
  diffBoards,
  migrateBoardDocument,
  type BoardDiff,
  type Shape,
} from '@crdt-canvas/engine';
import { deleteMigrationBackup, getMigrationBackup, saveMigrationBackup } from '../features/canvas/migrationRecovery';

export type PersistenceState = 'loading' | 'ready' | 'error' | 'migration-error';
export type NetworkState = 'paused' | 'offline' | 'connecting' | 'connected';

export interface SessionStatus {
  persistence: PersistenceState;
  persistenceError: string | null;
  migrationSummary: string | null;
  migrationBackupAvailable: boolean;
  network: NetworkState;
  /** Peers reachable right now (WebRTC + other tabs). */
  peers: number;
  encrypted: boolean;
  /** Local edits made while no peer was connected (cleared once someone syncs). */
  unsyncedEdits: number;
}

export interface CatchUp {
  diff: BoardDiff;
  reason: 'reopen' | 'reconnect' | 'merge';
  at: number;
  /** Shapes before the change, for ghosts of moved/removed objects. */
  before: Map<string, Shape>;
}

export interface BoardMeta {
  title: string;
  style: 'clean' | 'sketch';
}

const SETTLE_MS = 1400;

export class BoardSession {
  readonly doc: Y.Doc;
  readonly store: CanvasStore;
  readonly awareness: Awareness;
  readonly roomId: string;
  readonly meta: Y.Map<unknown>;
  provider: WebrtcProvider | null = null;
  private persistence: IndexeddbPersistence | null = null;

  private status: SessionStatus;
  private statusListeners = new Set<() => void>();
  private catchUp: CatchUp | null = null;
  private catchUpListeners = new Set<() => void>();
  private metaSnapshot: BoardMeta;
  private metaListeners = new Set<() => void>();

  private baseline: Shape[] | null = null;
  private baselineReason: CatchUp['reason'] = 'reopen';
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private migrationTask: Promise<unknown> | null = null;
  private destroyed = false;
  private paused = false;
  private savedPresence: Record<string, unknown> | null = null;

  constructor(options: { roomId: string; actor: string; key?: string; readOnly?: boolean; fallbackTitle?: string }) {
    this.roomId = options.roomId;
    this.doc = new Y.Doc();
    this.store = new CanvasStore(this.doc, options.actor, { readOnly: options.readOnly });
    this.awareness = new Awareness(this.doc);
    this.meta = this.doc.getMap('boardMeta');
    this.metaSnapshot = { title: options.fallbackTitle || options.roomId, style: 'clean' };
    this.status = {
      persistence: 'loading',
      persistenceError: null,
      migrationSummary: null,
      migrationBackupAvailable: false,
      network: 'connecting',
      peers: 0,
      encrypted: Boolean(options.key),
      unsyncedEdits: 0,
    };

    this.meta.observe(this.onMetaChange);
    this.doc.on('update', this.onUpdate);

    this.startPersistence();
    this.startProvider(options.key);
    this.pollTimer = setInterval(this.refreshNetwork, 2000);
    window.addEventListener('online', this.refreshNetwork);
    window.addEventListener('offline', this.refreshNetwork);
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  subscribeStatus = (listener: () => void) => { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; };
  getStatus = () => this.status;
  subscribeCatchUp = (listener: () => void) => { this.catchUpListeners.add(listener); return () => { this.catchUpListeners.delete(listener); }; };
  getCatchUp = () => this.catchUp;
  subscribeMeta = (listener: () => void) => { this.metaListeners.add(listener); return () => { this.metaListeners.delete(listener); }; };
  getMeta = () => this.metaSnapshot;

  private setStatus(patch: Partial<SessionStatus>) {
    const next = { ...this.status, ...patch };
    const changed = (Object.keys(patch) as Array<keyof SessionStatus>).some(key => next[key] !== this.status[key]);
    if (!changed) return;
    this.status = next;
    this.statusListeners.forEach(listener => listener());
  }

  // ── Board metadata (shared via the CRDT) ──────────────────────────────────

  setTitle(title: string) {
    const clean = title.trim().slice(0, 120);
    if (!clean || this.store.readOnly) return;
    this.doc.transact(() => this.meta.set('title', clean), 'meta');
  }

  setStyle(style: BoardMeta['style']) {
    if (this.store.readOnly) return;
    this.doc.transact(() => this.meta.set('style', style), 'meta');
  }

  private onMetaChange = () => {
    const title = this.meta.get('title');
    const style = this.meta.get('style');
    const next: BoardMeta = {
      title: typeof title === 'string' && title.trim() ? title : this.metaSnapshot.title,
      style: style === 'sketch' ? 'sketch' : 'clean',
    };
    if (next.title !== this.metaSnapshot.title || next.style !== this.metaSnapshot.style) {
      this.metaSnapshot = next;
      this.metaListeners.forEach(listener => listener());
    }
  };

  // ── Persistence & migration ───────────────────────────────────────────────

  private startPersistence() {
    try {
      this.persistence = new IndexeddbPersistence(`crdt-canvas-${this.roomId}`, this.doc);
      this.persistence.whenSynced.then(() => {
        if (this.destroyed) return;
        // What this device last saw is the baseline for "while you were away".
        this.setBaseline('reopen');
        void this.migrateSafely().then(ok => { if (ok) this.setStatus({ persistence: 'ready' }); });
      }).catch(() => this.setStatus({ persistence: 'error', persistenceError: 'This browser blocked local storage. Edits will be lost when the tab closes.' }));
    } catch {
      this.setStatus({ persistence: 'error', persistenceError: 'Local storage is unavailable in this browser.' });
    }
  }

  private migrateSafely(): Promise<boolean> {
    if (this.migrationTask) return this.migrationTask as Promise<boolean>;
    const task = (async () => {
      const doc = this.doc;
      let backupAvailable = false;
      try {
        if (this.store.readOnly) return true;
        const preview = migrateBoardDocument(doc, { dryRun: true });
        const needsBackup = preview.changedShapes > 0 || preview.fromVersion !== CURRENT_BOARD_SCHEMA_VERSION;
        if (needsBackup && preview.fromVersion > 0 && doc.getArray('shapes').length > 0) {
          backupAvailable = Boolean(await getMigrationBackup(this.roomId));
          if (!backupAvailable) {
            await saveMigrationBackup(this.roomId, Y.encodeStateAsUpdate(doc));
            backupAvailable = true;
          }
        }
        const migration = migrateBoardDocument(doc);
        if (migration.changedShapes > 0 && migration.fromVersion > 0) this.setStatus({ migrationSummary: migration.summary });
        if (backupAvailable) {
          try { await deleteMigrationBackup(this.roomId); backupAvailable = false; } catch { /* keep the copy */ }
        }
        this.setStatus({ persistenceError: null, migrationBackupAvailable: backupAvailable, persistence: this.status.persistence === 'migration-error' ? 'ready' : this.status.persistence });
        return true;
      } catch (error) {
        if (!backupAvailable) {
          try { await saveMigrationBackup(this.roomId, Y.encodeStateAsUpdate(doc)); backupAvailable = true; } catch { /* reported below */ }
        }
        this.setStatus({
          persistence: 'migration-error',
          persistenceError: error instanceof Error ? error.message : 'The board schema could not be migrated.',
          migrationBackupAvailable: backupAvailable,
        });
        return false;
      }
    })().finally(() => { this.migrationTask = null; });
    this.migrationTask = task;
    return task;
  }

  // ── Networking ────────────────────────────────────────────────────────────

  private startProvider(key?: string, attempt = 0) {
    if (this.destroyed) return;
    try {
      this.provider = new WebrtcProvider(this.roomId, this.doc, {
        signaling: signalingUrls(),
        awareness: this.awareness,
        password: key || null,
        maxConns: 24,
        filterBcConns: true,
      } as ConstructorParameters<typeof WebrtcProvider>[2]);
    } catch (error) {
      // y-webrtc releases a room asynchronously; reopening the same board in
      // the same tab can race it. Retry shortly instead of failing.
      if (attempt < 20) setTimeout(() => this.startProvider(key, attempt + 1), 100);
      else console.warn('[board] could not start sync provider', error);
      return;
    }
    this.provider.on('peers', this.refreshNetwork);
    this.provider.on('synced', () => {
      void this.migrateSafely();
      this.setStatus({ unsyncedEdits: 0 });
    });
    this.refreshNetwork();
  }

  private refreshNetwork = () => {
    const provider = this.provider;
    if (!provider || this.destroyed) return;
    const room = (provider as unknown as { room?: { webrtcConns: Map<string, unknown>; bcConns: Set<string> } }).room;
    const peers = (room?.webrtcConns.size ?? 0) + (room?.bcConns.size ?? 0);
    const signalingUp = provider.signalingConns.some(conn => (conn as unknown as { connected: boolean }).connected);
    let network: NetworkState;
    if (this.paused) network = 'paused';
    else if (peers > 0) network = 'connected';
    else if (signalingUp) network = 'connected';
    else if (typeof navigator !== 'undefined' && navigator.onLine === false) network = 'offline';
    else network = 'connecting';
    const wasAlone = this.status.peers === 0;
    this.setStatus({ network, peers: this.paused ? 0 : peers });
    if (peers === 0 && !wasAlone) this.setBaseline('reconnect');
    if (peers > 0) this.setStatus({ unsyncedEdits: 0 });
  };

  /** Stop exchanging updates; edits stay local until `resumeSync`. */
  pauseSync() {
    if (this.paused) return;
    this.paused = true;
    // y-webrtc clears our local presence on disconnect; keep it for resume.
    this.savedPresence = this.awareness.getLocalState();
    this.provider?.disconnect();
    this.setBaseline('reconnect');
    this.setStatus({ network: 'paused', peers: 0 });
  }

  resumeSync() {
    if (!this.paused) return;
    this.paused = false;
    this.provider?.connect();
    if (!this.awareness.getLocalState() && this.savedPresence) this.awareness.setLocalState(this.savedPresence);
    this.savedPresence = null;
    this.setStatus({ network: 'connecting' });
    this.refreshNetwork();
  }

  isPaused() { return this.paused; }

  // ── Catch-up ("While you were away") ──────────────────────────────────────

  private setBaseline(reason: CatchUp['reason']) {
    this.baseline = this.store.flush().all.slice();
    this.baselineReason = reason;
  }

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    const local = origin === this.store || origin === this.persistence || origin === 'meta' || origin === 'board-schema-migration' || origin === 'crdt-engine';
    if (local) {
      if (origin === this.store && this.status.peers === 0) this.setStatus({ unsyncedEdits: this.status.unsyncedEdits + 1 });
      return;
    }
    if (!this.baseline) return;
    // Remote (or merged) operations arrived after a period apart; wait for the
    // burst to settle, then summarise what other people changed.
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(this.settle, SETTLE_MS);
  };

  private settle = () => {
    this.settleTimer = null;
    if (!this.baseline || this.destroyed) return;
    const before = this.baseline;
    const after = this.store.flush().all;
    if (this.baselineReason === 'reopen' && !before.some(shape => !shape.deleted)) {
      // First visit to a shared board: everything is new, nothing was "missed".
      this.baseline = null;
      return;
    }
    const raw = diffBoards(before, after);
    const self = this.store.actor;
    const diff = {
      ...raw,
      added: raw.added.filter(s => s.actor !== self),
      changed: raw.changed.filter(c => c.after.actor !== self),
      removed: raw.removed.filter(s => (after.find(a => a.id === s.id)?.actor ?? '') !== self),
    };
    diff.isEmpty = !diff.added.length && !diff.changed.length && !diff.removed.length;
    this.baseline = this.status.peers === 0 ? this.baseline : null;
    if (diff.isEmpty) return;
    const byActor = new Map<string, number>();
    for (const s of diff.added) byActor.set(s.actor, (byActor.get(s.actor) ?? 0) + 1);
    for (const c of diff.changed) byActor.set(c.after.actor, (byActor.get(c.after.actor) ?? 0) + 1);
    for (const s of diff.removed) {
      const actor = after.find(a => a.id === s.id)?.actor ?? s.actor;
      byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
    }
    this.publishCatchUp({ diff: { ...diff, byActor }, reason: this.baselineReason, at: Date.now(), before: new Map(before.map(s => [s.id, s])) });
  };

  /** Show a diff explicitly (e.g. after merging a file). */
  publishCatchUp(catchUp: CatchUp | null) {
    this.catchUp = catchUp;
    this.catchUpListeners.forEach(listener => listener());
  }

  /** Snapshot the current state so the next external change can be reported. */
  markBaseline(reason: CatchUp['reason']) {
    this.setBaseline(reason);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  destroy() {
    this.destroyed = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    window.removeEventListener('online', this.refreshNetwork);
    window.removeEventListener('offline', this.refreshNetwork);
    this.meta.unobserve(this.onMetaChange);
    this.doc.off('update', this.onUpdate);
    try { this.awareness.setLocalState(null); } catch { /* ignore */ }
    this.provider?.destroy();
    this.persistence?.destroy();
    this.store.dispose();
    this.awareness.destroy();
    this.doc.destroy();
    this.statusListeners.clear();
    this.catchUpListeners.clear();
    this.metaListeners.clear();
  }
}

/**
 * Resolve signaling endpoints. Default: the same origin's /ws (the production
 * server serves both; the Vite dev server proxies /ws). Set
 * VITE_SIGNALING_URLS (comma-separated) only to use separate relays.
 */
export function signalingUrls(): string[] {
  const env = (import.meta.env.VITE_SIGNALING_URLS as string | undefined)?.trim();
  const pageHost = window.location.hostname;
  if (env) {
    return env.split(',').map(url => url.trim()).filter(Boolean).map(url => {
      // A localhost URL is useless to a phone on the LAN; point it at this host.
      try {
        const parsed = new URL(url);
        if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && pageHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
          parsed.hostname = pageHost;
        }
        return parsed.toString().replace(/\/$/, '');
      } catch {
        return url;
      }
    });
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return [`${protocol}//${window.location.host}/ws`];
}
