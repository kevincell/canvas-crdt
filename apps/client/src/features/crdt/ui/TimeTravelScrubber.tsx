import { Box, Slider, IconButton, Typography } from '@mui/material';

export interface TimeTravelScrubberProps {
  historyStep: number;
  totalSteps: number;
  isPlaying: boolean;
  onHistoryChange: (step: number) => void;
  onPlayPause: () => void;
  onClose: () => void;
}

export function TimeTravelScrubber({
  historyStep,
  totalSteps,
  isPlaying,
  onHistoryChange,
  onPlayPause,
  onClose,
}: TimeTravelScrubberProps) {
  if (totalSteps === 0) return null;

  return (
    <Box sx={{
      position: 'absolute',
      bottom: 80,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 480,
      background: 'rgba(20, 20, 32, 0.9)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(124, 58, 237, 0.3)',
      borderRadius: '16px',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      zIndex: 50,
      animation: 'slideUp 0.3s ease',
    }}>
      <IconButton 
        onClick={onPlayPause}
        sx={{
          color: '#c4b5fd',
          background: 'rgba(124, 58, 237, 0.2)',
          border: '1px solid rgba(124, 58, 237, 0.4)',
          width: 36,
          height: 36,
          '&:hover': { background: 'rgba(124, 58, 237, 0.3)' }
        }}
      >
        <span style={{ fontSize: 16 }}>{isPlaying ? '⏸' : '▶'}</span>
      </IconButton>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 11, color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            Time Travel
          </Typography>
          <Typography sx={{ fontSize: 11, color: '#8888a8', fontFamily: 'monospace' }}>
            {historyStep} / {totalSteps}
          </Typography>
        </Box>
        <Slider
          value={historyStep}
          min={0}
          max={totalSteps}
          step={1}
          onChange={(_, val) => onHistoryChange(val as number)}
          sx={{
            color: '#7c3aed',
            height: 4,
            padding: '8px 0',
            '& .MuiSlider-thumb': {
              width: 14,
              height: 14,
              backgroundColor: '#fff',
              boxShadow: '0 0 10px rgba(124, 58, 237, 0.5)',
              '&:hover, &.Mui-focusVisible': {
                boxShadow: '0 0 0 8px rgba(124, 58, 237, 0.16)',
              },
            },
            '& .MuiSlider-rail': {
              opacity: 0.2,
              backgroundColor: '#fff',
            },
          }}
        />
      </Box>

      <IconButton 
        onClick={onClose}
        size="small"
        sx={{ color: '#8888a8', alignSelf: 'flex-start', mt: -0.5, mr: -1 }}
      >
        <span style={{ fontSize: 14 }}>✕</span>
      </IconButton>
    </Box>
  );
}
