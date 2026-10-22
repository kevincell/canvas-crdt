/**
 * BoardCanvas — interactive drawing surface.
 *
 * Tools: cursor select · hand box-select (drag a blue box, then drag the box to move the group)
 * · pen · line/arrow · rectangle · ellipse · text box · image · fill · eraser (partial, S/M/L)
 * · delete · laser.  Pan: Space / middle / right-drag, or drag empty space with the cursor.
 * Zoom: mouse wheel, pinch, or the + / − buttons.
 *
 * Drags are previewed locally at full frame rate and written to the shared document in small
 * batches, so moving things feels instant even while peers receive the changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type Shape, ShapeKind, type Conflict } from '@crdt-canvas/engine';
import { Box, IconButton, Tooltip } from '@mui/material';
import { Add, Remove } from '@mui/icons-material';
import {
  type Bounds, type Pt, boundsOf, unionBounds, normRect, intersects, contains, hitShape, insideClosed,
  eraseFromStroke, simplify, translateData, scaleData, resolveLine, textLayout,
} from './geometry';
import { drawShapes, drawShape, orderShapes, withAlpha } from './render';
import { type BoardData, type ToolId, type ToolStyle, ERASER_SIZES, type EraserSize, FONT_STACK, dataOf } from './model';
import { type ThemeMode, PALETTES, inkFor, v } from '../../theme/theme';
import { FloatingConflictWidget } from '../crdt/ui/FloatingConflictWidget';

export interface ShapeUpdate { id: string; data: Partial<BoardData>; op: 'move' | 'resize' | 'update' }

export interface BoardCanvasProps {
  shapes: Shape[];
  mode: ThemeMode;
  tool: ToolId;
  style: ToolStyle;
  eraserSize: EraserSize;
  readOnly?: boolean;
  me: { name: string; deviceId: string; color: string };
  remoteCursors: Map<string, { x: number; y: number; color: string; name: string }>;
  remoteLasers?: Map<string, { points: { x: number; y: number }[]; color: string }>;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  /** Hand-tool box (world coords) so the selection bar can offer "Text box here" */
  onBoxChange?: (box: Bounds | null) => void;
  boxRequest?: { box: Bounds | null; token: number };
  conflictAreas: Array<{ id: string; area: Bounds }>;
  liveConflicts?: Conflict[];
  onResolveLiveConflict?: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
  commentPins: Array<{ key: string; x: number; y: number; count: number; shapeIds: string[] }>;
  onOpenComments?: (shapeIds: string[]) => void;
  editTextRequest?: { id: string; token: number } | null;
  /** Pan (and zoom out if needed) so these objects are in view */
  focusRequest?: { ids: string[]; token: number } | null;
  createShape: (kind: ShapeKind, data: Partial<BoardData>) => string | null;
  updateShapes: (updates: ShapeUpdate[], skipHistory: boolean) => void;
  commitHistory: (entries: Array<{ id: string; prevData: any; nextData?: any }>) => void;
  deleteShapes: (ids: string[]) => void;
  /** Replace strokes with their remaining pieces after erasing (one transaction) */
  replaceStrokes: (replacements: Array<{ id: string; pieces: Pt[][] }>) => void;
  onLockedAttempt: (ids: string[], action: 'move' | 'delete' | 'edit') => void;
  onImageRequest: (at: Pt) => void;
  onCursor?: (x: number, y: number) => void;
  onLaser?: (points: Pt[] | null) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onZoomChange?: (zoom: number) => void;
  /** Rendered above the canvas at the selection's screen position */
  renderSelectionBar?: (info: { screen: { left: number; top: number; right: number; bottom: number }; world: Bounds; ids: string[] }) => ReactNode;
}

type Drag =
  | { kind: 'pan'; start: Pt; offset: Pt }
  | { kind: 'move'; start: Pt; ids: string[]; orig: Map<string, BoardData>; box: Bounds | null }
  | { kind: 'resize'; handle: number; ids: string[]; orig: Map<string, BoardData>; bounds: Bounds; box: boolean }
  | { kind: 'line-end'; id: string; end: 'start' | 'end'; orig: BoardData }
  | { kind: 'draw'; tool: ToolId; start: Pt; points: Pt[] }
  | { kind: 'box'; start: Pt; current: Pt }
  | { kind: 'erase'; path: Pt[] }
  | { kind: 'laser'; points: Array<Pt & { t: number }> };

const HANDLE_PX = 9;
const MIN_ZOOM = 0.1, MAX_ZOOM = 8;

export function BoardCanvas(props: BoardCanvasProps) {
  const {
    shapes, mode, tool, style, readOnly, remoteCursors, remoteLasers,
    selectedIds, onBoxChange, boxRequest, conflictAreas, liveConflicts, onResolveLiveConflict,
    commentPins, onOpenComments, editTextRequest, focusRequest,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ zoom: 1, offset: { x: 0, y: 0 } });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [coarsePointer, setCoarsePointer] = useState(false);
  const handlePx = coarsePointer ? 24 : HANDLE_PX;

  const imageCache = useRef(new Map<string, HTMLImageElement>());
  const dragRef = useRef<Drag | null>(null);
  const overridesRef = useRef(new Map<string, BoardData>());
  const erasePreviewRef = useRef(new Map<string, Pt[][]>());
  const flushTimerRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const pointersRef = useRef(new Map<number, Pt>());
  const uncapturedPointersRef = useRef(new Set<number>());
  const pinchRef = useRef<{ dist: number; zoom: number; world: Pt } | null>(null);
  const hoverRef = useRef<Pt | null>(null);
  const localLaserRef = useRef<Array<Pt & { t: number }>>([]);
  const [box, setBox] = useState<Bounds | null>(null);
  const boxRef = useRef(box);
  boxRef.current = box;
  const [cursorTick, setCursorTick] = useState(0);
  const [textEdit, setTextEdit] = useState<null | {
    id?: string; left: number; top: number; w: number; h: number; value: string; data: Partial<BoardData>;
  }>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const propsRef = useRef(props);
  propsRef.current = props;

  const byId = useMemo(() => new Map(shapes.filter(s => !s.deleted).map(s => [s.id, s])), [shapes]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  // ── coordinates ──
  const toWorld = useCallback((sx: number, sy: number): Pt => {
    const { zoom, offset } = viewRef.current;
    return { x: (sx - offset.x) / zoom, y: (sy - offset.y) / zoom };
  }, []);
  const toScreen = useCallback((p: Pt): Pt => {
    const { zoom, offset } = viewRef.current;
    return { x: p.x * zoom + offset.x, y: p.y * zoom + offset.y };
  }, []);
  const eventPoint = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  // ── shapes with local drag/erase previews applied ──
  const effectiveShape = useCallback((s: Shape): Shape => {
    const o = overridesRef.current.get(s.id);
    return o ? { ...s, data: o as any } : s;
  }, []);

  // Larger handles make resize and connector endpoints practical on touch screens.
  useEffect(() => {
    const media = window.matchMedia?.('(any-pointer: coarse)');
    if (!media) return;
    const sync = () => setCoarsePointer(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  // ── resize observer ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Centre the board on first load (world 0,0 a bit inset)
  const centredRef = useRef(false);
  useEffect(() => {
    if (centredRef.current || !size.w) return;
    centredRef.current = true;
    const active = shapes.filter(s => !s.deleted);
    const b = unionBounds(active.map(boundsOf));
    if (b) {
      const z = Math.min(1, Math.max(0.2, Math.min((size.w - 120) / Math.max(1, b.maxX - b.minX), (size.h - 160) / Math.max(1, b.maxY - b.minY))));
      setView({ zoom: z, offset: { x: (size.w - (b.maxX - b.minX) * z) / 2 - b.minX * z, y: (size.h - (b.maxY - b.minY) * z) / 2 - b.minY * z + 20 } });
    } else {
      setView({ zoom: 1, offset: { x: size.w / 2 - 300, y: size.h / 2 - 200 } });
    }
  }, [size.w, size.h, shapes]);

  useEffect(() => { props.onZoomChange?.(view.zoom); }, [view.zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusRequest || !size.w) return;
    const list = focusRequest.ids.map(id => byIdRef.current.get(id)).filter(Boolean).map(s => boundsOf(resolveLine(s!, byIdRef.current)));
    const b = unionBounds(list);
    if (!b) return;
    setView(vw => {
      const fit = Math.min((size.w - 160) / Math.max(1, b.maxX - b.minX), (size.h - 160) / Math.max(1, b.maxY - b.minY));
      const zoom = clampZoom(Math.min(vw.zoom, fit));
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      return { zoom, offset: { x: size.w / 2 - cx * zoom, y: size.h / 2 - cy * zoom } };
    });
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // External box request (e.g. clear box after "Text box here")
  useEffect(() => {
    if (!boxRequest) return;
    setBox(boxRequest.box);
  }, [boxRequest]);
  useEffect(() => { onBoxChange?.(box); }, [box, onBoxChange]);
  // Changing tool away from the hand clears its box
  useEffect(() => { if (tool !== 'box') setBox(null); }, [tool]);

  // ── rendering ──
  const rafRef = useRef<number | null>(null);
  const draw = useCallback(() => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = propsRef.current;
    const pal = PALETTES[p.mode];
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const { zoom, offset } = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.canvasBg;
    ctx.fillRect(0, 0, w, h);

    // dot grid
    const spacing = 28 * zoom;
    if (spacing > 7) {
      ctx.fillStyle = pal.canvasGrid;
      const r = Math.max(0.8, Math.min(1.6, zoom * 1.2));
      const sx = ((offset.x % spacing) + spacing) % spacing, sy = ((offset.y % spacing) + spacing) % spacing;
      ctx.beginPath();
      for (let x = sx; x < w; x += spacing) for (let y = sy; y < h; y += spacing) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      ctx.fill();
    }

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * offset.x, dpr * offset.y);
    const viewport = { minX: -offset.x / zoom - 50, minY: -offset.y / zoom - 50, maxX: (w - offset.x) / zoom + 50, maxY: (h - offset.y) / zoom + 50 };

    // shapes (with drag overrides; strokes being erased drawn as their remaining pieces)
    const erasing = erasePreviewRef.current;
    const live = p.shapes.filter(s => !s.deleted).map(s => effectiveShape(s));
    const visible = erasing.size ? live.filter(s => !erasing.has(s.id)) : live;
    drawShapes(ctx, visible, {
      mode: p.mode, zoom, imageCache: imageCache.current, onImageLoad: () => request(),
      hiddenIds: textEdit?.id ? new Set([textEdit.id]) : undefined, showLockBadges: true,
    }, viewport);
    erasing.forEach((pieces, id) => {
      const base = byIdRef.current.get(id);
      if (!base) return;
      pieces.forEach(pts => drawShape(ctx, { ...base, data: { ...(base.data as any), points: pts } }, { mode: p.mode, zoom, imageCache: imageCache.current }));
    });

    // conflict areas
    for (const c of p.conflictAreas) {
      const a = c.area;
      const pad = 10 / zoom;
      ctx.fillStyle = pal.conflictArea;
      ctx.strokeStyle = pal.conflictAreaStroke;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.fillRect(a.minX - pad, a.minY - pad, a.maxX - a.minX + pad * 2, a.maxY - a.minY + pad * 2);
      ctx.strokeRect(a.minX - pad, a.minY - pad, a.maxX - a.minX + pad * 2, a.maxY - a.minY + pad * 2);
      ctx.setLineDash([]);
    }

    // drawing preview
    const d = dragRef.current;
    if (d?.kind === 'draw' && d.points.length) {
      const last = d.points[d.points.length - 1];
      const ink = inkFor(p.style.color, p.mode);
      const base: any = { color: p.style.color, width: p.style.width, strokeWidth: p.style.width, dash: p.style.dash, opacity: p.style.opacity, fillOpacity: 0 };
      let preview: any = null;
      if (d.tool === 'pen') preview = { kind: ShapeKind.Stroke, ...base, points: d.points };
      else if (d.tool === 'line') preview = { kind: ShapeKind.Line, ...base, x1: d.start.x, y1: d.start.y, x2: last.x, y2: last.y, arrowEnd: p.style.arrow !== 'none', arrowStart: p.style.arrow === 'both' };
      else if (d.tool === 'rect') { const r = normRect(d.start, last); preview = { kind: ShapeKind.Rect, ...base, x: r.minX, y: r.minY, w: r.maxX - r.minX, h: r.maxY - r.minY }; }
      else if (d.tool === 'ellipse') { const r = normRect(d.start, last); preview = { kind: ShapeKind.Ellipse, ...base, cx: (r.minX + r.maxX) / 2, cy: (r.minY + r.maxY) / 2, rx: (r.maxX - r.minX) / 2, ry: (r.maxY - r.minY) / 2 }; }
      else if (d.tool === 'text') {
        const r = normRect(d.start, last);
        ctx.strokeStyle = withAlpha(ink, 0.6);
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([5 / zoom, 4 / zoom]);
        ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
        ctx.setLineDash([]);
      }
      if (preview) drawShape(ctx, { id: '__preview', kind: preview.kind, data: preview, actor: '', vector: {}, deleted: false, createdAt: 0, updatedAt: 0 }, { mode: p.mode, zoom, imageCache: imageCache.current });
    }

    // selection outlines + handles
    const sel = selectedRef.current.map(id => byIdRef.current.get(id)).filter(Boolean).map(s => resolveLine(effectiveShape(s!), byIdRef.current));
    if (sel.length) {
      ctx.strokeStyle = pal.selection;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      for (const s of sel) {
        const b = boundsOf(s);
        const pad = 5 / zoom;
        ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
      }
      ctx.setLineDash([]);
      if (p.tool === 'select' && sel.length === 1 && !(sel[0].data as BoardData).locked && !p.readOnly) {
        const s = sel[0];
        ctx.fillStyle = pal.surface;
        ctx.strokeStyle = pal.selection;
        ctx.lineWidth = 1.5 / zoom;
        for (const hp of handlePoints(s)) {
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, (handlePx / 2) / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // hand-tool box
    const liveBox = d?.kind === 'box' ? normRect(d.start, d.current) : boxRef.current;
    if (liveBox) {
      ctx.fillStyle = pal.boxSelectFill;
      ctx.strokeStyle = pal.boxSelectStroke;
      ctx.lineWidth = 1 / zoom;
      ctx.fillRect(liveBox.minX, liveBox.minY, liveBox.maxX - liveBox.minX, liveBox.maxY - liveBox.minY);
      ctx.strokeRect(liveBox.minX, liveBox.minY, liveBox.maxX - liveBox.minX, liveBox.maxY - liveBox.minY);
      if (d?.kind !== 'box' && !p.readOnly) {
        ctx.fillStyle = pal.boxSelectStroke;
        for (const hp of boxCorners(liveBox)) ctx.fillRect(hp.x - 4 / zoom, hp.y - 4 / zoom, 8 / zoom, 8 / zoom);
      }
    }

    // lasers (remote + local): glowing tail + bright tip
    const now = performance.now();
    const drawLaser = (pts: Pt[], color: string) => {
      if (pts.length < 1) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      for (let i = 1; i < pts.length; i++) {
        const t = i / pts.length;
        ctx.strokeStyle = withAlpha(color, 0.15 + 0.75 * t);
        ctx.lineWidth = (1.5 + 3.5 * t) / zoom;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      const tip = pts[pts.length - 1];
      ctx.shadowBlur = 24;
      ctx.fillStyle = withAlpha(color, 0.35);
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 11 / zoom, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 3.2 / zoom, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 5.5 / zoom, 0, Math.PI * 2); ctx.globalAlpha = 0.7; ctx.fill();
      ctx.restore();
    };
    p.remoteLasers?.forEach(l => drawLaser(l.points, l.color));
    const local = localLaserRef.current.filter(pt => now - pt.t < 1200);
    localLaserRef.current = local;
    if (local.length) drawLaser(local, p.me.color);

    // remote cursors
    p.remoteCursors.forEach(c => {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1 / zoom, 1 / zoom);
      ctx.fillStyle = c.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 15); ctx.lineTo(4.2, 11.4); ctx.lineTo(10, 11); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.font = '600 11px Inter, Arial, sans-serif';
      const tw = ctx.measureText(c.name).width;
      ctx.fillStyle = c.color;
      ctx.beginPath(); ctx.roundRect?.(11, 13, tw + 12, 18, 9); if (!ctx.roundRect) ctx.rect(11, 13, tw + 12, 18); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(c.name, 17, 26);
      ctx.restore();
    });

    // eraser cursor
    if (p.tool === 'eraser' && hoverRef.current) {
      const hp = hoverRef.current;
      ctx.strokeStyle = pal.textMuted;
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath(); ctx.arc(hp.x, hp.y, ERASER_SIZES[p.eraserSize], 0, Math.PI * 2); ctx.stroke();
    }

    if (local.length || (p.remoteLasers && p.remoteLasers.size)) request();
  }, [effectiveShape, textEdit?.id, handlePx]); // eslint-disable-line react-hooks/exhaustive-deps

  const request = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(() => drawRef.current());
  }, []);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => { request(); }, [shapes, view, size, mode, selectedIds, conflictAreas, remoteCursors, remoteLasers, tool, style, box, textEdit, cursorTick, handlePx, request]);

  // ── hit helpers ──
  const topHit = useCallback((p: Pt, filter?: (s: Shape) => boolean): Shape | null => {
    const tol = 6 / viewRef.current.zoom;
    const ordered = orderShapes(propsRef.current.shapes).map(s => resolveLine(effectiveShape(s), byIdRef.current));
    for (let i = ordered.length - 1; i >= 0; i--) {
      const s = ordered[i];
      if (filter && !filter(s)) continue;
      if (hitShape(s, p, tol)) return s;
    }
    return null;
  }, [effectiveShape]);

  const handleAt = useCallback((p: Pt): { idx: number; shape: Shape } | null => {
    const ids = selectedRef.current;
    if (ids.length !== 1 || propsRef.current.tool !== 'select') return null;
    const raw = byIdRef.current.get(ids[0]);
    if (!raw || (raw.data as BoardData).locked) return null;
    const s = resolveLine(effectiveShape(raw), byIdRef.current);
    const tol = (handlePx + 3) / viewRef.current.zoom;
    const hp = handlePoints(s);
    for (let i = 0; i < hp.length; i++) if (Math.hypot(hp[i].x - p.x, hp[i].y - p.y) <= tol) return { idx: i, shape: raw };
    return null;
  }, [effectiveShape, handlePx]);

  // ── writes (batched while dragging) ──
  const scheduleFlush = useCallback((op: 'move' | 'resize') => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      const updates: ShapeUpdate[] = [];
      overridesRef.current.forEach((data, id) => updates.push({ id, data, op }));
      if (updates.length) propsRef.current.updateShapes(updates, true);
    }, 60);
  }, []);

  const finishOverrides = useCallback((op: 'move' | 'resize', orig: Map<string, BoardData>) => {
    if (flushTimerRef.current != null) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const updates: ShapeUpdate[] = [];
    overridesRef.current.forEach((data, id) => updates.push({ id, data, op }));
    if (updates.length) {
      propsRef.current.updateShapes(updates, true);
      propsRef.current.commitHistory(updates.map(u => ({ id: u.id, prevData: orig.get(u.id), nextData: u.data })));
    }
    // keep overrides until the shared state catches up (avoids a flicker back)
    const pending = new Map(overridesRef.current);
    setTimeout(() => {
      pending.forEach((_, id) => { if (overridesRef.current.get(id) === pending.get(id)) overridesRef.current.delete(id); });
      request();
    }, 250);
  }, [request]);

  // ── text editing ──
  const openTextEditor = useCallback((s: Shape | null, at?: Bounds) => {
    const z = viewRef.current.zoom;
    if (s) {
      const d = dataOf(s) as any;
      const t = textLayout(d);
      const tl = toScreen({ x: t.left, y: t.top });
      setTextEdit({ id: s.id, left: tl.x, top: tl.y, w: Math.max(80, t.width * z), h: Math.max(30, t.height * z), value: d.text ?? '', data: d });
    } else if (at) {
      const tl = toScreen({ x: at.minX, y: at.minY });
      const p = propsRef.current.style;
      setTextEdit({
        left: tl.x, top: tl.y, w: Math.max(120, (at.maxX - at.minX) * z), h: Math.max(34, (at.maxY - at.minY) * z), value: '',
        data: { fontFamily: p.fontFamily, fontSize: p.fontSize, color: p.color, box: true, w: Math.max(120 / z, at.maxX - at.minX), h: Math.max(30 / z, at.maxY - at.minY), x: at.minX, y: at.minY + 16, opacity: p.opacity } as any,
      });
    }
    setTimeout(() => textAreaRef.current?.focus(), 30);
  }, [toScreen]);

  const commitText = useCallback((cancel = false) => {
    setTextEdit(current => {
      if (!current) return null;
      const text = (textAreaRef.current?.value ?? current.value).replace(/\s+$/, '');
      if (!cancel) {
        const p = propsRef.current;
        if (current.id) {
          if (text) p.updateShapes([{ id: current.id, data: { text } as any, op: 'update' }], false);
          else p.deleteShapes([current.id]);
        } else if (text) {
          const id = p.createShape(ShapeKind.Text, { ...current.data, text, createdBy: p.me.name, createdById: p.me.deviceId } as any);
          if (id) p.onSelectionChange([id]);
        }
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!editTextRequest) return;
    const s = byIdRef.current.get(editTextRequest.id);
    if (s && (s.kind === ShapeKind.Text) && !(s.data as BoardData).locked) openTextEditor(s);
  }, [editTextRequest, openTextEditor]);

  // Expose: create a text box filling a world rectangle (used by the selection bar)
  useEffect(() => {
    (window as any).__boardOpenTextBox = (b: Bounds) => openTextEditor(null, b);
    return () => { delete (window as any).__boardOpenTextBox; };
  }, [openTextEditor]);

  // ── pointer handlers ──
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (textEdit) { commitText(); }
    const sp = eventPoint(e);
    pointersRef.current.set(e.pointerId, sp);
    // Some mobile WebViews expose Pointer Events but throw while capturing a touch.
    // Drawing must continue when capture is unavailable.
    try {
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      uncapturedPointersRef.current.delete(e.pointerId);
    } catch {
      // Keep tracking this pointer at window level if the browser cannot capture it.
      uncapturedPointersRef.current.add(e.pointerId);
    }

    // Pinch with two fingers
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: viewRef.current.zoom, world: toWorld(mid.x, mid.y) };
      dragRef.current = null;
      return;
    }

    const wp = toWorld(sp.x, sp.y);
    const wantsPan = e.button === 1 || e.button === 2 || spaceRef.current;
    if (wantsPan || p.readOnly) {
      dragRef.current = { kind: 'pan', start: sp, offset: { ...viewRef.current.offset } };
      return;
    }
    if (e.button !== 0) return;

    const t = p.tool;
    if (t === 'select') {
      const handle = handleAt(wp);
      if (handle) {
        const s = handle.shape;
        const d = dataOf(s);
        if (d.kind === ShapeKind.Line) {
          dragRef.current = { kind: 'line-end', id: s.id, end: handle.idx === 0 ? 'start' : 'end', orig: d };
        } else {
          dragRef.current = { kind: 'resize', handle: handle.idx, ids: [s.id], orig: new Map([[s.id, d]]), bounds: boundsOf(resolveLine(s, byIdRef.current)), box: false };
        }
        return;
      }
      const hit = topHit(wp);
      if (hit) {
        let ids = selectedRef.current;
        if (e.shiftKey) ids = ids.includes(hit.id) ? ids.filter(i => i !== hit.id) : [...ids, hit.id];
        else if (!ids.includes(hit.id)) ids = [hit.id];
        p.onSelectionChange(ids);
        const movable = ids.filter(id => !(byIdRef.current.get(id)?.data as BoardData)?.locked);
        if (movable.length !== ids.length && ids.length) {
          // locked items in the selection don't move
        }
        if (movable.length) {
          dragRef.current = { kind: 'move', start: wp, ids: movable, orig: new Map(movable.map(id => [id, dataOf(byIdRef.current.get(id)!)])), box: null };
        }
        return;
      }
      p.onSelectionChange([]);
      dragRef.current = { kind: 'pan', start: sp, offset: { ...viewRef.current.offset } };
      return;
    }

    if (t === 'box') {
      const b = boxRef.current;
      if (b) {
        const tol = (coarsePointer ? 22 : 8) / viewRef.current.zoom;
        const corners = boxCorners(b);
        const ci = corners.findIndex(c => Math.hypot(c.x - wp.x, c.y - wp.y) <= tol);
        const ids = selectedRef.current.filter(id => !(byIdRef.current.get(id)?.data as BoardData)?.locked);
        if (ci >= 0 && ids.length) {
          dragRef.current = { kind: 'resize', handle: ci, ids, orig: new Map(ids.map(id => [id, dataOf(byIdRef.current.get(id)!)])), bounds: b, box: true };
          return;
        }
        if (contains(b, wp)) {
          dragRef.current = { kind: 'move', start: wp, ids, orig: new Map(ids.map(id => [id, dataOf(byIdRef.current.get(id)!)])), box: { ...b } };
          if (selectedRef.current.length > ids.length) p.onLockedAttempt(selectedRef.current.filter(id => !ids.includes(id)), 'move');
          return;
        }
      }
      setBox(null);
      p.onSelectionChange([]);
      dragRef.current = { kind: 'box', start: wp, current: wp };
      return;
    }

    if (t === 'pen' || t === 'line' || t === 'rect' || t === 'ellipse' || t === 'text') {
      dragRef.current = { kind: 'draw', tool: t, start: wp, points: [wp] };
      return;
    }
    if (t === 'eraser') {
      dragRef.current = { kind: 'erase', path: [wp] };
      eraseStep([wp]);
      return;
    }
    if (t === 'laser') {
      const pt = { ...wp, t: performance.now() };
      localLaserRef.current = [pt];
      dragRef.current = { kind: 'laser', points: [pt] };
      request();
      return;
    }
    if (t === 'delete') {
      const hit = topHit(wp);
      if (hit) {
        if ((hit.data as BoardData).locked) p.onLockedAttempt([hit.id], 'delete');
        else p.deleteShapes([hit.id]);
      }
      return;
    }
    if (t === 'fill') {
      const ordered = orderShapes(p.shapes);
      for (let i = ordered.length - 1; i >= 0; i--) {
        const s = ordered[i];
        const d = dataOf(s);
        const fillable = insideClosed(s, wp) || (d.kind === ShapeKind.Text && d.box && contains(boundsOf(s), wp));
        if (!fillable) continue;
        if (d.locked) { p.onLockedAttempt([s.id], 'edit'); return; }
        p.updateShapes([{ id: s.id, data: { fillColor: p.style.color, fillOpacity: 0.85 } as any, op: 'update' }], false);
        return;
      }
      return;
    }
    if (t === 'image') {
      p.onImageRequest(wp);
    }
  }, [eventPoint, toWorld, topHit, handleAt, commitText, textEdit, request, coarsePointer]); // eslint-disable-line react-hooks/exhaustive-deps

  const eraseStep = useCallback((path: Pt[]) => {
    const radius = ERASER_SIZES[propsRef.current.eraserSize];
    const preview = erasePreviewRef.current;
    const pathBounds = unionBounds(path.map(pt => ({ minX: pt.x - radius, minY: pt.y - radius, maxX: pt.x + radius, maxY: pt.y + radius })));
    if (!pathBounds) return;
    for (const s of propsRef.current.shapes) {
      if (s.deleted || s.kind !== ShapeKind.Stroke) continue;
      const d = dataOf(s) as any;
      if (d.locked) continue;
      if (!intersects(boundsOf(s), pathBounds)) continue;
      const source: Pt[][] = preview.get(s.id) ?? [d.points];
      let changed = false;
      const next: Pt[][] = [];
      for (const piece of source) {
        const res = eraseFromStroke(piece, path, radius);
        if (res) { changed = true; next.push(...res); } else next.push(piece);
      }
      if (changed) preview.set(s.id, next);
    }
    request();
  }, [request]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const sp = eventPoint(e);
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, sp);
    const wp = toWorld(sp.x, sp.y);
    hoverRef.current = wp;
    propsRef.current.onCursor?.(wp.x, wp.y);

    if (pinchRef.current && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoom = clampZoom(pinchRef.current.zoom * (dist / Math.max(1, pinchRef.current.dist)));
      setView({ zoom, offset: { x: mid.x - pinchRef.current.world.x * zoom, y: mid.y - pinchRef.current.world.y * zoom } });
      return;
    }

    const d = dragRef.current;
    if (!d) {
      if (propsRef.current.tool === 'eraser') request();
      return;
    }
    switch (d.kind) {
      case 'pan':
        setView(vw => ({ ...vw, offset: { x: d.offset.x + sp.x - d.start.x, y: d.offset.y + sp.y - d.start.y } }));
        break;
      case 'move': {
        const dx = wp.x - d.start.x, dy = wp.y - d.start.y;
        d.ids.forEach(id => { const o = d.orig.get(id); if (o) overridesRef.current.set(id, { ...o, ...translateData(o, dx, dy) } as BoardData); });
        if (d.box) setBox({ minX: d.box.minX + dx, minY: d.box.minY + dy, maxX: d.box.maxX + dx, maxY: d.box.maxY + dy });
        scheduleFlush('move');
        request();
        break;
      }
      case 'resize': {
        const b = d.bounds;
        const corners = boxCorners(b); // 0 tl, 1 tr, 2 br, 3 bl
        const fixed = corners[(d.handle + 2) % 4];
        const dragged = corners[d.handle];
        const dirX = dragged.x >= fixed.x ? 1 : -1, dirY = dragged.y >= fixed.y ? 1 : -1;
        let nw = Math.max(8, (wp.x - fixed.x) * dirX), nh = Math.max(8, (wp.y - fixed.y) * dirY);
        const ow = Math.max(1, b.maxX - b.minX), oh = Math.max(1, b.maxY - b.minY);
        const keepRatio = e.shiftKey || (d.ids.length === 1 && [ShapeKind.Image, ShapeKind.Text].includes(byIdRef.current.get(d.ids[0])?.kind as ShapeKind));
        let sx = nw / ow, sy = nh / oh;
        if (keepRatio) { const s = Math.max(sx, sy); sx = s; sy = s; nw = ow * s; nh = oh * s; }
        const newMinX = dirX > 0 ? fixed.x : fixed.x - nw;
        const newMinY = dirY > 0 ? fixed.y : fixed.y - nh;
        d.ids.forEach(id => {
          const o = d.orig.get(id);
          if (!o) return;
          overridesRef.current.set(id, { ...o, ...scaleData(o, fixed, sx, sy) } as BoardData);
        });
        if (d.box) setBox({ minX: newMinX, minY: newMinY, maxX: newMinX + nw, maxY: newMinY + nh });
        scheduleFlush('resize');
        request();
        break;
      }
      case 'line-end': {
        const o = d.orig as any;
        const patch = d.end === 'start' ? { x1: wp.x, y1: wp.y, startShapeId: undefined } : { x2: wp.x, y2: wp.y, endShapeId: undefined };
        overridesRef.current.set(d.id, { ...o, ...patch });
        scheduleFlush('resize');
        request();
        break;
      }
      case 'draw':
        if (d.tool === 'pen') {
          const last = d.points[d.points.length - 1];
          if (Math.hypot(last.x - wp.x, last.y - wp.y) * viewRef.current.zoom > 1.2) d.points.push(wp);
        } else {
          let q = wp;
          if (e.shiftKey && (d.tool === 'rect' || d.tool === 'ellipse')) {
            const s = Math.max(Math.abs(wp.x - d.start.x), Math.abs(wp.y - d.start.y));
            q = { x: d.start.x + Math.sign(wp.x - d.start.x || 1) * s, y: d.start.y + Math.sign(wp.y - d.start.y || 1) * s };
          }
          d.points = [d.start, q];
        }
        request();
        break;
      case 'box':
        d.current = wp;
        request();
        break;
      case 'erase':
        d.path.push(wp);
        eraseStep(d.path.slice(-6));
        break;
      case 'laser': {
        const pt = { ...wp, t: performance.now() };
        d.points.push(pt);
        localLaserRef.current.push(pt);
        const recent = d.points.filter(q => pt.t - q.t < 900).map(({ x, y }) => ({ x, y }));
        propsRef.current.onLaser?.(recent.slice(-40));
        request();
        break;
      }
    }
  }, [eventPoint, toWorld, request, scheduleFlush, eraseStep]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    uncapturedPointersRef.current.delete(e.pointerId);
    if (pinchRef.current && pointersRef.current.size < 2) { pinchRef.current = null; return; }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const p = propsRef.current;
    const base = { createdBy: p.me.name, createdById: p.me.deviceId, opacity: p.style.opacity, dash: p.style.dash };
    switch (d.kind) {
      case 'move': {
        const moved = d.ids.some(id => overridesRef.current.has(id));
        if (moved) finishOverrides('move', d.orig);
        break;
      }
      case 'resize':
      case 'line-end': {
        const orig = d.kind === 'line-end' ? new Map([[d.id, d.orig]]) : d.orig;
        if (d.kind === 'line-end') {
          // re-attach to a shape under the dropped end
          const o = overridesRef.current.get(d.id) as any;
          if (o) {
            const pt = d.end === 'start' ? { x: o.x1, y: o.y1 } : { x: o.x2, y: o.y2 };
            const target = topHit(pt, s => s.id !== d.id && [ShapeKind.Rect, ShapeKind.Ellipse, ShapeKind.Image, ShapeKind.Text].includes(s.kind));
            if (target) overridesRef.current.set(d.id, { ...o, [d.end === 'start' ? 'startShapeId' : 'endShapeId']: target.id });
          }
        }
        finishOverrides('resize', orig);
        break;
      }
      case 'draw': {
        const pts = d.points;
        const last = pts[pts.length - 1];
        const tooSmall = Math.hypot(last.x - d.start.x, last.y - d.start.y) * viewRef.current.zoom < 4;
        if (d.tool === 'pen') {
          if (pts.length < 2) pts.push({ x: pts[0].x + 0.5, y: pts[0].y + 0.5 });
          const id = p.createShape(ShapeKind.Stroke, { points: simplify(pts, 0.35 / viewRef.current.zoom), color: p.style.color, width: p.style.width, ...base } as any);
          void id;
        } else if (d.tool === 'text') {
          openTextEditor(null, tooSmall ? { minX: d.start.x, minY: d.start.y, maxX: d.start.x + 220 / viewRef.current.zoom, maxY: d.start.y + 40 / viewRef.current.zoom } : normRect(d.start, last));
        } else if (!tooSmall) {
          if (d.tool === 'line') {
            const startT = topHit(d.start, s => [ShapeKind.Rect, ShapeKind.Ellipse, ShapeKind.Image, ShapeKind.Text].includes(s.kind));
            const endT = topHit(last, s => [ShapeKind.Rect, ShapeKind.Ellipse, ShapeKind.Image, ShapeKind.Text].includes(s.kind) && s.id !== startT?.id);
            p.createShape(ShapeKind.Line, {
              x1: d.start.x, y1: d.start.y, x2: last.x, y2: last.y, color: p.style.color, width: p.style.width,
              arrowEnd: p.style.arrow !== 'none', arrowStart: p.style.arrow === 'both',
              startShapeId: startT?.id, endShapeId: endT?.id, ...base,
            } as any);
          } else if (d.tool === 'rect') {
            const r = normRect(d.start, last);
            p.createShape(ShapeKind.Rect, { x: r.minX, y: r.minY, w: r.maxX - r.minX, h: r.maxY - r.minY, color: p.style.color, strokeWidth: p.style.width, fillOpacity: 0, cornerRadius: 0, ...base } as any);
          } else if (d.tool === 'ellipse') {
            const r = normRect(d.start, last);
            p.createShape(ShapeKind.Ellipse, { cx: (r.minX + r.maxX) / 2, cy: (r.minY + r.maxY) / 2, rx: (r.maxX - r.minX) / 2, ry: (r.maxY - r.minY) / 2, color: p.style.color, strokeWidth: p.style.width, fillOpacity: 0, ...base } as any);
          }
        }
        request();
        break;
      }
      case 'box': {
        const r = normRect(d.start, d.current);
        if ((r.maxX - r.minX) * viewRef.current.zoom < 4 && (r.maxY - r.minY) * viewRef.current.zoom < 4) { setBox(null); break; }
        const ids = p.shapes.filter(s => !s.deleted && intersects(boundsOf(resolveLine(s, byIdRef.current)), r)).map(s => s.id);
        setBox(r);
        p.onSelectionChange(ids);
        break;
      }
      case 'erase': {
        const replacements: Array<{ id: string; pieces: Pt[][] }> = [];
        erasePreviewRef.current.forEach((pieces, id) => replacements.push({ id, pieces }));
        if (replacements.length) p.replaceStrokes(replacements);
        setTimeout(() => { erasePreviewRef.current.clear(); request(); }, 200);
        break;
      }
      case 'laser':
        setTimeout(() => p.onLaser?.(null), 900);
        break;
    }
  }, [finishOverrides, openTextEditor, topHit, request]);

  // Pointer capture is unreliable in some mobile browsers. If capture failed,
  // finish the gesture from the window and include the release coordinate so
  // the previewed final segment is committed to the shared document.
  const pointerMoveRef = useRef(onPointerMove);
  const pointerUpRef = useRef(onPointerUp);
  pointerMoveRef.current = onPointerMove;
  pointerUpRef.current = onPointerUp;
  useEffect(() => {
    const onWindowMove = (event: PointerEvent) => {
      if (uncapturedPointersRef.current.has(event.pointerId)) {
        pointerMoveRef.current(event as unknown as React.PointerEvent<HTMLCanvasElement>);
      }
    };
    const onWindowUp = (event: PointerEvent) => {
      if (!uncapturedPointersRef.current.has(event.pointerId)) return;
      const pointerEvent = event as unknown as React.PointerEvent<HTMLCanvasElement>;
      pointerMoveRef.current(pointerEvent);
      pointerUpRef.current(pointerEvent);
    };
    const onWindowCancel = (event: PointerEvent) => {
      if (!uncapturedPointersRef.current.has(event.pointerId)) return;
      pointerUpRef.current(event as unknown as React.PointerEvent<HTMLCanvasElement>);
    };
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowCancel);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowCancel);
    };
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (p.readOnly) return;
    const wp = toWorld(...(Object.values(eventPoint(e)) as [number, number]));
    const hit = topHit(wp, s => s.kind === ShapeKind.Text);
    if (hit) {
      if ((hit.data as BoardData).locked) p.onLockedAttempt([hit.id], 'edit');
      else openTextEditor(hit);
    }
  }, [toWorld, eventPoint, topHit, openTextEditor]);

  // ── wheel zoom ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        setView(vw => ({ ...vw, offset: { x: vw.offset.x - e.deltaX, y: vw.offset.y } }));
        return;
      }
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      setView(vw => {
        const zoom = clampZoom(vw.zoom * factor);
        const k = zoom / vw.zoom;
        return { zoom, offset: { x: sx - (sx - vw.offset.x) * k, y: sy - (sy - vw.offset.y) * k } };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setView(vw => {
      const zoom = clampZoom(vw.zoom * factor);
      const k = zoom / vw.zoom;
      const cx = size.w / 2, cy = size.h / 2;
      return { zoom, offset: { x: cx - (cx - vw.offset.x) * k, y: cy - (cy - vw.offset.y) * k } };
    });
  }, [size.w, size.h]);

  // ── keyboard ──
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'SELECT');
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const p = propsRef.current;
      if (e.code === 'Space') { spaceRef.current = true; setCursorTick(t => t + 1); }
      if (p.readOnly) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current.length) {
        e.preventDefault();
        const locked = selectedRef.current.filter(id => (byIdRef.current.get(id)?.data as BoardData)?.locked);
        const free = selectedRef.current.filter(id => !locked.includes(id));
        if (free.length) p.deleteShapes(free);
        if (locked.length) p.onLockedAttempt(locked, 'delete');
        p.onSelectionChange([]);
        setBox(null);
      }
      if (e.key === 'Escape') { p.onSelectionChange([]); setBox(null); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) p.onRedo?.(); else p.onUndo?.(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); p.onRedo?.(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        p.onSelectionChange(p.shapes.filter(s => !s.deleted).map(s => s.id));
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { spaceRef.current = false; setCursorTick(t => t + 1); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const blur = () => { spaceRef.current = false; };
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  // ── paste / drop images ──
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const wp = toWorld(...(Object.values(eventPoint(e)) as [number, number]));
    (window as any).__boardDroppedImage = file;
    propsRef.current.onImageRequest(wp);
  }, [toWorld, eventPoint]);

  // ── selection bar position ──
  const selectionInfo = useMemo(() => {
    if (!selectedIds.length && !box) return null;
    const list = selectedIds.map(id => byId.get(id)).filter(Boolean).map(s => resolveLine(effectiveShape(s!), byId));
    const world = box ?? unionBounds(list.map(boundsOf));
    if (!world) return null;
    const tl = toScreen({ x: world.minX, y: world.minY });
    const br = toScreen({ x: world.maxX, y: world.maxY });
    return { screen: { left: tl.x, top: tl.y, right: br.x, bottom: br.y }, world, ids: selectedIds };
  }, [selectedIds, box, byId, view, effectiveShape, toScreen, cursorTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const cursor = (() => {
    if (spaceRef.current || dragRef.current?.kind === 'pan') return 'grabbing';
    if (readOnly) return 'grab';
    switch (tool) {
      case 'select': return 'default';
      case 'box': return 'crosshair';
      case 'text': return 'text';
      case 'eraser': return 'none';
      case 'delete': return 'not-allowed';
      case 'fill': return 'cell';
      case 'laser': return 'crosshair';
      default: return 'crosshair';
    }
  })();

  const pal = PALETTES[mode];

  return (
    <Box ref={containerRef} sx={{ position: 'absolute', inset: 0, overflow: 'hidden', bgcolor: v('canvasBg') }}
      onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="Collaborative board"
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { hoverRef.current = null; if (tool === 'eraser') request(); }}
        onDoubleClick={onDoubleClick}
        onContextMenu={e => e.preventDefault()}
      />

      {/* Inline text editor */}
      {textEdit && (
        <textarea
          ref={textAreaRef}
          defaultValue={textEdit.value}
          onBlur={() => commitText()}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); commitText(!textEdit.id && !textAreaRef.current?.value); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
          }}
          placeholder="Type…"
          style={{
            position: 'absolute', left: textEdit.left, top: textEdit.top, width: textEdit.w, minHeight: textEdit.h,
            font: `500 ${((textEdit.data.fontSize as number) ?? 16) * view.zoom}px ${FONT_STACK[(textEdit.data.fontFamily as 'Arial') ?? 'Arial']}`,
            lineHeight: 1.3, padding: 6 * view.zoom, color: inkFor(String((textEdit.data as any).color ?? '#2F2A22'), mode),
            background: withAlpha(pal.surface, 0.92), border: `1.5px dashed ${pal.selection}`, borderRadius: 6,
            outline: 'none', resize: 'both', zIndex: 30, boxSizing: 'border-box',
          }}
        />
      )}

      {/* Comment pins */}
      {commentPins.map(pin => {
        const s = toScreen(pin);
        return (
          <Tooltip key={pin.key} title={`${pin.count} comment${pin.count === 1 ? '' : 's'}`}>
            <Box
              onClick={() => onOpenComments?.(pin.shapeIds)}
              sx={{
                position: 'absolute', left: s.x - 12, top: s.y - 26, minWidth: 24, height: 22, px: 0.6,
                borderRadius: '11px 11px 11px 2px', bgcolor: v('accent'), color: '#fff', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3, cursor: 'pointer',
                boxShadow: v('shadow'), zIndex: 12, userSelect: 'none',
              }}
            >💬 {pin.count}</Box>
          </Tooltip>
        );
      })}

      {/* Engine conflict resolve widgets (unchanged behaviour) */}
      {liveConflicts && onResolveLiveConflict && liveConflicts.map(c => {
        const s = byId.get(c.shapeId);
        if (!s) return null;
        return <FloatingConflictWidget key={`${c.shapeId}-${c.ts}`} conflict={c} shape={s} scale={view.zoom} offset={view.offset} onResolve={onResolveLiveConflict} />;
      })}

      {/* Contextual selection bar */}
      {selectionInfo && props.renderSelectionBar && !textEdit && !readOnly && (
        props.renderSelectionBar(selectionInfo)
      )}

      {/* Zoom + / − */}
      <Box sx={{ position: 'absolute', right: { xs: 12, md: 14 }, top: { xs: 12, md: 'auto' }, bottom: { xs: 'auto', md: 14 }, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 0.75, zIndex: 20 }}>
        <Tooltip title="Zoom in" placement="left">
          <IconButton size="small" onClick={() => zoomBy(1.2)} sx={zoomBtnSx}><Add fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title={`Zoom out (${Math.round(view.zoom * 100)}%)`} placement="left">
          <IconButton size="small" onClick={() => zoomBy(1 / 1.2)} sx={zoomBtnSx}><Remove fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

const zoomBtnSx = {
  width: 36, height: 36, bgcolor: v('surface'), color: v('text'), border: `1px solid ${v('border')}`,
  boxShadow: v('shadow'), '&:hover': { bgcolor: v('surface2') },
};

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

function boxCorners(b: Bounds): Pt[] {
  return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
}

function handlePoints(s: Shape): Pt[] {
  const d = s.data as any;
  if (d.kind === ShapeKind.Line) return [{ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }];
  return boxCorners(boundsOf(s));
}
