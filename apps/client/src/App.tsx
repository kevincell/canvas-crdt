import { useState, useCallback } from 'react';
import { JoinScreen } from './views/JoinScreen';
import { SingleCanvasView } from './views/SingleCanvasView';
import { DualPeerContainer } from './features/demo/DualPeerContainer';
import { Box } from '@mui/material';

type AppMode = 'join' | 'canvas' | 'dual';

// Load persisted preferences
function loadPrefs() {
  return {
    name: localStorage.getItem('crdt-canvas-name') || '',
    roomId: localStorage.getItem('crdt-canvas-last-room') || '',
    color: localStorage.getItem('crdt-canvas-color') || '#7c3aed',
  };
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('join');
  const [actorName, setActorName] = useState(() => loadPrefs().name);
  const [roomId, setRoomId] = useState(() => loadPrefs().roomId);
  const [activeColor] = useState(() => loadPrefs().color);

  const handleJoin = useCallback((name: string, room: string) => {
    setActorName(name);
    setRoomId(room);
    localStorage.setItem('crdt-canvas-name', name);
    localStorage.setItem('crdt-canvas-last-room', room);
    setMode('canvas');
  }, []);

  const handleLaunchDual = useCallback((room: string) => {
    const finalRoom = room || 'demo-' + Math.random().toString(36).slice(2, 8);
    setRoomId(finalRoom);
    localStorage.setItem('crdt-canvas-last-room', finalRoom);
    setMode('dual');
  }, []);

  const handleLeave = useCallback(() => {
    setMode('join');
  }, []);

  const handleSwitchRoom = useCallback((newRoom: string) => {
    setRoomId(newRoom);
    localStorage.setItem('crdt-canvas-last-room', newRoom);
    setMode('canvas');
  }, []);

  const handleToggleSplit = useCallback(() => {
    setMode(m => (m === 'dual' ? 'canvas' : 'dual'));
  }, []);

  return (
    <Box className="pewdiepie-bg" sx={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'transparent',
      overflow: 'hidden',
    }}>
      {mode === 'join' && (
        <JoinScreen
          onJoin={handleJoin}
          onLaunchDual={handleLaunchDual}
        />
      )}

      {mode === 'dual' && (
        <DualPeerContainer
          roomId={roomId || 'demo-dual'}
          onExitDual={() => setMode('canvas')}
        />
      )}

      {mode === 'canvas' && (
        <SingleCanvasView
          actorName={actorName || 'Alice'}
          roomId={roomId || 'demo-room'}
          initialColor={activeColor}
          onLeave={handleLeave}
          onSwitchRoom={handleSwitchRoom}
          onToggleSplitScreen={handleToggleSplit}
          isSplitScreen={false}
          hideShowcase={false}
        />
      )}
    </Box>
  );
}