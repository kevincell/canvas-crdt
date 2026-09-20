import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ReplayIcon from '@mui/icons-material/Replay';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import HistoryIcon from '@mui/icons-material/History';

export type MergeLensScenario = 'union' | 'ambiguity' | 'history' | 'partition';

const SCENARIOS: Record<MergeLensScenario, {
  title: string;
  eyebrow: string;
  peerA: string;
  peerB: string;
  outcome: string;
  detail: string;
  accent: string;
  softAccent: string;
  icon: typeof AutoAwesomeIcon;
}> = {
  union: {
    title: 'Both resize intents survive',
    eyebrow: 'Semantic merge rule',
    peerA: 'Alice expands →',
    peerB: 'Bob expands ← ↓',
    outcome: 'Union bounding box',
    detail: 'Instead of choosing a winner, the result encloses every concurrent resize.',
    accent: '#38bdf8',
    softAccent: 'rgba(56, 189, 248, 0.13)',
    icon: AutoAwesomeIcon,
  },
  ambiguity: {
    title: 'Converged does not always mean clear',
    eyebrow: 'Intent ambiguity detection',
    peerA: 'Alice moves ↖',
    peerB: 'Bob moves ↘',
    outcome: 'Flagged for review',
    detail: 'Every peer independently sees the same high-distance intent mismatch—no central referee required.',
    accent: '#f59e0b',
    softAccent: 'rgba(245, 158, 11, 0.13)',
    icon: WarningAmberIcon,
  },
  history: {
    title: 'Every merge has an inspectable trail',
    eyebrow: 'Transparent merge history',
    peerA: 'Create',
    peerB: 'Edit',
    outcome: 'Replayable timeline',
    detail: 'Step through the shared sequence to understand how the canvas reached its current state.',
    accent: '#a78bfa',
    softAccent: 'rgba(167, 139, 250, 0.13)',
    icon: HistoryIcon,
  },
  partition: {
    title: 'Offline work remains part of the story',
    eyebrow: 'Offline-first reconciliation',
    peerA: 'Alice edits offline',
    peerB: 'Bob keeps working',
    outcome: 'Reconnect & converge',
    detail: 'Local changes queue safely, then merge automatically when the peer-to-peer link returns.',
    accent: '#34d399',
    softAccent: 'rgba(52, 211, 153, 0.13)',
    icon: CloudDoneIcon,
  },
};

export function MergeLens({
  scenario,
  compact = false,
  onClose,
}: {
  scenario: MergeLensScenario;
  compact?: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const data = SCENARIOS[scenario];
  const ScenarioIcon = data.icon;

  useEffect(() => {
    setStep(0);
    const timers = [
      window.setTimeout(() => setStep(1), 650),
      window.setTimeout(() => setStep(2), 1450),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [scenario]);

  const replay = () => {
    setStep(0);
    window.setTimeout(() => setStep(1), 650);
    window.setTimeout(() => setStep(2), 1450);
  };

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        left: compact ? 12 : 18,
        bottom: compact ? 12 : 16,
        width: compact ? 300 : 356,
        maxWidth: 'calc(100% - 24px)',
        zIndex: 45,
        overflow: 'hidden',
        background: 'rgba(14, 16, 27, 0.94)',
        border: `1px solid ${data.accent}66`,
        borderRadius: 3,
        boxShadow: `0 16px 46px rgba(0,0,0,0.48), 0 0 26px ${data.accent}1f`,
        backdropFilter: 'blur(20px)',
        animation: 'popIn 0.22s ease-out',
      }}
    >
      <Box sx={{ p: 1.5, pb: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.25 }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 1.5, background: data.softAccent, color: data.accent, flexShrink: 0 }}>
            <ScenarioIcon sx={{ fontSize: 17 }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ color: data.accent, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase' }}>
              {data.eyebrow}
            </Typography>
            <Typography sx={{ color: '#f5f3ff', fontSize: 13, fontWeight: 700, lineHeight: 1.25, mt: 0.15 }}>
              {data.title}
            </Typography>
          </Box>
          <IconButton aria-label="Close merge lens" size="small" onClick={onClose} sx={{ color: '#8c8ca7', p: 0.25, mt: -0.25 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr', alignItems: 'center', gap: 0.5 }}>
          {[data.peerA, data.peerB].map((intent, index) => (
            <Box key={intent} sx={{ opacity: step >= 1 ? 1 : 0.35, transform: step >= 1 ? 'translateY(0)' : `translateY(${index === 0 ? '-5px' : '5px'})`, transition: 'opacity 0.35s ease, transform 0.35s ease', p: 0.85, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, textAlign: 'center' }}>
              <Typography sx={{ color: index === 0 ? '#c4b5fd' : '#7dd3fc', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Peer {index === 0 ? 'A' : 'B'}
              </Typography>
              <Typography sx={{ color: '#e6e4f1', fontSize: 10.5, fontWeight: 600, mt: 0.2, whiteSpace: 'nowrap' }}>{intent}</Typography>
            </Box>
          )).reduce<ReactNode[]>((nodes, node, index) => {
            if (index) nodes.push(<SyncAltIcon key={`sync-${index}`} sx={{ color: step >= 1 ? data.accent : '#55556d', fontSize: 19, justifySelf: 'center', transition: 'color 0.35s ease' }} />);
            nodes.push(node);
            return nodes;
          }, [])}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.1, p: 0.9, borderRadius: 1.5, background: data.softAccent, opacity: step >= 2 ? 1 : 0.32, transform: step >= 2 ? 'scale(1)' : 'scale(0.97)', transition: 'opacity 0.4s ease, transform 0.4s ease' }}>
          <AutoAwesomeIcon sx={{ fontSize: 16, color: data.accent }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: data.accent, fontSize: 10.5, fontWeight: 800 }}>{data.outcome}</Typography>
            <Typography sx={{ color: '#c7c5d8', fontSize: 10.5, lineHeight: 1.3, mt: 0.1 }}>{data.detail}</Typography>
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1.5, py: 0.65, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)' }}>
        <Typography sx={{ color: '#8f8da4', fontSize: 9.5 }}>Peer intents → deterministic outcome</Typography>
        <Button size="small" startIcon={<ReplayIcon sx={{ fontSize: '13px !important' }} />} onClick={replay} sx={{ color: data.accent, minWidth: 0, px: 0.5, py: 0.1, fontSize: 10, fontWeight: 700, textTransform: 'none' }}>
          Replay
        </Button>
      </Box>
    </Box>
  );
}
