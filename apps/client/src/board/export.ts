/**
 * Exports rendered with the same painter as the screen, so files match what
 * people see (theme, sketch style, notes, connectors).
 */
import * as Y from 'yjs';
import { ShapeKind, encodeBoardFile, shapeBBox, type Shape } from '@crdt-canvas/engine';
import { drawFrameTitle, drawShape, ImageCache, type DrawContext } from './canvas/draw';
import { resolveConnector, sortByLayer, unionOf } from './canvas/transform';
import { CURRENT_BOARD_SCHEMA_VERSION } from '@crdt-canvas/engine';

const PADDING = 48;
const MAX_SIDE = 8192;
const MAX_PIXELS = 32_000_000;

export interface ExportOptions {
  shapes: Shape[];
  byId: ReadonlyMap<string, Shape>;
  dark: boolean;
  sketch: boolean;
  background: boolean;
  scale?: number;
}

export async function renderToCanvas(options: ExportOptions): Promise<HTMLCanvasElement> {
  const shapes = sortByLayer(options.shapes.filter(s => !s.deleted)).map(s => resolveConnector(s, options.byId));
  if (!shapes.length) throw new Error('There is nothing to export yet.');
  const bounds = unionOf(shapes.map(s => {
    const b = shapeBBox(s);
    // Leave room for frame titles above frames.
    return s.data.kind === ShapeKind.Rect && s.data.frameTitle ? { ...b, minY: b.minY - 24 } : b;
  }))!;
  const worldW = bounds.maxX - bounds.minX + PADDING * 2;
  const worldH = bounds.maxY - bounds.minY + PADDING * 2;
  const scale = Math.min(options.scale ?? 2, MAX_SIDE / worldW, MAX_SIDE / worldH, Math.sqrt(MAX_PIXELS / (worldW * worldH)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(worldW * scale));
  canvas.height = Math.max(1, Math.ceil(worldH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Export is unavailable in this browser.');

  // Load every image first so the export is complete.
  let pending = 0;
  let done: () => void = () => {};
  const loaded = new Promise<void>(resolve => { done = resolve; });
  const images = new ImageCache(() => { pending--; if (pending <= 0) done(); });
  const sources = new Set(shapes.flatMap(s => s.data.kind === ShapeKind.Image ? [s.data.src] : []));
  for (const src of sources) if (!images.get(src)) pending++;
  if (pending > 0) await Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 4000))]);

  if (options.background) {
    ctx.fillStyle = options.dark ? '#17181c' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, (PADDING - bounds.minX) * scale, (PADDING - bounds.minY) * scale);
  const dc: DrawContext = { ctx, zoom: scale, dark: options.dark, sketch: options.sketch, images, seed: '' };
  for (const s of shapes) { dc.seed = s.id; drawShape(dc, s.data); }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const s of shapes) {
    if (s.data.kind !== ShapeKind.Rect || !s.data.frameTitle) continue;
    drawFrameTitle(ctx, s.data.frameTitle, s.data.x - bounds.minX + PADDING, s.data.y - bounds.minY + PADDING, s.data.w, options.dark, false, '#5b5bf0');
  }
  return canvas;
}

export async function exportPng(options: ExportOptions, title: string, selection: boolean) {
  const canvas = await renderToCanvas(options);
  const blob = await toBlob(canvas, 'image/png');
  downloadBlob(blob, `${safeName(title)}${selection ? '-selection' : ''}.png`);
}

export async function copyPng(options: ExportOptions) {
  const canvas = await renderToCanvas(options);
  const blob = await toBlob(canvas, 'image/png');
  if (!('ClipboardItem' in window)) throw new Error('This browser cannot copy images to the clipboard.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function exportPdf(options: ExportOptions, title: string) {
  const canvas = await renderToCanvas({ ...options, background: true });
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const landscape = canvas.width >= canvas.height;
  const pageW = landscape ? 842 : 595, pageH = landscape ? 595 : 842, margin = 24;
  const fit = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
  const w = canvas.width * fit, h = canvas.height * fit;
  const content = ascii(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((pageW - w) / 2).toFixed(2)} ${((pageH - h) / 2).toFixed(2)} cm /Im0 Do Q`);
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concat([ascii(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, ascii('\nendstream')]),
    concat([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('\nendstream')]),
  ];
  downloadBlob(buildPdf(objects), `${safeName(title)}.pdf`);
}

/** Portable JSON snapshot (imports as a copy). */
export function exportSnapshot(shapes: Shape[], title: string) {
  const snapshot = {
    format: 'crdt-canvas-board',
    schemaVersion: CURRENT_BOARD_SCHEMA_VERSION,
    title,
    exportedAt: new Date().toISOString(),
    shapes: shapes.filter(s => !s.deleted).map(s => ({ id: s.id, data: s.data })),
  };
  downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), `${safeName(title)}.json`);
}

/** Full CRDT state: opening it elsewhere merges instead of overwriting. */
export function exportMergeFile(doc: Y.Doc, title: string, roomId: string, exportedBy: string) {
  const bytes = encodeBoardFile(doc, { title, roomId, exportedBy });
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' });
  downloadBlob(blob, `${safeName(title)}.crdtcanvas`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')), type, quality));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'board';
}

function ascii(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function buildPdf(objects: Uint8Array[]): Blob {
  const header = ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const parts: Uint8Array[] = [header];
  const offsets: number[] = [];
  let offset = header.length;
  objects.forEach((body, index) => {
    offsets.push(offset);
    const obj = concat([ascii(`${index + 1} 0 obj\n`), body, ascii('\nendobj\n')]);
    parts.push(obj);
    offset += obj.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) xref += `${String(value).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
  parts.push(ascii(xref));
  return new Blob(parts.map(p => p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) as ArrayBuffer), { type: 'application/pdf' });
}
