/**
 * Ink → shape recognition (offline, deterministic, no ML model).
 *
 * Classifies a freehand stroke as a straight line, an arrow, an ellipse or a
 * rectangle using closed-form geometric fitting errors. Used for "hold to
 * snap": the user draws roughly, pauses, and the stroke becomes a clean shape
 * while staying one undo step.
 */

import type { Point } from './core';

export type Recognized =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; arrow: boolean; confidence: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; confidence: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; confidence: number };

const MIN_POINTS = 6;
const MIN_EXTENT = 12;

export function recognizeStroke(input: Point[]): Recognized | null {
  const points = resample(input, 64);
  if (points.length < MIN_POINTS) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  if (diag < MIN_EXTENT) return null;

  const length = pathLength(input);
  const first = input[0];
  const last = input[input.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);

  // Straight line: the path barely deviates from its chord.
  if (chord / Math.max(length, 1) > 0.94) {
    const deviation = maxDistanceToSegment(points, first, last) / Math.max(chord, 1);
    if (deviation < 0.06) {
      return { kind: 'line', x1: first.x, y1: first.y, x2: last.x, y2: last.y, arrow: false, confidence: 1 - deviation * 8 };
    }
  }

  // Arrow: a long straight shaft followed by a short hook back toward the shaft.
  const arrow = detectArrow(input);
  if (arrow) return arrow;

  // Closed shapes: the endpoints meet relative to the size of the figure.
  const closure = chord / diag;
  if (closure > 0.25 || Math.min(w, h) < MIN_EXTENT) return null;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = Math.max(w / 2, 1);
  const ry = Math.max(h / 2, 1);

  // Ellipse error: mean |1 - normalised radius|.
  let ellipseError = 0;
  for (const p of points) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    ellipseError += Math.abs(1 - r);
  }
  ellipseError /= points.length;

  // Rectangle error: mean distance to the nearest bbox edge, normalised.
  let rectError = 0;
  for (const p of points) {
    const d = Math.min(Math.abs(p.x - minX), Math.abs(p.x - maxX), Math.abs(p.y - minY), Math.abs(p.y - maxY));
    rectError += d / Math.min(w, h);
  }
  rectError /= points.length;
  // Rectangles fill their corners; ellipses leave them empty.
  const cornerFill = cornerOccupancy(points, minX, minY, maxX, maxY);

  if (rectError < 0.07 && cornerFill >= 3 && rectError * 1.6 < ellipseError) {
    return { kind: 'rect', x: minX, y: minY, w, h, confidence: 1 - rectError * 6 };
  }
  if (ellipseError < 0.12) {
    return { kind: 'ellipse', cx, cy, rx, ry, confidence: 1 - ellipseError * 5 };
  }
  if (rectError < 0.08 && cornerFill >= 3) {
    return { kind: 'rect', x: minX, y: minY, w, h, confidence: 1 - rectError * 6 };
  }
  return null;
}

function detectArrow(input: Point[]): Recognized | null {
  if (input.length < 8) return null;
  const total = pathLength(input);
  // Find the point where the path first turns sharply after a straight run.
  let run = 0;
  for (let i = 1; i < input.length - 2; i++) {
    run += Math.hypot(input[i].x - input[i - 1].x, input[i].y - input[i - 1].y);
    if (run < total * 0.55) continue;
    const tip = input[i];
    const shaftStart = input[0];
    const shaftLen = Math.hypot(tip.x - shaftStart.x, tip.y - shaftStart.y);
    if (shaftLen < run * 0.93) return null; // shaft not straight
    const tail = input.slice(i);
    const tailLen = pathLength(tail);
    if (tailLen < shaftLen * 0.08 || tailLen > shaftLen * 0.6) continue;
    // The hook should head back roughly against the shaft direction.
    const end = tail[tail.length - 1];
    const sx = (tip.x - shaftStart.x) / shaftLen, sy = (tip.y - shaftStart.y) / shaftLen;
    const hx = end.x - tip.x, hy = end.y - tip.y;
    const hookLen = Math.hypot(hx, hy) || 1;
    const back = -(hx * sx + hy * sy) / hookLen;
    if (back > 0.35) {
      return { kind: 'line', x1: shaftStart.x, y1: shaftStart.y, x2: tip.x, y2: tip.y, arrow: true, confidence: back };
    }
  }
  return null;
}

function cornerOccupancy(points: Point[], minX: number, minY: number, maxX: number, maxY: number): number {
  const rx = (maxX - minX) * 0.2;
  const ry = (maxY - minY) * 0.2;
  const corners = [
    [minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY],
  ];
  let filled = 0;
  for (const [x, y] of corners) {
    if (points.some(p => Math.abs(p.x - x) <= rx && Math.abs(p.y - y) <= ry)) filled++;
  }
  return filled;
}

export function pathLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

function maxDistanceToSegment(points: Point[], a: Point, b: Point): number {
  let max = 0;
  for (const p of points) max = Math.max(max, distanceToSegment(p, a, b));
  return max;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Resample a polyline to `n` evenly spaced points. */
export function resample(points: Point[], n: number): Point[] {
  if (points.length < 2) return points.slice();
  const interval = pathLength(points) / (n - 1);
  if (interval === 0) return [points[0]];
  const out: Point[] = [points[0]];
  let acc = 0;
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    let curr = points[i];
    let d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    while (acc + d >= interval && d > 0) {
      const t = (interval - acc) / d;
      const q = { x: prev.x + t * (curr.x - prev.x), y: prev.y + t * (curr.y - prev.y) };
      out.push(q);
      prev = q;
      d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      acc = 0;
    }
    acc += d;
    prev = curr;
  }
  if (out.length < n) out.push(points[points.length - 1]);
  return out;
}
