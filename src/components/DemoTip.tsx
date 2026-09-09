import { Box, Button, Typography } from '@mui/material';

export function DemoTip({ onClose, show: boolean }) {
  if (!show) return null;

  return (
    <Box sx={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
    }}>
      <Box sx={{
        background: 'rgba(30, 30, 46, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        padding: 24,
        width: 480,
        maxWidth: '90%',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
      }}>
        <Typography sx={{ fontSize: 20, fontWeight: 600, color: '#e2e2f0', mb: 4 }}>
          CRDT Canvas Demo Tips
        </Typography>
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#c4b5fd', mb: 2 }}>
            1. Union-Bounding-Box Merge Rule
          </Typography>
          <Typography sx={{ fontSize: 14, color: '#e2e2f0', mb: 2 }}>
            Create a rectangle in one tab. In the first tab, start resizing it to the right. At the same time, in another tab (or device), start resizing the same rectangle to the left. When both resizes are released, observe that the rectangle expands to cover both resizes (union of the two bounding boxes).
          </Typography>
        </Box>
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#c4b5fd', mb: 2 }}>
            2. Intent Ambiguity Detection
          </Typography>
          <Typography sx={{ fontSize: 14, color: '#e2e2f0', mb: 2 }}>
            Create a shape in one tab. In the first tab, move the shape to the top-left. At the same time, in another tab, move the same shape to the bottom-right. When both moves are released, observe that a conflict appears in the conflict panel (click the ⚠ icon in the toolbar to see it). Resolve the conflict by choosing one of the positions or by making a compromise.
          </Typography>
        </Box>
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#c4b5fd', mb: 2 }}>
            3. Merge-History Playback
          </Typography>
          <Typography sx={{ fontSize: 14, color: '#e2e2f0', mb: 2 }}>
            Perform a series of actions (create, move, resize, etc.) in one or more tabs. Click the play button in the toolbar to replay the entire history of the canvas.
          </Typography>
        </Box>
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#c4b5fd', mb: 2 }}>
            4. Offline-First P2P Synchronization
          </Typography>
          <Typography sx={{ fontSize: 14, color: '#e2e2f0', mb: 2 }}>
            Click the simulator button in the toolbar to open the partition simulator. Click "Network Split" to simulate a loss of connection between peers. Make changes in both partitions (they will appear offline). Click "Reconnect" to see the changes sync and any conflicts resolved.
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Button
            variant="contained"
            color="error"
            size="small"
            onClick={onClose}
            sx={{ fontSize: 12, textTransform: 'none' }}
          >
            Got it
          </Button>
          <Box sx={{ display: 'inline-block', ml: 2 }}>
            <Checkbox
              checked={!localStorage.getItem('demoTipShown')}
              onChange={(e) => {
                if (e.target.checked) {
                  localStorage.removeItem('demoTipShown');
                } else {
                  localStorage.setItem('demoTipShown', 'true');
                }
              }}
              sx={{ fontSize: 12 }}
            />
            <Typography sx={{ fontSize: 12, color: '#8888a8', ml: 1 }}>
              Don't show this again
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}