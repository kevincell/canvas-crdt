import React, { useState } from 'react';
import { Box, Typography, Button, IconButton, Chip, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AspectRatioIcon from '@mui/icons-material/AspectRatio';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { sound } from '../../utils/audio';

interface DemoShowcaseBarProps {
  onRunUnionBoxDemo: () => void;
  onRunAmbiguityDemo: () => void;
  onRunHistoryDemo: () => void;
  onRunPartitionDemo: () => void;
  onToggleSplitScreen?: () => void;
  isSplitScreen?: boolean;
}

export function DemoShowcaseBar({
  onRunUnionBoxDemo,
  onRunAmbiguityDemo,
  onRunHistoryDemo,
  onRunPartitionDemo,
  onToggleSplitScreen,
  isSplitScreen,
}: DemoShowcaseBarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeCallout, setActiveCallout] = useState<{
    title: string;
    desc: string;
    type: 'union' | 'ambiguity' | 'history' | 'partition';
  } | null>(null);

  const handleUnionBox = () => {
    sound.playPop();
    setActiveCallout({
      title: 'Union-Bounding-Box Merge Rule Triggered',
      desc: 'Simulating concurrent resizes from Peer A (rightward) and Peer B (leftward). The CRDT merges both bounding boxes [A ∪ B] without picking a destructive single winner.',
      type: 'union',
    });
    onRunUnionBoxDemo();
    setTimeout(() => setActiveCallout(null), 7000);
  };

  const handleAmbiguity = () => {
    sound.playConflict();
    setActiveCallout({
      title: 'Intent Ambiguity Conflict Detected',
      desc: 'Simulated concurrent moves to opposing canvas quadrants. The Conflict Panel is now open with ambiguity score and compromise resolution.',
      type: 'ambiguity',
    });
    onRunAmbiguityDemo();
    setTimeout(() => setActiveCallout(null), 7000);
  };

  const handleHistory = () => {
    sound.playSuccess();
    setActiveCallout({
      title: 'Merge-History Playback Active',
      desc: 'Scrubbing forward and backward through the CRDT change history vector log.',
      type: 'history',
    });
    onRunHistoryDemo();
    setTimeout(() => setActiveCallout(null), 7000);
  };

  const handlePartition = () => {
    sound.playPop();
    setActiveCallout({
      title: 'Network Partition Simulated',
      desc: 'WebRTC disconnected. Local edits queue safely in offline buffer; peers will converge automatically upon reconnection.',
      type: 'partition',
    });
    onRunPartitionDemo();
    setTimeout(() => setActiveCallout(null), 7000);
  };

  if (!isOpen) {
    return (
      <Box sx={{
        position: 'absolute',
        top: 64,
        right: 18,
        zIndex: 50,
      }}>
        <Button
          size="small"
          onClick={() => { sound.playClick(); setIsOpen(true); }}
          startIcon={<AutoAwesomeIcon sx={{ color: '#a78bfa', fontSize: 16 }} />}
          sx={{
            background: 'rgba(26, 26, 38, 0.88)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(167, 139, 250, 0.3)',
            borderRadius: '20px',
            color: '#e2e2f0',
            textTransform: 'none',
            fontSize: 12,
            fontWeight: 600,
            px: 2,
            py: 0.5,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            '&:hover': {
              background: 'rgba(38, 38, 54, 0.95)',
              borderColor: 'rgba(167, 139, 250, 0.6)',
            }
          }}
        >
          ✨ Demo Showcase
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{
      position: 'absolute',
      top: 64,
      right: 18,
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 1.5,
      maxWidth: 440,
    }}>
      {/* Main showcase controller */}
      <Box sx={{
        background: 'rgba(18, 19, 29, 0.88)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 3,
        p: 1.5,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        animation: 'fadeIn 0.2s ease',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#a78bfa', fontSize: 18 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#f3f3fd', letterSpacing: '-0.01em' }}>
              Feature Showcase
            </Typography>
            <Chip
              label="Interactive 1-Click"
              size="small"
              sx={{
                height: 18,
                fontSize: 10,
                fontWeight: 600,
                background: 'rgba(124, 58, 237, 0.25)',
                color: '#c4b5fd',
                border: '1px solid rgba(124, 58, 237, 0.4)',
              }}
            />
          </Box>
          <IconButton size="small" onClick={() => setIsOpen(false)} sx={{ color: '#8888a8', p: 0.5 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        <Typography sx={{ fontSize: 11, color: '#9090b2', mb: 1.5, lineHeight: 1.4 }}>
          Click any feature below to run an instant live demonstration:
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Tooltip title="Spawns rectangle and executes simultaneous dual-peer edge resize merging via bounding-box union">
            <Button
              size="small"
              onClick={handleUnionBox}
              startIcon={<AspectRatioIcon sx={{ fontSize: 15, color: '#38bdf8' }} />}
              sx={{
                justifyContent: 'flex-start',
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: 2,
                color: '#e0f2fe',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                py: 0.75,
                px: 1.25,
                '&:hover': {
                  background: 'rgba(56, 189, 248, 0.18)',
                  borderColor: 'rgba(56, 189, 248, 0.5)',
                },
              }}
            >
              Union Bounding Box
            </Button>
          </Tooltip>

          <Tooltip title="Simulates conflicting peer movements and opens the Conflict Resolution panel">
            <Button
              size="small"
              onClick={handleAmbiguity}
              startIcon={<WarningAmberIcon sx={{ fontSize: 15, color: '#f59e0b' }} />}
              sx={{
                justifyContent: 'flex-start',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: 2,
                color: '#fef3c7',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                py: 0.75,
                px: 1.25,
                '&:hover': {
                  background: 'rgba(245, 158, 11, 0.18)',
                  borderColor: 'rgba(245, 158, 11, 0.5)',
                },
              }}
            >
              Intent Ambiguity
            </Button>
          </Tooltip>

          <Tooltip title="Generates collaborative edits and scrubs through the merge timeline">
            <Button
              size="small"
              onClick={handleHistory}
              startIcon={<PlayArrowIcon sx={{ fontSize: 15, color: '#a855f7' }} />}
              sx={{
                justifyContent: 'flex-start',
                background: 'rgba(168, 85, 247, 0.08)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                borderRadius: 2,
                color: '#f3e8ff',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                py: 0.75,
                px: 1.25,
                '&:hover': {
                  background: 'rgba(168, 85, 247, 0.18)',
                  borderColor: 'rgba(168, 85, 247, 0.5)',
                },
              }}
            >
              History Playback
            </Button>
          </Tooltip>

          <Tooltip title="Simulates network partition, local queued operations, and automatic CRDT sync convergence">
            <Button
              size="small"
              onClick={handlePartition}
              startIcon={<CloudOffIcon sx={{ fontSize: 15, color: '#ef4444' }} />}
              sx={{
                justifyContent: 'flex-start',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 2,
                color: '#fee2e2',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                py: 0.75,
                px: 1.25,
                '&:hover': {
                  background: 'rgba(239, 68, 68, 0.18)',
                  borderColor: 'rgba(239, 68, 68, 0.5)',
                },
              }}
            >
              Network Partition Demo
            </Button>
          </Tooltip>
        </Box>

        {onToggleSplitScreen && (
          <Box sx={{ mt: 1.5, pt: 1.2, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <Button
              fullWidth
              size="small"
              onClick={onToggleSplitScreen}
              sx={{
                background: isSplitScreen ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                border: isSplitScreen ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 2,
                color: isSplitScreen ? '#a7f3d0' : '#d1d1e0',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                py: 0.6,
                '&:hover': {
                  background: isSplitScreen ? 'rgba(16, 185, 129, 0.28)' : 'rgba(255, 255, 255, 0.09)',
                },
              }}
            >
              {isSplitScreen ? '🗗 Exit Side-by-Side Dual View' : '🗖 Side-by-Side Dual View (Alice + Bob)'}
            </Button>
          </Box>
        )}
      </Box>

      {/* Dynamic explanatory callout */}
      {activeCallout && (
        <Box sx={{
          background: 'rgba(20, 22, 35, 0.95)',
          backdropFilter: 'blur(16px)',
          border: '1px solid',
          borderColor: activeCallout.type === 'union' ? '#38bdf8' : activeCallout.type === 'ambiguity' ? '#f59e0b' : activeCallout.type === 'history' ? '#a855f7' : '#ef4444',
          borderRadius: 2.5,
          p: 1.5,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          animation: 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#f3f4f6', mb: 0.5 }}>
            {activeCallout.title}
          </Typography>
          <Typography sx={{ fontSize: 11, color: '#c7c7db', lineHeight: 1.45 }}>
            {activeCallout.desc}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
