/**
 * Demo scenarios panel. The scripted demos are switched off (they were unreliable); the panel
 * stays as a minimisable explainer of the four research scenarios.
 */
import { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { ScienceOutlined, ExpandMore, ExpandLess } from '@mui/icons-material';
import { v } from '../../theme/theme';

const SCENARIOS = [
  { title: 'Union-bounding-box merge', text: 'Two people resize the same object at once — both resizes are kept as the union of the two boxes instead of one winning.' },
  { title: 'Intent ambiguity', text: 'Two people move the same object to very different places — the conflict is flagged with a score and resolve options.' },
  { title: 'Checkpoints', text: 'Each edit session saves a start and an end checkpoint you can view and revert to by vote.' },
  { title: 'Network partition', text: 'Go offline and keep drawing — edits are saved locally and merge automatically when peers reconnect.' },
];

export function DemoShowcaseBar() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('crdt-demo-panel') === 'open'; } catch { return false; }
  });
  const toggle = () => {
    setOpen(o => {
      try { localStorage.setItem('crdt-demo-panel', o ? 'closed' : 'open'); } catch { /* ignore */ }
      return !o;
    });
  };
  return (
    <Box sx={{ position: 'absolute', left: 74, bottom: 14, zIndex: 22, width: open ? 300 : 'auto', bgcolor: v('surface'), border: `1px solid ${v('border')}`, borderRadius: '12px', boxShadow: v('shadow'), overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, pl: 1.2, pr: 0.4, py: 0.3 }}>
        <ScienceOutlined sx={{ fontSize: 17, color: v('accent') }} />
        <Box sx={{ fontSize: 12, fontWeight: 700, flex: 1, color: v('textMuted') }}>Demo scenarios</Box>
        <Tooltip title={open ? 'Minimise' : 'Show'}>
          <IconButton size="small" onClick={toggle} aria-label={open ? 'Minimise demo scenarios' : 'Show demo scenarios'}>
            {open ? <ExpandMore fontSize="small" /> : <ExpandLess fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      {open && (
        <Box sx={{ px: 1.2, pb: 1.2 }}>
          {SCENARIOS.map(s => (
            <Box key={s.title} sx={{ py: 0.7, borderTop: `1px solid ${v('border')}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{s.title}</Box>
                <Box sx={{ fontSize: 10, fontWeight: 700, color: v('textFaint'), border: `1px solid ${v('border')}`, borderRadius: '6px', px: 0.6 }}>demo off</Box>
              </Box>
              <Box sx={{ fontSize: 11.5, color: v('textMuted'), lineHeight: 1.4 }}>{s.text}</Box>
            </Box>
          ))}
          <Box sx={{ fontSize: 10.5, color: v('textFaint'), pt: 0.5 }}>Try them for real with two devices on the same network.</Box>
        </Box>
      )}
    </Box>
  );
}
