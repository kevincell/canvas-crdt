/**
 * Semantic board diff.
 *
 * Compares two board states and classifies every change by *intent* (moved,
 * resized, restyled, re-texted) rather than by raw property, so a UI can say
 * "Bob moved 3 notes and rewrote one" instead of listing coordinates.
 * Powers the reconnect catch-up replay and the merge-file preview.
 */

import { ShapeKind, shapeBBox, type Shape, type ShapeData } from './core';

export type ChangeAspect = 'moved' | 'resized' | 'restyled' | 'text' | 'structure';

export interface ShapeChange {
  id: string;
  before: Shape;
  after: Shape;
  aspects: ChangeAspect[];
  /** Displacement of the bounding-box centre, in world units. */
  delta: { dx: number; dy: number };
}

export interface BoardDiff {
  added: Shape[];
  removed: Shape[];
  changed: ShapeChange[];
  /** Number of touched shapes per actor (creator for adds, last editor otherwise). */
  byActor: Map<string, number>;
  /** Union of the bounds of every touched shape (after-state where possible). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  isEmpty: boolean;
}

const GEOMETRY_EPSILON = 0.5;
const STYLE_KEYS = new Set(['color', 'bgColor', 'fillOpacity', 'strokeWidth', 'width', 'cornerRadius', 'arrowEnd', 'fontSize', 'strokeStyle']);
const TEXT_KEYS = new Set(['text', 'frameTitle', 'label']);
const STRUCTURE_KEYS = new Set(['groupId', 'frameId', 'zIndex', 'locked', 'startShapeId', 'endShapeId', 'src']);

export function diffBoards(before: Shape[], after: Shape[]): BoardDiff {
  const beforeMap = new Map(before.filter(s => !s.deleted).map(s => [s.id, s]));
  const afterMap = new Map(after.filter(s => !s.deleted).map(s => [s.id, s]));
  const added: Shape[] = [];
  const removed: Shape[] = [];
  const changed: ShapeChange[] = [];
  const byActor = new Map<string, number>();
  const bump = (actor: string) => byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
  let bounds: BoardDiff['bounds'] = null;
  const grow = (shape: Shape) => {
    const b = shapeBBox(shape);
    bounds = bounds
      ? { minX: Math.min(bounds.minX, b.minX), minY: Math.min(bounds.minY, b.minY), maxX: Math.max(bounds.maxX, b.maxX), maxY: Math.max(bounds.maxY, b.maxY) }
      : { ...b };
  };

  for (const [id, next] of afterMap) {
    const prev = beforeMap.get(id);
    if (!prev) {
      added.push(next);
      bump(next.actor);
      grow(next);
      continue;
    }
    if (prev === next) continue;
    const aspects = classifyChange(prev.data, next.data);
    if (!aspects.length) continue;
    const a = shapeBBox(prev);
    const b = shapeBBox(next);
    changed.push({
      id,
      before: prev,
      after: next,
      aspects,
      delta: { dx: (b.minX + b.maxX - a.minX - a.maxX) / 2, dy: (b.minY + b.maxY - a.minY - a.maxY) / 2 },
    });
    bump(next.actor);
    grow(prev);
    grow(next);
  }
  for (const [id, prev] of beforeMap) {
    if (afterMap.has(id)) continue;
    removed.push(prev);
    const tombstone = after.find(s => s.id === id);
    bump(tombstone?.actor ?? prev.actor);
    grow(prev);
  }

  return { added, removed, changed, byActor, bounds, isEmpty: !added.length && !removed.length && !changed.length };
}

/** Classify which user-visible aspects differ between two records. */
export function classifyChange(prev: ShapeData, next: ShapeData): ChangeAspect[] {
  const aspects = new Set<ChangeAspect>();
  const a = shapeBBox({ data: prev } as Shape);
  const b = shapeBBox({ data: next } as Shape);
  const sizeChanged = Math.abs((a.maxX - a.minX) - (b.maxX - b.minX)) > GEOMETRY_EPSILON
    || Math.abs((a.maxY - a.minY) - (b.maxY - b.minY)) > GEOMETRY_EPSILON;
  const posChanged = Math.abs(a.minX - b.minX) > GEOMETRY_EPSILON || Math.abs(a.minY - b.minY) > GEOMETRY_EPSILON;
  // Text boxes grow when their content changes; don't call that a resize.
  const textChanged = keysDiffer(prev, next, TEXT_KEYS);
  if (sizeChanged && !(textChanged && (next.kind === ShapeKind.Text))) aspects.add('resized');
  else if (posChanged) aspects.add('moved');
  if (textChanged) aspects.add('text');
  if (keysDiffer(prev, next, STYLE_KEYS)) aspects.add('restyled');
  if (keysDiffer(prev, next, STRUCTURE_KEYS)) aspects.add('structure');
  return [...aspects];
}

function keysDiffer(a: ShapeData, b: ShapeData, keys: Set<string>): boolean {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const key of keys) {
    if (JSON.stringify(ra[key] ?? null) !== JSON.stringify(rb[key] ?? null)) return true;
  }
  return false;
}

/** One-line human summary such as "Bob added 2, moved 3 · Ana edited 1". */
export function summarizeDiff(diff: BoardDiff, label: (actor: string) => string = a => a): string {
  if (diff.isEmpty) return 'No changes';
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  const moved = diff.changed.filter(c => c.aspects.includes('moved')).length;
  const resized = diff.changed.filter(c => c.aspects.includes('resized')).length;
  const text = diff.changed.filter(c => c.aspects.includes('text')).length;
  const styled = diff.changed.filter(c => c.aspects.includes('restyled') && c.aspects.length === 1).length;
  if (moved) parts.push(`${moved} moved`);
  if (resized) parts.push(`${resized} resized`);
  if (text) parts.push(`${text} rewritten`);
  if (styled) parts.push(`${styled} restyled`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  const people = [...diff.byActor.keys()].map(label);
  const unique = [...new Set(people)];
  const who = unique.length === 0 ? '' : unique.length <= 2 ? ` by ${unique.join(' & ')}` : ` by ${unique.slice(0, 2).join(', ')} +${unique.length - 2}`;
  return `${parts.join(', ')}${who}`;
}
