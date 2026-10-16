/** Shared colour palette and style presets. */

export const INK_COLORS = ['#1e1e1e', '#868e96', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#6741d9', '#c2255c'];
export const NOTE_COLORS = ['#fff3bf', '#ffd8a8', '#ffc9c9', '#fcc2d7', '#d0bfff', '#a5d8ff', '#b2f2bb', '#e9ecef'];
export const DEFAULT_INK = '#1e1e1e';
export const DEFAULT_NOTE = '#fff3bf';

export const STROKE_SIZES = [
  { id: 's', label: 'Thin', value: 2 },
  { id: 'm', label: 'Medium', value: 4 },
  { id: 'l', label: 'Bold', value: 8 },
  { id: 'xl', label: 'Extra bold', value: 14 },
] as const;

export const FONT_SIZES = [
  { id: 's', label: 'S', value: 14 },
  { id: 'm', label: 'M', value: 20 },
  { id: 'l', label: 'L', value: 32 },
  { id: 'xl', label: 'XL', value: 48 },
] as const;

export const FILLS = [
  { id: 'none', label: 'No fill', value: 0 },
  { id: 'tint', label: 'Tint', value: 0.14 },
  { id: 'solid', label: 'Solid', value: 0.9 },
] as const;

export const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, Arial, sans-serif';
export const HAND_FONT = '"Patrick Hand", "Segoe Print", "Bradley Hand", "Chalkboard SE", cursive';

/** Parse #rgb / #rrggbb into [r, g, b] 0–255. */
export function parseHex(color: string): [number, number, number] | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color?.trim() ?? '');
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split('').map(c => c + c).join('') : match[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text colour for a background. */
export function contrastText(background: string): string {
  return luminance(background) > 0.35 ? '#1e1e1e' : '#ffffff';
}

/**
 * Colours are stored once and adapted per viewer: in dark mode near-black ink
 * renders near-white (and vice versa) so a board drawn on a light canvas stays
 * legible. Saturated colours and note papers are left untouched.
 */
export function displayColor(color: string, dark: boolean): string {
  if (!dark) return color;
  const rgb = parseHex(color);
  if (!rgb) return color;
  const max = Math.max(...rgb), min = Math.min(...rgb);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation > 0.25) return color;
  const l = luminance(color);
  if (l < 0.08) return '#e9eaee';
  if (l > 0.85) return '#2a2b31';
  return color;
}

export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function darken(color: string, amount: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const [r, g, b] = rgb.map(v => Math.max(0, Math.min(255, Math.round(v * (1 - amount)))));
  return `rgb(${r}, ${g}, ${b})`;
}
