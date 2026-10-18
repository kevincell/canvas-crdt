/** Small shared UI pieces for the board (toolbar, selection bar, panels). */
import { type ReactNode, forwardRef } from 'react';
import { Box, IconButton, Tooltip, type SxProps, type Theme } from '@mui/material';
import { v } from '../../theme/theme';
import { type DashStyle, dashPattern } from './model';

export const panelSx: SxProps<Theme> = {
  bgcolor: v('surface'),
  border: `1px solid ${v('border')}`,
  boxShadow: v('shadow'),
  borderRadius: '14px',
  color: v('text'),
};

export const ToolButton = forwardRef<HTMLButtonElement, {
  title: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode; size?: number; danger?: boolean; badge?: number; placement?: 'right' | 'bottom' | 'top' | 'left';
}>(function ToolButton({ title, shortcut, active, disabled, onClick, children, size = 38, danger, badge, placement = 'right' }, ref) {
  return (
    <Tooltip title={shortcut ? `${title}  (${shortcut})` : title} placement={placement} arrow disableInteractive>
      <span style={{ display: 'inline-flex', position: 'relative' }}>
        <IconButton
          ref={ref}
          aria-label={title}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          sx={{
            width: size, height: size, borderRadius: '10px',
            color: danger ? v('danger') : active ? v('primaryStrong') : v('textMuted'),
            bgcolor: active ? v('primarySoft') : 'transparent',
            boxShadow: active ? `inset 0 0 0 1.5px ${v('primary')}` : 'none',
            transition: 'background-color .15s, color .15s',
            '&:hover': { bgcolor: active ? v('primarySoft') : v('surface2'), color: danger ? v('danger') : v('text') },
            '&.Mui-disabled': { color: v('textFaint'), opacity: 0.5 },
          }}
        >
          {children}
        </IconButton>
        {!!badge && (
          <Box sx={{
            position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, px: 0.4, borderRadius: '9px',
            bgcolor: '#D2453A', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center',
            justifyContent: 'center', pointerEvents: 'none', border: `2px solid ${v('surface')}`,
          }}>{badge > 99 ? '99+' : badge}</Box>
        )}
      </span>
    </Tooltip>
  );
});

export function Swatch({ color, active, onClick, title }: { color: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <Tooltip title={title ?? color} disableInteractive>
      <Box
        component="button"
        aria-label={title ?? `Colour ${color}`}
        onClick={onClick}
        sx={{
          width: 22, height: 22, borderRadius: '50%', bgcolor: color, cursor: 'pointer', p: 0, flexShrink: 0,
          border: `2px solid ${active ? v('text') : v('border')}`,
          boxShadow: active ? `0 0 0 2px ${v('surface')} inset` : 'none',
          transition: 'transform .1s', '&:hover': { transform: 'scale(1.12)' },
        }}
      />
    </Tooltip>
  );
}

export function DashPreview({ dash, width = 2.5 }: { dash: DashStyle; width?: number }) {
  const pattern = dashPattern(dash, width).join(' ');
  return (
    <svg width="34" height="10" aria-hidden>
      <line x1="3" y1="5" x2="31" y2="5" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeDasharray={pattern || undefined} />
    </svg>
  );
}

export const DASH_OPTIONS: Array<{ id: DashStyle; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dots', label: 'Dots, small gaps' },
  { id: 'dots-wide', label: 'Dots, long gaps' },
];

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md' }: {
  value: T; options: Array<{ id: T; label: ReactNode; title?: string }>; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.4, p: 0.4, borderRadius: '9px', bgcolor: v('surface2'), border: `1px solid ${v('border')}` }}>
      {options.map(o => (
        <Tooltip key={String(o.id)} title={o.title ?? ''} disableInteractive>
          <Box
            component="button"
            onClick={() => onChange(o.id)}
            aria-pressed={o.id === value}
            sx={{
              minWidth: size === 'sm' ? 26 : 32, height: size === 'sm' ? 24 : 28, px: 0.75, borderRadius: '7px',
              fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: o.id === value ? v('primaryStrong') : v('textMuted'),
              bgcolor: o.id === value ? v('surface') : 'transparent',
              boxShadow: o.id === value ? `0 1px 3px rgba(0,0,0,.12), inset 0 0 0 1px ${v('primary')}` : 'none',
              '&:hover': { color: v('text') },
            }}
          >{o.label}</Box>
        </Tooltip>
      ))}
    </Box>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Box sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: v('textFaint') }}>{children}</Box>;
}

// ── Custom icons (things MUI doesn't have) ──
export function EraserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M15.5 4.5l4 4a1.5 1.5 0 010 2.1L11 19H7l-3-3a1.5 1.5 0 010-2.1L13.4 4.5a1.5 1.5 0 012.1 0z" />
      <path d="M9.5 8.5l6 6" />
      <path d="M11 19h9" strokeLinecap="round" />
    </svg>
  );
}

export function LaserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 20c4-1 8-5 11-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".45" />
      <circle cx="16.5" cy="7.5" r="4.6" fill="currentColor" opacity=".18" />
      <circle cx="16.5" cy="7.5" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function CursorIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" />
    </svg>
  );
}

export function LineIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <path d="M5 19L19 5" />
      <path d="M12 5h7v7" />
    </svg>
  );
}

export function ConflictIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l9 16H3z" />
      <path d="M12 10v4.5" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r=".6" fill="currentColor" />
    </svg>
  );
}
