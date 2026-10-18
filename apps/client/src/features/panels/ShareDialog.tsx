/** Share: a view-only link (just the drawing) and an edit link (full tools, join approval). */
import { useMemo, type ReactNode } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, TextField } from '@mui/material';
import { ContentCopy, Close, Visibility, Edit } from '@mui/icons-material';
import { v } from '../../theme/theme';

export function shareLinks(roomId: string, boardId: string, localIP: string) {
  const loc = window.location;
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname);
  const host = isLocal && localIP ? `${loc.protocol}//${localIP}${loc.port ? ':' + loc.port : ''}` : loc.origin;
  const base = `${host}${loc.pathname}?room=${encodeURIComponent(roomId)}&board=${encodeURIComponent(boardId)}`;
  return { view: `${base}&view=1`, edit: base };
}

export function ShareDialog({ open, onClose, roomId, boardId, boardName, localIP, onToast }: {
  open: boolean; onClose: () => void; roomId: string; boardId: string; boardName: string; localIP: string; onToast: (m: string) => void;
}) {
  const links = useMemo(() => shareLinks(roomId, boardId, localIP), [roomId, boardId, localIP]);
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => onToast(`${what} link copied`)).catch(() => onToast(text));
  const Row = ({ icon, title, text, link, what }: { icon: ReactNode; title: string; text: string; link: string; what: string }) => (
    <Box sx={{ p: 1.5, borderRadius: '12px', border: `1px solid ${v('border')}`, bgcolor: v('surface2'), mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
        <Box sx={{ color: v('primary'), display: 'flex' }}>{icon}</Box>
        <Box sx={{ fontWeight: 700, fontSize: 14 }}>{title}</Box>
      </Box>
      <Box sx={{ fontSize: 12, color: v('textMuted'), mb: 1 }}>{text}</Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField size="small" fullWidth value={link} slotProps={{ htmlInput: { readOnly: true, style: { fontSize: 12 } } }} onFocus={e => e.target.select()} />
        <Button variant="contained" startIcon={<ContentCopy fontSize="small" />} onClick={() => copy(link, what)}>Copy</Button>
      </Box>
    </Box>
  );
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Box sx={{ flex: 1 }}>Share “{boardName}”</Box>
        <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Row icon={<Visibility fontSize="small" />} title="View only" what="View" link={links.view}
          text="Shows only the finished drawing, live — no toolbar, no editing, no approval needed." />
        <Row icon={<Edit fontSize="small" />} title="Edit" what="Edit" link={links.edit}
          text="Full tools. People opening this wait until someone in the room allows them in." />
        <Box sx={{ fontSize: 11.5, color: v('textFaint') }}>
          Works for devices on the same network{localIP ? ` (this computer: ${localIP})` : ''}. Room ID: <b>{roomId}</b>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
