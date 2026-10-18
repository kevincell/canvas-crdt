/**
 * Two demo templates. Shapes use template-local ids so arrows can attach to boxes; ids are
 * replaced when the template is placed on a board.
 */
import { ShapeKind } from '@crdt-canvas/engine';

export interface BoardTemplate {
  id: string;
  title: string;
  description: string;
  shapes: Array<{ id: string; kind: ShapeKind; data: Record<string, any> }>;
}

const SAGE = '#6F8F6A', LATTE = '#A9754F', HONEY = '#D6A03A', SLATE = '#4F7C8A', ROSE = '#C1708F', INK = '#2F2A22';

const box = (id: string, x: number, y: number, w: number, h: number, color: string, extra: Record<string, any> = {}) =>
  ({ id, kind: ShapeKind.Rect, data: { kind: ShapeKind.Rect, x, y, w, h, color, strokeWidth: 2, fillColor: color, fillOpacity: 0.12, cornerRadius: 14, ...extra } });
const text = (id: string, x: number, top: number, w: number, value: string, size = 18, extra: Record<string, any> = {}) =>
  ({ id, kind: ShapeKind.Text, data: { kind: ShapeKind.Text, x, y: top + 16, w, h: size * 1.6, box: true, text: value, color: INK, fontFamily: 'Arial', fontSize: size, ...extra } });
const arrow = (id: string, from: string, to: string, color = INK) =>
  ({ id, kind: ShapeKind.Line, data: { kind: ShapeKind.Line, x1: 0, y1: 0, x2: 0, y2: 0, color, width: 2.5, arrowEnd: true, startShapeId: from, endShapeId: to } });

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'brainstorm',
    title: 'Brainstorm',
    description: 'Four areas: the question, wild ideas, themes and next steps.',
    shapes: [
      text('t0', 40, 0, 860, 'Brainstorm — what are we solving?', 28, { fontFamily: 'Times New Roman' }),
      box('b1', 40, 70, 420, 260, HONEY),
      text('t1', 60, 86, 380, '1 · The question'),
      box('b2', 480, 70, 420, 260, SLATE),
      text('t2', 500, 86, 380, '2 · Wild ideas'),
      box('b3', 40, 350, 420, 260, SAGE),
      text('t3', 60, 366, 380, '3 · Themes'),
      box('b4', 480, 350, 420, 260, ROSE),
      text('t4', 500, 366, 380, '4 · Next steps & owners'),
      text('h1', 60, 130, 380, 'Write the problem in one sentence…', 15, { color: '#6F6352' }),
      text('h2', 500, 130, 380, 'No bad ideas here — draw, paste images, anything.', 15, { color: '#6F6352' }),
      text('h3', 60, 410, 380, 'Group similar ideas; circle the strongest.', 15, { color: '#6F6352' }),
      text('h4', 500, 410, 380, 'Who does what, by when?', 15, { color: '#6F6352' }),
    ],
  },
  {
    id: 'flow',
    title: 'Simple flowchart',
    description: 'Start → steps → decision → end, with attached arrows.',
    shapes: [
      { id: 's', kind: ShapeKind.Ellipse, data: { kind: ShapeKind.Ellipse, cx: 140, cy: 80, rx: 90, ry: 40, color: SAGE, strokeWidth: 2, fillColor: SAGE, fillOpacity: 0.15 } },
      text('st', 95, 68, 100, 'Start', 18),
      box('a', 280, 40, 200, 80, LATTE),
      text('at', 300, 66, 160, 'Step one', 17),
      box('b', 540, 40, 200, 80, LATTE),
      text('bt', 560, 66, 160, 'Step two', 17),
      box('d', 560, 190, 160, 110, HONEY, { cornerRadius: 0, dash: 'dashed' }),
      text('dt', 575, 228, 130, 'Decision?', 17),
      box('e', 280, 210, 200, 70, SLATE),
      text('et', 300, 232, 160, 'End', 17),
      arrow('l1', 's', 'a'), arrow('l2', 'a', 'b'), arrow('l3', 'b', 'd'), arrow('l4', 'd', 'e'),
    ],
  },
];

/** Shift template shapes to the given top-left and return them in creation order (lines last) */
export function placeTemplate(t: BoardTemplate, at: { x: number; y: number }) {
  const move = (d: Record<string, any>) => {
    const out = { ...d };
    if ('x' in out) out.x += at.x;
    if ('y' in out) out.y += at.y;
    if ('cx' in out) out.cx += at.x;
    if ('cy' in out) out.cy += at.y;
    if ('x1' in out) { out.x1 += at.x; out.x2 += at.x; out.y1 += at.y; out.y2 += at.y; }
    return out;
  };
  const nonLines = t.shapes.filter(s => s.kind !== ShapeKind.Line).map(s => ({ ...s, data: move(s.data) }));
  const lines = t.shapes.filter(s => s.kind === ShapeKind.Line).map(s => ({ ...s, data: move(s.data) }));
  return [...nonLines, ...lines];
}
