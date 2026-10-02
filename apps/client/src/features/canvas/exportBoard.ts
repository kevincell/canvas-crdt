import { type Shape, ShapeKind, shapeBBox, attachedLineEndpoints } from '@crdt-canvas/engine';

const EXPORT_PADDING = 56;
const MAX_SIDE = 8192;
const MAX_PIXELS = 24_000_000;

export async function exportBoardPng(shapes: Shape[], selectedIds?: string[], title?: string) {
  const canvas = await renderBoardCanvas(shapes, selectedIds);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The browser could not encode this board as PNG.')), 'image/png'));
  downloadBlob(blob, `${safeName(title || 'board')}${selectedIds ? '-selection' : ''}.png`);
}

export async function exportBoardPdf(shapes: Shape[], selectedIds?: string[], title?: string) {
  const canvas = await renderBoardCanvas(shapes, selectedIds);
  const jpegUrl = canvas.toDataURL('image/jpeg', 0.92);
  const jpegBytes = Uint8Array.from(atob(jpegUrl.split(',')[1]), char => char.charCodeAt(0));
  const landscape = canvas.width >= canvas.height;
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const margin = 28;
  const scale = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height);
  const drawWidth = canvas.width * scale;
  const drawHeight = canvas.height * scale;
  const drawX = (pageWidth - drawWidth) / 2;
  const drawY = (pageHeight - drawHeight) / 2;
  const content = `q ${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${drawX.toFixed(3)} ${drawY.toFixed(3)} cm /Im0 Do Q`;
  const contentBytes = new TextEncoder().encode(content);
  const objects: Uint8Array[] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concatBytes([ascii(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`), jpegBytes, ascii('\nendstream')]),
    concatBytes([ascii(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, ascii('\nendstream')]),
  ];
  downloadBlob(buildPdf(objects), `${safeName(title || 'board')}${selectedIds ? '-selection' : ''}.pdf`);
}

async function renderBoardCanvas(shapes: Shape[], selectedIds?: string[]): Promise<HTMLCanvasElement> {
  const targetShapes = new Map(shapes.filter(shape => !shape.deleted).map(shape => [shape.id, shape]));
  const active = shapes.filter(shape => !shape.deleted && (!selectedIds || selectedIds.includes(shape.id))).map(shape => {
    if (shape.data.kind !== ShapeKind.Line || (!shape.data.startShapeId && !shape.data.endShapeId)) return shape;
    const endpoints = attachedLineEndpoints(shape.data, targetShapes);
    return { ...shape, data: { ...shape.data, x1: endpoints.start.x, y1: endpoints.start.y, x2: endpoints.end.x, y2: endpoints.end.y } };
  });
  if (!active.length) throw new Error('There is nothing to export yet.');
  const bounds = active.map(shapeBBox).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
  }));
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX) + EXPORT_PADDING * 2;
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY) + EXPORT_PADDING * 2;
  const scale = Math.min(1, MAX_SIDE / worldWidth, MAX_SIDE / worldHeight, Math.sqrt(MAX_PIXELS / (worldWidth * worldHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(worldWidth * scale));
  canvas.height = Math.max(1, Math.ceil(worldHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG export is unavailable in this browser.');
  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(EXPORT_PADDING - bounds.minX, EXPORT_PADDING - bounds.minY);
  const ordered = active.map((shape, index) => ({ shape, index }))
    .sort((a, b) => (a.shape.data.zIndex ?? a.index) - (b.shape.data.zIndex ?? b.index) || a.index - b.index)
    .map(item => item.shape);

  for (const shape of ordered) {
    const d = shape.data;
    if (d.kind === ShapeKind.Stroke) {
      if (d.points.length < 2) continue;
      ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(d.points[0].x, d.points[0].y);
      d.points.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.stroke();
    } else if (d.kind === ShapeKind.Rect) {
      ctx.fillStyle = alphaColor(d.color, d.fillOpacity ?? 0.13); ctx.strokeStyle = d.color; ctx.lineWidth = d.strokeWidth ?? 1.5;
      if (d.frameTitle) ctx.setLineDash([8, 5]);
      rectPath(ctx, d.x, d.y, d.w, d.h, d.cornerRadius ?? 0); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (d.frameTitle) { ctx.fillStyle = d.color; ctx.font = '600 14px Inter, sans-serif'; ctx.fillText(d.frameTitle, d.x, d.y - 7); }
    } else if (d.kind === ShapeKind.Ellipse) {
      ctx.beginPath(); ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = alphaColor(d.color, d.fillOpacity ?? 0.13); ctx.fill(); ctx.strokeStyle = d.color; ctx.lineWidth = d.strokeWidth ?? 1.5; ctx.stroke();
    } else if (d.kind === ShapeKind.Line) {
      ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke();
      if (d.arrowEnd) drawArrow(ctx, d.x1, d.y1, d.x2, d.y2, 12);
    } else if (d.kind === ShapeKind.Text) {
      ctx.fillStyle = d.color; ctx.font = '500 16px Inter, sans-serif'; ctx.textBaseline = 'top';
      d.text.split('\n').forEach((line, index) => ctx.fillText(line, d.x, d.y - 16 + index * 20)); ctx.textBaseline = 'alphabetic';
    } else if (d.kind === ShapeKind.Note) {
      ctx.fillStyle = d.bgColor; rectPath(ctx, d.x, d.y, d.w, d.h, 4); ctx.fill();
      ctx.fillStyle = d.color; ctx.font = '13px Inter, sans-serif';
      let y = d.y + 16;
      for (const line of wrapNote(ctx, d.text, d.w - 12)) { ctx.fillText(line, d.x + 6, y); y += 16; }
    } else if (d.kind === ShapeKind.Image) {
      try { const image = await loadImage(d.src); ctx.drawImage(image, d.x, d.y, d.w, d.h); }
      catch { ctx.fillStyle = '#1e293b'; ctx.fillRect(d.x, d.y, d.w, d.h); ctx.strokeStyle = '#64748b'; ctx.strokeRect(d.x, d.y, d.w, d.h); }
    }
  }
  ctx.restore();
  return canvas;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ascii(value: string): Uint8Array { return new TextEncoder().encode(value); }

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function buildPdf(objects: Uint8Array[]): Blob {
  const header = ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const parts: Uint8Array[] = [header];
  const offsets: number[] = [0];
  let offset = header.length;
  objects.forEach((body, index) => {
    offsets.push(offset);
    const object = concatBytes([ascii(`${index + 1} 0 obj\n`), body, ascii('\nendobj\n')]);
    parts.push(object); offset += object.length;
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets.slice(1)) xref += `${String(value).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(ascii(xref));
  // Convert views to standalone ArrayBuffers for current DOM typings, which
  // correctly reject possible SharedArrayBuffer-backed views as Blob parts.
  const blobParts = parts.map(part => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer);
  return new Blob(blobParts, { type: 'application/pdf' });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load an image in the export.'));
    image.src = src;
  });
}

function alphaColor(color: string, alpha: number): string {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
  return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${alpha})`;
}

function rectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  if (radius > 0) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  } else ctx.rect(x, y, width, height);
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
}

function wrapNote(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > width) { lines.push(current); current = word; }
      else current = candidate;
    }
    lines.push(current);
  }
  return lines;
}

function safeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'board';
}
