/**
 * Left-hand tool rail + a small options strip for the active tool.
 */
import { useEffect, type ReactNode } from 'react';
import { Box, Slider, Divider, MenuItem, Select } from '@mui/material';
import {
  PanToolOutlined, EditOutlined, CropSquare, RadioButtonUnchecked, TextFields, ImageOutlined,
  FormatColorFill, DeleteOutlineOutlined as DeleteOutline, Undo, Redo,
} from '@mui/icons-material';
import { type ToolId, type ToolStyle, type EraserSize, FONT_FAMILIES, type FontFamily } from './model';
import { ToolButton, Swatch, DashPreview, DASH_OPTIONS, Segmented, Label, panelSx, EraserIcon, LaserIcon, CursorIcon, LineIcon } from './ui';
import { INK_COLORS, v } from '../../theme/theme';

export const TOOLS: Array<{ id: ToolId; label: string; key: string; icon: ReactNode; about: string }> = [
  { id: 'select', label: 'Select', key: 'V', icon: <CursorIcon />, about: 'Click one object to select it; drag to move, drag the round handles to resize. Shift-click adds more. Drag empty space to pan.' },
  { id: 'box', label: 'Hand (box select)', key: 'H', icon: <PanToolOutlined fontSize="small" />, about: 'Drag a blue box over objects to select them all. Drag inside the box to move the group, drag its corners to resize.' },
  { id: 'pen', label: 'Pen', key: 'P', icon: <EditOutlined fontSize="small" />, about: 'Freehand drawing. Close a shape (end near the start) and the Fill tool can colour it.' },
  { id: 'line', label: 'Line / arrow', key: 'L', icon: <LineIcon />, about: 'Straight line. Choose no arrow, an arrow at the end, or both ends. Lines that start or end on a shape stay attached to it.' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: <CropSquare fontSize="small" />, about: 'Drag to draw a rectangle. Hold Shift for a square. Corners can be pointed or rounded.' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: <RadioButtonUnchecked fontSize="small" />, about: 'Drag to draw an ellipse. Hold Shift for a circle.' },
  { id: 'text', label: 'Text box', key: 'T', icon: <TextFields fontSize="small" />, about: 'Click, or drag a box, then type. Double-click a text box to edit it. Arial or Times New Roman.' },
  { id: 'image', label: 'Image', key: 'I', icon: <ImageOutlined fontSize="small" />, about: 'Click where the picture should go, then choose a file. You can also drop or paste images.' },
  { id: 'fill', label: 'Fill', key: 'F', icon: <FormatColorFill fontSize="small" />, about: 'Click inside a closed shape (rectangle, ellipse, text box or closed pen shape) to fill it with the current colour.' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: <EraserIcon />, about: 'Rubs out parts of pen strokes, like a pencil eraser. Sizes S, M and L.' },
  { id: 'delete', label: 'Delete', key: 'D', icon: <DeleteOutline fontSize="small" />, about: 'Click an object to delete the whole thing. Locked objects need a vote.' },
  { id: 'laser', label: 'Laser pointer', key: 'K', icon: <LaserIcon />, about: 'Point at things for everyone. Leaves a short glowing tail in your pointer colour; nothing is saved.' },
];

const STYLE_TOOLS: ToolId[] = ['pen', 'line', 'rect', 'ellipse', 'text', 'fill'];

export function BoardToolbar({
  tool, setTool, style, setStyle, eraserSize, setEraserSize, onUndo, onRedo, canUndo, canRedo, laserColor,
}: {
  tool: ToolId; setTool: (t: ToolId) => void;
  style: ToolStyle; setStyle: (patch: Partial<ToolStyle>) => void;
  eraserSize: EraserSize; setEraserSize: (s: EraserSize) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  laserColor: string;
}) {
  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) { setTool(t.id); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

  const showStyle = STYLE_TOOLS.includes(tool);

  return (
    <Box sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 1, alignItems: 'flex-start', zIndex: 25, maxHeight: 'calc(100% - 24px)' }}>
      <Box sx={{ ...panelSx, p: 0.6, display: 'flex', flexDirection: 'column', gap: 0.35, overflowY: 'auto' }} role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
        {TOOLS.map(t => (
          <ToolButton key={t.id} title={t.label} shortcut={t.key} active={tool === t.id} onClick={() => setTool(t.id)}>
            {t.id === 'laser' ? <Box sx={{ color: tool === 'laser' ? laserColor : 'inherit', display: 'flex' }}>{t.icon}</Box> : t.icon}
          </ToolButton>
        ))}
        <Divider sx={{ my: 0.4, borderColor: v('border') }} />
        <ToolButton title="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo}><Undo fontSize="small" /></ToolButton>
        <ToolButton title="Redo" shortcut="Ctrl+Y" disabled={!canRedo} onClick={onRedo}><Redo fontSize="small" /></ToolButton>
      </Box>

      {(showStyle || tool === 'eraser') && (
        <Box sx={{ ...panelSx, p: 1.25, width: 214, display: 'flex', flexDirection: 'column', gap: 1.1, animation: 'fadeIn .15s ease' }}>
          {tool === 'eraser' ? (
            <>
              <Label>Eraser size</Label>
              <Segmented value={eraserSize} onChange={setEraserSize} options={[
                { id: 'S', label: 'S', title: 'Small' }, { id: 'M', label: 'M', title: 'Medium' }, { id: 'L', label: 'L', title: 'Large' },
              ]} />
              <Box sx={{ fontSize: 11.5, color: v('textMuted') }}>Rubs out parts of pen strokes. Use Delete to remove whole objects.</Box>
            </>
          ) : (
            <>
              <Label>{tool === 'fill' ? 'Fill colour' : 'Colour'}</Label>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.7 }}>
                {INK_COLORS.map(c => <Swatch key={c} color={c} active={style.color === c} onClick={() => setStyle({ color: c })} />)}
                <Box component="label" title="Custom colour" sx={{ width: 22, height: 22, borderRadius: '50%', border: `2px dashed ${v('borderStrong')}`, cursor: 'pointer', position: 'relative', overflow: 'hidden', background: 'conic-gradient(#e57373,#ffd54f,#81c784,#64b5f6,#ba68c8,#e57373)' }}>
                  <input type="color" value={style.color} onChange={e => setStyle({ color: e.target.value })} style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} aria-label="Custom colour" />
                </Box>
              </Box>

              {tool !== 'fill' && tool !== 'text' && (
                <>
                  <Label>Thickness · {style.width}px</Label>
                  <Slider size="small" min={1} max={24} step={1} value={style.width} onChange={(_, val) => setStyle({ width: val as number })} />
                  <Label>Line style</Label>
                  <Segmented size="sm" value={style.dash} onChange={d => setStyle({ dash: d })}
                    options={DASH_OPTIONS.map(d => ({ id: d.id, label: <DashPreview dash={d.id} width={2} />, title: d.label }))} />
                </>
              )}

              {tool === 'line' && (
                <>
                  <Label>Arrow</Label>
                  <Segmented size="sm" value={style.arrow} onChange={a => setStyle({ arrow: a })} options={[
                    { id: 'none', label: '—', title: 'No arrow' }, { id: 'end', label: '→', title: 'Arrow at end' }, { id: 'both', label: '↔', title: 'Arrows at both ends' },
                  ]} />
                </>
              )}

              {tool === 'text' && (
                <>
                  <Label>Font</Label>
                  <Select size="small" value={style.fontFamily} onChange={e => setStyle({ fontFamily: e.target.value as FontFamily })} sx={{ fontSize: 13 }}>
                    {FONT_FAMILIES.map(f => <MenuItem key={f} value={f} sx={{ fontFamily: f }}>{f}</MenuItem>)}
                  </Select>
                  <Label>Size · {style.fontSize}px</Label>
                  <Slider size="small" min={10} max={72} step={1} value={style.fontSize} onChange={(_, val) => setStyle({ fontSize: val as number })} />
                </>
              )}

              {tool !== 'fill' && (
                <>
                  <Label>Opacity · {Math.round(style.opacity * 100)}%</Label>
                  <Slider size="small" min={0.1} max={1} step={0.05} value={style.opacity} onChange={(_, val) => setStyle({ opacity: val as number })} />
                </>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
