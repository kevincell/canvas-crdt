import { type Shape } from '@crdt-canvas/engine';
import { renderToCanvas, preloadImages } from '../board/render';
import { type ThemeMode } from '../../theme/theme';

const EXPORT_PADDING = 56;

export async function exportBoardPng(shapes: Shape[], selectedIds?: string[], title?: string, mode: ThemeMode = 'day') {
  const canvas = await renderBoardCanvas(shapes, selectedIds, mode);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The browser could not encode this board as PNG.')), 'image/png'));
  downloadBlob(blob, `${safeName(title || 'board')}${selectedIds ? '-selection' : ''}.png`);
}

export async function exportBoardPdf(shapes: Shape[], selectedIds?: string[], title?: string, mode: ThemeMode = 'day') {
  const canvas = await renderBoardCanvas(shapes, selectedIds, mode);
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

async function renderBoardCanvas(shapes: Shape[], selectedIds?: string[], mode: ThemeMode = 'day'): Promise<HTMLCanvasElement> {
  const active = shapes.filter(shape => !shape.deleted && (!selectedIds || selectedIds.includes(shape.id)));
  if (!active.length) throw new Error('There is nothing to export yet.');
  const cache = new Map<string, HTMLImageElement>();
  await preloadImages(active, cache);
  return renderToCanvas(active, { mode, padding: EXPORT_PADDING, imageCache: cache });
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

function safeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'board';
}
