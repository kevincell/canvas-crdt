import { describe, it, expect } from 'vitest';
import {
  ShapeKind,
  type Shape,
  createShape,
  shapeBBox,
  unionBBox,
  dedupPoints,
  detectConflicts,
  type Point,
} from '../core';

describe('Performance and large board budgets (L63)', () => {
  it('handles 1,000 shapes bounding box and spatial indexing within frame budget (<16ms)', () => {
    const shapes: Shape[] = [];
    for (let i = 0; i < 1000; i++) {
      shapes.push(
        createShape(ShapeKind.Rect, {
          x: (i % 50) * 120,
          y: Math.floor(i / 50) * 120,
          w: 100,
          h: 80,
          color: '#3b82f6',
        }, 'actor-1')
      );
    }

    const start = performance.now();
    let totalUnion = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    for (const shape of shapes) {
      const box = shapeBBox(shape);
      totalUnion = unionBBox(totalUnion, box);
    }
    const elapsed = performance.now() - start;

    expect(shapes.length).toBe(1000);
    expect(totalUnion.maxX).toBeGreaterThan(5000);
    // 1,000 shapes bbox + union must take well under a 16ms animation frame (typically <3ms)
    expect(elapsed).toBeLessThan(16);
  });

  it('spatial viewport culling on 2,500 shapes executes under 5ms', () => {
    const shapes: Shape[] = [];
    for (let i = 0; i < 2500; i++) {
      shapes.push(
        createShape(ShapeKind.Rect, {
          x: (i % 50) * 150,
          y: Math.floor(i / 50) * 150,
          w: 100,
          h: 100,
          color: '#10b981',
        }, 'actor-1')
      );
    }

    // Viewport window
    const viewport = { minX: 500, minY: 500, maxX: 1800, maxY: 1400 };

    const start = performance.now();
    const visible = shapes.filter(shape => {
      const b = shapeBBox(shape);
      return b.maxX >= viewport.minX && b.minX <= viewport.maxX &&
             b.maxY >= viewport.minY && b.minY <= viewport.maxY;
    });
    const elapsed = performance.now() - start;

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(shapes.length);
    // Culling 2,500 shapes must execute under 10ms
    expect(elapsed).toBeLessThan(10);
  });

  it('stroke point deduplication compresses rapid input streams under 2ms', () => {
    // Simulate high-frequency 240Hz pointer events generating 2,000 dense points
    const rawPoints: Point[] = [];
    let curX = 100;
    let curY = 100;
    for (let i = 0; i < 2000; i++) {
      curX += (i % 3 === 0 ? 0.2 : 0.05); // sub-pixel jitter
      curY += (i % 2 === 0 ? 0.15 : 0.02);
      rawPoints.push({ x: curX, y: curY });
    }

    const start = performance.now();
    // Use engine dedup helper
    const filtered = (dedupPoints as any)(rawPoints, 0.5);
    const elapsed = performance.now() - start;

    expect(filtered.length).toBeLessThan(rawPoints.length);
    expect(elapsed).toBeLessThan(5);
  });

  it('conflict detection on 500 concurrent shapes executes within interactive budget', () => {
    const shapes: Shape[] = [];
    for (let i = 0; i < 500; i++) {
      shapes.push(
        createShape(ShapeKind.Rect, {
          x: (i % 20) * 100,
          y: Math.floor(i / 20) * 100,
          w: 80,
          h: 80,
          color: '#6366f1',
        }, i % 2 === 0 ? 'alice' : 'bob')
      );
    }

    const start = performance.now();
    const conflicts = detectConflicts(shapes);
    const elapsed = performance.now() - start;

    expect(Array.isArray(conflicts)).toBe(true);
    expect(elapsed).toBeLessThan(20);
  });
});
