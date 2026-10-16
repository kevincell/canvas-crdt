import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/patrick-hand/latin-400.css';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Installable, offline-capable app shell (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => console.warn('[sw] registration failed', error));
  });
}
