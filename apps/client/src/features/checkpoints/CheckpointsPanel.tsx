import { useState } from 'react';
import { Box, Button, Divider, Typography } from '@mui/material';
import { type BoardCheckpoint } from './useBoardCheckpoints';

export function CheckpointsPanel({
  checkpoints, onCreate, onRestore, onDelete, onClose,
}: {
  checkpoints: BoardCheckpoint[];
  onCreate: (name: string) => string | null;
  onRestore: (checkpoint: BoardCheckpoint) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const save = () => {
    const result = onCreate(name);
    if (result) setError(result);
    else { setName(''); setError(''); }
  };
  return <Box role="region" aria-label="Board checkpoints" sx={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#e2e2f0' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1.25 }}>
      <Box><Typography sx={{ fontSize: 13, fontWeight: 700 }}>Checkpoints</Typography><Typography sx={{ color: '#85859b', fontSize: 9 }}>Shared with this board · up to 8 · 2 MB each</Typography></Box>
      <Button size="small" onClick={onClose} aria-label="Close checkpoints">Close</Button>
    </Box>
    <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <label style={{ color: '#9898ae', fontSize: 10 }}>Checkpoint name
        <input value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') save(); }} placeholder="Before workshop edits" style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, color: '#e2e2f0', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', fontSize: 11 }} />
      </label>
      <Button variant="contained" size="small" onClick={save}>Save checkpoint</Button>
      {error && <Typography role="alert" sx={{ color: '#fca5a5', fontSize: 10 }}>{error}</Typography>}
    </Box>
    <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />
    <Box sx={{ p: 1.25, overflowY: 'auto', flex: 1 }}>
      {!checkpoints.length && <Typography sx={{ color: '#85859b', fontSize: 11, textAlign: 'center', py: 3 }}>No checkpoints yet.</Typography>}
      {checkpoints.slice().reverse().map(checkpoint => <Box key={checkpoint.id} sx={{ p: 1, mb: 0.75, borderRadius: 1, border: '1px solid rgba(255,255,255,.07)', bgcolor: 'rgba(255,255,255,.025)' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, overflowWrap: 'anywhere' }}>{checkpoint.name}</Typography>
        <Typography sx={{ color: '#85859b', fontSize: 9, my: 0.5 }}>{checkpoint.actor} · {checkpoint.shapes.length} objects · {new Date(checkpoint.createdAt).toLocaleString()}</Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Button size="small" onClick={() => onRestore(checkpoint)} aria-label={`Restore ${checkpoint.name} as a copy`} sx={{ fontSize: 9, textTransform: 'none' }}>Restore as copy</Button>
          <Button size="small" onClick={() => onDelete(checkpoint.id)} aria-label={`Delete checkpoint ${checkpoint.name}`} sx={{ fontSize: 9, color: '#fca5a5', textTransform: 'none' }}>Delete</Button>
        </Box>
      </Box>)}
    </Box>
    <Typography sx={{ px: 1.5, pb: 1.25, color: '#77778f', fontSize: 9 }}>Restoring adds editable copies to this board; the checkpoint stays unchanged.</Typography>
  </Box>;
}
