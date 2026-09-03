import { Box, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

interface ConnectionBannerProps {
  state: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'offline';
  peerCount: number;
  queuedOps: number;
  onReconnect?: () => void;
}

export function ConnectionBanner({ state, peerCount, queuedOps, onReconnect }: ConnectionBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Hide banner when fully connected with peers
    if (state === 'connected' && peerCount > 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
  }, [state, peerCount]);

  const getConfig = () => {
    switch (state) {
      case 'disconnected':
        return { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.3)', icon: '⚠', label: 'Disconnected', sublabel: 'Signaling server unreachable' };
      case 'connecting':
        return { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)', icon: '⟳', label: 'Connecting', sublabel: 'Establishing WebRTC link…' };
      case 'connected':
        return { color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', icon: '✓', label: 'Connected', sublabel: `${peerCount} peer${peerCount !== 1 ? 's' : ''} online` };
      case 'syncing':
        return { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.3)', icon: '⇄', label: 'Syncing', sublabel: 'Synchronizing changes…' };
      case 'offline':
        return { color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.3)', icon: '✏', label: 'Offline Mode', sublabel: queuedOps > 0 ? `${queuedOps} edit${queuedOps !== 1 ? 's' : ''} queued locally` : 'Edits queued locally' };
    }
  };

  const cfg = getConfig();

  if (!visible) return null;

  return (
    <Box sx={{
      position: 'absolute',
      top: 68,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '7px 16px',
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 2,
      backdropFilter: 'blur(16px)',
      zIndex: 100,
      minWidth: 200,
      maxWidth: 360,
      animation: 'fadeIn 0.2s ease',
    }}>
      <Typography sx={{
        fontSize: 16,
        flexShrink: 0,
        ...(state === 'connecting' || state === 'syncing' ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
      }}>
        {cfg.icon}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: cfg.color, lineHeight: 1.2 }}>
          {cfg.label}
        </Typography>
        <Typography sx={{ fontSize: 10, color: '#8888a8', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cfg.sublabel}
        </Typography>
      </Box>
      {onReconnect && (state === 'disconnected' || state === 'connecting') && (
        <button
          onClick={onReconnect}
          style={{
            padding: '3px 10px',
            fontSize: 11,
            background: `${cfg.color}22`,
            border: `1px solid ${cfg.border}`,
            borderRadius: 4,
            color: cfg.color,
            cursor: 'pointer',
            flexShrink: 0,
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
          }}
        >
          Retry
        </button>
      )}
    </Box>
  );
}
