/**
 * One renderer for everything that draws a board: the live canvas, PNG/PDF export and the
 * checkpoint / conflict snapshot previews. Draws in world coordinates — the caller sets the
 * transform.
 */
import { type Shape, ShapeKind } from '@crdt-canvas/engine';
import { type BoardData, dataOf, dashPattern } from './model';
import { type Bounds, isClosedStroke, resolveLine, textLayout, boundsOf } from './geometry';
import { type ThemeMode, inkFor, PALETTES } from '../../theme/theme';

export interface DrawOptions {
  mode: ThemeMode;
  /** current zoom (to keep UI decorations like badges a constant screen size) */
  zoom: number;
  imageCache: Map<string, HTMLImageElement>;
  onImageLoad?: () => void;
  selectedIds?: ReadonlySet<string>;
  /** Objects hidden while being edited inline (text editor overlay) */
  hiddenIds?: ReadonlySet<string>;
  showLockBadges?: boolean;
}

export function withAlpha(color: string, alpha: number): string {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function orderShapes(shapes: Shape[]): Shape[] {
  return shapes
    .map((shape, index) => ({ shape, index }))
    .filter(e => !e.shape.deleted)
    .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
    .map(e => e.shape);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function applyStroke(ctx: CanvasRenderingContext2D, color: string, width: number, dash: BoardData['dash']) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashPattern(dash, width));
}

/** Draw a single (already line-resolved) shape */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, o: DrawOptions) {
  const d = dataOf(shape) as any;
  const ink = inkFor(d.color ?? '#2F2A22', o.mode);
  ctx.save();
  ctx.globalAlpha = typeof d.opacity === 'number' ? Math.max(0.05, Math.min(1, d.opacity)) : 1;

  switch (d.kind) {
    case ShapeKind.Stroke: {
      const pts = d.points as Array<{ x: number; y: number }>;
      if (!pts || pts.length < 1) break;
      if (d.fillColor && isClosedStroke(pts)) {
        ctx.fillStyle = withAlpha(inkFor(d.fillColor, o.mode), d.fillOpacity ?? 0.85);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
      }
      applyStroke(ctx, ink, d.width ?? 3, d.dash);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      // Smooth with quadratic midpoints
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      break;
    }
    case ShapeKind.Rect: {
      const fill = d.fillColor ? inkFor(d.fillColor, o.mode) : ink;
      const fillAlpha = d.fillColor ? (d.fillOpacity ?? 0.85) : (d.fillOpacity ?? 0);
      if (d.cornerRadius > 0) roundRectPath(ctx, d.x, d.y, d.w, d.h, d.cornerRadius);
      else { ctx.beginPath(); ctx.rect(d.x, d.y, d.w, d.h); }
      if (fillAlpha > 0) { ctx.fillStyle = withAlpha(fill, fillAlpha); ctx.fill(); }
      applyStroke(ctx, ink, d.strokeWidth ?? 2, d.dash);
      ctx.stroke();
      break;
    }
    case ShapeKind.Ellipse: {
      const fill = d.fillColor ? inkFor(d.fillColor, o.mode) : ink;
      const fillAlpha = d.fillColor ? (d.fillOpacity ?? 0.85) : (d.fillOpacity ?? 0);
      ctx.beginPath();
      ctx.ellipse(d.cx, d.cy, Math.max(0.5, d.rx), Math.max(0.5, d.ry), 0, 0, Math.PI * 2);
      if (fillAlpha > 0) { ctx.fillStyle = withAlpha(fill, fillAlpha); ctx.fill(); }
      applyStroke(ctx, ink, d.strokeWidth ?? 2, d.dash);
      ctx.stroke();
      break;
    }
    case ShapeKind.Line: {
      const w = d.width ?? 3;
      applyStroke(ctx, ink, w, d.dash);
      ctx.beginPath();
      ctx.moveTo(d.x1, d.y1);
      ctx.lineTo(d.x2, d.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ink;
      const head = Math.max(10, w * 3.4);
      if (d.arrowEnd) arrowHead(ctx, d.x1, d.y1, d.x2, d.y2, head);
      if (d.arrowStart) arrowHead(ctx, d.x2, d.y2, d.x1, d.y1, head);
      break;
    }
    case ShapeKind.Text: {
      if (o.hiddenIds?.has(shape.id)) break;
      const t = textLayout(d);
      if (d.box) {
        if (d.fillColor) {
          ctx.fillStyle = withAlpha(inkFor(d.fillColor, o.mode), d.fillOpacity ?? 0.85);
          roundRectPath(ctx, t.left, t.top, t.width, t.height, 6);
          ctx.fill();
        }
        if (d.strokeBox) {
          ctx.strokeStyle = withAlpha(ink, 0.5);
          ctx.lineWidth = 1;
          roundRectPath(ctx, t.left, t.top, t.width, t.height, 6);
          ctx.stroke();
        }
      }
      ctx.fillStyle = ink;
      ctx.font = t.font;
      ctx.textBaseline = 'top';
      t.lines.forEach((line, i) => ctx.fillText(line, t.left + t.pad, t.top + t.pad + i * t.lineH));
      break;
    }
    case ShapeKind.Note: {
      // Legacy sticky notes are shown as a filled text box
      if (o.hiddenIds?.has(shape.id)) break;
      const bg = d.bgColor || '#fef3c7';
      ctx.fillStyle = o.mode === 'night' ? withAlpha(bg, 0.28) : bg;
      roundRectPath(ctx, d.x, d.y, d.w, d.h, 6);
      ctx.fill();
      ctx.fillStyle = o.mode === 'night' ? PALETTES.night.text : (d.color || '#2F2A22');
      ctx.font = `500 14px Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const words = String(d.text ?? '').split(/\s+/);
      let line = '', y = d.y + 10;
      for (const word of words) {
        const cand = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(cand).width > d.w - 16) { ctx.fillText(line, d.x + 8, y); y += 18; line = word; }
        else line = cand;
      }
      if (line) ctx.fillText(line, d.x + 8, y);
      break;
    }
    case ShapeKind.Image: {
      const img = o.imageCache.get(d.src);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, d.x, d.y, d.w, d.h);
      } else {
        ctx.fillStyle = PALETTES[o.mode].surface2;
        ctx.fillRect(d.x, d.y, d.w, d.h);
        if (!o.imageCache.has(d.src)) {
          const el = new Image();
          el.onload = () => o.onImageLoad?.();
          el.src = d.src;
          o.imageCache.set(d.src, el);
        }
      }
      break;
    }
  }
  ctx.restore();
}

/** Draw a whole board (shapes in z-order) */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], o: DrawOptions, viewport?: Bounds) {
  const ordered = orderShapes(shapes);
  const byId = new Map(ordered.map(s => [s.id, s]));
  for (const raw of ordered) {
    const shape = resolveLine(raw, byId);
    if (viewport) {
      const b = boundsOf(shape);
      if (b.maxX < viewport.minX || b.minX > viewport.maxX || b.maxY < viewport.minY || b.minY > viewport.maxY) continue;
    }
    drawShape(ctx, shape, o);
    if (o.showLockBadges && (shape.data as BoardData).locked) {
      const b = boundsOf(shape);
      const r = 9 / o.zoom;
      ctx.save();
      ctx.fillStyle = PALETTES[o.mode].text;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(b.maxX, b.minY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = `${11 / o.zoom}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', b.maxX, b.minY + 0.5 / o.zoom);
      ctx.restore();
    }
  }
}

/** Render shapes to an offscreen canvas fitted to their bounds (export & snapshot previews) */
export function renderToCanvas(
  shapes: Shape[],
  opts: { mode: ThemeMode; maxWidth?: number; maxHeight?: number; padding?: number; background?: string; imageCache?: Map<string, HTMLImageElement>; onImageLoad?: () => void; focus?: Bounds | null; highlight?: Bounds | null },
): HTMLCanvasElement {
  const active = orderShapes(shapes);
  const byId = new Map(active.map(s => [s.id, s]));
  const resolved = active.map(s => resolveLine(s, byId));
  const pad = opts.padding ?? 40;
  const all = resolved.map(boundsOf);
  const b = opts.focus ? opts.focus : all.length
    ? all.reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) }))
    : { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const worldW = Math.max(1, b.maxX - b.minX) + pad * 2;
  const worldH = Math.max(1, b.maxY - b.minY) + pad * 2;
  const maxW = opts.maxWidth ?? 8192, maxH = opts.maxHeight ?? 8192;
  const scale = Math.min(maxW / worldW, maxH / worldH, opts.maxWidth ? 4 : 1, Math.sqrt(24_000_000 / (worldW * worldH)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(worldW * scale));
  canvas.height = Math.max(1, Math.ceil(worldH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = opts.background ?? PALETTES[opts.mode].canvasBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (pad - b.minX) * scale, (pad - b.minY) * scale);
  drawShapes(ctx, resolved, { mode: opts.mode, zoom: scale, imageCache: opts.imageCache ?? new Map(), onImageLoad: opts.onImageLoad });
  if (opts.highlight) {
    const h = opts.highlight, hp = 8 / scale;
    ctx.fillStyle = PALETTES[opts.mode].conflictArea.replace(/[\d.]+\)$/, '0.22)');
    ctx.strokeStyle = PALETTES[opts.mode].conflictAreaStroke;
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.fillRect(h.minX - hp, h.minY - hp, h.maxX - h.minX + hp * 2, h.maxY - h.minY + hp * 2);
    ctx.strokeRect(h.minX - hp, h.minY - hp, h.maxX - h.minX + hp * 2, h.maxY - h.minY + hp * 2);
    ctx.setLineDash([]);
  }
  return canvas;
}

/** Wait until all images used by the shapes are decoded (for exports) */
export async function preloadImages(shapes: Shape[], cache: Map<string, HTMLImageElement>) {
  const srcs = new Set(shapes.filter(s => !s.deleted && s.data.kind === ShapeKind.Image).map(s => (s.data as any).src as string));
  await Promise.all([...srcs].map(src => new Promise<void>(resolve => {
    const existing = cache.get(src);
    if (existing && existing.complete) return resolve();
    const img = existing ?? new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    if (!existing) { img.src = src; cache.set(src, img); }
  })));
}
