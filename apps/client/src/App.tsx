import { useCallback, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { JoinScreen } from './views/JoinScreen';
import { RoomScreen } from './views/RoomScreen';
import { type JoinMode } from './features/room/useRoom';
import { getDeviceId, getStoredName, setStoredName, getPointerColor, setPointerColor, randomId, IS_GUEST_TAB } from './app/identity';

type Route =
  | { screen: 'home'; notice?: string | null; prefillRoom?: string }
  | { screen: 'room'; roomId: string; mode: JoinMode; createInfo?: { name: string; description: string }; boardId?: string };

function routeFromUrl(hasName: boolean): Route {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room')?.trim();
  if (!room) return { screen: 'home' };
  const view = params.get('view') === '1';
  if (!view && !hasName) return { screen: 'home', prefillRoom: room };
  return { screen: 'room', roomId: room, mode: view ? 'view' : 'join', boardId: params.get('board') ?? undefined };
}

export default function App() {
  const [deviceId] = useState(getDeviceId);
  const [name, setName] = useState(getStoredName);
  const [color, setColor] = useState(getPointerColor);
  const [route, setRoute] = useState<Route>(() => routeFromUrl(!!getStoredName()));

  // Keep the address bar in step (so refresh / copy-paste reopens the same room & board)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (route.screen === 'room') {
      url.searchParams.set('room', route.roomId);
      if (route.boardId) url.searchParams.set('board', route.boardId); else url.searchParams.delete('board');
      if (route.mode === 'view') url.searchParams.set('view', '1'); else url.searchParams.delete('view');
    } else {
      url.search = '';
    }
    if (IS_GUEST_TAB) url.searchParams.set('guest', '1');
    window.history.replaceState(null, '', url.toString());
  }, [route]);

  const onIdentity = useCallback((n: string, c: string) => {
    if (n) { setName(n); setStoredName(n); }
    setColor(c); setPointerColor(c);
  }, []);

  const goHome = useCallback((notice?: string) => setRoute({ screen: 'home', notice: notice ?? null }), []);

  const identity = { deviceId, name: name || 'Viewer', color };

  return (
    <Box sx={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {route.screen === 'home' ? (
        <JoinScreen
          name={name}
          color={color}
          initialRoom={route.prefillRoom}
          notice={route.notice}
          onIdentity={onIdentity}
          onCreate={info => setRoute({ screen: 'room', roomId: randomId(6), mode: 'create', createInfo: info, boardId: 'main' })}
          onJoin={roomId => setRoute({ screen: 'room', roomId, mode: 'join' })}
        />
      ) : (
        <RoomScreen
          key={`${route.roomId}:${route.mode}`}
          roomId={route.roomId}
          mode={route.mode}
          createInfo={route.createInfo}
          boardId={route.boardId}
          identity={identity}
          onBoardChange={boardId => setRoute(r => (r.screen === 'room' ? { ...r, boardId } : r))}
          onHome={goHome}
          onSwitchRoom={roomId => setRoute({ screen: 'room', roomId, mode: 'join' })}
          onRename={n => onIdentity(n, color)}
          onColor={c => onIdentity(name, c)}
        />
      )}
    </Box>
  );
}
