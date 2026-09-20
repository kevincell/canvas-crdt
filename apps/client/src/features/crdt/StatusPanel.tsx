import { Box, Typography, Avatar, Badge, Divider } from '@mui/material';
import { Wifi, Person } from '@mui/icons-material';

interface StatusPanelProps {
  connected: boolean;
  peerCount: number;
  shapeCount: number;
  conflictCount: number;
  historyStep: number;
  totalHistorySteps: number;
  roomId: string;
  localIP: string;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'offline';
  queuedOps: number;
}

export function StatusPanel({
  connected, peerCount, shapeCount, conflictCount,
  historyStep, totalHistorySteps, roomId, localIP,
  connectionState, queuedOps,
}: StatusPanelProps) {
  return (
    <Box sx={{
      position: 'absolute',
      bottom: 16,
      right: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      zIndex: 100,
    }}>
      {/* Connection status */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'rgba(30, 30, 46, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 2,
        backdropFilter: 'blur(12px)',
        fontSize: 12,
      }}>
        <Badge
          overlap="circular"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          badgeContent={
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%',
              background: connectionState === 'connected' ? '#6ee7b7'
                : connectionState === 'syncing' ? '#fcd34d'
                : connectionState === 'connecting' ? '#93c5fd'
                : connectionState === 'offline' ? '#fdba74'
                : '#fca5a5',
              boxShadow: `0 0 8px ${connectionState === 'connected' ? '#6ee7b7' : connectionState === 'syncing' ? '#fcd34d' : '#fca5a5'}`,
              animation: (connectionState === 'syncing' || connectionState === 'connecting') ? 'pulse 1.2s ease-in-out infinite' : 'none',
            }} />
          }
        >
          <Wifi sx={{ fontSize: 14, color: '#8888a8' }} />
        </Badge>
        <Typography sx={{ color: '#8888a8' }}>
          {connectionState === 'offline' && '✏️ Offline — edits queued'}
          {connectionState === 'connecting' && '🔄 Connecting to signaling…'}
          {connectionState === 'syncing' && '📡 Syncing…'}
          {connectionState === 'connected' && peerCount > 0 && `${peerCount} peer${peerCount !== 1 ? 's' : ''} connected via WebRTC`}
          {connectionState === 'connected' && peerCount === 0 && '✓ Signaling connected — waiting for peers'}
          {connectionState === 'disconnected' && '✗ Disconnected from signaling'}
        </Typography>
        {roomId && (
          <Typography sx={{ color: '#555570', fontSize: 10 }}>
            Room: <span style={{ color: '#a78bfa', fontFamily: 'monospace' }}>{roomId}</span>
          </Typography>
        )}
      </Box>

      {/* Local IP hint */}
      {localIP && (
        <Box sx={{
          padding: '4px 10px',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: 1,
          fontSize: 11,
          color: '#93c5fd',
        }}>
          LAN IP: <code style={{ fontFamily: 'monospace' }}>{localIP}</code>
        </Box>
      )}

      {/* Stats row */}
      <Box sx={{ display: 'flex', gap: 6 }}>
        <Box sx={{
          padding: '4px 10px',
          background: 'rgba(30, 30, 46, 0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 1,
          fontSize: 11,
          color: '#8888a8',
        }}>
          {shapeCount} shapes
        </Box>
        {conflictCount > 0 && (
          <Box sx={{
            padding: '4px 10px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 1,
            fontSize: 11,
            color: '#fca5a5',
          }}>
            {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
          </Box>
        )}
        {historyStep > 0 && (
          <Box sx={{
            padding: '4px 10px',
            background: 'rgba(124, 58, 237, 0.15)',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            borderRadius: 1,
            fontSize: 11,
            color: '#c4b5fd',
          }}>
            History: {historyStep}/{totalHistorySteps}
          </Box>
        )}
        {queuedOps > 0 && (
          <Box sx={{
            padding: '4px 10px',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 1,
            fontSize: 11,
            color: '#fcd34d',
          }}>
            {queuedOps} queued
          </Box>
        )}
      </Box>
    </Box>
  );
}
