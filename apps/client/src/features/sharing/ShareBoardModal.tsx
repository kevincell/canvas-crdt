import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Close,
  ContentCopy,
  Check,
  Edit,
  Visibility,
  Slideshow,
  Security,
  Link as LinkIcon,
} from '@mui/icons-material';

interface ShareBoardModalProps {
  open: boolean;
  onClose: () => void;
  roomId: string;
  boardTitle: string;
  isReadOnly?: boolean;
}

export function ShareBoardModal({
  open,
  onClose,
  roomId,
  boardTitle,
  isReadOnly = false,
}: ShareBoardModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const getBaseUrl = () => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}`;
  };

  const editorUrl = `${getBaseUrl()}?room=${encodeURIComponent(roomId)}&role=editor`;
  const viewerUrl = `${getBaseUrl()}?room=${encodeURIComponent(roomId)}&role=viewer`;
  const presentationUrl = `${getBaseUrl()}?room=${encodeURIComponent(roomId)}&role=viewer&present=true`;

  const copyToClipboard = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      window.prompt('Copy link to clipboard:', url);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'rgba(15, 15, 23, 0.98)',
            backgroundImage: 'radial-gradient(ellipse at top, rgba(124, 58, 237, 0.12), transparent 70%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 3,
            color: '#f8fafc',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7)',
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          px: 3,
          py: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 2,
              bgcolor: 'rgba(124, 58, 237, 0.2)',
              border: '1px solid rgba(124, 58, 237, 0.4)',
              color: '#c4b5fd',
            }}
          >
            <LinkIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
              Share “{boardTitle || roomId}”
            </Typography>
            <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
              Room ID: <span style={{ fontFamily: 'monospace', color: '#c4b5fd' }}>{roomId}</span>
            </Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: '#94a3b8', '&:hover': { color: '#f8fafc' } }}>
          <Close sx={{ fontSize: 20 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 3, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Editor Link */}
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(124, 58, 237, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Edit sx={{ fontSize: 16, color: '#a78bfa' }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                Editor link
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 10, color: '#a78bfa', bgcolor: 'rgba(124, 58, 237, 0.15)', px: 1, py: 0.25, borderRadius: 1 }}>
              Full access
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
            Recipients can draw, edit text, move and delete shapes, add comments, and vote.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input
              readOnly
              value={editorUrl}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontSize: 11,
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={() => copyToClipboard(editorUrl, 'editor')}
              startIcon={copiedKey === 'editor' ? <Check sx={{ fontSize: 14 }} /> : <ContentCopy sx={{ fontSize: 14 }} />}
              sx={{
                bgcolor: copiedKey === 'editor' ? '#10b981' : '#7c3aed',
                '&:hover': { bgcolor: copiedKey === 'editor' ? '#059669' : '#6d28d9' },
                textTransform: 'none',
                fontSize: 11,
                fontWeight: 600,
                minWidth: 100,
              }}
            >
              {copiedKey === 'editor' ? 'Copied!' : 'Copy'}
            </Button>
          </Box>
        </Box>

        {/* Read-Only Viewer Link */}
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Visibility sx={{ fontSize: 16, color: '#38bdf8' }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                Read-only viewer link
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 10, color: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.15)', px: 1, py: 0.25, borderRadius: 1 }}>
              Inspect & view
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
            Recipients can watch live changes, pan/zoom, inspect shapes, and export. Canvas mutations are disabled.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input
              readOnly
              value={viewerUrl}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontSize: 11,
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={() => copyToClipboard(viewerUrl, 'viewer')}
              startIcon={copiedKey === 'viewer' ? <Check sx={{ fontSize: 14 }} /> : <ContentCopy sx={{ fontSize: 14 }} />}
              sx={{
                bgcolor: copiedKey === 'viewer' ? '#10b981' : '#0284c7',
                '&:hover': { bgcolor: copiedKey === 'viewer' ? '#059669' : '#0369a1' },
                textTransform: 'none',
                fontSize: 11,
                fontWeight: 600,
                minWidth: 100,
              }}
            >
              {copiedKey === 'viewer' ? 'Copied!' : 'Copy'}
            </Button>
          </Box>
        </Box>

        {/* Presentation Link */}
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(244, 63, 94, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Slideshow sx={{ fontSize: 16, color: '#f43f5e' }} />
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                Presentation slideshow link
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 10, color: '#f43f5e', bgcolor: 'rgba(244, 63, 94, 0.15)', px: 1, py: 0.25, borderRadius: 1 }}>
              Slideshow mode
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
            Opens the board directly in fullscreen frame presentation mode with previous/next slide navigation.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input
              readOnly
              value={presentationUrl}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontSize: 11,
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={() => copyToClipboard(presentationUrl, 'presentation')}
              startIcon={copiedKey === 'presentation' ? <Check sx={{ fontSize: 14 }} /> : <ContentCopy sx={{ fontSize: 14 }} />}
              sx={{
                bgcolor: copiedKey === 'presentation' ? '#10b981' : '#e11d48',
                '&:hover': { bgcolor: copiedKey === 'presentation' ? '#059669' : '#be123c' },
                textTransform: 'none',
                fontSize: 11,
                fontWeight: 600,
                minWidth: 100,
              }}
            >
              {copiedKey === 'presentation' ? 'Copied!' : 'Copy'}
            </Button>
          </Box>
        </Box>

        {/* Security & Access Architecture Note */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.25,
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'rgba(56, 189, 248, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.15)',
          }}
        >
          <Security sx={{ fontSize: 16, color: '#38bdf8', mt: 0.25 }} />
          <Box>
            <Typography sx={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600 }}>
              Access control & threat model note
            </Typography>
            <Typography sx={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4, mt: 0.25 }}>
              Peer-to-peer WebRTC synchronization. Read-only viewer links enforce client-side mutation suppression, lock out editing tools, and broadcast viewer awareness status.
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Button
          onClick={onClose}
          sx={{
            color: '#cbd5e1',
            textTransform: 'none',
            fontSize: 12,
            '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.06)' },
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
