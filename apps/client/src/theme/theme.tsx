/**
 * Day / Night theme — "café garden" palette.
 *
 * Day:   oat-milk cream surfaces, espresso text, sage-green primary, latte-brown accent.
 * Night: deep forest-moss surfaces, warm parchment text (never pure white — easy on the eyes),
 *        soft sage / caramel accents with enough contrast to read comfortably.
 *
 * Every colour is exposed as a CSS variable (var(--c-…)) so plain styles, MUI `sx`, and the
 * canvas renderer all switch together. The choice is per device (localStorage), so each peer
 * picks their own mode without affecting anyone else.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

export type ThemeMode = 'day' | 'night';

export interface Palette {
  bg: string;          // app background
  surface: string;     // panels, header, toolbar
  surface2: string;    // inputs, hovered rows, secondary panels
  surface3: string;    // pressed / selected rows
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;     // sage
  primaryStrong: string;
  primarySoft: string; // tinted background for primary chips/buttons
  onPrimary: string;
  accent: string;      // latte / caramel
  accentSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
  shadow: string;
  // canvas
  canvasBg: string;
  canvasGrid: string;
  selection: string;
  boxSelectFill: string;
  boxSelectStroke: string;
  conflictArea: string;
  conflictAreaStroke: string;
}

export const PALETTES: Record<ThemeMode, Palette> = {
  day: {
    bg: '#EFE8DC',
    surface: '#FBF7F0',
    surface2: '#F3ECE1',
    surface3: '#E7DDCD',
    border: '#DED2C0',
    borderStrong: '#C9B9A2',
    text: '#3A3226',
    textMuted: '#6F6352',
    textFaint: '#9A8D7A',
    primary: '#6F8F6A',
    primaryStrong: '#557350',
    primarySoft: 'rgba(111, 143, 106, 0.14)',
    onPrimary: '#FFFFFF',
    accent: '#A9754F',
    accentSoft: 'rgba(169, 117, 79, 0.14)',
    danger: '#B95C47',
    dangerSoft: 'rgba(185, 92, 71, 0.12)',
    warning: '#C08A2E',
    warningSoft: 'rgba(214, 160, 58, 0.16)',
    success: '#5E8E5C',
    successSoft: 'rgba(94, 142, 92, 0.14)',
    info: '#5F8299',
    infoSoft: 'rgba(95, 130, 153, 0.14)',
    shadow: '0 10px 30px rgba(84, 66, 41, 0.12), 0 2px 6px rgba(84, 66, 41, 0.08)',
    canvasBg: '#FFFCF6',
    canvasGrid: 'rgba(120, 98, 66, 0.20)',
    selection: '#557350',
    boxSelectFill: 'rgba(0, 102, 204, 0.16)',
    boxSelectStroke: 'rgba(0, 92, 190, 0.85)',
    conflictArea: 'rgba(240, 200, 40, 0.13)',
    conflictAreaStroke: 'rgba(205, 160, 20, 0.55)',
  },
  night: {
    bg: '#161A15',
    surface: '#1F241D',
    surface2: '#272D25',
    surface3: '#31392E',
    border: '#353E32',
    borderStrong: '#4A5545',
    text: '#E6DFD1',
    textMuted: '#B3AA99',
    textFaint: '#857D6F',
    primary: '#9DBE96',
    primaryStrong: '#B4D1AD',
    primarySoft: 'rgba(157, 190, 150, 0.16)',
    onPrimary: '#16200F',
    accent: '#D2A983',
    accentSoft: 'rgba(210, 169, 131, 0.15)',
    danger: '#E2917E',
    dangerSoft: 'rgba(226, 145, 126, 0.15)',
    warning: '#E2C075',
    warningSoft: 'rgba(226, 192, 117, 0.15)',
    success: '#9CC596',
    successSoft: 'rgba(156, 197, 150, 0.15)',
    info: '#94B8CC',
    infoSoft: 'rgba(148, 184, 204, 0.15)',
    shadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)',
    canvasBg: '#1C211B',
    canvasGrid: 'rgba(230, 223, 209, 0.10)',
    selection: '#B4D1AD',
    boxSelectFill: 'rgba(70, 150, 230, 0.18)',
    boxSelectStroke: 'rgba(110, 175, 240, 0.9)',
    conflictArea: 'rgba(240, 205, 70, 0.10)',
    conflictAreaStroke: 'rgba(240, 205, 70, 0.45)',
  },
};

/** Kebab-case CSS variable name for a palette key, e.g. textMuted → --c-text-muted */
export const cssVarName = (key: keyof Palette) => `--c-${String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`;
/** `var(--c-…)` reference for use in styles / sx */
export const v = (key: keyof Palette) => `var(${cssVarName(key)})`;

const STORAGE_KEY = 'crdt-theme-mode';

interface ThemeModeContextValue {
  mode: ThemeMode;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'day',
  palette: PALETTES.day,
  setMode: () => {},
  toggleMode: () => {},
});

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'day' || stored === 'night') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  } catch {
    return 'day';
  }
}

function applyCssVars(mode: ThemeMode) {
  const root = document.documentElement;
  const palette = PALETTES[mode];
  (Object.keys(palette) as Array<keyof Palette>).forEach(key => {
    root.style.setProperty(cssVarName(key), palette[key]);
  });
  root.dataset.theme = mode;
  root.style.colorScheme = mode === 'night' ? 'dark' : 'light';
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);

  // Apply before paint of children (also on first render)
  useMemo(() => { if (typeof document !== 'undefined') applyCssVars(mode); }, [mode]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);
  const toggleMode = useCallback(() => setModeState(m => (m === 'day' ? 'night' : 'day')), []);

  const palette = PALETTES[mode];
  const muiTheme = useMemo(() => createTheme({
    palette: {
      mode: mode === 'night' ? 'dark' : 'light',
      primary: { main: palette.primary, contrastText: palette.onPrimary },
      secondary: { main: palette.accent },
      error: { main: palette.danger },
      warning: { main: palette.warning },
      success: { main: palette.success },
      info: { main: palette.info },
      background: { default: palette.bg, paper: palette.surface },
      text: { primary: palette.text, secondary: palette.textMuted },
      divider: palette.border,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: "'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif",
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', border: `1px solid ${palette.border}` } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { background: palette.text, color: palette.surface, fontSize: 11, fontWeight: 500 },
          arrow: { color: palette.text },
        },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiMenu: { styleOverrides: { paper: { boxShadow: palette.shadow } } },
      MuiPopover: { styleOverrides: { paper: { boxShadow: palette.shadow } } },
      MuiDialog: { styleOverrides: { paper: { boxShadow: palette.shadow } } },
    },
  }), [mode, palette]);

  const value = useMemo(() => ({ mode, palette, setMode, toggleMode }), [mode, palette, setMode, toggleMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={muiTheme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

// ── Canvas ink adaptation ──────────────────────────────────────────────────
// Ink colours are stored as chosen. When drawing, near-black ink is shown light on the night
// canvas (and near-white ink dark on the day canvas) so nobody's drawing disappears for a peer
// who uses the other mode.
function luminance(hex: string): number | null {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function inkFor(color: string, mode: ThemeMode): string {
  const lum = luminance(color);
  if (lum === null) return color;
  if (mode === 'night' && lum < 0.04) return PALETTES.night.text;
  if (mode === 'day' && lum > 0.85) return PALETTES.day.text;
  return color;
}

/** Drawing palette offered in the toolbar — readable on both canvases */
export const INK_COLORS = [
  '#2F2A22', // espresso ink (auto-lightens at night)
  '#B95C47', // terracotta
  '#D6A03A', // honey
  '#6F8F6A', // sage
  '#4F7C8A', // teal slate
  '#7A6BA8', // lavender
  '#C1708F', // rose
  '#8B6A4F', // walnut
];
