/**
 * Board shape model (client side).
 *
 * The CRDT engine stores each shape's `data` as JSON, so extra style fields are fully
 * backwards-compatible: old boards simply don't have them and fall back to defaults.
 */
import { type Shape, type ShapeData, ShapeKind } from '@crdt-canvas/engine';

export type DashStyle = 'solid' | 'dots' | 'dots-wide' | 'dashed';
export type FontFamily = 'Arial' | 'Times New Roman';
export const FONT_FAMILIES: FontFamily[] = ['Arial', 'Times New Roman'];
export const FONT_STACK: Record<FontFamily, string> = {
  'Arial': "Arial, 'Liberation Sans', Helvetica, sans-serif",
  'Times New Roman': "'Times New Roman', 'Liberation Serif', Times, serif",
};

export interface StyleExt {
  /** Who first drew it (display name) and their device id — used for the overlap-conflict rule */
  createdBy?: string;
  createdById?: string;
  dash?: DashStyle;
  /** Whole-object opacity (0.1 – 1) */
  opacity?: number;
  /** Colour set by the Fill tool (rect / ellipse / closed freehand shape) */
  fillColor?: string;
  /** Text boxes */
  fontFamily?: FontFamily;
  fontSize?: number;
  /** New-style text box: x,y is the top-left corner and w,h its size */
  box?: boolean;
  w?: number;
  h?: number;
  /** Lock info — locked objects can only be unlocked / deleted by a room vote */
  lockedBy?: string;
  lockedAt?: number;
  arrowStart?: boolean;
}

export type BoardData = ShapeData & StyleExt;

export function dataOf(shape: Shape): BoardData {
  return shape.data as BoardData;
}

export type ToolId =
  | 'select'   // cursor: pick one object
  | 'box'      // hand: drag a box to multi-select, then drag the box to move the group
  | 'pen'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'image'
  | 'fill'
  | 'eraser'
  | 'delete'
  | 'laser';

export const ERASER_SIZES = { S: 8, M: 18, L: 36 } as const;
export type EraserSize = keyof typeof ERASER_SIZES;

export interface ToolStyle {
  color: string;
  width: number;
  opacity: number;
  dash: DashStyle;
  fontFamily: FontFamily;
  fontSize: number;
  arrow: 'none' | 'end' | 'both';
}

export const DEFAULT_STYLE: ToolStyle = {
  color: '#2F2A22',
  width: 3,
  opacity: 1,
  dash: 'solid',
  fontFamily: 'Arial',
  fontSize: 18,
  arrow: 'none',
};

export function dashPattern(dash: DashStyle | undefined, width: number): number[] {
  const w = Math.max(1, width);
  switch (dash) {
    case 'dots': return [0.01, w * 2.2];
    case 'dots-wide': return [0.01, w * 4.5];
    case 'dashed': return [w * 3.2, w * 2.4];
    default: return [];
  }
}

export function isTextLike(kind: ShapeKind) {
  return kind === ShapeKind.Text || kind === ShapeKind.Note;
}

export function hasStroke(kind: ShapeKind) {
  return kind === ShapeKind.Stroke || kind === ShapeKind.Line || kind === ShapeKind.Rect || kind === ShapeKind.Ellipse;
}
