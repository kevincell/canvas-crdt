import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

import { createRoot } from 'react-dom/client';
import { ThemeModeProvider } from './theme/theme';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeModeProvider>
    <App />
  </ThemeModeProvider>,
);
