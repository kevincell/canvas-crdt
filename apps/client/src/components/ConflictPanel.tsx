import { type Conflict } from '@crdt-canvas/engine';
import {
  Box, Typography, Button, Chip,
} from '@mui/material';

export function ConflictPanel({
  conflicts,
  shapes,
  onResolve,
}: {
  conflicts: Conflict[];
  shapes: any[];
  onResolve: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
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
      bottom: 16,
      left: 16,
      width: 340,
      maxHeight: 280,
      overflowY: 'auto',
      background: 'rgba(30, 30, 46, 0.95)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: 2,
      padding: '12px 14px',
      backdropFilter: 'blur(12px)',
      zIndex: 100,
    }}>
      <Typography variant="subtitle2" sx={{ color: '#fca5a5', mb: 1, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11 }}>
        ⚠ Intent Ambiguity Detected
      </Typography>
      {conflicts.map((c, i) => {
        const shape = shapes.find((s: any) => s.id === c.shapeId);
        return (
          <Box key={i} sx={{
            padding: '8px 10px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 1,
            marginBottom: 1,
          }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Chip
                label={`${c.level.toUpperCase()} — ${c.type.replace('_', ' ')}`}
                size="small"
                sx={{
                  background: `${levelColor(c.level)}22`,
                  color: levelColor(c.level),
                  border: `1px solid ${levelColor(c.level)}44`,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              <Typography sx={{ fontSize: 10, color: '#8888a8' }}>{c.actors.join(' + ')}</Typography>
            </Box>
            <Typography sx={{ fontSize: 11, color: '#8888a8', mb: 0.75 }}>{c.description}</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                onClick={() => onResolve(c.shapeId, 'merge')}
                sx={{
                  flex: 1, fontSize: 10,
                  background: 'rgba(124, 58, 237, 0.3)',
                  border: '1px solid rgba(124, 58, 237, 0.5)',
                  color: '#a78bfa',
                  '&:hover': { background: 'rgba(124, 58, 237, 0.5)' },
                }}
              >
                Merge (union)
              </Button>
              <Button
                size="small"
                onClick={() => onResolve(c.shapeId, 'keep-local')}
                sx={{
                  flex: 1, fontSize: 10,
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#6ee7b7',
                  '&:hover': { background: 'rgba(16, 185, 129, 0.3)' },
                }}
              >
                Keep mine
              </Button>
            </Box>
          </Box>
        );
      })}
      <Typography sx={{ fontSize: 10, color: '#555570', mt: 1, fontStyle: 'italic' }}>
        All peers compute the same ambiguity flags independently — no consensus needed.
      </Typography>
    </Box>
  );
}
