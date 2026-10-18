/** Checkpoints: start / end of every person's edit session, viewable, revertible by vote. */
import { useMemo, useState } from 'react';
import * as Y from 'yjs';
import { Box, Button, Chip, Dialog } from '@mui/material';
import { Flag, History, HowToVote, Restore } from '@mui/icons-material';
import { SidePanel, Empty, clock, timeAgo } from './SidePanel';
import { SnapshotPreview } from './SnapshotPreview';
import { type Checkpoint, loadSnapshot } from '../board/useBoardLogs';
import { type Proposal } from '../room/roomTypes';
import { type ThemeMode, v } from '../../theme/theme';

const KIND: Record<Checkpoint['kind'], { label: string; color: string }> = {
  start: { label: 'Started editing', color: 'info' },
  end: { label: 'Finished editing', color: 'success' },
  merge: { label: 'Auto-merge', color: 'warning' },
  revert: { label: 'Reverted', color: 'danger' },
};

export function CheckpointsPanel({ doc, mode, checkpoints, proposals, votesNeeded, validVotes, myDeviceId, onProposeRevert, onVote, onClose, readOnly }: {
  doc: Y.Doc | null; mode: ThemeMode; checkpoints: Checkpoint[]; proposals: Proposal[];
  votesNeeded: (p: Proposal) => number; validVotes: (p: Proposal) => number; myDeviceId: string;
  onProposeRevert: (cp: Checkpoint) => void; onVote: (id: string) => void; onClose: () => void; readOnly?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(checkpoints[0]?.id ?? null);
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const openRevert = useMemo(() => {
    const m = new Map<string, Proposal>();
    proposals.forEach(p => { if (p.kind === 'revert' && p.status === 'open' && p.targets[0]) m.set(p.targets[0], p); });
    return m;
  }, [proposals]);

  return (
    <SidePanel title="Checkpoints" icon={<Flag />} subtitle="Saved at the start and end of every edit session" onClose={onClose}>
      {!checkpoints.length && <Empty>No checkpoints yet. One is saved when someone starts editing and another when they stop (after a minute idle or leaving).</Empty>}
      {checkpoints.map(cp => {
        const k = KIND[cp.kind];
        const isOpen = openId === cp.id;
        const prop = openRevert.get(cp.id);
        return (
          <Box key={cp.id} sx={{ mx: 1.5, my: 0.8, borderRadius: '12px', border: `1px solid ${isOpen ? v('primary') : v('border')}`, overflow: 'hidden' }}>
            <Box component="button" onClick={() => setOpenId(isOpen ? null : cp.id)} sx={{ width: '100%', textAlign: 'left', p: 1.2, display: 'flex', gap: 1, alignItems: 'center', '&:hover': { bgcolor: v('surface2') } }}>
              <History fontSize="small" sx={{ color: v('textFaint') }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ fontSize: 13, fontWeight: 700 }}>{cp.actor} <Box component="span" sx={{ fontWeight: 500, color: v('textMuted') }}>· {k.label}</Box></Box>
                <Box sx={{ fontSize: 11.5, color: v('textMuted') }} title={clock(cp.ts)}>{clock(cp.ts)} · {timeAgo(cp.ts)}</Box>
                {cp.note && <Box sx={{ fontSize: 11.5, color: v('textMuted'), mt: 0.2 }}>{cp.note}</Box>}
              </Box>
              {prop && <Chip size="small" icon={<HowToVote sx={{ fontSize: 14 }} />} label={`${validVotes(prop)}/${votesNeeded(prop)}`} sx={{ height: 22, fontSize: 11 }} />}
            </Box>
            {isOpen && (
              <Box sx={{ px: 1.2, pb: 1.2 }}>
                <CheckpointPreview doc={doc} mode={mode} snapshotKey={cp.snapshotKey} onZoom={() => setZoomKey(cp.snapshotKey)} />
                {!readOnly && (
                  <Box sx={{ display: 'flex', gap: 0.8, mt: 1, alignItems: 'center' }}>
                    {prop ? (
                      prop.votes[myDeviceId]
                        ? <Box sx={{ fontSize: 12, color: v('textMuted') }}>You voted to revert · {validVotes(prop)} of {votesNeeded(prop)} needed</Box>
                        : <Button size="small" variant="contained" startIcon={<HowToVote fontSize="small" />} onClick={() => onVote(prop.id)}>Vote to revert ({validVotes(prop)}/{votesNeeded(prop)})</Button>
                    ) : (
                      <Button size="small" variant="outlined" color="warning" startIcon={<Restore fontSize="small" />} onClick={() => onProposeRevert(cp)}>Revert to here…</Button>
                    )}
                  </Box>
                )}
                {!readOnly && !prop && <Box sx={{ fontSize: 11, color: v('textFaint'), mt: 0.6 }}>Reverting needs more than half of the room to agree.</Box>}
              </Box>
            )}
          </Box>
        );
      })}
      <Dialog open={!!zoomKey} onClose={() => setZoomKey(null)} maxWidth="lg" fullWidth>
        {zoomKey && <Box sx={{ p: 1 }}><CheckpointPreview doc={doc} mode={mode} snapshotKey={zoomKey} height={560} /></Box>}
      </Dialog>
    </SidePanel>
  );
}

function CheckpointPreview({ doc, mode, snapshotKey, height = 170, onZoom }: { doc: Y.Doc | null; mode: ThemeMode; snapshotKey: string; height?: number; onZoom?: () => void }) {
  const shapes = useMemo(() => loadSnapshot(doc, snapshotKey), [doc, snapshotKey]);
  return <SnapshotPreview shapes={shapes} mode={mode} height={height} onClick={onZoom} />;
}
