import { useMemo } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';
import { BOARD_TEMPLATES, type BoardTemplate } from './boardTemplates';
import { SnapshotPreview } from '../panels/SnapshotPreview';
import { type ThemeMode, v } from '../../theme/theme';

export function TemplatesDialog({ open, onClose, onPick, mode }: { open: boolean; onClose: () => void; onPick: (t: BoardTemplate) => void; mode: ThemeMode }) {
  const previews = useMemo(() => BOARD_TEMPLATES.map(t => t.shapes.map(s => ({ id: s.id, kind: s.kind, data: s.data as any, actor: '', vector: {}, deleted: false, createdAt: 0, updatedAt: 0 }))), []);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Box sx={{ flex: 1 }}>Templates</Box>
        <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ fontSize: 12.5, color: v('textMuted'), mb: 1.5 }}>Added next to what’s already on the board — nothing is replaced.</Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {BOARD_TEMPLATES.map((t, i) => (
            <Box key={t.id} component="button" onClick={() => onPick(t)} sx={{ textAlign: 'left', p: 1.2, borderRadius: '14px', border: `1px solid ${v('border')}`, bgcolor: v('surface2'), '&:hover': { borderColor: v('primary') } }}>
              <SnapshotPreview shapes={previews[i]} mode={mode} height={170} />
              <Box sx={{ fontWeight: 700, mt: 1 }}>{t.title}</Box>
              <Box sx={{ fontSize: 12, color: v('textMuted') }}>{t.description}</Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
