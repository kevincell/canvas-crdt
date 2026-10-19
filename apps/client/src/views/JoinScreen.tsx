/**
 * Home screen: your name & pointer colour, create a room, join one by ID, or reopen a recent one.
 */
import { useEffect, useState } from 'react';
import { Box, Button, IconButton, TextField, Tooltip } from '@mui/material';
import { Spa, LightModeOutlined, DarkModeOutlined, Add, Login, MeetingRoomOutlined } from '@mui/icons-material';
import { POINTER_COLORS, getJoinedRooms, type JoinedRoom } from '../app/identity';
import { Swatch, Label, panelSx } from '../features/board/ui';
import { timeAgo } from '../features/panels/SidePanel';
import { useThemeMode, v } from '../theme/theme';

export function JoinScreen({ name, color, initialRoom, notice, onIdentity, onCreate, onJoin }: {
  name: string; color: string; initialRoom?: string; notice?: string | null;
  onIdentity: (name: string, color: string) => void;
  onCreate: (info: { name: string; description: string }) => void;
  onJoin: (roomId: string) => void;
}) {
  const { mode, toggleMode } = useThemeMode();
  const [draftName, setDraftName] = useState(name);
  const [roomName, setRoomName] = useState('');
  const [roomDesc, setRoomDesc] = useState('');
  const [joinId, setJoinId] = useState(initialRoom ?? '');
  const [rooms, setRooms] = useState<JoinedRoom[]>(getJoinedRooms);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const sync = () => setRooms(getJoinedRooms());
    window.addEventListener('crdt-rooms-changed', sync);
    return () => window.removeEventListener('crdt-rooms-changed', sync);
  }, []);

  const nameOk = draftName.trim().length > 0;
  const ensureName = () => {
    setTouched(true);
    if (!nameOk) return false;
    onIdentity(draftName.trim().slice(0, 32), color);
    return true;
  };
  const cleanId = (s: string) => {
    const t = s.trim();
    try { const u = new URL(t); return u.searchParams.get('room') ?? t; } catch { return t; }
  };

  const card = { ...panelSx, p: { xs: 2, sm: 2.5 }, borderRadius: '18px' } as const;

  return (
    <Box className="app-bg" sx={{ width: '100%', height: '100%', overflowY: 'auto', color: v('text') }}>
      <Box sx={{ maxWidth: 980, mx: 'auto', px: 2, py: { xs: 3, md: 5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: { xs: 3, md: 4 } }}>
          <Box sx={{ width: 44, height: 44, borderRadius: '14px', bgcolor: v('primary'), color: v('onPrimary'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spa /></Box>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 800, letterSpacing: '-.01em' }}>Canvas CRDT</Box>
            <Box sx={{ fontSize: 13, color: v('textMuted') }}>Draw, write and watch together — peer-to-peer, works offline.</Box>
          </Box>
          <Tooltip title={mode === 'day' ? 'Night mode' : 'Day mode'}>
            <IconButton onClick={toggleMode} sx={{ border: `1px solid ${v('border')}`, bgcolor: v('surface') }}>{mode === 'day' ? <DarkModeOutlined /> : <LightModeOutlined />}</IconButton>
          </Tooltip>
        </Box>

        {notice && <Box sx={{ ...card, mb: 2, py: 1.5, bgcolor: v('warningSoft'), fontSize: 13.5 }}>{notice}</Box>}

        <Box sx={{ ...card, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <TextField label="Your name" value={draftName} onChange={e => setDraftName(e.target.value)} onBlur={() => nameOk && onIdentity(draftName.trim().slice(0, 32), color)}
              error={touched && !nameOk} helperText={touched && !nameOk ? 'Enter a name so others know who you are' : ' '} size="small" sx={{ flex: '1 1 220px' }}
              slotProps={{ htmlInput: { maxLength: 32 } }} autoFocus={!name} />
            <Box sx={{ flex: '1 1 260px', pb: 2.6 }}>
              <Label>Pointer & laser colour</Label>
              <Box sx={{ display: 'flex', gap: 0.8, mt: 0.8, flexWrap: 'wrap' }}>
                {POINTER_COLORS.map(c => <Swatch key={c} color={c} active={c === color} onClick={() => onIdentity(draftName.trim() || name, c)} />)}
              </Box>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <Box sx={card}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}><Add sx={{ color: v('primary') }} /><Box sx={{ fontWeight: 800, fontSize: 16 }}>Create a room</Box></Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField size="small" label="Room name" placeholder="e.g. Design review" value={roomName} onChange={e => setRoomName(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
              <TextField size="small" label="Description (optional)" value={roomDesc} onChange={e => setRoomDesc(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
              <Button variant="contained" size="large" onClick={() => ensureName() && onCreate({ name: roomName.trim() || `${draftName.trim()}’s room`, description: roomDesc.trim() })}>Create room</Button>
              <Box sx={{ fontSize: 12, color: v('textFaint') }}>You’ll be the host. It starts with one empty board; people who join wait for you (or any member) to let them in.</Box>
            </Box>
          </Box>

          <Box sx={card}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}><Login sx={{ color: v('accent') }} /><Box sx={{ fontWeight: 800, fontSize: 16 }}>Join a room</Box></Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField size="small" label="Room ID or link" value={joinId} onChange={e => setJoinId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && cleanId(joinId) && ensureName()) onJoin(cleanId(joinId)); }} />
              <Button variant="outlined" size="large" disabled={!cleanId(joinId)} onClick={() => ensureName() && onJoin(cleanId(joinId))}>Ask to join</Button>
              <Box sx={{ fontSize: 12, color: v('textFaint') }}>Someone already in the room approves you. Both devices need to be on the same network. Testing alone in one browser? Open another tab at <b>?guest=1</b> to act as a second person.</Box>
            </Box>
          </Box>
        </Box>

        <Box sx={{ ...card, mt: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}><MeetingRoomOutlined sx={{ color: v('textMuted') }} /><Box sx={{ fontWeight: 800, fontSize: 16 }}>Your rooms</Box></Box>
          {!rooms.length && <Box sx={{ fontSize: 13, color: v('textFaint') }}>Rooms you create or join show up here.</Box>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
            {rooms.map(r => (
              <Box key={r.roomId} component="button" onClick={() => ensureName() && onJoin(r.roomId)}
                sx={{ textAlign: 'left', p: 1.4, borderRadius: '12px', border: `1px solid ${v('border')}`, bgcolor: v('surface2'), '&:hover': { borderColor: v('primary') } }}>
                <Box sx={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.roomId}</Box>
                <Box sx={{ fontSize: 11.5, color: v('textFaint') }}>{r.roomId} · {r.role ?? 'member'} · {timeAgo(r.lastOpened)}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
