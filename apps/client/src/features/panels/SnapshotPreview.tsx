/** Small rendered picture of a board snapshot (checkpoints, conflict before / after). */
import { useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { type Shape } from '@crdt-canvas/engine';
import { renderToCanvas } from '../board/render';
import { type Bounds } from '../board/geometry';
import { type ThemeMode, v } from '../../theme/theme';

const sharedImages = new Map<string, HTMLImageElement>();

export function SnapshotPreview({ shapes, mode, focus, highlight, height = 150, label, onClick }: {
  shapes: Shape[] | null; mode: ThemeMode; focus?: Bounds | null; highlight?: Bounds | null; height?: number; label?: string; onClick?: () => void;
}) {
  const [tick, setTick] = useState(0);
  const url = useMemo(() => {
    if (!shapes) return null;
    try {
      const pad = focus ? Math.max(60, Math.max(focus.maxX - focus.minX, focus.maxY - focus.minY) * 0.6) : 30;
      const box = focus ? { minX: focus.minX - pad, minY: focus.minY - pad, maxX: focus.maxX + pad, maxY: focus.maxY + pad } : null;
      const c = renderToCanvas(shapes, { mode, maxWidth: 640, maxHeight: height * 2, padding: box ? 0 : 30, imageCache: sharedImages, onImageLoad: () => setTick(t => t + 1), focus: box, highlight });
      return c.toDataURL('image/png');
    } catch { return null; }
  }, [shapes, mode, focus, highlight, height, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { /* re-render once images decode */ }, [tick]);

  return (
    <Box onClick={onClick} sx={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${v('border')}`, bgcolor: v('canvasBg'), height, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: onClick ? 'zoom-in' : 'default' }}>
      {url ? <img src={url} alt={label ?? 'Board snapshot'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        : <Box sx={{ fontSize: 12, color: v('textFaint') }}>{shapes ? 'Empty board' : 'Snapshot not available'}</Box>}
      {label && <Box sx={{ position: 'absolute', left: 6, top: 6, px: 0.8, py: 0.1, borderRadius: '6px', bgcolor: v('surface'), border: `1px solid ${v('border')}`, fontSize: 10.5, fontWeight: 700, color: v('textMuted') }}>{label}</Box>}
    </Box>
  );
}
