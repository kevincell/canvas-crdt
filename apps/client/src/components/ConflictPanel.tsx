import { type Conflict } from '@crdt-canvas/engine';
import {
  Box, Typography, Button, Chip,
} from '@mui/material';

export function ConflictPanel({
  conflicts,
  shapes,
  onResolve,
  onClose,
}: {
  conflicts: Conflict[];
  shapes: any[];
  onResolve: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
  onClose?: () => void;
}) {
  if (conflicts.length === 0) return null;

  const levelColor = (level: string) => {
    switch (level) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#3b82f6';
      default: return '#8888a8';
    }
  };

  return (
    <Box id="conflict-panel" sx={{
      position: 'absolute',
      bottom: 24,
      left: 20,
      width: 360,
      maxHeight: 340,
      overflowY: 'auto',
      background: 'rgba(20, 20, 32, 0.94)',
      border: '1px solid rgba(239, 68, 68, 0.35)',
      borderRadius: 2.5,
      padding: '14px 16px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
      zIndex: 100,
      animation: 'popIn 0.2s ease',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
        <Typography variant="subtitle2" sx={{ color: '#fca5a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <span>⚠</span> Intent Ambiguity Conflict
        </Typography>
        {onClose && (
          <Button size="small" onClick={onClose} sx={{ minWidth: 24, p: 0, color: '#8888a8', fontSize: 12 }}>
            ✕
          </Button>
        )}
      </Box>

      {conflicts.map((c, i) => {
        return (
          <Box key={i} sx={{
            padding: '10px 12px',
            background: 'rgba(239, 68, 68, 0.07)',
            border: '1px solid rgba(239, 68, 68, 0.22)',
            borderRadius: 2,
            marginBottom: 1.2,
          }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
              <Chip
                label={`${c.level.toUpperCase()} DIVERGENCE`}
                size="small"
                sx={{
                  background: `${levelColor(c.level)}22`,
                  color: levelColor(c.level),
                  border: `1px solid ${levelColor(c.level)}44`,
                  fontSize: 10,
                  fontWeight: 700,
                  height: 20,
                }}
              />
              <Typography sx={{ fontSize: 11, color: '#9090b8', fontWeight: 600 }}>{c.actors.join(' ↔ ')}</Typography>
            </Box>

            <Typography sx={{ fontSize: 11.5, color: '#d1d1e5', mb: 1, lineHeight: 1.4 }}>
              {c.description}
            </Typography>

            {/* Ambiguity Score Bar */}
            <Box sx={{ mb: 1.2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#8888a8', mb: 0.3 }}>
                <span>Ambiguity Metric</span>
                <span style={{ color: levelColor(c.level), fontWeight: 700 }}>
                  {c.level === 'high' ? '92% (Opposite Directions)' : c.level === 'medium' ? '65% (Divergent)' : '35% (Subtle)'}
                </span>
              </Box>
              <Box sx={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{
                  width: c.level === 'high' ? '92%' : c.level === 'medium' ? '65%' : '35%',
                  height: '100%',
                  background: levelColor(c.level),
                  borderRadius: 2,
                }} />
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                onClick={() => onResolve(c.shapeId, 'merge')}
                sx={{
                  flex: 1, fontSize: 10.5, fontWeight: 600,
                  background: 'rgba(124, 58, 237, 0.25)',
                  border: '1px solid rgba(124, 58, 237, 0.5)',
                  color: '#c4b5fd',
                  textTransform: 'none',
                  py: 0.5,
                  '&:hover': { background: 'rgba(124, 58, 237, 0.45)' },
                }}
              >
                Compromise (Union)
              </Button>
              <Button
                size="small"
                onClick={() => onResolve(c.shapeId, 'keep-local')}
                sx={{
                  flex: 1, fontSize: 10.5, fontWeight: 600,
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  color: '#6ee7b7',
                  textTransform: 'none',
                  py: 0.5,
                  '&:hover': { background: 'rgba(16, 185, 129, 0.35)' },
                }}
              >
                Keep Mine
              </Button>
              <Button
                size="small"
                onClick={() => onResolve(c.shapeId, 'keep-remote')}
                sx={{
                  flex: 1, fontSize: 10.5, fontWeight: 600,
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid rgba(59, 130, 246, 0.45)',
                  color: '#93c5fd',
                  textTransform: 'none',
                  py: 0.5,
                  '&:hover': { background: 'rgba(59, 130, 246, 0.35)' },
                }}
              >
                Accept Remote
              </Button>
            </Box>
          </Box>
        );
      })}
      <Typography sx={{ fontSize: 10, color: '#686884', mt: 0.5, fontStyle: 'italic' }}>
        Deterministic CRDT rule: Union covers both bounding boxes without loss. All peers compute the same ambiguity flags independently.
      </Typography>
    </Box>
  );
}
