/**
 * Geometry helpers: bounds, precise hit-testing, partial erasing, transforms, overlap.
 */
import { type Shape, ShapeKind, shapeBBox, attachedLineEndpoints, type LineShape } from '@crdt-canvas/engine';
import { type BoardData, dataOf } from './model';

export type Pt = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const TEXT_LINE_HEIGHT = 1.3;

// ── Text measuring (cached offscreen canvas) ───────────────────────────────
let measureCtx: CanvasRenderingContext2D | null = null;
function measure(): CanvasRenderingContext2D | null {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

export function textFont(d: BoardData): string {
  const size = d.fontSize ?? 16;
  const family = d.fontFamily === 'Times New Roman'
    ? "'Times New Roman', 'Liberation Serif', Times, serif"
    : "Arial, 'Liberation Sans', Helvetica, sans-serif";
  return `500 ${size}px ${family}`;
}

/** Wrap text to a width (null = no wrap). Returns display lines. */
export function wrapLines(text: string, font: string, maxWidth: number | null): string[] {
  const ctx = measure();
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!maxWidth || !ctx) { out.push(paragraph); continue; }
    ctx.font = font;
    const words = paragraph.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
}

export function textLayout(d: BoardData & { text?: string; x?: number; y?: number }) {
  const size = d.fontSize ?? 16;
  const font = textFont(d);
  const lineH = size * TEXT_LINE_HEIGHT;
  const top = (d.y ?? 0) - 16;
  const left = d.x ?? 0;
  const pad = d.box ? 6 : 0;
  const lines = wrapLines(String(d.text ?? ''), font, d.box && d.w ? Math.max(20, d.w - pad * 2) : null);
  const ctx = measure();
  let width = d.box && d.w ? d.w : 0;
  if (!d.box || !d.w) {
    if (ctx) {
      ctx.font = font;
      width = Math.max(20, ...lines.map(l => ctx.measureText(l).width));
    } else {
      width = Math.max(20, ...lines.map(l => l.length * size * 0.55));
    }
  }
  const textH = Math.max(1, lines.length) * lineH;
  const height = d.box && d.h ? Math.max(d.h, textH + pad * 2) : textH;
  return { font, lines, lineH, left, top, width, height, pad, size };
}

// ── Bounds ─────────────────────────────────────────────────────────────────
export function resolveLine(shape: Shape, byId: ReadonlyMap<string, Shape>): Shape {
  const d = shape.data;
  if (d.kind !== ShapeKind.Line || (!d.startShapeId && !d.endShapeId)) return shape;
  const ep = attachedLineEndpoints(d as LineShape, byId);
  return { ...shape, data: { ...d, x1: ep.start.x, y1: ep.start.y, x2: ep.end.x, y2: ep.end.y } };
}

export function boundsOf(shape: Shape): Bounds {
  const d = dataOf(shape);
  if (d.kind === ShapeKind.Text) {
    const t = textLayout(d as any);
    return { minX: t.left, minY: t.top, maxX: t.left + t.width, maxY: t.top + t.height };
  }
  const b = shapeBBox(shape);
  if (d.kind === ShapeKind.Stroke || d.kind === ShapeKind.Line) {
    const half = ((d as any).width ?? 2) / 2;
    return { minX: b.minX - half, minY: b.minY - half, maxX: b.maxX + half, maxY: b.maxY + half };
  }
  return b;
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  return list.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function normRect(a: Pt, b: Pt): Bounds {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function contains(outer: Bounds, p: Pt, pad = 0): boolean {
  return p.x >= outer.minX - pad && p.x <= outer.maxX + pad && p.y >= outer.minY - pad && p.y <= outer.maxY + pad;
}

export function area(b: Bounds): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

export function overlapArea(a: Bounds, b: Bounds): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

// ── Distances ──────────────────────────────────────────────────────────────
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: Pt[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

/** A freehand stroke counts as a closed shape (fillable) when it ends near where it started */
export function isClosedStroke(points: Pt[]): boolean {
  if (points.length < 6) return false;
  const first = points[0], last = points[points.length - 1];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return diag > 20 && Math.hypot(first.x - last.x, first.y - last.y) <= Math.max(14, diag * 0.12);
}

// ── Hit testing ────────────────────────────────────────────────────────────
/** Is world point `p` on / inside the shape? `tol` is the click tolerance in world units. */
export function hitShape(shape: Shape, p: Pt, tol: number, interiorCounts = true): boolean {
  const d = dataOf(shape);
  switch (d.kind) {
    case ShapeKind.Stroke: {
      const pts = (d as any).points as Pt[];
      if (!pts?.length) return false;
      if (distToPolyline(p, pts) <= ((d as any).width ?? 2) / 2 + tol) return true;
      return interiorCounts && !!d.fillColor && isClosedStroke(pts) && pointInPolygon(p, pts);
    }
    case ShapeKind.Line: {
      const l = d as any;
      return distToSegment(p, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }) <= (l.width ?? 2) / 2 + tol;
    }
    case ShapeKind.Ellipse: {
      const e = d as any;
      if (e.rx <= 0 || e.ry <= 0) return false;
      const nx = (p.x - e.cx) / e.rx, ny = (p.y - e.cy) / e.ry;
      const r = Math.sqrt(nx * nx + ny * ny);
      const edgeTol = (tol + (e.strokeWidth ?? 2)) / Math.min(e.rx, e.ry);
      if (Math.abs(r - 1) <= edgeTol) return true;
      return interiorCounts && r < 1;
    }
    case ShapeKind.Rect: {
      const b = boundsOf(shape);
      if (!contains(b, p, tol)) return false;
      if (interiorCounts) return true;
      const edge = tol + ((d as any).strokeWidth ?? 2);
      return p.x - b.minX <= edge || b.maxX - p.x <= edge || p.y - b.minY <= edge || b.maxY - p.y <= edge;
    }
    default:
      return contains(boundsOf(shape), p, tol);
  }
}

/** Is a world point inside a closed region of the shape (used by the Fill tool)? */
export function insideClosed(shape: Shape, p: Pt): boolean {
  const d = dataOf(shape);
  if (d.kind === ShapeKind.Rect) return contains(boundsOf(shape), p);
  if (d.kind === ShapeKind.Ellipse) {
    const e = d as any;
    if (e.rx <= 0 || e.ry <= 0) return false;
    return ((p.x - e.cx) / e.rx) ** 2 + ((p.y - e.cy) / e.ry) ** 2 <= 1;
  }
  if (d.kind === ShapeKind.Stroke) {
    const pts = (d as any).points as Pt[];
    return isClosedStroke(pts) && pointInPolygon(p, pts);
  }
  return false;
}

// ── Partial eraser ─────────────────────────────────────────────────────────
/**
 * Remove every point of a freehand stroke that the eraser path passed over (within `radius`),
 * splitting the stroke into the remaining pieces. Returns null when nothing was touched.
 */
export function eraseFromStroke(points: Pt[], eraserPath: Pt[], radius: number): Pt[][] | null {
  if (points.length < 2 || eraserPath.length === 0) return null;
  // Densify long segments so erasing in the middle of a straight-ish stroke still splits it
  const dense: Pt[] = [];
  const step = Math.max(1.5, radius / 3);
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    dense.push(a);
    const b = points[i + 1];
    if (!b) continue;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(dist / step);
    for (let k = 1; k < n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const erased = dense.map(p => distToPolyline(p, eraserPath) <= radius);
  if (!erased.some(Boolean)) return null;
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  dense.forEach((p, i) => {
    if (erased[i]) {
      if (current.length >= 2) pieces.push(current);
      current = [];
    } else {
      current.push(p);
    }
  });
  if (current.length >= 2) pieces.push(current);
  return pieces.map(simplify);
}

/** Light Ramer–Douglas–Peucker simplification to keep stored strokes small */
export function simplify(points: Pt[], epsilon = 0.6): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const dd = distToSegment(points[i], points[s], points[e]);
      if (dd > maxD) { maxD = dd; idx = i; }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ── Transforms ─────────────────────────────────────────────────────────────
export function translateData(d: BoardData, dx: number, dy: number): Partial<BoardData> {
  const a = d as any;
  switch (d.kind) {
    case ShapeKind.Stroke: return { points: a.points.map((p: Pt) => ({ x: p.x + dx, y: p.y + dy })) } as any;
    case ShapeKind.Line: return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } as any;
    case ShapeKind.Ellipse: return { cx: a.cx + dx, cy: a.cy + dy } as any;
    default: return { x: a.x + dx, y: a.y + dy } as any;
  }
}

/** Scale shape data about an origin point (sx, sy > 0) */
export function scaleData(d: BoardData, origin: Pt, sx: number, sy: number): Partial<BoardData> {
  const a = d as any;
  const tx = (x: number) => origin.x + (x - origin.x) * sx;
  const ty = (y: number) => origin.y + (y - origin.y) * sy;
  const avg = Math.sqrt(Math.abs(sx * sy));
  switch (d.kind) {
    case ShapeKind.Stroke:
      return { points: a.points.map((p: Pt) => ({ x: tx(p.x), y: ty(p.y) })) } as any;
    case ShapeKind.Line:
      return { x1: tx(a.x1), y1: ty(a.y1), x2: tx(a.x2), y2: ty(a.y2) } as any;
    case ShapeKind.Ellipse:
      return { cx: tx(a.cx), cy: ty(a.cy), rx: Math.max(2, a.rx * sx), ry: Math.max(2, a.ry * sy) } as any;
    case ShapeKind.Text: {
      if (d.box) {
        const top = a.y - 16;
        const newTop = ty(top);
        return { x: tx(a.x), y: newTop + 16, w: Math.max(30, (a.w ?? 100) * sx), h: Math.max(20, (a.h ?? 30) * sy), fontSize: Math.max(8, Math.round((a.fontSize ?? 16) * Math.min(sx, sy) * 10) / 10) } as any;
      }
      const top = a.y - 16;
      return { x: tx(a.x), y: ty(top) + 16, fontSize: Math.max(8, Math.round((a.fontSize ?? 16) * avg * 10) / 10) } as any;
    }
    default:
      return { x: tx(a.x), y: ty(a.y), w: Math.max(4, a.w * sx), h: Math.max(4, a.h * sy) } as any;
  }
}

export { shapeBBox };
