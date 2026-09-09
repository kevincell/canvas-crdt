import React from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import { SingleCanvasView } from './SingleCanvasView';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import { sound } from '../utils/audio';

interface DualPeerContainerProps {
  roomId: string;
  onExitDual: () => void;
}

export function DualPeerContainer({ roomId, onExitDual }: DualPeerContainerProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    sound.playClick();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#090a0f',
      overflow: 'hidden',
    }}>
      {/* Top Presenter Bar */}
      <Box sx={{
        height: 44,
        background: 'rgba(15, 16, 26, 0.98)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        zIndex: 60,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{
            fontSize: 14,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #c4b5fd 0%, #7c3aed 50%, #38bdf8 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-0.02em',
            fontFamily: 'Outfit, sans-serif',
          }}>
            ✦ Dual-Peer Presenter Mode
          </Typography>
          <Chip
            icon={<SyncAltIcon sx={{ fontSize: '12px !important', color: '#34d399' }} />}
            label="Real-time WebRTC + Yjs CRDT Synchronization Active"
            size="small"
            sx={{
              height: 22,
              fontSize: 10.5,
              fontWeight: 600,
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#6ee7b7',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            size="small"
            onClick={handleCopy}
            startIcon={<ContentCopyIcon sx={{ fontSize: 13 }} />}
            sx={{
              fontSize: 11,
              color: '#c4b5fd',
              background: 'rgba(124, 58, 237, 0.12)',
              border: '1px solid rgba(124, 58, 237, 0.3)',
              borderRadius: '6px',
              textTransform: 'none',
              px: 1.25,
              py: 0.25,
              '&:hover': { background: 'rgba(124, 58, 237, 0.22)' },
            }}
          >
            {copied ? 'Copied Room ID!' : `Room: ${roomId}`}
          </Button>

          <Button
            size="small"
            onClick={onExitDual}
            sx={{
              fontSize: 11,
              fontWeight: 600,
              color: '#e2e2f0',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: '6px',
              textTransform: 'none',
              px: 1.5,
              py: 0.25,
              '&:hover': { background: 'rgba(255, 255, 255, 0.15)' },
            }}
          >
            Exit Dual View
          </Button>
        </Box>
      </Box>

      {/* Split views */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Peer 1: Alice */}
        <Box sx={{
          flex: 1,
          height: '100%',
          position: 'relative',
          borderRight: '2px solid rgba(124, 58, 237, 0.35)',
        }}>
          <SingleCanvasView
            actorName="Alice"
            roomId={roomId}
            initialColor="#7c3aed"
            isCompact={true}
            onToggleSplitScreen={onExitDual}
            isSplitScreen={true}
            hideShowcase={false}
          />
        </Box>

        {/* Peer 2: Bob */}
        <Box sx={{
          flex: 1,
          height: '100%',
          position: 'relative',
        }}>
          <SingleCanvasView
            actorName="Bob"
            roomId={roomId}
            initialColor="#0284c7"
            isCompact={true}
            onToggleSplitScreen={onExitDual}
            isSplitScreen={true}
            hideShowcase={true}
          />
        </Box>
      </Box>
    </Box>
  );
}
