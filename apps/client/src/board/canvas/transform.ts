/**
 * Geometry used by interaction and rendering: previews (ephemeral transforms
 * applied while dragging, shared with peers through awareness), resizing,
 * spatial indexing and snapping.
 */
import {
  ShapeKind,
  attachedLineEndpoints,
  hitTestShape,
  scaleFrameMember,
  shapeBBox,
  translateShapeData,
  type Shape,
  type ShapeData,
} from '@crdt-canvas/engine';
import type { Bounds, Point } from './camera';

// ─── Previews ───────────────────────────────────────────────────────────────

export type Preview =
  | { kind: 'translate'; ids: string[]; dx: number; dy: number }
  | { kind: 'scale'; ids: string[]; from: Bounds; to: Bounds; scaleText: boolean };

export function applyPreviewToData(data: ShapeData, preview: Preview): ShapeData {
  if (preview.kind === 'translate') return translateShapeData(data, preview.dx, preview.dy);
  return scaleShapeData(data, preview.from, preview.to, preview.scaleText);
}

export function scaleShapeData(data: ShapeData, from: Bounds, to: Bounds, scaleText: boolean): ShapeData {
  const next = scaleFrameMember(data, from, to);
  const sy = (to.maxY - to.minY) / Math.max(1e-6, from.maxY - from.minY);
  const sx = (to.maxX - to.minX) / Math.max(1e-6, from.maxX - from.minX);
  if (next.kind === ShapeKind.Text && scaleText) {
    const factor = Math.max(0.1, Math.min(sx, sy));
    const fontSize = Math.max(6, Math.min(400, (data.kind === ShapeKind.Text ? data.fontSize ?? 16 : 16) * factor));
    return { ...next, fontSize };
  }
  if ((next.kind === ShapeKind.Stroke || next.kind === ShapeKind.Line) && scaleText) {
    // Keep ink weight proportional when scaling a whole drawing uniformly.
    const factor = Math.sqrt(Math.abs(sx * sy));
    if (Number.isFinite(factor) && factor > 0 && Math.abs(factor - 1) > 0.01) {
      return { ...next, width: Math.max(0.5, Math.min(80, next.width * factor)) };
    }
  }
  return next;
}

/** Normalise flipped bounds produced by dragging a handle past the opposite edge. */
export function normalizeBounds(b: Bounds): Bounds {
  return { minX: Math.min(b.minX, b.maxX), minY: Math.min(b.minY, b.maxY), maxX: Math.max(b.minX, b.maxX), maxY: Math.max(b.minY, b.maxY) };
}

// ─── Handles ────────────────────────────────────────────────────────────────

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlePosition(b: Bounds, handle: Handle): Point {
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  switch (handle) {
    case 'nw': return { x: b.minX, y: b.minY };
    case 'n': return { x: cx, y: b.minY };
    case 'ne': return { x: b.maxX, y: b.minY };
    case 'e': return { x: b.maxX, y: cy };
    case 'se': return { x: b.maxX, y: b.maxY };
    case 's': return { x: cx, y: b.maxY };
    case 'sw': return { x: b.minX, y: b.maxY };
    case 'w': return { x: b.minX, y: cy };
  }
}

export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

export function resizeBounds(start: Bounds, handle: Handle, dx: number, dy: number, options: { keepAspect: boolean; fromCenter: boolean }): Bounds {
  let { minX, minY, maxX, maxY } = start;
  const moveW = handle.includes('w'), moveE = handle.includes('e'), moveN = handle.includes('n'), moveS = handle.includes('s');
  if (moveW) minX += dx;
  if (moveE) maxX += dx;
  if (moveN) minY += dy;
  if (moveS) maxY += dy;
  if (options.fromCenter) {
    if (moveW) maxX -= dx;
    if (moveE) minX -= dx;
    if (moveN) maxY -= dy;
    if (moveS) minY -= dy;
  }
  let next = normalizeBounds({ minX, minY, maxX, maxY });
  if (options.keepAspect) {
    const w0 = Math.max(1, start.maxX - start.minX), h0 = Math.max(1, start.maxY - start.minY);
    const ratio = w0 / h0;
    let w = next.maxX - next.minX, h = next.maxY - next.minY;
    const corner = (moveW || moveE) && (moveN || moveS);
    if (corner) { if (w / h > ratio) h = w / ratio; else w = h * ratio; }
    else if (moveW || moveE) h = w / ratio;
    else w = h * ratio;
    const anchorX = options.fromCenter ? (start.minX + start.maxX) / 2 : moveW ? start.maxX : moveE ? start.minX : (start.minX + start.maxX) / 2;
    const anchorY = options.fromCenter ? (start.minY + start.maxY) / 2 : moveN ? start.maxY : moveS ? start.minY : (start.minY + start.maxY) / 2;
    const left = options.fromCenter || !(moveW || moveE) ? anchorX - w / 2 : moveW ? anchorX - w : anchorX;
    const top = options.fromCenter || !(moveN || moveS) ? anchorY - h / 2 : moveN ? anchorY - h : anchorY;
    next = { minX: left, minY: top, maxX: left + w, maxY: top + h };
  }
  return next;
}

// ─── Bounds helpers ─────────────────────────────────────────────────────────

/** Bounds of a shape with connector endpoints resolved against `byId`. */
export function resolvedBounds(shape: Shape, byId: ReadonlyMap<string, Shape>): Bounds {
  if (shape.data.kind === ShapeKind.Line && (shape.data.startShapeId || shape.data.endShapeId)) {
    return shapeBBox(resolveConnector(shape, byId));
  }
  return shapeBBox(shape);
}

export function resolveConnector(shape: Shape, byId: ReadonlyMap<string, Shape>): Shape {
  if (shape.data.kind !== ShapeKind.Line || (!shape.data.startShapeId && !shape.data.endShapeId)) return shape;
  const live = new Map<string, Shape>();
  for (const key of [shape.data.startShapeId, shape.data.endShapeId]) {
    const target = key ? byId.get(key) : undefined;
    if (target && !target.deleted) live.set(target.id, target);
  }
  const ends = attachedLineEndpoints(shape.data, live);
  if (ends.start.x === shape.data.x1 && ends.start.y === shape.data.y1 && ends.end.x === shape.data.x2 && ends.end.y === shape.data.y2) return shape;
  return { ...shape, data: { ...shape.data, x1: ends.start.x, y1: ends.start.y, x2: ends.end.x, y2: ends.end.y } };
}

export function unionOf(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  return list.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
}

export function isFrame(shape: Shape | undefined): boolean {
  return Boolean(shape && shape.data.kind === ShapeKind.Rect && shape.data.frameTitle);
}

// ─── Spatial index ──────────────────────────────────────────────────────────

const CELL = 512;

export class SpatialIndex {
  private cells = new Map<string, Shape[]>();
  private huge: Shape[] = [];
  private rank = new Map<string, number>();
  readonly bounds = new Map<string, Bounds>();

  constructor(ordered: Shape[], byId: ReadonlyMap<string, Shape>) {
    ordered.forEach((shape, index) => {
      this.rank.set(shape.id, index);
      const b = resolvedBounds(shape, byId);
      this.bounds.set(shape.id, b);
      const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
      const y0 = Math.floor(b.minY / CELL), y1 = Math.floor(b.maxY / CELL);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) { this.huge.push(shape); return; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(shape); else this.cells.set(key, [shape]);
      }
    });
  }

  /** Candidates intersecting the rectangle, back-to-front. */
  query(b: Bounds): Shape[] {
    const found = new Set<Shape>(this.huge);
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const y0 = Math.floor(b.minY / CELL), y1 = Math.floor(b.maxY / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) {
      for (const bucket of this.cells.values()) for (const s of bucket) found.add(s);
    } else {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        for (const s of this.cells.get(`${x}:${y}`) ?? []) found.add(s);
      }
    }
    return [...found]
      .filter(s => { const sb = this.bounds.get(s.id)!; return sb.maxX >= b.minX && sb.minX <= b.maxX && sb.maxY >= b.minY && sb.minY <= b.maxY; })
      .sort((a, c) => this.rank.get(a.id)! - this.rank.get(c.id)!);
  }

  /** Topmost shape whose real geometry is under the point. */
  hit(p: Point, tolerance: number, byId: ReadonlyMap<string, Shape>, filter?: (s: Shape) => boolean): Shape | null {
    const candidates = this.query({ minX: p.x - tolerance, minY: p.y - tolerance - 24, maxX: p.x + tolerance, maxY: p.y + tolerance });
    for (let i = candidates.length - 1; i >= 0; i--) {
      const shape = candidates[i];
      if (filter && !filter(shape)) continue;
      if (hitTestShape(resolveConnector(shape, byId), p, tolerance)) return shape;
    }
    // Nothing under the ink: the smallest hollow shape around the point wins,
    // so clicking inside an unfilled box still selects it.
    let best: Shape | null = null;
    let bestArea = Infinity;
    for (const shape of candidates) {
      if (filter && !filter(shape)) continue;
      const d = shape.data;
      let inside = false;
      if (d.kind === ShapeKind.Rect && !d.frameTitle) inside = p.x >= Math.min(d.x, d.x + d.w) && p.x <= Math.max(d.x, d.x + d.w) && p.y >= Math.min(d.y, d.y + d.h) && p.y <= Math.max(d.y, d.y + d.h);
      else if (d.kind === ShapeKind.Ellipse) inside = Math.hypot((p.x - d.cx) / Math.max(0.001, d.rx), (p.y - d.cy) / Math.max(0.001, d.ry)) <= 1;
      if (!inside) continue;
      const b = this.bounds.get(shape.id)!;
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (area < bestArea) { best = shape; bestArea = area; }
    }
    return best;
  }
}

export function sortByLayer(shapes: Shape[]): Shape[] {
  return shapes.map((shape, index) => ({ shape, index }))
    .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
    .map(({ shape }) => shape);
}

// ─── Snapping ───────────────────────────────────────────────────────────────

export type Guide = { x1: number; y1: number; x2: number; y2: number; label?: string; kind: 'align' | 'gap' };

/**
 * Snap a moving box to edges/centres of nearby boxes and to equal gaps.
 * Returns the correction to add to the proposed translation.
 */
export function snapBox(moving: Bounds, others: Bounds[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  let bestX = threshold, bestY = threshold;
  let dx = 0, dy = 0;
  let guideX: Guide | null = null, guideY: Guide | null = null;
  const mx = [moving.minX, (moving.minX + moving.maxX) / 2, moving.maxX];
  const my = [moving.minY, (moving.minY + moving.maxY) / 2, moving.maxY];
  for (const o of others) {
    const ox = [o.minX, (o.minX + o.maxX) / 2, o.maxX];
    const oy = [o.minY, (o.minY + o.maxY) / 2, o.maxY];
    for (const a of mx) for (const b of ox) {
      const d = b - a;
      if (Math.abs(d) < bestX) {
        bestX = Math.abs(d); dx = d;
        guideX = { kind: 'align', x1: b, x2: b, y1: Math.min(moving.minY, o.minY) - 10, y2: Math.max(moving.maxY, o.maxY) + 10 };
      }
    }
    for (const a of my) for (const b of oy) {
      const d = b - a;
      if (Math.abs(d) < bestY) {
        bestY = Math.abs(d); dy = d;
        guideY = { kind: 'align', y1: b, y2: b, x1: Math.min(moving.minX, o.minX) - 10, x2: Math.max(moving.maxX, o.maxX) + 10 };
      }
    }
  }

  // Equal-gap snapping between the nearest neighbours on each axis.
  const overlapsY = (o: Bounds) => o.maxY >= moving.minY && o.minY <= moving.maxY;
  const overlapsX = (o: Bounds) => o.maxX >= moving.minX && o.minX <= moving.maxX;
  const left = others.filter(o => overlapsY(o) && o.maxX <= moving.minX).sort((a, b) => b.maxX - a.maxX)[0];
  const right = others.filter(o => overlapsY(o) && o.minX >= moving.maxX).sort((a, b) => a.minX - b.minX)[0];
  const gapGuides: Guide[] = [];
  if (left && right) {
    const width = moving.maxX - moving.minX;
    const gap = (right.minX - left.maxX - width) / 2;
    const d = left.maxX + gap - moving.minX;
    if (gap > 0 && Math.abs(d) < bestX) {
      bestX = Math.abs(d); dx = d; guideX = null;
      const y = Math.max(moving.maxY, left.maxY, right.maxY) + 16;
      gapGuides.push({ kind: 'gap', x1: left.maxX, x2: left.maxX + gap, y1: y, y2: y, label: `${Math.round(gap)}` });
      gapGuides.push({ kind: 'gap', x1: right.minX - gap, x2: right.minX, y1: y, y2: y, label: `${Math.round(gap)}` });
    }
  }
  const above = others.filter(o => overlapsX(o) && o.maxY <= moving.minY).sort((a, b) => b.maxY - a.maxY)[0];
  const below = others.filter(o => overlapsX(o) && o.minY >= moving.maxY).sort((a, b) => a.minY - b.minY)[0];
  if (above && below) {
    const height = moving.maxY - moving.minY;
    const gap = (below.minY - above.maxY - height) / 2;
    const d = above.maxY + gap - moving.minY;
    if (gap > 0 && Math.abs(d) < bestY) {
      bestY = Math.abs(d); dy = d; guideY = null;
      const x = Math.max(moving.maxX, above.maxX, below.maxX) + 16;
      gapGuides.push({ kind: 'gap', y1: above.maxY, y2: above.maxY + gap, x1: x, x2: x, label: `${Math.round(gap)}` });
      gapGuides.push({ kind: 'gap', y1: below.minY - gap, y2: below.minY, x1: x, x2: x, label: `${Math.round(gap)}` });
    }
  }
  const guides = [...(guideX ? [shiftGuide(guideX, 0, dy)] : []), ...(guideY ? [shiftGuide(guideY, dx, 0)] : []), ...gapGuides];
  return { dx, dy, guides };
}

function shiftGuide(guide: Guide, dx: number, dy: number): Guide {
  return guide.x1 === guide.x2
    ? { ...guide, y1: guide.y1 + Math.min(0, dy), y2: guide.y2 + Math.max(0, dy) }
    : { ...guide, x1: guide.x1 + Math.min(0, dx), x2: guide.x2 + Math.max(0, dx) };
}

export function snapToGrid(p: Point, size: number): Point {
  return { x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size };
}

/** Constrain a vector to 15° increments (Shift while drawing lines). */
export function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}
