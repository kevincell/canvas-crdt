import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import App from './App'
import './index.css'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c3aed' },
    background: { default: '#0f0f14', paper: '#1e1e2e' },
  },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
})

createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <App />
  </ThemeProvider>,
)
