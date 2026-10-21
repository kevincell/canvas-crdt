/**
 * Contextual bar that floats above the current selection (like Word's mini toolbar):
 * colour, fill, thickness, line style, corners, opacity, font, − / + resize, comment, lock, delete.
 */
import { useState, type ReactNode } from 'react';
import { Box, Popover, Slider, Divider, MenuItem, Select, Tooltip } from '@mui/material';
import {
  Remove, Add, ChatBubbleOutlineOutlined as ChatBubbleOutline, LockOutlined, LockOpenOutlined, DeleteOutlineOutlined as DeleteOutline, FormatColorFill, LineWeight, TextFields,
} from '@mui/icons-material';
import { type Shape, ShapeKind } from '@crdt-canvas/engine';
import { type BoardData, type DashStyle, type FontFamily, FONT_FAMILIES, dataOf } from './model';
import { isClosedStroke } from './geometry';
import { ToolButton, Swatch, DashPreview, DASH_OPTIONS, Segmented, Label, panelSx } from './ui';
import { INK_COLORS, v } from '../../theme/theme';

export interface StylePatch {
  color?: string;
  fillColor?: string | null;
  width?: number;
  dash?: DashStyle;
  opacity?: number;
  cornerRadius?: number;
  fontFamily?: FontFamily;
  fontSize?: number;
}

/** Translate a generic style change into the fields each shape kind actually uses */
export function stylePatchFor(shape: Shape, p: StylePatch): Partial<BoardData> | null {
  const d = dataOf(shape) as any;
  const out: any = {};
  const k = shape.kind;
  if (p.color !== undefined) out.color = p.color;
  if (p.opacity !== undefined) out.opacity = p.opacity;
  if (p.dash !== undefined && (k === ShapeKind.Stroke || k === ShapeKind.Line || k === ShapeKind.Rect || k === ShapeKind.Ellipse)) out.dash = p.dash;
  if (p.width !== undefined) {
    if (k === ShapeKind.Stroke || k === ShapeKind.Line) out.width = p.width;
    else if (k === ShapeKind.Rect || k === ShapeKind.Ellipse) out.strokeWidth = p.width;
  }
  if (p.fillColor !== undefined && canFill(shape)) {
    if (p.fillColor === null) { out.fillColor = undefined; out.fillOpacity = 0; }
    else { out.fillColor = p.fillColor; out.fillOpacity = 0.85; }
  }
  if (p.cornerRadius !== undefined && k === ShapeKind.Rect) out.cornerRadius = p.cornerRadius;
  if (k === ShapeKind.Text) {
    if (p.fontFamily !== undefined) out.fontFamily = p.fontFamily;
    if (p.fontSize !== undefined) out.fontSize = p.fontSize;
  }
  void d;
  return Object.keys(out).length ? out : null;
}

export function canFill(shape: Shape): boolean {
  const d = dataOf(shape) as any;
  if (shape.kind === ShapeKind.Rect || shape.kind === ShapeKind.Ellipse) return true;
  if (shape.kind === ShapeKind.Text) return !!d.box;
  if (shape.kind === ShapeKind.Stroke) return isClosedStroke(d.points ?? []);
  return false;
}

export function SelectionBar({
  screen, shapes, boxActive, onStyle, onScale, onComment, onLock, onUnlock, onDelete, onTextInBox, commentCount,
}: {
  screen: { left: number; top: number; right: number; bottom: number };
  shapes: Shape[];
  boxActive: boolean;
  onStyle: (patch: StylePatch) => void;
  onScale: (factor: number) => void;
  onComment: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onDelete: () => void;
  onTextInBox?: () => void;
  commentCount: number;
}) {
  const [anchor, setAnchor] = useState<{ el: HTMLElement; kind: 'color' | 'fill' | 'line' | 'text' } | null>(null);
  const count = shapes.length;
  const lockedCount = shapes.filter(s => dataOf(s).locked).length;
  const allLocked = count > 0 && lockedCount === count;
  const editable = shapes.filter(s => !dataOf(s).locked);
  const first = editable[0] ? dataOf(editable[0]) as any : null;
  const hasStrokeLike = editable.some(s => [ShapeKind.Stroke, ShapeKind.Line, ShapeKind.Rect, ShapeKind.Ellipse].includes(s.kind));
  const hasRect = editable.some(s => s.kind === ShapeKind.Rect);
  const hasText = editable.some(s => s.kind === ShapeKind.Text);
  const fillable = editable.some(canFill);

  // Place above the selection, or below if there's no room
  const barW = window.innerWidth < 600 ? Math.min(window.innerWidth - 16, 340) : 470;
  const cx = (screen.left + screen.right) / 2;
  const above = screen.top > 70;
  const top = above ? screen.top - 54 : screen.bottom + 14;
  const edge = window.innerWidth < 600 ? 8 : 70;
  const left = Math.max(edge, Math.min(window.innerWidth - barW - 8, cx - barW / 2));

  const currentColor = first?.color ?? INK_COLORS[0];
  const currentWidth = first ? (first.width ?? first.strokeWidth ?? 3) : 3;

  const pop = (kind: 'color' | 'fill' | 'line' | 'text') => (e: React.MouseEvent<HTMLButtonElement>) => setAnchor({ el: e.currentTarget, kind });

  if (!count && !boxActive) return null;

  return (
    <Box
      onPointerDown={e => e.stopPropagation()}
      sx={{ ...panelSx, position: 'absolute', left, top, zIndex: 28, display: 'flex', alignItems: 'center', gap: 0.25, px: 0.6, py: 0.45, borderRadius: '12px', animation: 'popIn .12s ease', width: { xs: 'calc(100vw - 16px)', sm: 'auto' }, maxWidth: 'calc(100vw - 16px)', maxHeight: { xs: '34vh', sm: 'none' }, overflowY: 'auto', flexWrap: 'wrap' }}
    >
      <Box sx={{ px: 0.75, fontSize: 11.5, fontWeight: 700, color: v('textMuted'), whiteSpace: 'nowrap' }}>
        {count ? `${count} selected` : 'Empty box'}{lockedCount ? ` · ${lockedCount} 🔒` : ''}
      </Box>

      {boxActive && onTextInBox && (
        <ToolButton title="Text box filling this box" placement="top" size={32} onClick={onTextInBox}><TextFields fontSize="small" /></ToolButton>
      )}

      {editable.length > 0 && (
        <>
          <Bar />
          <Tooltip title="Colour" placement="top" disableInteractive>
            <Box component="button" aria-label="Colour" onClick={pop('color')} sx={{ width: 32, height: 32, borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', '&:hover': { bgcolor: v('surface2') } }}>
              <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: currentColor, border: `2px solid ${v('border')}` }} />
            </Box>
          </Tooltip>
          {fillable && <ToolButton title="Fill" placement="top" size={32} onClick={pop('fill')}><FormatColorFill fontSize="small" /></ToolButton>}
          {(hasStrokeLike || editable.length) && <ToolButton title="Thickness, line style, corners, opacity" placement="top" size={32} onClick={pop('line')}><LineWeight fontSize="small" /></ToolButton>}
          {hasText && <ToolButton title="Font" placement="top" size={32} onClick={pop('text')}><TextFields fontSize="small" /></ToolButton>}
          <Bar />
          <ToolButton title="Smaller" placement="top" size={32} onClick={() => onScale(1 / 1.1)}><Remove fontSize="small" /></ToolButton>
          <ToolButton title="Bigger" placement="top" size={32} onClick={() => onScale(1.1)}><Add fontSize="small" /></ToolButton>
        </>
      )}

      {count > 0 && (
        <>
          <Bar />
          <ToolButton title={commentCount ? `Comments (${commentCount})` : 'Comment on selection'} placement="top" size={32} onClick={onComment} badge={commentCount || undefined}>
            <ChatBubbleOutline fontSize="small" />
          </ToolButton>
          {allLocked
            ? <ToolButton title="Unlock (needs more than half of the room to agree)" placement="top" size={32} onClick={onUnlock}><LockOpenOutlined fontSize="small" /></ToolButton>
            : <ToolButton title="Lock selection" placement="top" size={32} onClick={onLock}><LockOutlined fontSize="small" /></ToolButton>}
          <ToolButton title={lockedCount ? 'Delete (locked items need a vote)' : 'Delete'} placement="top" size={32} danger onClick={onDelete}><DeleteOutline fontSize="small" /></ToolButton>
        </>
      )}

      <Popover
        open={!!anchor}
        anchorEl={anchor?.el}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: above ? 'top' : 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: above ? 'bottom' : 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { ...panelSx as any, p: 1.4, mt: above ? -1 : 1, width: 230 } } }}
      >
        {anchor?.kind === 'color' && (
          <ColorGrid value={currentColor} onPick={c => onStyle({ color: c })} />
        )}
        {anchor?.kind === 'fill' && (
          <>
            <ColorGrid value={first?.fillColor ?? ''} onPick={c => onStyle({ fillColor: c })} />
            <Box component="button" onClick={() => onStyle({ fillColor: null })} sx={{ mt: 1, fontSize: 12, color: v('textMuted'), textDecoration: 'underline' }}>No fill</Box>
          </>
        )}
        {anchor?.kind === 'line' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {hasStrokeLike && (
              <>
                <Label>Thickness · {currentWidth}px</Label>
                <Slider size="small" min={1} max={24} step={1} defaultValue={currentWidth} onChangeCommitted={(_, val) => onStyle({ width: val as number })} />
                <Label>Line style</Label>
                <Segmented size="sm" value={(first?.dash ?? 'solid') as DashStyle} onChange={d => onStyle({ dash: d })}
                  options={DASH_OPTIONS.map(d => ({ id: d.id, label: <DashPreview dash={d.id} width={2} />, title: d.label }))} />
              </>
            )}
            {hasRect && (
              <>
                <Label>Corners</Label>
                <Segmented size="sm" value={(first?.cornerRadius ?? 0) > 0 ? 'round' : 'sharp'} onChange={c => onStyle({ cornerRadius: c === 'round' ? 14 : 0 })} options={[
                  { id: 'sharp', label: '⌜ Pointed' }, { id: 'round', label: '◜ Rounded' },
                ]} />
              </>
            )}
            <Label>Opacity · {Math.round((first?.opacity ?? 1) * 100)}%</Label>
            <Slider size="small" min={0.1} max={1} step={0.05} defaultValue={first?.opacity ?? 1} onChangeCommitted={(_, val) => onStyle({ opacity: val as number })} />
          </Box>
        )}
        {anchor?.kind === 'text' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Label>Font</Label>
            <Select size="small" value={(first?.fontFamily ?? 'Arial') as FontFamily} onChange={e => onStyle({ fontFamily: e.target.value as FontFamily })} sx={{ fontSize: 13 }}>
              {FONT_FAMILIES.map(f => <MenuItem key={f} value={f} sx={{ fontFamily: f }}>{f}</MenuItem>)}
            </Select>
            <Label>Size</Label>
            <Slider size="small" min={10} max={72} step={1} defaultValue={first?.fontSize ?? 18} valueLabelDisplay="auto" onChangeCommitted={(_, val) => onStyle({ fontSize: val as number })} />
          </Box>
        )}
      </Popover>
    </Box>
  );
}

function Bar(): ReactNode {
  return <Divider orientation="vertical" flexItem sx={{ mx: 0.35, my: 0.5, borderColor: v('border') }} />;
}

function ColorGrid({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
      {INK_COLORS.map(c => <Swatch key={c} color={c} active={value === c} onClick={() => onPick(c)} />)}
      <Box component="label" title="Custom colour" sx={{ width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', position: 'relative', overflow: 'hidden', border: `2px dashed ${v('borderStrong')}`, background: 'conic-gradient(#e57373,#ffd54f,#81c784,#64b5f6,#ba68c8,#e57373)' }}>
        <input type="color" defaultValue={value || '#6F8F6A'} onChange={e => onPick(e.target.value)} style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} aria-label="Custom colour" />
      </Box>
    </Box>
  );
}
