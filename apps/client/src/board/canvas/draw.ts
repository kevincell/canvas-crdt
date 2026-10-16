/**
 * Shape painting. Everything here draws in world coordinates (the caller has
 * applied the camera transform), so ink weight and text scale with zoom.
 * Expensive artefacts are cached per immutable record.
 */
import { getStroke } from 'perfect-freehand';
import rough from 'roughjs';
import type { Drawable } from 'roughjs/bin/core';
import type { RoughGenerator } from 'roughjs/bin/generator';
import {
  DEFAULT_NOTE_TEXT_SIZE,
  DEFAULT_TEXT_SIZE,
  ShapeKind,
  TEXT_LINE_HEIGHT,
  type EllipseShape,
  type LineShape,
  type NoteShape,
  type RectShape,
  type ShapeData,
  type StrokeShape,
  type TextShape,
} from '@crdt-canvas/engine';
import { contrastText, darken, displayColor, HAND_FONT, UI_FONT, withAlpha } from './palette';
import { hash } from '../../app/identity';

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  zoom: number;
  dark: boolean;
  sketch: boolean;
  images: ImageCache;
  /** Seed for deterministic sketch jitter (the shape id). */
  seed: string;
}

const strokePaths = new WeakMap<object, Path2D>();
const roughCache = new WeakMap<object, { dark: boolean; drawables: Drawable[] }>();
const layoutCache = new WeakMap<object, { sig: string; fontSize: number; lines: string[]; font: string }>();
let generator: RoughGenerator | null = null;
/** Bumped when web fonts finish loading so cached text layouts are re-measured. */
let fontEpoch = 0;
export function invalidateTextLayouts() { fontEpoch++; }
const roughGen = () => (generator ??= rough.generator());

export function fontFor(size: number, sketch: boolean, weight = 500) {
  return `${weight} ${size}px ${sketch ? HAND_FONT : UI_FONT}`;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function drawShape(dc: DrawContext, data: ShapeData) {
  switch (data.kind) {
    case ShapeKind.Stroke: return drawStroke(dc, data);
    case ShapeKind.Rect: return drawRect(dc, data);
    case ShapeKind.Ellipse: return drawEllipse(dc, data);
    case ShapeKind.Line: return drawLine(dc, data);
    case ShapeKind.Text: return drawText(dc, data);
    case ShapeKind.Note: return drawNote(dc, data);
    case ShapeKind.Image: return drawImage(dc, data);
  }
}

// ─── Freehand ink ───────────────────────────────────────────────────────────

export function strokeOutline(points: Array<{ x: number; y: number }>, width: number, complete: boolean): Path2D {
  const outline = getStroke(points.map(p => [p.x, p.y]), {
    size: width * 1.6,
    thinning: 0.5,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: true,
    last: complete,
  });
  const path = new Path2D();
  if (outline.length < 2) {
    const p = points[0];
    if (p) path.arc(p.x, p.y, width * 0.6, 0, Math.PI * 2);
    return path;
  }
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[i + 1];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

function drawStroke({ ctx, dark }: DrawContext, d: StrokeShape) {
  if (!d.points?.length) return;
  let path = strokePaths.get(d);
  if (!path) { path = strokeOutline(d.points, d.width || 2, true); strokePaths.set(d, path); }
  ctx.fillStyle = displayColor(d.color, dark);
  if (d.strokeStyle && d.strokeStyle !== 'solid') {
    // Dashed ink reads better as a centred line than a filled outline.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = d.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setDash(ctx, d.strokeStyle, d.width);
    ctx.beginPath();
    ctx.moveTo(d.points[0].x, d.points[0].y);
    for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  ctx.fill(path);
}

// ─── Geometric shapes ───────────────────────────────────────────────────────

function setDash(ctx: CanvasRenderingContext2D, style: ShapeData['strokeStyle'], width: number) {
  if (style === 'dashed') ctx.setLineDash([width * 4 + 4, width * 3 + 4]);
  else if (style === 'dotted') ctx.setLineDash([0.01, width * 2.5 + 3]);
  else ctx.setLineDash([]);
}

function sketchDrawables(dc: DrawContext, data: ShapeData, build: (g: RoughGenerator, seed: number) => Drawable[]): Drawable[] {
  const cached = roughCache.get(data);
  if (cached && cached.dark === dc.dark) return cached.drawables;
  const drawables = build(roughGen(), (hash(dc.seed) % 2_000_000) + 1);
  roughCache.set(data, { dark: dc.dark, drawables });
  return drawables;
}

function paintDrawables(ctx: CanvasRenderingContext2D, drawables: Drawable[]) {
  // Minimal renderer for rough.js op sets (avoids binding a RoughCanvas to a canvas).
  for (const drawable of drawables) {
    for (const set of drawable.sets) {
      const path = new Path2D();
      for (const op of set.ops) {
        const d = op.data;
        if (op.op === 'move') path.moveTo(d[0], d[1]);
        else if (op.op === 'bcurveTo') path.bezierCurveTo(d[0], d[1], d[2], d[3], d[4], d[5]);
        else if (op.op === 'lineTo') path.lineTo(d[0], d[1]);
      }
      const o = drawable.options;
      if (set.type === 'fillPath') {
        ctx.fillStyle = o.fill ?? 'transparent';
        ctx.fill(path, 'evenodd');
      } else if (set.type === 'fillSketch') {
        ctx.strokeStyle = o.fill ?? 'transparent';
        ctx.lineWidth = o.fillWeight ?? Math.max(1, o.strokeWidth / 2);
        ctx.stroke(path);
      } else {
        ctx.strokeStyle = o.stroke;
        ctx.lineWidth = o.strokeWidth;
        ctx.stroke(path);
      }
    }
  }
}

function drawRect(dc: DrawContext, d: RectShape) {
  const { ctx, dark, zoom } = dc;
  const stroke = displayColor(d.color, dark);
  const width = d.strokeWidth ?? 2;
  const opacity = d.fillOpacity ?? 0.13;
  if (d.frameTitle) return drawFrame(dc, d);
  if (dc.sketch) {
    const drawables = sketchDrawables(dc, d, (g, seed) => [g.rectangle(d.x, d.y, d.w, d.h, {
      seed, roughness: 1.1, bowing: 1, stroke, strokeWidth: Math.max(1, width),
      fill: opacity > 0.02 ? withAlpha(stroke, Math.min(1, opacity)) : undefined,
      fillStyle: opacity >= 0.5 ? 'solid' : 'hachure', hachureGap: 8, fillWeight: 1.2,
    })]);
    paintDrawables(ctx, drawables);
  } else {
    const r = Math.min(d.cornerRadius ?? 0, Math.abs(d.w) / 2, Math.abs(d.h) / 2);
    ctx.beginPath();
    if (r > 0) ctx.roundRect(d.x, d.y, d.w, d.h, r); else ctx.rect(d.x, d.y, d.w, d.h);
    if (opacity > 0) { ctx.fillStyle = withAlpha(stroke, opacity); ctx.fill(); }
    if (width > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      setDash(ctx, d.strokeStyle, width);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (d.label) drawLabel(dc, d.label, d.x, d.y, d.w, d.h, opacity >= 0.5 ? contrastText(d.color) : stroke);
  void zoom;
}

function drawFrame(dc: DrawContext, d: RectShape) {
  const { ctx, dark, zoom } = dc;
  ctx.beginPath();
  ctx.roundRect(d.x, d.y, d.w, d.h, 8 / Math.max(zoom, 0.5));
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.65)';
  ctx.fill();
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(17,24,39,0.16)';
  ctx.lineWidth = 1 / zoom;
  ctx.stroke();
}

/** Frame titles are drawn in screen space by the renderer so they stay legible. */
export function drawFrameTitle(ctx: CanvasRenderingContext2D, title: string, screenX: number, screenY: number, maxWidth: number, dark: boolean, selected: boolean, accent: string) {
  ctx.font = fontFor(12, false, 600);
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = selected ? accent : dark ? '#a1a5b3' : '#646a78';
  const text = ellipsize(ctx, title, Math.max(40, maxWidth));
  ctx.fillText(text, screenX + 2, screenY - 5);
  ctx.textBaseline = 'alphabetic';
}

function drawEllipse(dc: DrawContext, d: EllipseShape) {
  const { ctx, dark } = dc;
  const stroke = displayColor(d.color, dark);
  const width = d.strokeWidth ?? 2;
  const opacity = d.fillOpacity ?? 0.13;
  if (dc.sketch) {
    const drawables = sketchDrawables(dc, d, (g, seed) => [g.ellipse(d.cx, d.cy, d.rx * 2, d.ry * 2, {
      seed, roughness: 1.1, stroke, strokeWidth: Math.max(1, width),
      fill: opacity > 0.02 ? withAlpha(stroke, Math.min(1, opacity)) : undefined,
      fillStyle: opacity >= 0.5 ? 'solid' : 'hachure', hachureGap: 8, fillWeight: 1.2,
    })]);
    paintDrawables(ctx, drawables);
  } else {
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy, Math.max(0.01, Math.abs(d.rx)), Math.max(0.01, Math.abs(d.ry)), 0, 0, Math.PI * 2);
    if (opacity > 0) { ctx.fillStyle = withAlpha(stroke, opacity); ctx.fill(); }
    if (width > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      setDash(ctx, d.strokeStyle, width);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (d.label) {
    const w = Math.abs(d.rx) * 2 * 0.72, h = Math.abs(d.ry) * 2 * 0.72;
    drawLabel(dc, d.label, d.cx - w / 2, d.cy - h / 2, w, h, opacity >= 0.5 ? contrastText(d.color) : stroke);
  }
}

function drawLine(dc: DrawContext, d: LineShape) {
  const { ctx, dark } = dc;
  const stroke = displayColor(d.color, dark);
  const width = d.width || 2;
  if (dc.sketch) {
    const drawables = sketchDrawables(dc, d, (g, seed) => [g.line(d.x1, d.y1, d.x2, d.y2, { seed, roughness: 1, stroke, strokeWidth: width })]);
    paintDrawables(ctx, drawables);
  } else {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    setDash(ctx, d.strokeStyle, width);
    ctx.beginPath();
    ctx.moveTo(d.x1, d.y1);
    // Stop the shaft short of the tip so it doesn't poke through the head.
    if (d.arrowEnd) {
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1;
      const head = arrowHeadSize(width);
      const back = Math.min(len, head * 0.6);
      ctx.lineTo(d.x2 - (d.x2 - d.x1) / len * back, d.y2 - (d.y2 - d.y1) / len * back);
    } else {
      ctx.lineTo(d.x2, d.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (d.arrowEnd) drawArrowHead(ctx, d.x1, d.y1, d.x2, d.y2, arrowHeadSize(width), stroke);
}

export function arrowHeadSize(width: number) {
  return Math.max(10, width * 4);
}

export function drawArrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number, color: string) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// ─── Text ───────────────────────────────────────────────────────────────────

function drawText(dc: DrawContext, d: TextShape) {
  const { ctx, dark, zoom } = dc;
  const size = d.fontSize ?? DEFAULT_TEXT_SIZE;
  const lineHeight = size * TEXT_LINE_HEIGHT;
  const color = displayColor(d.color === '#ffffff' || d.color === '#fff' ? '#1e1e1e' : d.color, dark);
  const lines = d.text.split('\n');
  if (size * zoom < 4) return greek(ctx, lines, d.x, d.y - size, size, lineHeight, color);
  ctx.font = fontFor(size, dc.sketch);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, d.x, d.y - size + i * lineHeight + size * 0.12));
  ctx.textBaseline = 'alphabetic';
}

function drawLabel(dc: DrawContext, text: string, x: number, y: number, w: number, h: number, color: string) {
  const { ctx, zoom } = dc;
  const pad = 8;
  const layout = fitText(ctx, text, Math.abs(w) - pad * 2, Math.abs(h) - pad * 2, 18, dc.sketch);
  const lineHeight = layout.fontSize * TEXT_LINE_HEIGHT;
  const total = layout.lines.length * lineHeight;
  const top = Math.min(y, y + h) + Math.abs(h) / 2 - total / 2;
  const cx = Math.min(x, x + w) + Math.abs(w) / 2;
  if (layout.fontSize * zoom < 4) return greek(ctx, layout.lines, cx - Math.abs(w) / 2 + pad, top, layout.fontSize, lineHeight, color);
  ctx.font = layout.font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  layout.lines.forEach((line, i) => ctx.fillText(line, cx, top + i * lineHeight + layout.fontSize * 0.12));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawNote(dc: DrawContext, d: NoteShape) {
  const { ctx, zoom } = dc;
  const bg = d.bgColor || '#fff3bf';
  const r = Math.min(6, d.w / 8);
  // Soft paper shadow (screen-space blur stays crisp at every zoom).
  ctx.save();
  ctx.shadowColor = dc.dark ? 'rgba(0,0,0,0.45)' : 'rgba(30,30,40,0.16)';
  ctx.shadowBlur = Math.min(18, 10 * zoom);
  ctx.shadowOffsetY = Math.min(6, 3 * zoom);
  ctx.beginPath();
  ctx.roundRect(d.x, d.y, d.w, d.h, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();
  // Darker fold strip along the top edge.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(d.x, d.y, d.w, d.h, r);
  ctx.clip();
  ctx.fillStyle = darken(bg, 0.07);
  ctx.fillRect(d.x, d.y, d.w, Math.max(3, d.h * 0.06));
  ctx.restore();

  if (!d.text) return;
  const color = d.color && d.color !== bg ? d.color : contrastText(bg);
  const pad = Math.max(8, d.w * 0.07);
  const preferred = d.fontSize ?? DEFAULT_NOTE_TEXT_SIZE;
  // Semantic zoom: when zoomed far out, magnify the note's text (up to its
  // box) so an overview of many notes stays readable instead of turning to dots.
  const target = zoom < 0.5 ? Math.max(preferred, Math.min(d.h / 3, 12 / zoom)) : preferred;
  // Quantise to quarter-octaves so continuous zooming reuses cached layouts.
  const magnified = preferred * Math.pow(2, Math.round(Math.log2(target / preferred) * 4) / 4);
  const layout = fitText(ctx, d.text, d.w - pad * 2, d.h - pad * 2, magnified, dc.sketch, d);
  const lineHeight = layout.fontSize * TEXT_LINE_HEIGHT;
  if (layout.fontSize * zoom < 3.5) return greek(ctx, layout.lines, d.x + pad, d.y + pad, layout.fontSize, lineHeight, withAlpha(color, 0.5));
  ctx.font = layout.font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  const maxLines = Math.max(1, Math.floor((d.h - pad * 2) / lineHeight));
  layout.lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, d.x + pad, d.y + pad + i * lineHeight + layout.fontSize * 0.1));
  ctx.textBaseline = 'alphabetic';
}

/** Wrap text into a box, shrinking the font (down to 40%) until it fits. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number, preferred: number, sketch: boolean, cacheKey?: object) {
  const sig = `${Math.round(maxWidth)}|${Math.round(maxHeight)}|${preferred.toFixed(2)}|${sketch ? 1 : 0}|${fontEpoch}`;
  const cached = cacheKey ? layoutCache.get(cacheKey) : undefined;
  if (cached && cached.sig === sig) return cached;
  let size = preferred;
  let lines: string[] = [];
  const min = Math.max(6, preferred * 0.4);
  for (let i = 0; i < 12; i++) {
    ctx.font = fontFor(size, sketch);
    lines = wrap(ctx, text, Math.max(10, maxWidth));
    if (wrappedHeight(lines.length, size) <= maxHeight || size <= min) break;
    size = Math.max(min, size * 0.88);
  }
  const result = { sig, fontSize: size, lines, font: fontFor(size, sketch) };
  if (cacheKey) layoutCache.set(cacheKey, result);
  return result;
}

function wrappedHeight(lines: number, size: number) {
  return lines * size * TEXT_LINE_HEIGHT;
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (line && ctx.measureText(candidate.trimEnd()).width > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
        // Break words longer than the box.
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        line = candidate;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

function greek(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, size: number, lineHeight: number, color: string) {
  ctx.fillStyle = withAlpha(color.startsWith('#') ? color : '#888888', 0.35);
  lines.forEach((line, i) => {
    const w = line.trim().length * size * 0.5;
    if (w > 0) ctx.fillRect(x, y + i * lineHeight + size * 0.3, w, size * 0.5);
  });
}

export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(text.slice(0, end) + '…').width > maxWidth) end--;
  return text.slice(0, end) + '…';
}

// ─── Images ─────────────────────────────────────────────────────────────────

export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  constructor(private onLoad: () => void) {}
  get(src: string): HTMLImageElement | null {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.onload = () => this.onLoad();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}

function drawImage(dc: DrawContext, d: Extract<ShapeData, { kind: ShapeKind.Image }>) {
  const { ctx, dark, zoom } = dc;
  const img = dc.images.get(d.src);
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(d.x, d.y, d.w, d.h, 4 / Math.max(zoom, 0.25));
    ctx.clip();
    ctx.drawImage(img, d.x, d.y, d.w, d.h);
    ctx.restore();
  } else {
    ctx.fillStyle = dark ? '#26272e' : '#eef0f3';
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }
}
