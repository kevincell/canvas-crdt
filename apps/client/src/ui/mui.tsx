/**
 * MUI is only used by a few legacy panels; this wrapper (and MUI itself) is
 * loaded lazily alongside them so it stays off the critical path.
 */
import { useMemo, type ComponentType } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { useResolvedTheme } from '../app/theme';

function useMuiTheme() {
  const resolved = useResolvedTheme();
  return useMemo(() => createTheme({
    palette: resolved === 'dark'
      ? { mode: 'dark', primary: { main: '#8b8bff' }, background: { default: '#111215', paper: '#1e1f25' }, text: { primary: '#ecedf1', secondary: '#a1a5b3' } }
      : { mode: 'light', primary: { main: '#5b5bf0' }, background: { default: '#f4f5f7', paper: '#ffffff' }, text: { primary: '#16181d', secondary: '#646a78' } },
    typography: { fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, Arial, sans-serif', button: { textTransform: 'none', fontWeight: 600 } },
    shape: { borderRadius: 10 },
  }), [resolved]);
}

export function withMui<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  return function MuiThemed(props: P) {
    const theme = useMuiTheme();
    return <ThemeProvider theme={theme}><Component {...props} /></ThemeProvider>;
  };
}
