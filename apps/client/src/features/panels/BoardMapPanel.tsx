/** Accessible outline for navigating a spatial board without relying on pointer precision. */
import { useMemo, useState } from 'react';
import { Box, IconButton, TextField, Tooltip } from '@mui/material';
import { CenterFocusStrong, FilterList, MapOutlined } from '@mui/icons-material';
import { type Shape, ShapeKind } from '@crdt-canvas/engine';
import { SidePanel, Empty } from './SidePanel';
import { dataOf } from '../board/model';
import { v } from '../../theme/theme';

function labelFor(shape: Shape): string {
  const data: any = dataOf(shape);
  if (shape.kind === ShapeKind.Rect && data.frameTitle) return data.frameTitle;
  if (shape.kind === ShapeKind.Text || shape.kind === ShapeKind.Note) return String(data.text || 'Untitled text').replace(/\s+/g, ' ').trim();
  if (shape.kind === ShapeKind.Image) return 'Image';
  if (shape.kind === ShapeKind.Line) return data.arrowEnd ? 'Arrow' : 'Line';
  if (shape.kind === ShapeKind.Ellipse) return 'Ellipse';
  if (shape.kind === ShapeKind.Rect) return 'Rectangle';
  return 'Drawing';
}

function kindFor(shape: Shape): string {
  const data: any = dataOf(shape);
  return shape.kind === ShapeKind.Rect && data.frameTitle ? 'Frame' : shape.kind;
}

export function BoardMapPanel({ shapes, selectedIds, onFocus, onClose }: {
  shapes: Shape[];
  selectedIds: string[];
  onFocus: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [framesOnly, setFramesOnly] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const frames = useMemo(() => new Set(shapes.filter(s => s.kind === ShapeKind.Rect && !!dataOf(s).frameTitle).map(s => s.id)), [shapes]);
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return shapes
      .filter(s => !framesOnly || frames.has(s.id))
      .filter(s => !needle || `${labelFor(s)} ${kindFor(s)}`.toLocaleLowerCase().includes(needle))
      .slice()
      .sort((a, b) => Number(frames.has(b.id)) - Number(frames.has(a.id)) || b.updatedAt - a.updatedAt);
  }, [shapes, query, framesOnly, frames]);

  return (
    <SidePanel title="Board map" icon={<MapOutlined />} subtitle={`${shapes.length} object${shapes.length === 1 ? '' : 's'} · search and focus`} onClose={onClose}>
      <Box sx={{ p: 1.5, display: 'flex', gap: 0.8, borderBottom: `1px solid ${v('border')}` }}>
        <TextField size="small" fullWidth value={query} onChange={e => setQuery(e.target.value)} placeholder="Search board text and frames" slotProps={{ htmlInput: { 'aria-label': 'Search board objects' } }} />
        <Tooltip title={framesOnly ? 'Show every object' : 'Show frames only'}>
          <IconButton aria-pressed={framesOnly} aria-label={framesOnly ? 'Show every object' : 'Show frames only'} onClick={() => setFramesOnly(v => !v)} sx={{ border: `1px solid ${framesOnly ? v('primary') : v('border')}`, bgcolor: framesOnly ? v('primarySoft') : 'transparent' }}><FilterList fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      {!items.length && <Empty>{query ? 'No board objects match that search.' : 'This board is empty.'}</Empty>}
      <Box role="listbox" aria-label="Board objects">
        {items.map(shape => {
          const isFrame = frames.has(shape.id);
          const isSelected = selected.has(shape.id);
          const data = dataOf(shape);
          return (
            <Box key={shape.id} role="option" aria-selected={isSelected} component="button" onClick={() => onFocus([shape.id])}
              sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, textAlign: 'left', borderBottom: `1px solid ${v('border')}`, bgcolor: isSelected ? v('primarySoft') : 'transparent', '&:hover': { bgcolor: v('surface2') }, '&:focus-visible': { outline: `2px solid ${v('primary')}`, outlineOffset: -2 } }}>
              <Box sx={{ width: 8, height: 8, borderRadius: isFrame ? '2px' : '50%', bgcolor: isFrame ? v('accent') : v('primary'), flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ fontSize: 13, fontWeight: isFrame ? 800 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(shape) || 'Untitled object'}</Box>
                <Box sx={{ fontSize: 11, color: v('textFaint'), textTransform: 'capitalize' }}>{kindFor(shape)}{data.locked ? ' · locked' : ''}</Box>
              </Box>
              <CenterFocusStrong sx={{ fontSize: 17, color: v('textFaint') }} />
            </Box>
          );
        })}
      </Box>
    </SidePanel>
  );
}
