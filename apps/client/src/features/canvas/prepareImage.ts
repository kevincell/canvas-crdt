import { ShapeKind, type ShapeData } from '@crdt-canvas/engine';

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // 15 MB source upload limit
export const MAX_DIMENSION = 1600;
export const MAX_PIXELS = 2_400_000;
export const MAX_IMAGE_BASE64_BYTES = 2 * 1024 * 1024; // 2 MB compressed base64 per image
export const MAX_BOARD_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB total image budget per board
export const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Calculates the total byte size of images stored on a board.
 */
export function calculateBoardImageBytes(shapes: Array<{ deleted?: boolean; data: ShapeData }>): number {
  return shapes.reduce((sum, shape) => {
    if (shape.deleted || shape.data.kind !== ShapeKind.Image) return sum;
    return sum + (shape.data.src ? shape.data.src.length : 0);
  }, 0);
}

export async function prepareBoardImage(
  file: File,
  existingBoardBytes?: number
): Promise<{ src: string; width: number; height: number }> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Use a PNG, JPEG, WebP, or GIF image.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Images must be 15 MB or smaller.');
  if (existingBoardBytes !== undefined && existingBoardBytes >= MAX_BOARD_TOTAL_IMAGE_BYTES) {
    throw new Error(`Board image storage limit reached (${Math.round(MAX_BOARD_TOTAL_IMAGE_BYTES / (1024 * 1024))} MB). Please remove some images before adding more.`);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_DIMENSION / image.naturalWidth, MAX_DIMENSION / image.naturalHeight, Math.sqrt(MAX_PIXELS / (image.naturalWidth * image.naturalHeight)));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, width, height);
    const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/webp' ? 'image/webp' : 'image/png';
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode this image.')), outputType, 0.88));
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the prepared image.'));
      reader.onerror = () => reject(new Error('Could not read the prepared image.'));
      reader.readAsDataURL(blob);
    });

    if (src.length > MAX_IMAGE_BASE64_BYTES) {
      throw new Error(`Compressed image exceeds maximum allowable size (${Math.round(MAX_IMAGE_BASE64_BYTES / (1024 * 1024))} MB).`);
    }
    if (existingBoardBytes !== undefined && existingBoardBytes + src.length > MAX_BOARD_TOTAL_IMAGE_BYTES) {
      throw new Error(`Adding this image would exceed the board storage budget (${Math.round(MAX_BOARD_TOTAL_IMAGE_BYTES / (1024 * 1024))} MB).`);
    }

    return { src, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be decoded.'));
    image.src = src;
  });
}
