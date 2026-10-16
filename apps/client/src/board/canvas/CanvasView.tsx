/**
 * The interactive canvas: pointer state machine, render loop, presence
 * broadcast and inline editing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ShapeKind,
  geometryPatch,
  recognizeStroke,
  segmentHitsShape,
  shapeBBox,
  simplifyPath,
  textMetrics,
  type Conflict,
  type Shape,
  type ShapeData,
} from '@crdt-canvas/engine';
import type { Editor, Tool } from '../editor';
import { GRID_SIZE } from '../editor';
import { screenToWorld, zoomAt, fitCamera, type Bounds, type Camera, type Point } from './camera';
import { Renderer, type Draft, type PeerView, type Scene } from './renderer';
import {
  HANDLE_CURSORS,
  HANDLES,
  SpatialIndex,
  handlePosition,
  isFrame,
  normalizeBounds,
  resizeBounds,
  resolveConnector,
  scaleShapeData,
  snapAngle,
  snapBox,
  snapToGrid,
  sortByLayer,
  unionOf,
  type Guide,
  type Handle,
  type Preview,
} from './transform';
import { contrastText } from './palette';
import { invalidateTextLayouts } from './draw';
import { TextEditor, type EditTarget } from './TextEditor';
import { LaserTrails, readPeer, throttle, type LocalPresence } from '../presence';
import type { Identity } from '../../app/identity';
import { actorLabel } from '../../app/identity';

type Gesture =
  | { type: 'none' }
  | { type: 'pan'; startScreen: Point; camera: Camera }
  | { type: 'pinch'; distance: number; mid: Point; camera: Camera }
  | { type: 'marquee'; origin: Point; additive: boolean; base: string[] }
  | { type: 'translate'; origin: Point; ids: string[]; moved: boolean; clickedId: string | null; startBounds: Bounds; others: Bounds[]; duplicate: boolean; wasSelected: boolean }
  | { type: 'resize'; handle: Handle; origin: Point; ids: string[]; startBounds: Bounds; scaleText: boolean }
  | { type: 'endpoint'; id: string; which: 'start' | 'end' }
  | { type: 'draw'; points: Point[]; lastMove: number; anchor: Point | null }
  | { type: 'create'; tool: Tool; origin: Point; current: Point }
  | { type: 'erase'; last: Point }
  | { type: 'laser' };

const DRAG_THRESHOLD = 3;
const TAP_SIZE = { rect: { w: 160, h: 100 }, ellipse: { w: 140, h: 100 }, frame: { w: 480, h: 320 } };

export interface CanvasViewProps {
  editor: Editor;
  identity: Identity;
  dark: boolean;
  voting: boolean;
  onVote: (shapeId: string) => void;
  voteCounts: ReadonlyMap<string, number>;
  commentPins: Array<{ id: string; x: number; y: number; count: number }>;
  onDropFiles: (files: File[], at: Point) => void;
  onResolveConflict: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
}

export function CanvasView({ editor, identity, dark, voting, onVote, voteCounts, commentPins, onDropFiles, onResolveConflict }: CanvasViewProps) {
  const session = editor.session;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const rafRef = useRef<number | null>(null);

  const snapshot = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const camera = useSyncExternalStore(editor.subscribeCamera, editor.getCamera);
  const meta = useSyncExternalStore(session.subscribeMeta, session.getMeta);

  // Time travel swaps in a past state (read-only) without touching the document.
  const past = state.timeTravel;
  const view = useMemo(() => {
    if (!past) return { shapes: snapshot.shapes, byId: snapshot.byId, conflicts: snapshot.conflicts };
    const live = past.shapes.filter(s => !s.deleted);
    return { shapes: live, byId: new Map(past.shapes.map(s => [s.id, s])) as ReadonlyMap<string, Shape>, conflicts: [] as Conflict[] };
  }, [past, snapshot]);
  const ordered = useMemo(() => sortByLayer(view.shapes), [view.shapes]);
  const index = useMemo(() => new SpatialIndex(ordered, view.byId), [ordered, view.byId]);

  // Mutable interaction state (never triggers React renders).
  const gesture = useRef<Gesture>({ type: 'none' });
  const draft = useRef<Draft>(null);
  const preview = useRef<Preview | null>(null);
  const guides = useRef<Guide[]>([]);
  const fading = useRef<Set<string>>(new Set());
  const hoverId = useRef<string | null>(null);
  const localLaser = useRef<Array<Point & { t: number }>>([]);
  const lasers = useRef(new LaserTrails());
  const pointers = useRef(new Map<number, Point>());
  const spaceDown = useRef(false);
  const penSeen = useRef(false);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newText, setNewText] = useState<EditTarget | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [openConflict, setOpenConflict] = useState<string | null>(null);

  const viewSnapshot = useMemo(() => ({ ...snapshot, shapes: view.shapes, byId: view.byId, conflicts: view.conflicts }), [snapshot, view]);
  const latest = useRef({ snapshot: viewSnapshot, state, index, voting, voteCounts, commentPins, meta, dark });
  latest.current = { snapshot: viewSnapshot, state, index, voting, voteCounts, commentPins, meta, dark };

  // ── Theme colours from CSS tokens ─────────────────────────────────────────
  const colors = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      canvas: css.getPropertyValue('--canvas').trim() || (dark ? '#17181c' : '#fbfbfc'),
      dot: css.getPropertyValue('--canvas-dot').trim() || 'rgba(0,0,0,0.15)',
      accent: css.getPropertyValue('--accent').trim() || '#5b5bf0',
    };
  }, [dark]);

  // ── Render loop ───────────────────────────────────────────────────────────
  const buildScene = useCallback((): Scene => {
    const { snapshot: snap, state: st, index: idx, voteCounts: votes, commentPins: pins, meta: m } = latest.current;
    const peers: PeerView[] = [];
    session.awareness.getStates().forEach((raw, clientId) => {
      if (clientId === session.awareness.clientID || !raw) return;
      const peer = readPeer(clientId, raw);
      lasers.current.update(clientId, raw);
      peers.push({ ...peer, laser: lasers.current.get(clientId) });
    });
    const container = containerRef.current;
    return {
      shapes: ordered,
      byId: snap.byId,
      index: idx,
      conflicts: snap.conflicts,
      camera: editor.getCamera(),
      width: container?.clientWidth ?? 1,
      height: container?.clientHeight ?? 1,
      dark: latest.current.dark,
      sketch: m.style === 'sketch',
      showGrid: st.showGrid,
      accent: colors.accent,
      canvasColor: colors.canvas,
      dotColor: colors.dot,
      selection: new Set(st.selection),
      hoverId: hoverId.current,
      editingId: st.editingId,
      fading: fading.current,
      localPreview: preview.current,
      peers,
      draft: draft.current,
      guides: guides.current,
      catchUp: st.catchUp,
      authorship: st.authorship,
      voteCounts: votes,
      commentPins: pins,
      highlightId: st.highlightId,
      localLaser: localLaser.current,
      hideHandles: Boolean(preview.current) || gesture.current.type === 'marquee',
    };
  }, [editor, session, ordered, colors]);

  const requestRender = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const animate = renderer.render(buildScene(), performance.now());
      if (animate) requestRender();
    });
  }, [buildScene]);

  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new Renderer(canvasRef.current, () => requestRender());
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [requestRender]);

  useEffect(() => { requestRender(); }, [snapshot, state, camera, meta, dark, voteCounts, commentPins, requestRender]);

  // Repaint (and re-measure text) once the hand-drawn font arrives.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const onLoaded = () => { invalidateTextLayouts(); requestRender(); };
    fonts.addEventListener('loadingdone', onLoaded);
    if (meta.style === 'sketch') void fonts.load('20px "Patrick Hand"').then(onLoaded).catch(() => {});
    return () => fonts.removeEventListener('loadingdone', onLoaded);
  }, [meta.style, requestRender]);

  // Resize → viewport; first layout fits content if there is no saved camera.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      editor.viewport = { width: el.clientWidth, height: el.clientHeight };
      if (first) {
        first = false;
        const saved = sessionStorage.getItem(`crdt-canvas-camera-${session.roomId}`);
        if (!saved) {
          const shapes = session.store.getSnapshot().shapes;
          if (shapes.length) editor.zoomToFit(undefined, false);
          else editor.setCamera({ x: el.clientWidth / 2, y: el.clientHeight / 2, z: 1 });
        }
      }
      requestRender();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [editor, session, requestRender]);

  // Fit to content once the local copy has loaded (if the user hasn't moved yet).
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (fittedOnce.current || !snapshot.shapes.length) return;
    fittedOnce.current = true;
    if (!sessionStorage.getItem(`crdt-canvas-camera-${session.roomId}`)) editor.zoomToFit(undefined, false);
  }, [snapshot.shapes.length, editor, session]);

  // ── Presence broadcast ────────────────────────────────────────────────────
  const setPresence = useMemo(() => {
    const awareness = session.awareness;
    const base: LocalPresence = {
      user: { name: identity.name || 'Guest', color: identity.color, actor: identity.actor },
      actor: identity.name || 'Guest', color: identity.color,
      cursor: null, selection: [], preview: null, laser: null, viewport: null, editing: null,
    };
    awareness.setLocalState(base);
    const set = <K extends keyof LocalPresence>(key: K, value: LocalPresence[K]) => awareness.setLocalStateField(key, value);
    return {
      cursor: throttle((p: Point | null) => set('cursor', p), 33),
      preview: throttle((p: Preview | null) => set('preview', p), 33),
      laser: throttle((points: Point[] | null) => set('laser', points ? { points } : null), 33),
      viewport: throttle((b: Bounds) => set('viewport', b), 150),
      selection: (ids: string[]) => set('selection', ids),
      editing: (id: string | null) => set('editing', id),
    };
  }, [session, identity]);

  useEffect(() => { setPresence.selection(state.selection); }, [state.selection, setPresence]);
  useEffect(() => { setPresence.editing(state.editingId ?? (newText ? 'new' : null)); }, [state.editingId, newText, setPresence]);
  useEffect(() => { setPresence.viewport(editor.visibleBounds()); }, [camera, editor, setPresence]);

  // Re-render on presence changes; follow mode tracks the followed viewport.
  useEffect(() => {
    const awareness = session.awareness;
    const onChange = (changes: { removed: number[] }) => {
      changes.removed.forEach(id => lasers.current.remove(id));
      const following = editor.getState().followingClientId;
      if (following !== null) {
        const raw = awareness.getStates().get(following);
        if (!raw) editor.setState({ followingClientId: null });
        else {
          const peer = readPeer(following, raw);
          if (peer.viewport) {
            const target = fitCamera(peer.viewport, editor.viewport.width, editor.viewport.height, 0, 8);
            editor.animateCamera(target, 180);
          }
        }
      }
      requestRender();
    };
    awareness.on('change', onChange);
    return () => awareness.off('change', onChange);
  }, [session, editor, requestRender]);

  // Pre-selection highlight from a newly started follow.
  useEffect(() => {
    if (state.followingClientId === null) return;
    const raw = session.awareness.getStates().get(state.followingClientId);
    const peer = raw ? readPeer(state.followingClientId, raw) : null;
    if (peer?.viewport) editor.animateCamera(fitCamera(peer.viewport, editor.viewport.width, editor.viewport.height, 0, 8), 500);
  }, [state.followingClientId, session, editor]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toWorld = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return screenToWorld(editor.getCamera(), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, [editor]);

  const toScreen = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const selectionBounds = useCallback((): Bounds | null => {
    const { snapshot: snap, state: st } = latest.current;
    const shapes = st.selection.map(id => snap.byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
    return unionOf(shapes.map(s => shapeBBox(resolveConnector(s, snap.byId))));
  }, []);

  const handleAt = useCallback((screen: Point): Handle | 'start' | 'end' | null => {
    const { snapshot: snap, state: st } = latest.current;
    if (!st.selection.length || st.editingId) return null;
    const shapes = st.selection.map(id => snap.byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
    if (!shapes.length || shapes.every(s => s.data.locked)) return null;
    const cam = editor.getCamera();
    const sp = (p: Point) => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y });
    if (shapes.length === 1 && shapes[0].data.kind === ShapeKind.Line) {
      const line = resolveConnector(shapes[0], snap.byId).data as Extract<ShapeData, { kind: ShapeKind.Line }>;
      const a = sp({ x: line.x1, y: line.y1 }), b = sp({ x: line.x2, y: line.y2 });
      if (Math.hypot(screen.x - a.x, screen.y - a.y) <= 9) return 'start';
      if (Math.hypot(screen.x - b.x, screen.y - b.y) <= 9) return 'end';
      return null;
    }
    const b = selectionBounds();
    if (!b) return null;
    const pad = shapes.length === 1 && shapes[0].data.kind === ShapeKind.Text ? 4 : 0;
    const tl = sp({ x: b.minX, y: b.minY }), br = sp({ x: b.maxX, y: b.maxY });
    const sb = { minX: tl.x - pad, minY: tl.y - pad, maxX: br.x + pad, maxY: br.y + pad };
    const small = sb.maxX - sb.minX < 28 || sb.maxY - sb.minY < 28;
    for (const handle of HANDLES) {
      if (small && handle.length === 1) continue;
      const p = handlePosition(sb, handle);
      if (Math.abs(screen.x - p.x) <= 8 && Math.abs(screen.y - p.y) <= 8) return handle;
    }
    // Edges are grabbable along their length too.
    const edge = 5;
    const inX = screen.x > sb.minX + 8 && screen.x < sb.maxX - 8, inY = screen.y > sb.minY + 8 && screen.y < sb.maxY - 8;
    if (inX && Math.abs(screen.y - sb.minY) <= edge) return 'n';
    if (inX && Math.abs(screen.y - sb.maxY) <= edge) return 's';
    if (inY && Math.abs(screen.x - sb.minX) <= edge) return 'w';
    if (inY && Math.abs(screen.x - sb.maxX) <= edge) return 'e';
    return null;
  }, [editor, selectionBounds]);

  const hitAt = useCallback((p: Point, filter?: (s: Shape) => boolean) => {
    const { snapshot: snap, index: idx } = latest.current;
    return idx.hit(p, 6 / editor.getCamera().z, snap.byId, filter);
  }, [editor]);

  /** Connector target under a point: any non-line shape. */
  const bindTarget = useCallback((p: Point, exclude?: string): string | undefined => {
    const hit = hitAt(p, s => s.data.kind !== ShapeKind.Line && s.data.kind !== ShapeKind.Stroke && s.id !== exclude);
    if (hit) return hit.id;
    // Frames and outlined shapes: also bind when inside the box.
    const { index: idx } = latest.current;
    const z = editor.getCamera().z;
    const near = idx.query({ minX: p.x - 1, minY: p.y - 1, maxX: p.x + 1, maxY: p.y + 1 })
      .filter(s => s.id !== exclude && s.data.kind !== ShapeKind.Line && s.data.kind !== ShapeKind.Stroke && !isFrame(s));
    void z;
    return near[near.length - 1]?.id;
  }, [hitAt, editor]);

  const clearTransient = useCallback(() => {
    draft.current = null;
    preview.current = null;
    guides.current = [];
    fading.current = new Set();
    setPresence.preview(null);
    setPresence.preview.flush?.();
    if (stillTimer.current) { clearTimeout(stillTimer.current); stillTimer.current = null; }
    requestRender();
  }, [requestRender, setPresence]);

  const commitNewText = useCallback((text: string) => {
    const target = newText;
    setNewText(null);
    if (!target || target.kind !== 'new-text' || !text.trim()) return;
    editor.create(ShapeKind.Text, { x: target.at.x, y: target.at.y, text: text.replace(/\s+$/, ''), color: target.color, fontSize: target.fontSize });
  }, [newText, editor]);

  const startNewText = useCallback((at: Point) => {
    const { style } = editor.getState();
    const metrics = textMetrics('M', style.fontSize);
    setNewText({ kind: 'new-text', at: { x: at.x, y: at.y + metrics.fontSize / 2 }, color: style.color, fontSize: style.fontSize });
    editor.setState({ selection: [] });
  }, [editor]);

  // ── Pointer handling ──────────────────────────────────────────────────────
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    if (event.pointerType === 'pen') penSeen.current = true;
    // Stop the browser moving focus to <body> (which would blur a text editor
    // we are about to open); blur any other field explicitly instead.
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !container.contains(active)) active.blur();
    container.setPointerCapture?.(event.pointerId);
    const screen = toScreen(event);
    pointers.current.set(event.pointerId, screen);

    // Two fingers: pinch-zoom & pan; abandon whatever one finger started.
    if (pointers.current.size === 2) {
      clearTransient();
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, camera: editor.getCamera() };
      return;
    }
    if (pointers.current.size > 2) return;

    const p = toWorld(event);
    const st = editor.getState();
    const tool = st.timeTravel ? 'hand' : st.tool;
    const touchPans = event.pointerType === 'touch' && penSeen.current;

    if (event.button === 1 || event.button === 2 || spaceDown.current || tool === 'hand' || touchPans) {
      if (event.button === 2 && tool !== 'hand') return; // right click reserved for context menu
      gesture.current = { type: 'pan', startScreen: screen, camera: editor.getCamera() };
      container.style.cursor = 'grabbing';
      return;
    }
    if (event.button !== 0) return;

    if (latest.current.voting) {
      const hit = hitAt(p);
      if (hit) onVote(hit.id);
      return;
    }

    switch (tool) {
      case 'select': {
        const handle = handleAt(screen);
        if (handle === 'start' || handle === 'end') {
          gesture.current = { type: 'endpoint', id: st.selection[0], which: handle };
          return;
        }
        if (handle) {
          const ids = editor.selectedShapes.filter(s => !s.data.locked).map(s => s.id);
          const b = selectionBounds();
          if (b && ids.length) {
            const single = ids.length === 1 ? latest.current.snapshot.byId.get(ids[0]) : null;
            gesture.current = { type: 'resize', handle, origin: p, ids, startBounds: b, scaleText: ids.length > 1 || single?.data.kind === ShapeKind.Text };
            return;
          }
        }
        const hit = hitAt(p);
        if (hit) {
          const selected = st.selection.includes(hit.id);
          if (event.shiftKey) {
            const group = editor.expandGroups([hit.id]);
            editor.select(selected ? st.selection.filter(id => !group.includes(id)) : [...st.selection, ...group], { expandGroups: false });
            return;
          }
          if (!selected) editor.select([hit.id]);
          const ids = editor.getState().selection;
          const moving = editor.withFrameContents(editor.shapesById(ids)).filter(s => !s.data.locked);
          const movingIds = new Set(moving.map(s => s.id));
          const startBounds = unionOf(moving.map(s => shapeBBox(s))) ?? shapeBBox(hit);
          const view = editor.visibleBounds();
          const others = latest.current.index.query(view)
            .filter(s => !movingIds.has(s.id) && s.data.kind !== ShapeKind.Line)
            .slice(-300)
            .map(s => latest.current.index.bounds.get(s.id) ?? shapeBBox(s));
          gesture.current = { type: 'translate', origin: p, ids: [...movingIds], moved: false, clickedId: hit.id, startBounds, others, duplicate: event.altKey, wasSelected: selected };
          return;
        }
        if (!event.shiftKey) editor.clearSelection();
        gesture.current = { type: 'marquee', origin: p, additive: event.shiftKey, base: event.shiftKey ? st.selection : [] };
        return;
      }
      case 'pen': {
        gesture.current = { type: 'draw', points: [p], lastMove: performance.now(), anchor: screen };
        draft.current = { kind: 'stroke', points: [p], color: st.style.color, width: st.style.strokeWidth, recognized: null };
        requestRender();
        return;
      }
      case 'rect': case 'ellipse': case 'frame': case 'line': case 'arrow': {
        const start = st.snapToGrid ? snapToGrid(p, GRID_SIZE) : p;
        gesture.current = { type: 'create', tool, origin: start, current: start };
        return;
      }
      case 'text': {
        startNewText(p);
        return;
      }
      case 'note': {
        editor.createNoteAt(st.snapToGrid ? snapToGrid(p, GRID_SIZE) : p);
        return;
      }
      case 'eraser': {
        gesture.current = { type: 'erase', last: p };
        draft.current = { kind: 'eraser', trail: [{ ...p, t: performance.now() }] };
        const hit = hitAt(p, s => !s.data.locked);
        if (hit) fading.current = new Set([hit.id]);
        requestRender();
        return;
      }
      case 'laser': {
        gesture.current = { type: 'laser' };
        localLaser.current = [...localLaser.current, { ...p, t: performance.now() }].slice(-80);
        setPresence.laser([p]);
        requestRender();
        return;
      }
    }
  }, [editor, toScreen, toWorld, hitAt, handleAt, selectionBounds, clearTransient, requestRender, onVote, startNewText, setPresence]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const screen = toScreen(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, screen);
    const g = gesture.current;

    if (g.type === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAt(g.camera, g.mid, distance / Math.max(1, g.distance));
      editor.setCamera({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y }, { userInitiated: true });
      return;
    }

    const p = toWorld(event);
    editor.pointer = p;
    if (event.pointerType !== 'touch') setPresence.cursor(p);
    const st = editor.getState();
    const z = editor.getCamera().z;

    switch (g.type) {
      case 'pan': {
        editor.setCamera({ ...g.camera, x: g.camera.x + screen.x - g.startScreen.x, y: g.camera.y + screen.y - g.startScreen.y }, { userInitiated: true });
        return;
      }
      case 'marquee': {
        const bounds = normalizeBounds({ minX: g.origin.x, minY: g.origin.y, maxX: p.x, maxY: p.y });
        draft.current = { kind: 'marquee', bounds };
        const { snapshot: snap, index: idx } = latest.current;
        const inside = idx.query(bounds).filter(s => {
          const b = shapeBBox(resolveConnector(s, snap.byId));
          return b.minX >= bounds.minX && b.maxX <= bounds.maxX && b.minY >= bounds.minY && b.maxY <= bounds.maxY;
        }).map(s => s.id);
        editor.select([...g.base, ...inside]);
        requestRender();
        return;
      }
      case 'translate': {
        let dx = p.x - g.origin.x, dy = p.y - g.origin.y;
        if (!g.moved) {
          if (Math.hypot(dx * z, dy * z) < DRAG_THRESHOLD) return;
          g.moved = true;
          if (g.duplicate) {
            // Alt-drag: leave the originals, drag fresh copies.
            const copies = editor.insertShapes(editor.shapesById(g.ids).map(s => ({ id: s.id, data: s.data })), { offset: { x: 0, y: 0 } });
            editor.select(copies, { expandGroups: false });
            g.ids = copies;
          }
        }
        if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        let snapGuides: Guide[] = [];
        const moved = { minX: g.startBounds.minX + dx, minY: g.startBounds.minY + dy, maxX: g.startBounds.maxX + dx, maxY: g.startBounds.maxY + dy };
        if (st.snapToGrid) {
          const snapped = snapToGrid({ x: moved.minX, y: moved.minY }, GRID_SIZE);
          dx += snapped.x - moved.minX; dy += snapped.y - moved.minY;
        } else if (!(event.ctrlKey || event.metaKey)) {
          const snap = snapBox(moved, g.others, 6 / z);
          if (!event.shiftKey || dy === 0) dx += snap.dx;
          if (!event.shiftKey || dx === 0) dy += snap.dy;
          snapGuides = snap.guides;
        }
        guides.current = snapGuides;
        preview.current = { kind: 'translate', ids: g.ids, dx, dy };
        setPresence.preview(preview.current);
        container.style.cursor = 'grabbing';
        requestRender();
        return;
      }
      case 'resize': {
        const raw = resizeBounds(g.startBounds, g.handle, p.x - g.origin.x, p.y - g.origin.y, {
          keepAspect: event.shiftKey !== isAspectLocked(editor, g.ids),
          fromCenter: event.altKey,
        });
        const min = 4 / z;
        const to = { ...raw, maxX: Math.max(raw.maxX, raw.minX + min), maxY: Math.max(raw.maxY, raw.minY + min) };
        preview.current = { kind: 'scale', ids: g.ids, from: g.startBounds, to, scaleText: g.scaleText };
        setPresence.preview(preview.current);
        requestRender();
        return;
      }
      case 'endpoint': {
        const shape = latest.current.snapshot.byId.get(g.id);
        if (!shape || shape.data.kind !== ShapeKind.Line) return;
        const target = bindTarget(p, g.id);
        const other = g.which === 'start' ? { x: shape.data.x2, y: shape.data.y2 } : { x: shape.data.x1, y: shape.data.y1 };
        const free = event.shiftKey ? snapAngle(other, p) : p;
        const patch = g.which === 'start'
          ? { x1: free.x, y1: free.y, startShapeId: target }
          : { x2: free.x, y2: free.y, endShapeId: target };
        session.store.update(g.id, patch as Partial<ShapeData>, 'update');
        return;
      }
      case 'draw': {
        const pts = g.points;
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * z < 0.75) return;
        const d = draft.current;
        if (d?.kind === 'stroke' && d.recognized) {
          // Moving away after a snap cancels it and keeps inking.
          if (g.anchor && Math.hypot(screen.x - g.anchor.x, screen.y - g.anchor.y) > 10) d.recognized = null;
          else return;
        }
        pts.push(p);
        g.lastMove = performance.now();
        g.anchor = screen;
        if (d?.kind === 'stroke') d.points = pts;
        if (st.inkToShape) {
          if (stillTimer.current) clearTimeout(stillTimer.current);
          stillTimer.current = setTimeout(() => {
            const current = draft.current;
            if (current?.kind !== 'stroke' || gesture.current.type !== 'draw') return;
            const found = recognizeStroke(current.points);
            if (found) {
              current.recognized = recognizedToData(found, current.color, current.width, st.style);
              navigator.vibrate?.(8);
              requestRender();
            }
          }, 520);
        }
        requestRender();
        return;
      }
      case 'create': {
        let current = st.snapToGrid ? snapToGrid(p, GRID_SIZE) : p;
        if ((g.tool === 'line' || g.tool === 'arrow') && event.shiftKey) current = snapAngle(g.origin, current);
        g.current = current;
        draft.current = { kind: 'shape', data: createData(g.tool, g.origin, current, st.style, event.shiftKey, event.altKey) };
        requestRender();
        return;
      }
      case 'erase': {
        const hits = latest.current.index.query(normalizeBounds({ minX: g.last.x, minY: g.last.y, maxX: p.x, maxY: p.y }))
          .filter(s => !s.data.locked && !fading.current.has(s.id) && segmentHitsShape(resolveConnector(s, latest.current.snapshot.byId), g.last, p, 6 / z));
        if (hits.length) fading.current = new Set([...fading.current, ...hits.map(s => s.id)]);
        g.last = p;
        if (draft.current?.kind === 'eraser') draft.current.trail = [...draft.current.trail, { ...p, t: performance.now() }].slice(-40);
        requestRender();
        return;
      }
      case 'laser': {
        localLaser.current = [...localLaser.current, { ...p, t: performance.now() }].slice(-80);
        setPresence.laser(localLaser.current.slice(-12).map(({ x, y }) => ({ x, y })));
        requestRender();
        return;
      }
    }

    // Idle: hover feedback and cursors.
    if (st.tool === 'select' && !latest.current.voting) {
      const handle = handleAt(screen);
      if (handle === 'start' || handle === 'end') container.style.cursor = 'crosshair';
      else if (handle) container.style.cursor = HANDLE_CURSORS[handle];
      else {
        const hit = hitAt(p);
        const next = hit?.id ?? null;
        container.style.cursor = hit ? (hit.data.locked ? 'default' : 'move') : 'default';
        if (next !== hoverId.current) { hoverId.current = next; requestRender(); }
      }
    } else {
      container.style.cursor = cursorFor(st.tool, latest.current.voting);
      if (hoverId.current) { hoverId.current = null; requestRender(); }
    }
    if (spaceDown.current) container.style.cursor = 'grab';
  }, [editor, session, toScreen, toWorld, handleAt, hitAt, bindTarget, requestRender, setPresence]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const container = containerRef.current;
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g.type === 'pinch') {
      if (pointers.current.size === 0) gesture.current = { type: 'none' };
      return;
    }
    gesture.current = { type: 'none' };
    const st = editor.getState();
    const store = session.store;
    if (container) container.style.cursor = cursorFor(st.tool, latest.current.voting);

    switch (g.type) {
      case 'translate': {
        if (g.moved && preview.current?.kind === 'translate') {
          const { dx, dy } = preview.current;
          editor.translate(g.ids.map(id => ({ id, dx, dy })));
        } else if (!g.moved && g.wasSelected && g.clickedId && st.selection.length > 1) {
          editor.select([g.clickedId]);
        }
        break;
      }
      case 'resize': {
        const pv = preview.current;
        if (pv?.kind === 'scale') {
          const entries = g.ids.map(id => {
            const shape = latest.current.snapshot.byId.get(id);
            return shape ? { id, patch: scalePatch(shape.data, scaleShapeData(shape.data, pv.from, pv.to, pv.scaleText)) } : null;
          }).filter((e): e is { id: string; patch: Partial<ShapeData> } => Boolean(e));
          store.transact(() => {
            store.updateMany(entries, 'resize');
            editor.assignFrames(g.ids);
          });
          store.stopCapturing();
        }
        break;
      }
      case 'endpoint':
        store.stopCapturing();
        break;
      case 'marquee':
        break;
      case 'draw': {
        const d = draft.current;
        if (d?.kind === 'stroke') {
          if (d.recognized) {
            const id = editor.create(d.recognized.kind, d.recognized, { select: false });
            if (id && d.recognized.kind === ShapeKind.Line) {
              const line = d.recognized;
              const start = bindTarget({ x: line.x1, y: line.y1 }, id);
              const end = bindTarget({ x: line.x2, y: line.y2 }, id);
              if (start || end) store.update(id, { startShapeId: start, endShapeId: end === start ? undefined : end } as Partial<ShapeData>);
            }
          } else if (d.points.length) {
            const z = editor.getCamera().z;
            const points = simplifyPath(d.points.length === 1 ? [d.points[0], { x: d.points[0].x + 0.1, y: d.points[0].y + 0.1 }] : d.points, 0.35 / z)
              .map(pt => ({ x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100 }));
            editor.create(ShapeKind.Stroke, { points, color: d.color, width: d.width, ...(st.style.strokeStyle !== 'solid' ? { strokeStyle: st.style.strokeStyle } : {}) }, { select: false });
          }
          editor.setState({ tool: 'pen' });
        }
        break;
      }
      case 'create': {
        const tool = g.tool;
        const tiny = Math.hypot(g.current.x - g.origin.x, g.current.y - g.origin.y) * editor.getCamera().z < 4;
        let data: ShapeData;
        if (tiny && (tool === 'line' || tool === 'arrow')) break;
        if (tiny) {
          const size = TAP_SIZE[tool as keyof typeof TAP_SIZE] ?? TAP_SIZE.rect;
          data = createData(tool, { x: g.origin.x - size.w / 2, y: g.origin.y - size.h / 2 }, { x: g.origin.x + size.w / 2, y: g.origin.y + size.h / 2 }, st.style, false, false);
        } else {
          data = createData(tool, g.origin, g.current, st.style, event.shiftKey, event.altKey);
        }
        if (tool === 'frame') {
          const count = latest.current.snapshot.shapes.filter(isFrame).length;
          const minLayer = Math.min(0, ...latest.current.snapshot.shapes.map((s, i) => s.data.zIndex ?? i));
          const id = editor.create(ShapeKind.Rect, { ...data, frameTitle: `Frame ${count + 1}`, zIndex: minLayer - 1 } as Partial<ShapeData>);
          if (id) editor.adoptIntoFrame(id);
        } else if (data.kind === ShapeKind.Line) {
          const start = bindTarget({ x: data.x1, y: data.y1 });
          const end = bindTarget({ x: data.x2, y: data.y2 }, start);
          editor.create(ShapeKind.Line, { ...data, startShapeId: start, endShapeId: end && end !== start ? end : undefined });
        } else {
          const id = editor.create(data.kind, data);
          if (id && tiny && (data.kind === ShapeKind.Rect || data.kind === ShapeKind.Ellipse)) editor.beginEdit(id);
        }
        break;
      }
      case 'erase': {
        const ids = [...fading.current];
        if (ids.length) {
          store.remove(ids);
          store.stopCapturing();
          editor.pruneSelection();
        }
        break;
      }
      case 'laser':
        setPresence.laser(null);
        break;
      case 'pan':
        break;
    }
    clearTransient();
  }, [editor, session, bindTarget, clearTransient, setPresence]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    const st = editor.getState();
    if (st.tool !== 'select' || editor.readOnly || latest.current.voting) return;
    const p = toWorld(event);
    const hit = hitAt(p);
    if (hit && (hit.data.kind === ShapeKind.Text || hit.data.kind === ShapeKind.Note || hit.data.kind === ShapeKind.Rect || hit.data.kind === ShapeKind.Ellipse)) {
      editor.beginEdit(hit.id);
      return;
    }
    if (!hit) startNewText(p);
  }, [editor, toWorld, hitAt, startNewText]);

  // ── Wheel: trackpad pan, pinch / ctrl+wheel zoom ──────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('textarea, input, [data-scrollable]')) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const cam = editor.getCamera();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-60, Math.min(60, event.deltaY * unit));
        editor.setCamera(zoomAt(cam, anchor, Math.exp(-delta * 0.01)), { userInitiated: true });
      } else {
        const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
        const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
        editor.setCamera({ ...cam, x: cam.x - dx, y: cam.y - dy }, { userInitiated: true });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // Safari trackpad pinch.
    let gestureStart = 1;
    const onGestureStart = (event: Event) => { event.preventDefault(); gestureStart = editor.getCamera().z; };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const e = event as unknown as { scale: number; clientX: number; clientY: number };
      const rect = el.getBoundingClientRect();
      const cam = editor.getCamera();
      editor.setCamera(zoomAt(cam, { x: e.clientX - rect.left, y: e.clientY - rect.top }, (gestureStart * e.scale) / cam.z), { userInitiated: true });
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [editor]);

  // Space-to-pan.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTyping(event.target) && !event.repeat) {
        spaceDown.current = true;
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDown.current = false;
        if (containerRef.current) containerRef.current.style.cursor = cursorFor(editor.getState().tool, latest.current.voting);
      }
    };
    const blur = () => { spaceDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [editor]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.style.cursor = cursorFor(state.tool, voting);
  }, [state.tool, voting]);

  // Leaving the canvas hides our cursor for others.
  const onPointerLeave = useCallback(() => {
    setPresence.cursor(null);
    if (hoverId.current) { hoverId.current = null; requestRender(); }
  }, [setPresence, requestRender]);

  // ── Editing target ────────────────────────────────────────────────────────
  const editingShape = state.editingId ? snapshot.byId.get(state.editingId) : undefined;
  const editTarget: EditTarget | null = newText ?? (editingShape && !editingShape.deleted ? { kind: 'shape', shape: editingShape } : null);

  // ── Conflict badges ───────────────────────────────────────────────────────
  const conflictBadges = view.conflicts.map(conflict => {
    const shape = snapshot.byId.get(conflict.shapeId);
    if (!shape) return null;
    const b = shapeBBox(shape);
    return { conflict, x: b.maxX * camera.z + camera.x, y: b.minY * camera.z + camera.y };
  }).filter((x): x is { conflict: Conflict; x: number; y: number } => Boolean(x));

  return (
    <div
      ref={containerRef}
      className="board-canvas"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', background: colors.canvas }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={event => event.preventDefault()}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={event => {
        event.preventDefault();
        setDragOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length) onDropFiles(files, toWorld(event));
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Whiteboard with ${view.shapes.length} objects`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {editTarget && (
        <TextEditor
          key={editTarget.kind === 'shape' ? editTarget.shape.id : 'new'}
          target={editTarget}
          camera={camera}
          dark={dark}
          sketch={meta.style === 'sketch'}
          onCommit={text => {
            if (editTarget.kind === 'new-text') commitNewText(text);
            else editor.commitEdit(editTarget.shape.id, text);
          }}
          onLive={editTarget.kind === 'shape' && editTarget.shape.data.kind === ShapeKind.Note ? text => editor.liveEdit(editTarget.shape.id, text) : undefined}
        />
      )}
      {conflictBadges.map(({ conflict, x, y }) => (
        <ConflictBadge
          key={conflict.shapeId}
          conflict={conflict}
          x={x}
          y={y}
          open={openConflict === conflict.shapeId}
          onToggle={() => setOpenConflict(id => id === conflict.shapeId ? null : conflict.shapeId)}
          onResolve={action => { onResolveConflict(conflict.shapeId, action); setOpenConflict(null); }}
          readOnly={editor.readOnly}
        />
      ))}
      {dragOver && (
        <div style={{ position: 'absolute', inset: 12, border: '2px dashed var(--accent)', borderRadius: 16, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 40 }}>
          <div className="panel" style={{ padding: '12px 18px', fontWeight: 600 }}>Drop images, board files, or merge files</div>
        </div>
      )}
    </div>
  );
}

// ─── Conflict badge ─────────────────────────────────────────────────────────

function ConflictBadge({ conflict, x, y, open, onToggle, onResolve, readOnly }: {
  conflict: Conflict; x: number; y: number; open: boolean; readOnly: boolean;
  onToggle: () => void; onResolve: (action: 'merge' | 'keep-local' | 'keep-remote') => void;
}) {
  const severe = conflict.level === 'high' || conflict.type === 'delete_vs_edit';
  const people = conflict.actors.map(actorLabel);
  const title = conflict.type === 'delete_vs_edit' ? 'Edited and deleted at the same time' : 'Moved in different directions at the same time';
  return (
    <div style={{ position: 'absolute', left: x + 6, top: y - 30, zIndex: 25 }} onPointerDown={event => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`Conflict: ${title}`}
        aria-expanded={open}
        onClick={onToggle}
        style={{ width: 24, height: 24, borderRadius: 12, background: severe ? 'var(--danger)' : 'var(--warning)', color: '#fff', fontWeight: 800, boxShadow: 'var(--shadow-md)', animation: 'pulse 1.6s ease-in-out infinite' }}
      >!</button>
      {open && (
        <div className="menu" style={{ position: 'absolute', top: 30, left: -8, width: 280, padding: 12 }}>
          <div style={{ fontWeight: 650, marginBottom: 4 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {people.join(' and ')} changed this object without seeing each other's edit
            {conflict.type === 'concurrent_edit' ? ` (${conflict.level} intent ambiguity). The board kept one position; pick what you meant.` : '. It was kept so nothing is lost.'}
          </div>
          {!readOnly && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm primary" onClick={() => onResolve('keep-local')}>Keep mine</button>
              <button type="button" className="btn sm" onClick={() => onResolve('keep-remote')}>Keep theirs</button>
              {conflict.type === 'concurrent_edit' && <button type="button" className="btn sm" onClick={() => onResolve('merge')} title="Union of both intents">Combine</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cursorFor(tool: Tool, voting: boolean): string {
  if (voting) return 'pointer';
  switch (tool) {
    case 'hand': return 'grab';
    case 'select': return 'default';
    case 'text': return 'text';
    case 'eraser': return 'cell';
    case 'laser': return 'crosshair';
    default: return 'crosshair';
  }
}

function isAspectLocked(editor: Editor, ids: string[]): boolean {
  if (ids.length !== 1) return false;
  const shape = editor.snapshot.byId.get(ids[0]);
  return shape?.data.kind === ShapeKind.Image || shape?.data.kind === ShapeKind.Text;
}

/** Only geometry (and font size for text) is written on resize. */
function scalePatch(before: ShapeData, after: ShapeData): Partial<ShapeData> {
  const patch = geometryPatch(after) as Record<string, unknown>;
  if (after.kind === ShapeKind.Text && after.fontSize !== (before as { fontSize?: number }).fontSize) patch.fontSize = after.fontSize;
  if ((after.kind === ShapeKind.Stroke || after.kind === ShapeKind.Line) && after.width !== (before as { width?: number }).width) patch.width = after.width;
  return patch as Partial<ShapeData>;
}

function createData(tool: Tool, a: Point, b: Point, style: { color: string; strokeWidth: number; fill: number; strokeStyle: 'solid' | 'dashed' | 'dotted' }, square: boolean, fromCenter: boolean): ShapeData {
  let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
  if (tool === 'line' || tool === 'arrow') {
    return {
      kind: ShapeKind.Line, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: style.color, width: style.strokeWidth,
      arrowEnd: tool === 'arrow', ...(style.strokeStyle !== 'solid' ? { strokeStyle: style.strokeStyle } : {}),
    };
  }
  if (square) {
    const size = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + Math.sign(x1 - x0 || 1) * size;
    y1 = y0 + Math.sign(y1 - y0 || 1) * size;
  }
  if (fromCenter) { x0 = a.x - (x1 - a.x); y0 = a.y - (y1 - a.y); }
  const minX = Math.min(x0, x1), minY = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  const dash = style.strokeStyle !== 'solid' ? { strokeStyle: style.strokeStyle } : {};
  if (tool === 'ellipse') {
    return { kind: ShapeKind.Ellipse, cx: minX + w / 2, cy: minY + h / 2, rx: w / 2, ry: h / 2, color: style.color, fillOpacity: style.fill, strokeWidth: style.strokeWidth, ...dash };
  }
  if (tool === 'frame') {
    return { kind: ShapeKind.Rect, x: minX, y: minY, w, h, color: '#868e96', fillOpacity: 0, strokeWidth: 1 };
  }
  return { kind: ShapeKind.Rect, x: minX, y: minY, w, h, color: style.color, fillOpacity: style.fill, strokeWidth: style.strokeWidth, cornerRadius: 8, ...dash };
}

function recognizedToData(found: NonNullable<ReturnType<typeof recognizeStroke>>, color: string, width: number, style: { fill: number }): ShapeData {
  if (found.kind === 'line') return { kind: ShapeKind.Line, x1: found.x1, y1: found.y1, x2: found.x2, y2: found.y2, color, width, arrowEnd: found.arrow };
  if (found.kind === 'ellipse') return { kind: ShapeKind.Ellipse, cx: found.cx, cy: found.cy, rx: found.rx, ry: found.ry, color, fillOpacity: style.fill, strokeWidth: width };
  return { kind: ShapeKind.Rect, x: found.x, y: found.y, w: found.w, h: found.h, color, fillOpacity: style.fill, strokeWidth: width, cornerRadius: 8 };
}

export { contrastText };
