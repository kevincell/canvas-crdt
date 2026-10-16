/**
 * CanvasStore — an incremental, indexed view over a board document.
 *
 * - Only elements touched by a transaction are re-parsed; unchanged shapes keep
 *   their object identity so renderers can cache by reference.
 * - Conflict detection runs per dirty element instead of over the whole board.
 * - Local edits run under the store as transaction origin and are tracked by a
 *   `Y.UndoManager`, so undo is per-user, never reverts collaborators' work,
 *   preserves shape ids (connectors stay attached), and groups a drag into one
 *   step.
 */

import * as Y from 'yjs';
import {
  ShapeKind,
  type Conflict,
  type Shape,
  type ShapeData,
} from './core';
import {
  bindYjsCanvas,
  createShapeInCanvas,
  deleteShapeInCanvas,
  detectElementConflict,
  elementToShape,
  findShapeElement,
  resolveConflictInCanvas,
  restoreShapeInCanvas,
  updateShapeInCanvas,
  type EditOp,
  type YjsCanvasState,
} from './yjs-canvas';

export interface StoreSnapshot {
  /** Live (non-deleted) shapes in document order. */
  shapes: Shape[];
  /** Every shape including tombstones, in document order. */
  all: Shape[];
  byId: ReadonlyMap<string, Shape>;
  conflicts: Conflict[];
  canUndo: boolean;
  canRedo: boolean;
  /** Monotonic counter, bumped on every change. */
  version: number;
}

export interface CanvasStoreOptions {
  /** Ignore all writes (viewer links). */
  readOnly?: boolean;
  /** Milliseconds within which consecutive local edits merge into one undo step. */
  captureTimeout?: number;
}

export class CanvasStore {
  readonly doc: Y.Doc;
  readonly array: Y.Array<Y.XmlElement>;
  readonly undoManager: Y.UndoManager;
  actor: string;
  readOnly: boolean;

  private readonly canvas: YjsCanvasState;
  private readonly cache = new Map<Y.XmlElement, Shape | null>();
  private readonly conflictCache = new Map<Y.XmlElement, Conflict | null>();
  private readonly dirty = new Set<Y.XmlElement>();
  private membershipDirty = true;
  private scheduled = false;
  private snapshot: StoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(doc: Y.Doc, actor: string, options: CanvasStoreOptions = {}) {
    this.doc = doc;
    this.actor = actor;
    this.readOnly = Boolean(options.readOnly);
    this.canvas = bindYjsCanvas(doc);
    this.array = this.canvas.shapesArray;
    this.undoManager = new Y.UndoManager(this.array, {
      trackedOrigins: new Set([this]),
      captureTimeout: options.captureTimeout ?? 500,
    });
    this.snapshot = { shapes: [], all: [], byId: new Map(), conflicts: [], canUndo: false, canRedo: false, version: 0 };
    this.array.observeDeep(this.onDeepChange);
    this.undoManager.on('stack-item-added', this.onStackChange);
    this.undoManager.on('stack-item-popped', this.onStackChange);
    this.undoManager.on('stack-cleared', this.onStackChange);
    this.recompute();
  }

  // ── Subscription (useSyncExternalStore-compatible) ─────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): StoreSnapshot => this.snapshot;

  get(id: string): Shape | undefined {
    return this.snapshot.byId.get(id);
  }

  /** Force synchronous recomputation (tests, exports right after a write). */
  flush(): StoreSnapshot {
    if (this.scheduled || this.dirty.size || this.membershipDirty) this.recompute();
    return this.snapshot;
  }

  dispose() {
    this.disposed = true;
    this.array.unobserveDeep(this.onDeepChange);
    this.undoManager.destroy();
    this.listeners.clear();
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Run several edits as one transaction (one network update, one undo step). */
  transact<T>(fn: () => T): T | undefined {
    if (this.readOnly) return undefined;
    let result: T | undefined;
    this.doc.transact(() => { result = fn(); }, this);
    return result;
  }

  create(kind: ShapeKind, data: Partial<ShapeData>, options: { id?: string } = {}): string | null {
    if (this.readOnly) return null;
    let id: string | null = null;
    this.doc.transact(() => { id = createShapeInCanvas(this.canvas, kind, data, this.actor, options); }, this);
    return id;
  }

  update(id: string, patch: Partial<ShapeData>, op: EditOp = 'update') {
    if (this.readOnly) return;
    this.doc.transact(() => updateShapeInCanvas(this.canvas, id, patch, this.actor, op), this);
  }

  updateMany(entries: Array<{ id: string; patch: Partial<ShapeData> }>, op: EditOp = 'update') {
    if (this.readOnly || !entries.length) return;
    this.doc.transact(() => {
      for (const { id, patch } of entries) updateShapeInCanvas(this.canvas, id, patch, this.actor, op);
    }, this);
  }

  remove(ids: string[]) {
    if (this.readOnly || !ids.length) return;
    this.doc.transact(() => {
      for (const id of ids) deleteShapeInCanvas(this.canvas, id, this.actor);
    }, this);
  }

  restore(ids: string[]) {
    if (this.readOnly || !ids.length) return;
    this.doc.transact(() => {
      for (const id of ids) restoreShapeInCanvas(this.canvas, id, this.actor);
    }, this);
  }

  resolveConflict(shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') {
    if (this.readOnly) return;
    this.doc.transact(() => resolveConflictInCanvas(this.canvas, shapeId, action, this.actor), this);
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  undo() { if (!this.readOnly) this.undoManager.undo(); }
  redo() { if (!this.readOnly) this.undoManager.redo(); }
  /** Close the current undo group so the next edit becomes its own step. */
  stopCapturing() { this.undoManager.stopCapturing(); }

  /** Read a shape straight from the document, bypassing the cache (safe inside transactions). */
  read(id: string): Shape | undefined {
    const el = findShapeElement(this.array, id);
    return el ? elementToShape(el) ?? undefined : undefined;
  }

  hasElement(id: string): boolean {
    return Boolean(findShapeElement(this.array, id));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private onStackChange = () => {
    this.schedule();
  };

  private onDeepChange = (events: Array<Y.YEvent<any>>) => {
    for (const event of events) {
      if (event.target === this.array) {
        this.membershipDirty = true;
        event.changes.added.forEach(item => {
          const content = item.content as unknown as { type?: unknown };
          if (content.type instanceof Y.XmlElement) this.dirty.add(content.type);
        });
      } else {
        let target: Y.AbstractType<any> | null = event.target;
        while (target && !(target instanceof Y.XmlElement && target.parent === this.array)) {
          target = target.parent as Y.AbstractType<any> | null;
        }
        if (target) this.dirty.add(target as Y.XmlElement);
        else this.membershipDirty = true;
      }
    }
    this.schedule();
  };

  private schedule() {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      if (!this.scheduled || this.disposed) return;
      this.recompute();
    });
  }

  private recompute() {
    this.scheduled = false;
    const dirty = new Set(this.dirty);
    this.dirty.clear();
    const membership = this.membershipDirty;
    this.membershipDirty = false;

    const now = Date.now();
    const pendingConflictChecks: Y.XmlElement[] = [];
    for (const el of dirty) {
      this.cache.set(el, elementToShape(el));
      pendingConflictChecks.push(el);
    }

    const all: Shape[] = [];
    const seen = new Set<Y.XmlElement>();
    for (const el of this.array) {
      seen.add(el);
      let shape = this.cache.get(el);
      if (shape === undefined) {
        shape = elementToShape(el);
        this.cache.set(el, shape);
        pendingConflictChecks.push(el);
      }
      if (shape) all.push(shape);
    }
    if (membership) {
      for (const el of this.cache.keys()) if (!seen.has(el)) { this.cache.delete(el); this.conflictCache.delete(el); }
    }

    // Conflict checks may write (union-bbox auto-merge); those writes re-enter
    // through observeDeep and are picked up on the next microtask.
    for (const el of pendingConflictChecks) {
      if (!seen.has(el)) continue;
      this.conflictCache.set(el, this.readOnly ? null : detectElementConflict(el, now));
    }

    const shapes = all.filter(shape => !shape.deleted);
    const byId = new Map(all.map(shape => [shape.id, shape]));
    const conflicts: Conflict[] = [];
    for (const conflict of this.conflictCache.values()) if (conflict) conflicts.push(conflict);

    const prev = this.snapshot;
    this.snapshot = {
      shapes: sameList(prev.shapes, shapes) ? prev.shapes : shapes,
      all: sameList(prev.all, all) ? prev.all : all,
      byId: sameList(prev.all, all) ? prev.byId : byId,
      conflicts: sameConflicts(prev.conflicts, conflicts) ? prev.conflicts : conflicts,
      canUndo: this.undoManager.undoStack.length > 0,
      canRedo: this.undoManager.redoStack.length > 0,
      version: prev.version + 1,
    };
    for (const listener of [...this.listeners]) listener();
  }
}

function sameList<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameConflicts(a: Conflict[], b: Conflict[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].shapeId !== b[i].shapeId || a[i].type !== b[i].type || a[i].level !== b[i].level || a[i].ts !== b[i].ts) return false;
  }
  return true;
}
