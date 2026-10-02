import { CURRENT_BOARD_SCHEMA_VERSION, ShapeKind, type Shape, type ShapeData, yjsShapesToShapes } from '@crdt-canvas/engine';
import * as Y from 'yjs';

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const MAX_SHAPES = 20_000;
const MAX_COORDINATE = 10_000_000;

export interface BoardSnapshot {
  format: 'crdt-canvas-board';
  schemaVersion: number;
  title: string;
  exportedAt: string;
  shapes: Array<{ id: string; data: ShapeData }>;
}

export function downloadBoardSnapshot(shapes: Shape[], title: string): void {
  const snapshot: BoardSnapshot = {
    format: 'crdt-canvas-board',
    schemaVersion: CURRENT_BOARD_SCHEMA_VERSION,
    title: title.trim() || 'Board',
    exportedAt: new Date().toISOString(),
    shapes: shapes.filter(shape => !shape.deleted).map(shape => ({ id: shape.id, data: structuredClone(shape.data) })),
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName(snapshot.title)}-snapshot.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ImportedBoardSnapshot {
  title: string;
  shapes: Array<{ id: string; data: ShapeData }>;
  warnings?: string[];
}

export function offsetSnapshotShapes(shapes: Array<{ id: string; data: ShapeData }>, dx: number, dy: number): Array<{ id: string; data: ShapeData }> {
  return shapes.map(({ id, data }) => {
    if (data.kind === ShapeKind.Stroke) return { id, data: { ...data, points: data.points.map(point => ({ x: point.x + dx, y: point.y + dy })) } };
    if (data.kind === ShapeKind.Ellipse) return { id, data: { ...data, cx: data.cx + dx, cy: data.cy + dy } };
    if (data.kind === ShapeKind.Line) return { id, data: { ...data, x1: data.x1 + dx, y1: data.y1 + dy, x2: data.x2 + dx, y2: data.y2 + dy } };
    return { id, data: { ...data, x: data.x + dx, y: data.y + dy } };
  });
}

export async function readBoardSnapshot(file: File): Promise<ImportedBoardSnapshot> {
  if (file.size > MAX_SNAPSHOT_BYTES) throw new Error('This snapshot is larger than the 25 MB import limit.');
  if (/\.yupdate$/i.test(file.name)) return readYjsRecoveryCopy(file);
  const raw: unknown = JSON.parse(await file.text());
  if (!isRecord(raw) || raw.format !== 'crdt-canvas-board' || !Array.isArray(raw.shapes)) {
    throw new Error('This file is not a CRDT Canvas board snapshot.');
  }
  if (!Number.isInteger(raw.schemaVersion) || Number(raw.schemaVersion) < 1 || Number(raw.schemaVersion) > CURRENT_BOARD_SCHEMA_VERSION) {
    throw new Error(`This snapshot uses unsupported schema version ${String(raw.schemaVersion)}.`);
  }
  if (raw.shapes.length > MAX_SHAPES) throw new Error(`A snapshot can contain up to ${MAX_SHAPES.toLocaleString()} objects.`);
  const shapes = raw.shapes.map((entry, index) => {
    if (isRecord(entry) && typeof entry.id === 'string' && 'data' in entry) {
      const data = normalizeShapeData(entry.data);
      return data ? { id: entry.id.slice(0, 160), data } : null;
    }
    // Read the first prototype format, which contained the shape data directly.
    const data = normalizeShapeData(entry);
    return data ? { id: `legacy-${index}`, data } : null;
  });
  if (shapes.some(shape => shape === null)) throw new Error('The snapshot contains an invalid or unsupported object.');
  if (!shapes.length) throw new Error('The snapshot does not contain any objects.');
  return { title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : 'Recovered board', shapes: shapes as Array<{ id: string; data: ShapeData }> };
}

async function readYjsRecoveryCopy(file: File): Promise<ImportedBoardSnapshot> {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(await file.arrayBuffer()));
    const shapeArray = doc.getArray<Y.XmlElement>('shapes');
    const liveRecordCount = shapeArray.toArray().filter(element => element.getAttribute('deleted') !== 'true').length;
    const rawShapes = yjsShapesToShapes(shapeArray).filter(shape => !shape.deleted);
    const shapes: Array<{ id: string; data: ShapeData }> = [];
    for (const shape of rawShapes) {
      const data = normalizeShapeData(shape.data);
      if (data) shapes.push({ id: shape.id, data });
    }
    if (!shapes.length) throw new Error('This recovery copy has no supported objects to import. Keep the original file for specialized recovery.');
    const title = file.name.replace(/-pre-migration\.yupdate$/i, '').replace(/\.yupdate$/i, '').slice(0, 120) || 'Recovered board';
    return {
      title,
      shapes,
      ...(shapes.length !== liveRecordCount ? { warnings: [`Recovered ${shapes.length} of ${liveRecordCount} live objects; unsupported or invalid objects were skipped. Keep the original recovery file.`] } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('This recovery copy')) throw error;
    throw new Error('This file is not a readable Yjs recovery copy. Keep the original file unchanged.');
  } finally {
    doc.destroy();
  }
}

function normalizeShapeData(value: unknown): ShapeData | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const common = normalizeMetadata(value);
  const finite = (...keys: string[]) => keys.every(key => isFiniteCoordinate(value[key]));
  switch (value.kind) {
    case ShapeKind.Stroke:
      if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > 100_000 || typeof value.color !== 'string' || !isFiniteCoordinate(value.width)) return null;
      if (!value.points.every(point => isRecord(point) && finitePoint(point.x) && finitePoint(point.y))) return null;
      return { kind: ShapeKind.Stroke, points: structuredClone(value.points) as { x: number; y: number }[], color: value.color, width: Number(value.width), ...common };
    case ShapeKind.Rect:
      if (!finite('x', 'y', 'w', 'h') || Number(value.w) < 0 || Number(value.h) < 0 || typeof value.color !== 'string') return null;
      return { kind: ShapeKind.Rect, x: Number(value.x), y: Number(value.y), w: Number(value.w), h: Number(value.h), color: value.color,
        fillOpacity: optionalUnit(value.fillOpacity, 0.13), strokeWidth: optionalPositive(value.strokeWidth, 1.5), cornerRadius: optionalNonnegative(value.cornerRadius, 0),
        ...(typeof value.frameTitle === 'string' ? { frameTitle: value.frameTitle.slice(0, 120) } : {}), ...common };
    case ShapeKind.Ellipse:
      if (!finite('cx', 'cy', 'rx', 'ry') || Number(value.rx) < 0 || Number(value.ry) < 0 || typeof value.color !== 'string') return null;
      return { kind: ShapeKind.Ellipse, cx: Number(value.cx), cy: Number(value.cy), rx: Number(value.rx), ry: Number(value.ry), color: value.color,
        fillOpacity: optionalUnit(value.fillOpacity, 0.13), strokeWidth: optionalPositive(value.strokeWidth, 1.5), ...common };
    case ShapeKind.Line:
      if (!finite('x1', 'y1', 'x2', 'y2') || typeof value.color !== 'string' || !isFiniteCoordinate(value.width)) return null;
      return { kind: ShapeKind.Line, x1: Number(value.x1), y1: Number(value.y1), x2: Number(value.x2), y2: Number(value.y2), color: value.color, width: Number(value.width), arrowEnd: value.arrowEnd === true,
        ...(typeof value.startShapeId === 'string' ? { startShapeId: value.startShapeId.slice(0, 160) } : {}),
        ...(typeof value.endShapeId === 'string' ? { endShapeId: value.endShapeId.slice(0, 160) } : {}), ...common };
    case ShapeKind.Text:
      if (!finite('x', 'y') || typeof value.text !== 'string' || value.text.length > 100_000 || typeof value.color !== 'string') return null;
      return { kind: ShapeKind.Text, x: Number(value.x), y: Number(value.y), text: value.text, color: value.color, ...common };
    case ShapeKind.Image:
      if (!finite('x', 'y', 'w', 'h') || Number(value.w) < 0 || Number(value.h) < 0 || typeof value.src !== 'string' || !isSafeImageSource(value.src)) return null;
      return { kind: ShapeKind.Image, x: Number(value.x), y: Number(value.y), w: Number(value.w), h: Number(value.h), src: value.src, ...common };
    case ShapeKind.Note:
      if (!finite('x', 'y', 'w', 'h') || Number(value.w) < 0 || Number(value.h) < 0 || typeof value.text !== 'string' || value.text.length > 100_000 || typeof value.color !== 'string' || typeof value.bgColor !== 'string') return null;
      return { kind: ShapeKind.Note, x: Number(value.x), y: Number(value.y), w: Number(value.w), h: Number(value.h), text: value.text, color: value.color, bgColor: value.bgColor, ...common };
    default:
      return null;
  }
}

function normalizeMetadata(value: Record<string, unknown>) {
  return {
    ...(isFiniteCoordinate(value.zIndex) ? { zIndex: Number(value.zIndex) } : {}),
    ...(typeof value.groupId === 'string' ? { groupId: value.groupId.slice(0, 160) } : {}),
    ...(typeof value.frameId === 'string' ? { frameId: value.frameId.slice(0, 160) } : {}),
    ...(typeof value.locked === 'boolean' ? { locked: value.locked } : {}),
  };
}

function isSafeImageSource(src: string): boolean {
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src)) return true;
  try { return ['http:', 'https:'].includes(new URL(src, window.location.href).protocol); }
  catch { return false; }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isFiniteCoordinate(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE; }
function finitePoint(value: unknown): value is number { return isFiniteCoordinate(value); }
function optionalUnit(value: unknown, fallback: number): number { return isFiniteCoordinate(value) ? Math.max(0, Math.min(1, Number(value))) : fallback; }
function optionalPositive(value: unknown, fallback: number): number { return isFiniteCoordinate(value) ? Math.max(0.1, Math.min(128, Number(value))) : fallback; }
function optionalNonnegative(value: unknown, fallback: number): number { return isFiniteCoordinate(value) ? Math.max(0, Math.min(2048, Number(value))) : fallback; }
function safeName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'board'; }
