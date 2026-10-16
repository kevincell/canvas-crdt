/**
 * Precise hit testing.
 *
 * Bounding-box picking makes a diagonal stroke grab every click in its empty
 * corners. These tests use the real geometry: distance to ink for strokes and
 * lines, interior-or-outline for shapes depending on whether they are filled,
 * and title-or-border for frames so their empty interior stays free for
 * marquee selection and drawing.
 */

import { ShapeKind, shapeBBox, type Point, type Shape } from './core';
import { distanceToSegment } from './recognize';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const FILLED_THRESHOLD = 0.04;
const FRAME_TITLE_HEIGHT = 24;

/**
 * @param tolerance world-space slack (pass `screenPx / zoom`).
 */
export function hitTestShape(shape: Shape, p: Point, tolerance: number): boolean {
  const d = shape.data;
  const b = shapeBBox(shape);
  if (p.x < b.minX - tolerance - 40 || p.x > b.maxX + tolerance + 40 || p.y < b.minY - tolerance - FRAME_TITLE_HEIGHT || p.y > b.maxY + tolerance + 40) {
    return false;
  }
  switch (d.kind) {
    case ShapeKind.Stroke: {
      const reach = d.width / 2 + tolerance;
      if (d.points.length === 1) return Math.hypot(p.x - d.points[0].x, p.y - d.points[0].y) <= reach;
      for (let i = 1; i < d.points.length; i++) {
        if (distanceToSegment(p, d.points[i - 1], d.points[i]) <= reach) return true;
      }
      return false;
    }
    case ShapeKind.Line:
      return distanceToSegment(p, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }) <= d.width / 2 + tolerance + 2;
    case ShapeKind.Rect: {
      const border = (d.strokeWidth ?? 1.5) / 2 + tolerance;
      const insideOuter = p.x >= d.x - border && p.x <= d.x + d.w + border && p.y >= d.y - border && p.y <= d.y + d.h + border;
      if (d.frameTitle) {
        const onTitle = p.y <= d.y && p.y >= d.y - FRAME_TITLE_HEIGHT && p.x >= d.x && p.x <= d.x + Math.max(80, Math.min(d.w, d.frameTitle.length * 9 + 24));
        const insideInner = p.x > d.x + border && p.x < d.x + d.w - border && p.y > d.y + border && p.y < d.y + d.h - border;
        return onTitle || (insideOuter && !insideInner);
      }
      if (!insideOuter) return false;
      if ((d.fillOpacity ?? 0.13) >= FILLED_THRESHOLD) return true;
      const insideInner = p.x > d.x + border && p.x < d.x + d.w - border && p.y > d.y + border && p.y < d.y + d.h - border;
      return !insideInner;
    }
    case ShapeKind.Ellipse: {
      const rx = Math.max(d.rx, 0.001), ry = Math.max(d.ry, 0.001);
      const border = (d.strokeWidth ?? 1.5) / 2 + tolerance;
      const outer = Math.hypot((p.x - d.cx) / (rx + border), (p.y - d.cy) / (ry + border));
      if (outer > 1) return false;
      if ((d.fillOpacity ?? 0.13) >= FILLED_THRESHOLD) return true;
      const innerRx = rx - border, innerRy = ry - border;
      if (innerRx <= 0 || innerRy <= 0) return true;
      return Math.hypot((p.x - d.cx) / innerRx, (p.y - d.cy) / innerRy) >= 1;
    }
    default:
      return p.x >= b.minX - tolerance && p.x <= b.maxX + tolerance && p.y >= b.minY - tolerance && p.y <= b.maxY + tolerance;
  }
}

/** Marquee semantics: a shape is selected when it lies entirely inside the box. */
export function shapeInsideBounds(shape: Shape, box: Bounds): boolean {
  const b = shapeBBox(shape);
  return b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of list) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/** Does a segment cross the shape? Used by the drag eraser. */
export function segmentHitsShape(shape: Shape, a: Point, b: Point, tolerance: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(tolerance, 1)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (hitTestShape(shape, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tolerance)) return true;
  }
  return false;
}

/** Ramer–Douglas–Peucker simplification; keeps endpoints. */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > maxDistance) { maxDistance = d; index = i; }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
