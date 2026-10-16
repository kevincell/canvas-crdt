import { useState } from 'react';
import { useRoute } from './app/router';
import { loadIdentity, type Identity } from './app/identity';
import { useResolvedTheme } from './app/theme';
import { BoardScreen } from './board/BoardScreen';
import { HomeScreen } from './home/HomeScreen';
import { ToastProvider, TooltipLayer } from './ui/primitives';

export default function App() {
  const route = useRoute();
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const resolved = useResolvedTheme();
  return (
    <ToastProvider>
      <TooltipLayer>
        {route.name === 'board'
          ? <BoardScreen key={route.roomId} route={route} identity={identity} onIdentity={setIdentity} dark={resolved === 'dark'} />
          : <HomeScreen identity={identity} onIdentity={setIdentity} />}
      </TooltipLayer>
    </ToastProvider>
  );
}
