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
      case 'high': return '#C9573F';
      case 'medium': return '#C9922E';
      case 'low': return '#5F8299';
      default: return '#8888a8';
    }
  };

  return (
    <Box sx={{
      position: 'absolute',
      left,
      top,
      width: 280,
      background: 'var(--c-surface)',
      border: `1px solid ${levelColor(conflict.level)}`,
      borderRadius: 2.5,
      padding: '12px 14px',
      backdropFilter: 'blur(20px)',
      boxShadow: 'var(--c-shadow)',
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
        <Typography sx={{ fontSize: 11, color: 'var(--c-text-muted)', fontWeight: 600 }}>{conflict.actors.join(' ↔ ')}</Typography>
      </Box>

      <Typography sx={{ fontSize: 11, color: 'var(--c-text)', mb: 1, lineHeight: 1.3 }}>
        {conflict.description}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onResolve(conflict.shapeId, 'merge'); }}
          sx={{
            flex: 1, fontSize: 9.5, fontWeight: 600,
            background: 'var(--c-primary-soft)',
            border: '1px solid var(--c-primary)',
            color: 'var(--c-primary-strong)',
            textTransform: 'none',
            py: 0.5,
            px: 0.5,
            minWidth: 0,
            '&:hover': { background: 'var(--c-primary-soft)', filter: 'brightness(0.95)' },
          }}
        >
          Merge
        </Button>
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onResolve(conflict.shapeId, 'keep-local'); }}
          sx={{
            flex: 1, fontSize: 9.5, fontWeight: 600,
            background: 'var(--c-success-soft)',
            border: '1px solid var(--c-success)',
            color: 'var(--c-success)',
            textTransform: 'none',
            py: 0.5,
            px: 0.5,
            minWidth: 0,
            '&:hover': { background: 'var(--c-success-soft)', filter: 'brightness(0.95)' },
          }}
        >
          Keep Mine
        </Button>
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onResolve(conflict.shapeId, 'keep-remote'); }}
          sx={{
            flex: 1, fontSize: 9.5, fontWeight: 600,
            background: 'var(--c-info-soft)',
            border: '1px solid var(--c-info)',
            color: 'var(--c-info)',
            textTransform: 'none',
            py: 0.5,
            px: 0.5,
            minWidth: 0,
            '&:hover': { background: 'var(--c-info-soft)', filter: 'brightness(0.95)' },
          }}
        >
          Remote
        </Button>
      </Box>
    </Box>
  );
}
