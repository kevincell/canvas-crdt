import { describe, it, expect } from 'vitest';
import {
  ShapeKind,
  type Shape,
  type TextShape,
  createShape,
  resolveTextOverlap,
  tidyTextOverlaps,
} from '../core';

describe('Text Overlap Resolution', () => {
  it('leaves text position unchanged when no other text overlaps', () => {
    const existing = createShape(ShapeKind.Text, {
      x: 100, y: 100, text: 'First line', color: '#1e293b',
    }, 'user-1');

    const result = resolveTextOverlap({ x: 500, y: 500, text: 'Distant text' }, [existing]);
    expect(result.x).toBe(500);
    expect(result.y).toBe(500);
  });

  it('moves overlapping text below when placed below the center of existing text', () => {
    // Existing text at (100, 100). Height = 20, minY = 84, maxY = 104, centerY = 94
    const existing = createShape(ShapeKind.Text, {
      x: 100, y: 100, text: 'Existing text header', color: '#1e293b',
    }, 'user-1');

    // Candidate placed at (100, 102) -> centerY = 96 > 94 (lower half)
    const result = resolveTextOverlap({ x: 100, y: 102, text: 'Sub-item text' }, [existing], 8);

    // Should move below: maxY (104) + margin (8) + 16 = 128
    expect(result.x).toBe(100);
    expect(result.y).toBe(128);
    // Verify vertical distance: result.minY (128 - 16 = 112) - existing.maxY (104) = 8px gap
    expect(result.y - 16).toBe(104 + 8);
  });

  it('moves overlapping text above when placed above the center of existing text', () => {
    const existing = createShape(ShapeKind.Text, {
      x: 100, y: 100, text: 'Existing text header', color: '#1e293b',
    }, 'user-1');

    // Candidate placed at (100, 90) -> centerY = 84 < 94 (upper half)
    const result = resolveTextOverlap({ x: 100, y: 90, text: 'Sup-item text' }, [existing], 8);

    // Candidate height = 20. Should move above:
    // candidate bottom should be at existing.minY (84) - 8 = 76.
    // candMaxY = y - 16 + 20 = y + 4 => y + 4 = 76 => y = 72
    expect(result.x).toBe(100);
    expect(result.y).toBe(72);
  });

  it('cascades downward past multiple existing stacked text items', () => {
    const textA = createShape(ShapeKind.Text, {
      x: 100, y: 100, text: 'Line A', color: '#1e293b',
    }, 'user-1');

    // Line B placed directly below Line A
    const posB = resolveTextOverlap({ x: 100, y: 105, text: 'Line B' }, [textA], 8);
    const textB = createShape(ShapeKind.Text, {
      x: posB.x, y: posB.y, text: 'Line B', color: '#1e293b',
    }, 'user-1');

    // Line C placed at y=105 as well; must cascade past both A and B
    const posC = resolveTextOverlap({ x: 100, y: 105, text: 'Line C' }, [textA, textB], 8);

    expect(posC.y).toBeGreaterThan(posB.y);
    // Verify Line C does not overlap Line A or Line B
    const candMinY = posC.y - 16;
    const bMaxY = (textB.data as TextShape).y - 16 + 20;
    expect(candMinY).toBeGreaterThanOrEqual(bMaxY + 8);
  });

  it('tidyTextOverlaps separates all overlapping texts on a board', () => {
    // 3 overlapping texts placed at nearly identical coordinates
    const t1 = createShape(ShapeKind.Text, { x: 100, y: 100, text: 'One', color: '#1e293b' }, 'u1');
    const t2 = createShape(ShapeKind.Text, { x: 100, y: 102, text: 'Two', color: '#1e293b' }, 'u1');
    const t3 = createShape(ShapeKind.Text, { x: 100, y: 104, text: 'Three', color: '#1e293b' }, 'u1');

    const updates = tidyTextOverlaps([t1, t2, t3], 8);

    expect(updates.size).toBeGreaterThanOrEqual(2);
    const finalY1 = 100;
    const finalY2 = updates.get(t2.id)?.y ?? 102;
    const finalY3 = updates.get(t3.id)?.y ?? 104;

    expect(finalY2).toBeGreaterThan(finalY1);
    expect(finalY3).toBeGreaterThan(finalY2);
  });
});
