import { useState } from 'react';
import { Box, Button, Divider, Typography } from '@mui/material';
import { ShapeKind, shapeBBox, type Shape, type ShapeData } from '@crdt-canvas/engine';
import { type Stencil, type StencilVersion } from './stencilStore';

interface StencilsPanelProps {
  stencils: Stencil[];
  selectedShapes: Shape[];
  loading: boolean;
  error: string | null;
  onSave: (name: string, shapes: Shape[]) => Promise<unknown>;
  onInsert: (stencil: Stencil, version: StencilVersion) => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function StencilsPanel({ stencils, selectedShapes, loading, error, onSave, onInsert, onDelete, onClose }: StencilsPanelProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || !selectedShapes.length || busy) return;
    setBusy(true);
    setLocalError(null);
    try { await onSave(name, selectedShapes); setName(''); }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : 'Could not save this stencil.'); }
    finally { setBusy(false); }
  };

  const remove = async (stencil: Stencil) => {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try { await onDelete(stencil.id); }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : 'Could not delete this stencil.'); }
    finally { setBusy(false); }
  };

  return <Box role="region" aria-label="Reusable stencil library" sx={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#e2e2f0', background: 'rgba(15,15,22,.98)' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1.25 }}>
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Reusable stencils</Typography>
        <Typography sx={{ mt: 0.25, color: '#85859b', fontSize: 9 }}>
          Saved on this device · {stencils.length}/50 items · up to 10 versions each
        </Typography>
      </Box>
      <Button size="small" onClick={onClose} aria-label="Close stencils panel">Close</Button>
    </Box>
    <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ color: '#c4b5fd', fontSize: 10, fontWeight: 700 }}>Save current selection · {selectedShapes.length} object{selectedShapes.length === 1 ? '' : 's'}</Typography>
      <input aria-label="Stencil name" maxLength={60} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} placeholder="e.g. Decision flow" style={{ boxSizing: 'border-box', width: '100%', padding: 8, borderRadius: 6, color: '#e2e2f0', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', fontSize: 11 }} />
      <Button variant="contained" size="small" disabled={!name.trim() || !selectedShapes.length || busy || (!stencils.some(s => s.name.toLowerCase() === name.trim().toLowerCase()) && stencils.length >= 50)} onClick={() => void save()}>
        {stencils.some(stencil => stencil.name.toLowerCase() === name.trim().toLowerCase()) ? 'Save new version' : 'Save stencil'}
      </Button>
      <Typography sx={{ color: '#73738a', fontSize: 9 }}>
        {stencils.length >= 50
          ? 'Capacity limit reached (50 stencils). Delete unused items before creating a new stencil name.'
          : 'Saving a stencil with an existing name adds a version. Each version is limited to 4 MB.'}
      </Typography>
    </Box>
    <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />
    {(error || localError) && <Typography role="alert" sx={{ px: 1.5, py: 1, color: '#fca5a5', fontSize: 10 }}>{localError || error}</Typography>}
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {loading && <Typography sx={{ color: '#85859b', fontSize: 10 }}>Loading stencils…</Typography>}
      {!loading && !stencils.length && <Typography sx={{ py: 3, textAlign: 'center', color: '#85859b', fontSize: 11 }}>No saved stencils yet. Select objects and save them here for reuse.</Typography>}
      {stencils.map(stencil => {
        const latest = stencil.versions.at(-1);
        if (!latest) return null;
        return <Box key={stencil.id} sx={{ p: 1, border: '1px solid rgba(255,255,255,.08)', borderRadius: 1.5, background: 'rgba(255,255,255,.025)' }}>
          <StencilPreview name={stencil.name} shapes={latest.shapes} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, mt: 0.75 }}>
            <Box sx={{ minWidth: 0 }}><Typography noWrap sx={{ fontSize: 11, fontWeight: 700 }}>{stencil.name}</Typography><Typography sx={{ color: '#85859b', fontSize: 9 }}>v{latest.version} · {latest.shapes.length} objects</Typography></Box>
            <Button size="small" variant="contained" onClick={() => onInsert(stencil, latest)} aria-label={`Insert ${stencil.name} version ${latest.version}`}>Insert</Button>
          </Box>
          <details style={{ marginTop: 5 }}>
            <summary style={{ cursor: 'pointer', color: '#9292a9', fontSize: 9 }}>Version history ({stencil.versions.length})</summary>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
              {stencil.versions.slice(0, -1).reverse().map(version => <Button key={version.version} size="small" variant="outlined" onClick={() => onInsert(stencil, version)} sx={{ minWidth: 0, px: 0.75, fontSize: 9 }}>Insert v{version.version}</Button>)}
              <Button size="small" color="error" onClick={() => void remove(stencil)} sx={{ minWidth: 0, px: 0.75, fontSize: 9 }}>Delete library item</Button>
            </Box>
          </details>
        </Box>;
      })}
    </Box>
  </Box>;
}

function StencilPreview({ name, shapes }: { name: string; shapes: Array<{ id: string; data: ShapeData }> }) {
  const boxes = shapes.map(({ id, data }) => ({ id, data, box: shapeBBox({ id, data } as Shape) }));
  const minX = Math.min(...boxes.map(item => item.box.minX));
  const minY = Math.min(...boxes.map(item => item.box.minY));
  const maxX = Math.max(...boxes.map(item => item.box.maxX));
  const maxY = Math.max(...boxes.map(item => item.box.maxY));
  const scale = Math.min(86 / Math.max(1, maxX - minX), 46 / Math.max(1, maxY - minY));
  const px = (x: number) => 7 + (x - minX) * scale;
  const py = (y: number) => 7 + (y - minY) * scale;
  return <svg role="img" aria-label={`Preview of ${name}`} viewBox="0 0 100 60" style={{ width: '100%', height: 60, borderRadius: 6, background: 'rgba(3,7,18,.8)' }}>
    {boxes.map(({ id, data, box }) => {
      const color = 'color' in data ? data.color : '#a78bfa';
      const x = px(box.minX), y = py(box.minY), width = Math.max(1, (box.maxX - box.minX) * scale), height = Math.max(1, (box.maxY - box.minY) * scale);
      if (data.kind === ShapeKind.Line) return <line key={id} x1={px(data.x1)} y1={py(data.y1)} x2={px(data.x2)} y2={py(data.y2)} stroke={color} strokeWidth="1.5" />;
      if (data.kind === ShapeKind.Stroke) return <polyline key={id} points={data.points.map(point => `${px(point.x)},${py(point.y)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />;
      if (data.kind === ShapeKind.Ellipse) return <ellipse key={id} cx={px(data.cx)} cy={py(data.cy)} rx={Math.max(1, data.rx * scale)} ry={Math.max(1, data.ry * scale)} fill={color} fillOpacity={data.fillOpacity ?? 0.2} stroke={color} strokeWidth="1" />;
      if (data.kind === ShapeKind.Note) return <g key={id}><rect x={x} y={y} width={width} height={height} rx="2" fill={data.bgColor} /><text x={x + 2} y={y + 8} fill={data.color} fontSize="5">{data.text.slice(0, 18)}</text></g>;
      if (data.kind === ShapeKind.Text) return <text key={id} x={x} y={y + 7} fill={color} fontSize="7">{data.text.slice(0, 20)}</text>;
      return <rect key={id} x={x} y={y} width={width} height={height} rx={data.kind === ShapeKind.Rect ? data.cornerRadius ?? 1 : 1} fill={data.kind === ShapeKind.Rect ? color : '#475569'} fillOpacity={data.kind === ShapeKind.Rect ? data.fillOpacity ?? 0.16 : 1} stroke={color} strokeWidth="1" />;
    })}
  </svg>;
}
