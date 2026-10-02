import { describe, it, expect } from 'vitest';
import { ShapeKind, type Shape } from '@crdt-canvas/engine';
import {
  calculateBoardImageBytes,
  prepareBoardImage,
  MAX_SOURCE_BYTES,
  MAX_IMAGE_BASE64_BYTES,
  MAX_BOARD_TOTAL_IMAGE_BYTES,
  ACCEPTED_TYPES,
} from '../prepareImage';

describe('Image size and storage limits (L64)', () => {
  it('defines explicit storage limits aligned with roadmap requirements', () => {
    expect(MAX_SOURCE_BYTES).toBe(15 * 1024 * 1024); // 15 MB
    expect(MAX_IMAGE_BASE64_BYTES).toBe(2 * 1024 * 1024); // 2 MB
    expect(MAX_BOARD_TOTAL_IMAGE_BYTES).toBe(25 * 1024 * 1024); // 25 MB
    expect(ACCEPTED_TYPES.has('image/png')).toBe(true);
    expect(ACCEPTED_TYPES.has('image/jpeg')).toBe(true);
    expect(ACCEPTED_TYPES.has('image/webp')).toBe(true);
    expect(ACCEPTED_TYPES.has('application/pdf')).toBe(false);
  });

  it('calculateBoardImageBytes computes exact image memory footprint', () => {
    const fakeImage1 = 'data:image/png;base64,' + 'A'.repeat(5000);
    const fakeImage2 = 'data:image/png;base64,' + 'B'.repeat(8000);

    const shapes: Shape[] = [
      { id: 'img-1', kind: ShapeKind.Image, data: { kind: ShapeKind.Image, x: 0, y: 0, w: 100, h: 100, src: fakeImage1 }, actor: 'a', vector: {}, deleted: false, createdAt: 1, updatedAt: 1 },
      { id: 'img-2', kind: ShapeKind.Image, data: { kind: ShapeKind.Image, x: 0, y: 0, w: 100, h: 100, src: fakeImage2 }, actor: 'a', vector: {}, deleted: false, createdAt: 1, updatedAt: 1 },
      { id: 'img-deleted', kind: ShapeKind.Image, data: { kind: ShapeKind.Image, x: 0, y: 0, w: 100, h: 100, src: 'deleted-data' }, actor: 'a', vector: {}, deleted: true, createdAt: 1, updatedAt: 1 },
      { id: 'rect-1', kind: ShapeKind.Rect, data: { kind: ShapeKind.Rect, x: 0, y: 0, w: 100, h: 100, color: '#f00' }, actor: 'a', vector: {}, deleted: false, createdAt: 1, updatedAt: 1 },
    ];

    const totalBytes = calculateBoardImageBytes(shapes);
    expect(totalBytes).toBe(fakeImage1.length + fakeImage2.length);
  });

  it('rejects image files exceeding 15 MB before decoding', async () => {
    // Create a mock File exceeding 15MB
    const oversizedBlob = new Blob(['x'.repeat(100)], { type: 'image/png' });
    const oversizedFile = new File([oversizedBlob], 'huge.png', { type: 'image/png' });
    Object.defineProperty(oversizedFile, 'size', { value: 16 * 1024 * 1024 });

    await expect(prepareBoardImage(oversizedFile)).rejects.toThrow(/15 MB or smaller/);
  });

  it('rejects unsupported file formats', async () => {
    const txtBlob = new Blob(['text content'], { type: 'text/plain' });
    const txtFile = new File([txtBlob], 'document.txt', { type: 'text/plain' });

    await expect(prepareBoardImage(txtFile)).rejects.toThrow(/PNG, JPEG, WebP, or GIF/);
  });

  it('rejects uploads when existing board image budget is at maximum', async () => {
    const validBlob = new Blob(['valid'], { type: 'image/png' });
    const validFile = new File([validBlob], 'test.png', { type: 'image/png' });

    // Simulate board already holding 25 MB
    const atCapacity = MAX_BOARD_TOTAL_IMAGE_BYTES;
    await expect(prepareBoardImage(validFile, atCapacity)).rejects.toThrow(/storage limit reached/);
  });
});
