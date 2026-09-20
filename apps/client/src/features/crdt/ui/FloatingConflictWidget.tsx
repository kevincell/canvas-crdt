import { type Conflict, type Shape, shapeBBox } from '@crdt-canvas/engine';
import { Box, Typography, Button, Chip } from '@mui/material';

export function FloatingConflictWidget({
  conflict,
  shape,
  scale,
  offset,
  onResolve,
}: {
  conflict: Conflict;
  shape: Shape;
  scale: number;
  offset: { x: number; y: number };
  onResolve: (shapeId: string, action: 'merge' | 'keep-local' | 'keep-remote') => void;
}) {
  const bbox = shapeBBox(shape);
  const left = bbox.minX * scale + offset.x;
  const top = bbox.maxY * scale + offset.y + 16; // 16px below the shape

  const levelColor = (level: string) => {
    switch (level) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#3b82f6';
      default: return '#8888a8';
    }
  };

  return (
    <Box sx={{
      position: 'absolute',
      left,
      top,
      width: 280,
      background: 'rgba(20, 20, 32, 0.94)',
      border: `1px solid ${levelColor(conflict.level)}`,
      borderRadius: 2.5,
      padding: '12px 14px',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
      zIndex: 100,
      animation: 'popIn 0.2s ease',
      transform: 'translate(-50%, 0)', // center horizontally relative to shape left (wait, better to center relative to shape center)
    }} style={{
      left: ((bbox.minX + bbox.maxX) / 2) * scale + offset.x,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
        <Chip
          label={`${conflict.level.toUpperCase()} CONFLICT`}
          size="small"
          sx={{
            background: `${levelColor(conflict.level)}22`,
            color: levelColor(conflict.level),
            border: `1px solid ${levelColor(conflict.level)}44`,
            fontSize: 10,
            fontWeight: 700,
            height: 20,
          }}
        />
        <Typography sx={{ fontSize: 11, color: '#9090b8', fontWeight: 600 }}>{conflict.actors.join(' ↔ ')}</Typography>
      </Box>

      <Typography sx={{ fontSize: 11, color: '#d1d1e5', mb: 1, lineHeight: 1.3 }}>
        {conflict.description}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onResolve(conflict.shapeId, 'merge'); }}
          sx={{
            flex: 1, fontSize: 9.5, fontWeight: 600,
            background: 'rgba(124, 58, 237, 0.25)',
            border: '1px solid rgba(124, 58, 237, 0.5)',
            color: '#c4b5fd',
            textTransform: 'none',
            py: 0.5,
            px: 0.5,
            minWidth: 0,
            '&:hover': { background: 'rgba(124, 58, 237, 0.45)' },
          }}
        >
          Merge
        </Button>
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onResolve(conflict.shapeId, 'keep-local'); }}
          sx={{
            flex: 1, fontSize: 9.5, fontWeight: 600,
            background: 'rgba(16, 185, 129, 0.2)',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            color: '#6ee7b7',
            textTransform: 'none',
            py: 0.5,
            px: 0.5,
            minWidth: 0,
            '&:hover': { background: 'rgba(16, 185, 129, 0.35)' },
          }}
        >
          Keep Mine
        </Button>
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onResolve(conflict.shapeId, 'keep-remote'); }}
          sx={{
            flex: 1, fontSize: 9.5, fontWeight: 600,
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.45)',
            color: '#93c5fd',
            textTransform: 'none',
            py: 0.5,
            px: 0.5,
            minWidth: 0,
            '&:hover': { background: 'rgba(59, 130, 246, 0.35)' },
          }}
        >
          Remote
        </Button>
      </Box>
    </Box>
  );
}
