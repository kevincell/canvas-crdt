/** Camera: screen = world * z + (x, y). */
export interface Camera { x: number; y: number; z: number }
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Point = { x: number; y: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.z, y: (point.y - camera.y) / camera.z };
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return { x: point.x * camera.z + camera.x, y: point.y * camera.z + camera.y };
}

/** Zoom by `factor` keeping the screen point `anchor` fixed. */
export function zoomAt(camera: Camera, anchor: Point, factor: number): Camera {
  const z = clampZoom(camera.z * factor);
  const k = z / camera.z;
  return { z, x: anchor.x - (anchor.x - camera.x) * k, y: anchor.y - (anchor.y - camera.y) * k };
}

export function fitCamera(bounds: Bounds, width: number, height: number, padding = 80, maxZoom = 2): Camera {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const z = clampZoom(Math.min(maxZoom, (width - padding * 2) / w, (height - padding * 2) / h));
  return {
    z,
    x: (width - w * z) / 2 - bounds.minX * z,
    y: (height - h * z) / 2 - bounds.minY * z,
  };
}

export function centerOn(point: Point, z: number, width: number, height: number): Camera {
  return { z, x: width / 2 - point.x * z, y: height / 2 - point.y * z };
}

export function viewportBounds(camera: Camera, width: number, height: number): Bounds {
  const a = screenToWorld(camera, { x: 0, y: 0 });
  const b = screenToWorld(camera, { x: width, y: height });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Smooth, interruptible camera animation in log-zoom space. */
export function interpolateCamera(from: Camera, to: Camera, t: number, width: number, height: number): Camera {
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
  // Interpolate the world point at the viewport centre so the motion feels anchored.
  const cFrom = screenToWorld(from, { x: width / 2, y: height / 2 });
  const cTo = screenToWorld(to, { x: width / 2, y: height / 2 });
  const c = { x: cFrom.x + (cTo.x - cFrom.x) * e, y: cFrom.y + (cTo.y - cFrom.y) * e };
  return centerOn(c, z, width, height);
}
