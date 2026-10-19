/** "You" menu: name, pointer / laser colour, rooms joined (click to switch), theme. */
import { useEffect, useState } from 'react';
import { Box, Button, Popover, TextField, IconButton, Tooltip } from '@mui/material';
import { Home, LightModeOutlined, DarkModeOutlined } from '@mui/icons-material';
import { POINTER_COLORS, getJoinedRooms, type JoinedRoom } from '../../app/identity';
import { Swatch, Label } from '../board/ui';
import { timeAgo } from './SidePanel';
import { useThemeMode, v } from '../../theme/theme';

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', bgcolor: color, color: '#fff', fontWeight: 800, fontSize: size * 0.42, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 2px ${v('surface')}, 0 0 0 3.5px ${color}` , flexShrink: 0, textShadow: '0 1px 2px rgba(0,0,0,.25)' }}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </Box>
  );
}

export function ProfileMenu({ anchorEl, onClose, name, color, currentRoomId, onRename, onColor, onSwitchRoom, onHome }: {
  anchorEl: HTMLElement | null; onClose: () => void; name: string; color: string; currentRoomId: string;
  onRename: (name: string) => void; onColor: (c: string) => void; onSwitchRoom: (roomId: string) => void; onHome: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [rooms, setRooms] = useState<JoinedRoom[]>(getJoinedRooms);
  const { mode, toggleMode } = useThemeMode();
  useEffect(() => { setDraft(name); }, [name, anchorEl]);
  useEffect(() => {
    const sync = () => setRooms(getJoinedRooms());
    window.addEventListener('crdt-rooms-changed', sync);
    if (anchorEl) sync();
    return () => window.removeEventListener('crdt-rooms-changed', sync);
  }, [anchorEl]);

  const commit = () => { const n = draft.trim().slice(0, 32); if (n && n !== name) onRename(n); };

  return (
    <Popover open={!!anchorEl} anchorEl={anchorEl} onClose={() => { commit(); onClose(); }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { mt: 1, width: 300, maxWidth: 'calc(100vw - 24px)', p: 1.8, borderRadius: '14px', bgcolor: v('surface') } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
        <Avatar name={draft || name} color={color} size={40} />
        <TextField size="small" fullWidth label="Your name" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLElement).blur(); } }} slotProps={{ htmlInput: { maxLength: 32 } }} />
      </Box>

      <Label>Pointer & laser colour</Label>
      <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mt: 0.8, mb: 1.6 }}>
        {POINTER_COLORS.map(c => <Swatch key={c} color={c} active={c === color} onClick={() => onColor(c)} />)}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.6 }}>
        <Box sx={{ flex: 1 }}><Label>Rooms you’ve joined</Label></Box>
        <Tooltip title="Home: create or join a room"><IconButton size="small" onClick={() => { onClose(); onHome(); }}><Home sx={{ fontSize: 17 }} /></IconButton></Tooltip>
      </Box>
      <Box sx={{ maxHeight: 220, overflowY: 'auto', mx: -0.6 }}>
        {!rooms.length && <Box sx={{ fontSize: 12, color: v('textFaint'), px: 0.6 }}>None yet.</Box>}
        {rooms.map(r => {
          const current = r.roomId === currentRoomId;
          return (
            <Box key={r.roomId} component="button" disabled={current} onClick={() => { onClose(); onSwitchRoom(r.roomId); }}
              sx={{ width: '100%', textAlign: 'left', px: 1, py: 0.7, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 1, bgcolor: current ? v('primarySoft') : 'transparent', cursor: current ? 'default' : 'pointer', '&:hover': { bgcolor: current ? v('primarySoft') : v('surface2') } }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || r.roomId}</Box>
                <Box sx={{ fontSize: 10.5, color: v('textFaint') }}>{r.roomId} · {r.role} · {timeAgo(r.lastOpened)}</Box>
              </Box>
              {current && <Box sx={{ fontSize: 10.5, fontWeight: 700, color: v('primaryStrong') }}>HERE</Box>}
            </Box>
          );
        })}
      </Box>

      <Button fullWidth size="small" variant="outlined" sx={{ mt: 1.5 }} startIcon={mode === 'day' ? <DarkModeOutlined fontSize="small" /> : <LightModeOutlined fontSize="small" />} onClick={toggleMode}>
        {mode === 'day' ? 'Switch to night' : 'Switch to day'}
      </Button>
    </Popover>
  );
}
