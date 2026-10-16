/**
 * Editor — the imperative controller between a BoardSession and the UI.
 *
 * Holds UI state (tool, style, selection, camera, view flags) and implements
 * every user action as a single CRDT transaction, so each action is one
 * network update and one undo step.
 */
import {
  ShapeKind,
  frameDescendants,
  geometryPatch,
  shapeBBox,
  shapeInsideBounds,
  textMetrics,
  translateShapeData,
  type Shape,
  type ShapeData,
} from '@crdt-canvas/engine';
import type { BoardSession, CatchUp } from './session';
import { clampZoom, fitCamera, interpolateCamera, screenToWorld, viewportBounds, zoomAt, type Bounds, type Camera, type Point } from './canvas/camera';
import { DEFAULT_INK, DEFAULT_NOTE, contrastText } from './canvas/palette';
import { isFrame, sortByLayer, unionOf } from './canvas/transform';
import type { CatchUpView } from './canvas/renderer';
import { readJSON, readString, writeJSON, writeString } from '../app/storage';

export type Tool = 'select' | 'hand' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'frame' | 'text' | 'note' | 'image' | 'eraser' | 'laser';

export interface StyleState {
  color: string;
  noteColor: string;
  strokeWidth: number;
  fill: number;
  fontSize: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
}

export interface EditorState {
  tool: Tool;
  toolLocked: boolean;
  style: StyleState;
  selection: string[];
  editingId: string | null;
  showGrid: boolean;
  snapToGrid: boolean;
  authorship: boolean;
  followingClientId: number | null;
  catchUp: CatchUpView | null;
  highlightId: string | null;
  presenting: { index: number } | null;
  inkToShape: boolean;
  /** Read-only preview of a past board state (time travel). */
  timeTravel: { shapes: Shape[]; label: string } | null;
}

export const GRID_SIZE = 24;
export const NOTE_SIZE = 200;
const CLIP_TYPE = 'crdt-canvas/clipboard';

let localClipboard: string | null = null;

const DEFAULT_STYLE: StyleState = { color: DEFAULT_INK, noteColor: DEFAULT_NOTE, strokeWidth: 4, fill: 0, fontSize: 20, strokeStyle: 'solid' };

export class Editor {
  readonly session: BoardSession;
  private state: EditorState;
  private listeners = new Set<() => void>();
  private cameraListeners = new Set<() => void>();
  private cameraValue: Camera = { x: 0, y: 0, z: 1 };
  private cameraAnimation: number | null = null;
  viewport = { width: 1, height: 1 };
  /** Last pointer position in world coordinates (paste target). */
  pointer: Point | null = null;
  onToast: (message: string, tone?: 'info' | 'error') => void = () => {};

  constructor(session: BoardSession) {
    this.session = session;
    const saved = readJSON<Partial<StyleState>>('crdt-canvas-style', {});
    this.state = {
      tool: session.store.readOnly ? 'hand' : 'select',
      toolLocked: false,
      style: { ...DEFAULT_STYLE, ...saved },
      selection: [],
      editingId: null,
      showGrid: readString('crdt-canvas-grid') !== '0',
      snapToGrid: false,
      authorship: false,
      followingClientId: null,
      catchUp: null,
      highlightId: null,
      presenting: null,
      inkToShape: readString('crdt-canvas-ink-to-shape') !== '0',
      timeTravel: null,
    };
    let savedCamera: string | null = null;
    try { savedCamera = sessionStorage.getItem(`crdt-canvas-camera-${session.roomId}`); } catch { /* unavailable */ }
    if (savedCamera) {
      try { const c = JSON.parse(savedCamera); if (Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)) this.cameraValue = c; } catch { /* ignore */ }
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  subscribeCamera = (listener: () => void) => { this.cameraListeners.add(listener); return () => { this.cameraListeners.delete(listener); }; };
  getCamera = () => this.cameraValue;

  setState(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  get store() { return this.session.store; }
  get readOnly() { return this.session.store.readOnly; }
  /** Always current: flushes pending changes (a no-op when nothing is pending). */
  get snapshot() { return this.session.store.flush(); }

  shapesById(ids: string[]): Shape[] {
    const byId = this.snapshot.byId;
    return ids.map(id => byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
  }

  get selectedShapes(): Shape[] { return this.shapesById(this.state.selection); }

  // ── Tools & style ─────────────────────────────────────────────────────────

  setTool(tool: Tool) {
    if (this.readOnly && !['select', 'hand', 'laser'].includes(tool)) return;
    this.setState({ tool, editingId: null, ...(tool !== 'select' ? { selection: tool === 'hand' || tool === 'laser' ? this.state.selection : [] } : {}) });
  }

  /** Update the style for new shapes and apply it to the current selection. */
  setStyle(patch: Partial<StyleState>) {
    const style = { ...this.state.style, ...patch };
    this.setState({ style });
    writeJSON('crdt-canvas-style', style);
    const targets = this.selectedShapes.filter(s => !s.data.locked);
    if (!targets.length || this.readOnly) return;
    const entries: Array<{ id: string; patch: Partial<ShapeData> }> = [];
    for (const shape of targets) {
      const d = shape.data;
      const p: Record<string, unknown> = {};
      if (patch.color !== undefined) {
        if (d.kind === ShapeKind.Note) { /* notes use noteColor */ }
        else if (d.kind !== ShapeKind.Image && !(d.kind === ShapeKind.Rect && d.frameTitle)) p.color = patch.color;
      }
      if (patch.noteColor !== undefined && d.kind === ShapeKind.Note) { p.bgColor = patch.noteColor; p.color = contrastText(patch.noteColor); }
      if (patch.strokeWidth !== undefined) {
        if (d.kind === ShapeKind.Stroke || d.kind === ShapeKind.Line) p.width = patch.strokeWidth;
        if ((d.kind === ShapeKind.Rect && !d.frameTitle) || d.kind === ShapeKind.Ellipse) p.strokeWidth = patch.strokeWidth;
      }
      if (patch.fill !== undefined && ((d.kind === ShapeKind.Rect && !d.frameTitle) || d.kind === ShapeKind.Ellipse)) p.fillOpacity = patch.fill;
      if (patch.fontSize !== undefined && (d.kind === ShapeKind.Text || d.kind === ShapeKind.Note)) p.fontSize = patch.fontSize;
      if (patch.strokeStyle !== undefined && d.kind !== ShapeKind.Text && d.kind !== ShapeKind.Note && d.kind !== ShapeKind.Image) p.strokeStyle = patch.strokeStyle;
      if (Object.keys(p).length) entries.push({ id: shape.id, patch: p as Partial<ShapeData> });
    }
    this.store.updateMany(entries, 'update');
    this.store.stopCapturing();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(ids: string[], options: { expandGroups?: boolean } = {}) {
    let next = [...new Set(ids)];
    if (options.expandGroups !== false) next = this.expandGroups(next);
    this.setState({ selection: next, editingId: this.state.editingId && next.includes(this.state.editingId) ? this.state.editingId : null });
    this.syncStyleFromSelection();
  }

  expandGroups(ids: string[]): string[] {
    const shapes = this.snapshot.shapes;
    const groups = new Set(this.shapesById(ids).map(s => s.data.groupId).filter(Boolean));
    if (!groups.size) return ids;
    return [...new Set([...ids, ...shapes.filter(s => s.data.groupId && groups.has(s.data.groupId)).map(s => s.id)])];
  }

  selectAll() {
    this.setState({ tool: 'select' });
    this.select(this.snapshot.shapes.map(s => s.id), { expandGroups: false });
  }

  clearSelection() {
    if (this.state.selection.length || this.state.editingId) this.setState({ selection: [], editingId: null });
  }

  selectInBounds(bounds: Bounds, additive: boolean) {
    const hits = this.snapshot.shapes.filter(s => shapeInsideBounds(s, bounds) && !(isFrame(s) && !shapeInsideBounds(s, bounds))).map(s => s.id);
    this.select(additive ? [...this.state.selection, ...hits] : hits);
  }

  /** Reflect the primary selected shape's style in the style panel. */
  private syncStyleFromSelection() {
    const shape = this.selectedShapes[this.selectedShapes.length - 1];
    if (!shape) return;
    const d = shape.data;
    const style = { ...this.state.style };
    if ('color' in d && d.kind !== ShapeKind.Note) style.color = d.color;
    if (d.kind === ShapeKind.Note) style.noteColor = d.bgColor;
    if (d.kind === ShapeKind.Stroke || d.kind === ShapeKind.Line) style.strokeWidth = d.width;
    if (d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse) { style.strokeWidth = d.strokeWidth ?? style.strokeWidth; style.fill = d.fillOpacity ?? 0; }
    if ((d.kind === ShapeKind.Text || d.kind === ShapeKind.Note) && d.fontSize) style.fontSize = d.fontSize;
    if (d.strokeStyle) style.strokeStyle = d.strokeStyle;
    this.setState({ style });
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  /** Create a shape, attach it to the frame that contains it, and select it. */
  create(kind: ShapeKind, data: Partial<ShapeData>, options: { select?: boolean; edit?: boolean } = {}): string | null {
    if (this.readOnly) return null;
    let id: string | null = null;
    this.store.transact(() => {
      id = this.store.create(kind, data);
      if (id) this.assignFrames([id]);
    });
    this.store.stopCapturing();
    if (id && options.select !== false) {
      this.setState({ selection: [id], editingId: options.edit ? id : null, tool: this.state.toolLocked || options.edit ? this.state.tool : 'select' });
    }
    return id;
  }

  createNoteAt(point: Point): string | null {
    const { noteColor, fontSize } = this.state.style;
    return this.create(ShapeKind.Note, {
      x: point.x - NOTE_SIZE / 2, y: point.y - NOTE_SIZE / 2, w: NOTE_SIZE, h: NOTE_SIZE,
      text: '', bgColor: noteColor, color: contrastText(noteColor), fontSize: Math.min(fontSize, 32),
    }, { edit: true });
  }

  /** Frames own the shapes fully inside them (smallest containing frame wins). */
  assignFrames(ids: string[]) {
    // Runs inside transactions, so read fresh records instead of the cache.
    const targets = ids.map(id => this.store.read(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
    const frameIds = new Set([...this.snapshot.shapes.filter(isFrame).map(s => s.id), ...targets.filter(isFrame).map(s => s.id)]);
    const frames = [...frameIds].map(id => this.store.read(id)).filter((s): s is Shape => Boolean(s && !s.deleted && isFrame(s)));
    const entries: Array<{ id: string; patch: Partial<ShapeData> }> = [];
    for (const shape of targets) {
      if (isFrame(shape)) continue;
      const b = shapeBBox(shape);
      const container = frames
        .filter(f => f.id !== shape.id && f.data.kind === ShapeKind.Rect && b.minX >= f.data.x && b.minY >= f.data.y && b.maxX <= f.data.x + f.data.w && b.maxY <= f.data.y + f.data.h)
        .sort((a, c) => area(a) - area(c))[0];
      if ((container?.id ?? undefined) !== shape.data.frameId) entries.push({ id: shape.id, patch: { frameId: container?.id } as Partial<ShapeData> });
    }
    if (entries.length) this.store.updateMany(entries, 'update');
  }

  /** A newly drawn frame adopts the loose shapes already inside it. */
  adoptIntoFrame(frameId: string) {
    this.store.flush();
    const frame = this.store.read(frameId);
    if (!frame || frame.data.kind !== ShapeKind.Rect) return;
    const f = frame.data;
    const entries = this.snapshot.shapes
      .filter(s => s.id !== frameId && !isFrame(s) && !s.data.frameId)
      .filter(s => { const b = shapeBBox(s); return b.minX >= f.x && b.minY >= f.y && b.maxX <= f.x + f.w && b.maxY <= f.y + f.h; })
      .map(s => ({ id: s.id, patch: { frameId } as Partial<ShapeData> }));
    this.store.updateMany(entries, 'update');
  }

  // ── Editing text ──────────────────────────────────────────────────────────

  beginEdit(id: string) {
    const shape = this.snapshot.byId.get(id);
    if (!shape || shape.deleted || shape.data.locked || this.readOnly) return;
    const d = shape.data;
    if (d.kind === ShapeKind.Text || d.kind === ShapeKind.Note || d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse) {
      this.setState({ selection: [id], editingId: id, tool: 'select' });
    }
  }

  commitEdit(id: string, text: string) {
    const shape = this.snapshot.byId.get(id);
    this.setState({ editingId: null });
    if (!shape) return;
    const d = shape.data;
    const clean = text.replace(/\s+$/, '');
    if (d.kind === ShapeKind.Text) {
      if (!clean.trim()) { this.store.remove([id]); this.setState({ selection: [] }); }
      else if (clean !== d.text) this.store.update(id, { text: clean } as Partial<ShapeData>);
    } else if (d.kind === ShapeKind.Note) {
      if (clean !== d.text) this.store.update(id, { text: clean } as Partial<ShapeData>);
    } else if (d.kind === ShapeKind.Rect && d.frameTitle) {
      if (clean.trim() && clean !== d.frameTitle) this.store.update(id, { frameTitle: clean.trim().slice(0, 120) } as Partial<ShapeData>);
    } else if (d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse) {
      if (clean !== (d.label ?? '')) this.store.update(id, { label: clean || undefined } as Partial<ShapeData>);
    }
    this.store.stopCapturing();
  }

  /** Throttled live text so collaborators see typing as it happens. */
  liveEdit(id: string, text: string) {
    const shape = this.snapshot.byId.get(id);
    if (!shape) return;
    const d = shape.data;
    if (d.kind === ShapeKind.Note && text !== d.text) this.store.update(id, { text } as Partial<ShapeData>);
    else if (d.kind === ShapeKind.Text && text.trim() && text !== d.text) this.store.update(id, { text } as Partial<ShapeData>);
  }

  // ── Structural actions ────────────────────────────────────────────────────

  private unlockedSelection(): Shape[] {
    return this.selectedShapes.filter(s => !s.data.locked);
  }

  deleteSelection() {
    const ids = this.unlockedSelection().map(s => s.id);
    if (!ids.length) return;
    // Deleting a frame keeps its contents (they simply become loose).
    this.store.transact(() => {
      this.store.remove(ids);
      const orphans = this.snapshot.shapes.filter(s => s.data.frameId && ids.includes(s.data.frameId) && !ids.includes(s.id));
      this.store.updateMany(orphans.map(s => ({ id: s.id, patch: { frameId: undefined } as Partial<ShapeData> })));
    });
    this.store.stopCapturing();
    this.setState({ selection: [], editingId: null });
  }

  duplicateSelection() {
    const shapes = this.withFrameContents(this.selectedShapes);
    if (!shapes.length) return;
    const ids = this.insertShapes(shapes.map(s => ({ id: s.id, data: s.data })), { offset: { x: 24, y: 24 } });
    this.select(ids, { expandGroups: false });
  }

  /** Selected frames bring their contents along. */
  withFrameContents(shapes: Shape[]): Shape[] {
    const all = this.snapshot.shapes;
    const ids = new Set(shapes.map(s => s.id));
    const out = [...shapes];
    for (const shape of shapes) {
      if (!isFrame(shape)) continue;
      for (const member of frameDescendants(all, shape.id)) if (!ids.has(member.id)) { ids.add(member.id); out.push(member); }
    }
    return out;
  }

  groupSelection() {
    const shapes = this.unlockedSelection();
    if (shapes.length < 2) return;
    const groupId = crypto.randomUUID();
    this.store.updateMany(shapes.map(s => ({ id: s.id, patch: { groupId } as Partial<ShapeData> })));
    this.store.stopCapturing();
  }

  ungroupSelection() {
    const shapes = this.unlockedSelection().filter(s => s.data.groupId);
    if (!shapes.length) return;
    this.store.updateMany(shapes.map(s => ({ id: s.id, patch: { groupId: undefined } as Partial<ShapeData> })));
    this.store.stopCapturing();
  }

  toggleLock() {
    const shapes = this.selectedShapes;
    if (!shapes.length) return;
    const locked = !shapes.every(s => s.data.locked);
    this.store.updateMany(shapes.map(s => ({ id: s.id, patch: { locked: locked || undefined } as Partial<ShapeData> })));
    this.store.stopCapturing();
  }

  reorder(direction: 'front' | 'back' | 'forward' | 'backward') {
    const selected = this.withFrameContents(this.unlockedSelection());
    if (!selected.length) return;
    const ordered = sortByLayer(this.snapshot.shapes);
    const ids = new Set(selected.map(s => s.id));
    let next: Shape[];
    if (direction === 'front') next = [...ordered.filter(s => !ids.has(s.id)), ...ordered.filter(s => ids.has(s.id))];
    else if (direction === 'back') next = [...ordered.filter(s => ids.has(s.id)), ...ordered.filter(s => !ids.has(s.id))];
    else {
      next = ordered.slice();
      const step = direction === 'forward' ? 1 : -1;
      const indices = next.map((s, i) => ids.has(s.id) ? i : -1).filter(i => i >= 0);
      if (step > 0) indices.reverse();
      for (const i of indices) {
        const j = i + step;
        if (j < 0 || j >= next.length || ids.has(next[j].id)) continue;
        [next[i], next[j]] = [next[j], next[i]];
      }
    }
    // Frames always sit beneath their own contents.
    const entries = next.map((s, index) => ({ id: s.id, patch: { zIndex: index } as Partial<ShapeData> }))
      .filter(entry => this.snapshot.byId.get(entry.id)?.data.zIndex !== (entry.patch as { zIndex: number }).zIndex);
    this.store.updateMany(entries);
    this.store.stopCapturing();
  }

  align(mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY') {
    const shapes = this.unlockedSelection();
    if (shapes.length < 2) return;
    const boxes = shapes.map(shape => ({ shape, b: shapeBBox(shape) }));
    const all = unionOf(boxes.map(x => x.b))!;
    const moves = new Map<string, { dx: number; dy: number }>();
    if (mode === 'distributeX' || mode === 'distributeY') {
      if (boxes.length < 3) return;
      const horizontal = mode === 'distributeX';
      const ordered = boxes.sort((a, b) => horizontal ? a.b.minX - b.b.minX : a.b.minY - b.b.minY);
      const size = (x: Bounds) => horizontal ? x.maxX - x.minX : x.maxY - x.minY;
      const start = horizontal ? all.minX : all.minY;
      const end = horizontal ? all.maxX : all.maxY;
      const gap = (end - start - ordered.reduce((sum, x) => sum + size(x.b), 0)) / (ordered.length - 1);
      let cursor = start;
      for (const item of ordered) {
        const delta = cursor - (horizontal ? item.b.minX : item.b.minY);
        moves.set(item.shape.id, horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
        cursor += size(item.b) + gap;
      }
    } else {
      for (const { shape, b } of boxes) {
        const dx = mode === 'left' ? all.minX - b.minX : mode === 'right' ? all.maxX - b.maxX : mode === 'centerX' ? (all.minX + all.maxX - b.minX - b.maxX) / 2 : 0;
        const dy = mode === 'top' ? all.minY - b.minY : mode === 'bottom' ? all.maxY - b.maxY : mode === 'centerY' ? (all.minY + all.maxY - b.minY - b.maxY) / 2 : 0;
        moves.set(shape.id, { dx, dy });
      }
    }
    this.translate([...moves].filter(([, m]) => Math.abs(m.dx) > 0.01 || Math.abs(m.dy) > 0.01).map(([id, m]) => ({ id, ...m })));
  }

  /** Arrange selected notes into a tidy, alphabetical grid. */
  tidyNotes() {
    const notes = this.unlockedSelection().filter(s => s.data.kind === ShapeKind.Note)
      .sort((a, b) => (a.data as { text: string }).text.localeCompare((b.data as { text: string }).text) || (a.id < b.id ? -1 : 1));
    if (notes.length < 2) return;
    const columns = Math.ceil(Math.sqrt(notes.length));
    const origin = unionOf(notes.map(n => shapeBBox(n)))!;
    const cellW = Math.max(...notes.map(n => (n.data as { w: number }).w)) + 24;
    const cellH = Math.max(...notes.map(n => (n.data as { h: number }).h)) + 24;
    const moves = notes.map((note, i) => {
      const d = note.data as { x: number; y: number };
      return { id: note.id, dx: origin.minX + (i % columns) * cellW - d.x, dy: origin.minY + Math.floor(i / columns) * cellH - d.y };
    });
    this.translate(moves);
  }

  /** Move shapes (and frames' contents) by per-shape deltas in one step. */
  translate(moves: Array<{ id: string; dx: number; dy: number }>) {
    if (!moves.length || this.readOnly) return;
    const byId = this.snapshot.byId;
    const entries: Array<{ id: string; patch: Partial<ShapeData> }> = [];
    const done = new Set<string>();
    for (const move of moves) {
      const shape = byId.get(move.id);
      if (!shape || shape.data.locked) continue;
      const targets = isFrame(shape) ? [shape, ...frameDescendants(this.snapshot.shapes, shape.id)] : [shape];
      for (const target of targets) {
        if (done.has(target.id) || target.data.locked) continue;
        done.add(target.id);
        entries.push({ id: target.id, patch: geometryPatch(translateShapeData(target.data, move.dx, move.dy)) });
      }
    }
    this.store.transact(() => {
      this.store.updateMany(entries, 'move');
      this.assignFrames([...done]);
    });
    this.store.stopCapturing();
  }

  nudge(dx: number, dy: number) {
    this.translate(this.unlockedSelection().map(s => ({ id: s.id, dx, dy })));
  }

  // ── Insert / clipboard ────────────────────────────────────────────────────

  /**
   * Insert copies of shapes with fresh ids, remapping groups, frames and
   * connector targets inside the set. One transaction, one undo step.
   */
  insertShapes(items: Array<{ id: string; data: ShapeData }>, options: { offset?: Point; center?: Point } = {}): string[] {
    if (this.readOnly || !items.length) return [];
    const bounds = unionOf(items.map(item => shapeBBox({ data: item.data } as Shape)))!;
    let dx = options.offset?.x ?? 0, dy = options.offset?.y ?? 0;
    if (options.center) {
      dx = options.center.x - (bounds.minX + bounds.maxX) / 2;
      dy = options.center.y - (bounds.minY + bounds.maxY) / 2;
    }
    const idMap = new Map(items.map(item => [item.id, newShapeId()]));
    const groupMap = new Map<string, string>();
    const maxLayer = this.snapshot.shapes.reduce((m, s, i) => Math.max(m, s.data.zIndex ?? i), -1);
    const ordered = items.map((item, index) => ({ ...item, layer: item.data.zIndex ?? index })).sort((a, b) => a.layer - b.layer);
    const created: string[] = [];
    this.store.transact(() => {
      ordered.forEach((item, index) => {
        const d = translateShapeData(structuredClone(item.data), dx, dy) as ShapeData & Record<string, unknown>;
        d.zIndex = maxLayer + 1 + index;
        if (d.groupId) {
          if (!groupMap.has(d.groupId)) groupMap.set(d.groupId, crypto.randomUUID());
          d.groupId = groupMap.get(d.groupId);
        }
        d.frameId = d.frameId ? idMap.get(d.frameId) : undefined;
        if (d.kind === ShapeKind.Line) {
          d.startShapeId = d.startShapeId ? idMap.get(d.startShapeId) : undefined;
          d.endShapeId = d.endShapeId ? idMap.get(d.endShapeId) : undefined;
        }
        delete d.locked;
        const id = this.store.create(d.kind, d, { id: idMap.get(item.id) });
        if (id) created.push(id);
      });
      this.assignFrames(created);
    });
    this.store.stopCapturing();
    return created;
  }

  async copy(cut = false): Promise<boolean> {
    const shapes = this.withFrameContents(this.selectedShapes);
    if (!shapes.length) return false;
    const payload = JSON.stringify({ type: CLIP_TYPE, version: 1, shapes: shapes.map(s => ({ id: s.id, data: s.data })) });
    localClipboard = payload;
    try { await navigator.clipboard.writeText(payload); } catch { /* fall back to in-memory clipboard */ }
    if (cut) this.deleteSelection();
    return true;
  }

  /** Paste from a ClipboardEvent (preferred: no permission prompt) or the async API. */
  async paste(event?: ClipboardEvent, handlers?: { image: (file: File, at: Point) => void }) {
    if (this.readOnly) return;
    const at = this.pointer && this.isPointVisible(this.pointer) ? this.pointer : this.viewportCenter();
    const files = event?.clipboardData ? [...event.clipboardData.files] : [];
    const image = files.find(file => file.type.startsWith('image/'));
    if (image && handlers) { handlers.image(image, at); return; }
    let text = event?.clipboardData?.getData('text/plain') ?? '';
    if (!event) { try { text = await navigator.clipboard.readText(); } catch { text = ''; } }
    if (!text && localClipboard) text = localClipboard;
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === CLIP_TYPE && Array.isArray(parsed.shapes)) {
        const ids = this.insertShapes(parsed.shapes, { center: at });
        this.select(ids, { expandGroups: false });
        return;
      }
    } catch { /* plain text */ }
    const clean = text.trim().slice(0, 5000);
    if (!clean) return;
    const m = textMetrics(clean, this.state.style.fontSize);
    this.create(ShapeKind.Text, { x: at.x - m.width / 2, y: at.y - m.height / 2 + m.fontSize, text: clean, color: this.state.style.color, fontSize: this.state.style.fontSize });
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  undo() { this.setState({ editingId: null }); this.store.undo(); this.pruneSelection(); }
  redo() { this.setState({ editingId: null }); this.store.redo(); this.pruneSelection(); }

  pruneSelection() {
    const live = this.store.flush().byId;
    const next = this.state.selection.filter(id => live.get(id) && !live.get(id)!.deleted);
    if (next.length !== this.state.selection.length) this.setState({ selection: next });
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  setCamera(camera: Camera, options: { userInitiated?: boolean } = {}) {
    if (options.userInitiated) {
      if (this.cameraAnimation !== null) { cancelAnimationFrame(this.cameraAnimation); this.cameraAnimation = null; }
      if (this.state.followingClientId !== null) this.setState({ followingClientId: null });
    }
    this.cameraValue = { x: camera.x, y: camera.y, z: clampZoom(camera.z) };
    this.cameraListeners.forEach(listener => listener());
    this.persistCamera();
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistCamera() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try { sessionStorage.setItem(`crdt-canvas-camera-${this.session.roomId}`, JSON.stringify(this.cameraValue)); } catch { /* ignore */ }
    }, 400);
  }

  animateCamera(target: Camera, duration = 420) {
    if (this.cameraAnimation !== null) cancelAnimationFrame(this.cameraAnimation);
    const from = this.cameraValue;
    const start = performance.now();
    const { width, height } = this.viewport;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { this.setCamera(target); return; }
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      this.setCamera(t >= 1 ? target : interpolateCamera(from, target, t, width, height));
      this.cameraAnimation = t < 1 ? requestAnimationFrame(step) : null;
    };
    this.cameraAnimation = requestAnimationFrame(step);
  }

  zoomBy(factor: number) {
    this.animateCamera(zoomAt(this.cameraValue, { x: this.viewport.width / 2, y: this.viewport.height / 2 }, factor), 200);
  }

  zoomTo(z: number) {
    this.animateCamera(zoomAt(this.cameraValue, { x: this.viewport.width / 2, y: this.viewport.height / 2 }, z / this.cameraValue.z), 240);
  }

  zoomToFit(ids?: string[], animate = true) {
    const shapes = ids ? this.shapesById(ids) : this.snapshot.shapes;
    const bounds = unionOf(shapes.map(s => shapeBBox(s)));
    if (!bounds) { this.animateCamera({ x: this.viewport.width / 2, y: this.viewport.height / 2, z: 1 }); return; }
    const target = fitCamera(bounds, this.viewport.width, this.viewport.height, ids ? 120 : 80, ids && ids.length === 1 ? 1.5 : 1.25);
    if (animate) this.animateCamera(target, 520); else this.setCamera(target);
  }

  zoomToBounds(bounds: Bounds, maxZoom = 1.25) {
    this.animateCamera(fitCamera(bounds, this.viewport.width, this.viewport.height, 100, maxZoom), 600);
  }

  viewportCenter(): Point {
    return screenToWorld(this.cameraValue, { x: this.viewport.width / 2, y: this.viewport.height / 2 });
  }

  visibleBounds(): Bounds {
    return viewportBounds(this.cameraValue, this.viewport.width, this.viewport.height);
  }

  isPointVisible(p: Point): boolean {
    const b = this.visibleBounds();
    return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
  }

  // ── View flags ────────────────────────────────────────────────────────────

  toggleGrid() {
    const showGrid = !this.state.showGrid;
    writeString('crdt-canvas-grid', showGrid ? '1' : '0');
    this.setState({ showGrid });
  }

  toggleInkToShape() {
    const inkToShape = !this.state.inkToShape;
    writeString('crdt-canvas-ink-to-shape', inkToShape ? '1' : '0');
    this.setState({ inkToShape });
  }

  showCatchUp(catchUp: CatchUp | null, mode: 'replay' | 'highlight' = 'highlight') {
    this.setState({ catchUp: catchUp ? { catchUp, mode, startedAt: performance.now() } : null });
  }

  highlight(id: string | null) {
    this.setState({ highlightId: id });
  }

  /** Make the board match a past state again, as one undoable step. */
  revertTo(past: Shape[]) {
    if (this.readOnly) return;
    const pastById = new Map(past.map(s => [s.id, s]));
    const current = this.store.flush().all;
    this.store.transact(() => {
      for (const shape of current) {
        const then = pastById.get(shape.id);
        if (!then || then.deleted) { if (!shape.deleted) this.store.remove([shape.id]); continue; }
        if (shape.deleted) this.store.restore([shape.id]);
        if (then.data !== shape.data) {
          const patch: Record<string, unknown> = { ...then.data };
          for (const key of Object.keys(shape.data)) if (!(key in then.data)) patch[key] = undefined;
          this.store.update(shape.id, patch as Partial<ShapeData>, 'update');
        }
      }
    });
    this.store.stopCapturing();
    this.setState({ timeTravel: null, selection: [] });
  }
}

function area(shape: Shape) {
  const b = shapeBBox(shape);
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}

export function newShapeId(): string {
  return crypto.randomUUID().slice(0, 8) + '-' + Date.now().toString(36);
}
