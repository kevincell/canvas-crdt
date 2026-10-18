/** Right-hand drawer used by the room, conflicts, checkpoints, comments, chat and about panels. */
import { type ReactNode } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { Close } from '@mui/icons-material';
import { v } from '../../theme/theme';

export function SidePanel({ title, icon, subtitle, onClose, children, width = 360, actions }: {
  title: string; icon?: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; width?: number; actions?: ReactNode;
}) {
  return (
    <Box
      role="complementary"
      aria-label={title}
      sx={{
        width: { xs: '100%', sm: width }, maxWidth: '100%', height: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column',
        bgcolor: v('surface'), borderLeft: `1px solid ${v('border')}`, color: v('text'),
        position: { xs: 'absolute', md: 'relative' }, right: 0, top: 0, zIndex: 40, boxShadow: { xs: v('shadow'), md: 'none' },
        animation: 'fadeIn .15s ease',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.4, borderBottom: `1px solid ${v('border')}` }}>
        {icon && <Box sx={{ display: 'flex', color: v('primary') }}>{icon}</Box>}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ fontWeight: 700, fontSize: 15 }}>{title}</Box>
          {subtitle && <Box sx={{ fontSize: 11.5, color: v('textMuted') }}>{subtitle}</Box>}
        </Box>
        {actions}
        <Tooltip title="Close"><IconButton size="small" onClick={onClose} aria-label="Close panel" sx={{ color: v('textMuted') }}><Close fontSize="small" /></IconButton></Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</Box>
    </Box>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${v('border')}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Box sx={{ flex: 1, fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: v('textFaint') }}>{title}</Box>
        {right}
      </Box>
      {children}
    </Box>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Box sx={{ p: 3, textAlign: 'center', color: v('textFaint'), fontSize: 13 }}>{children}</Box>;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <Box component="span" sx={{ width: size, height: size, borderRadius: '50%', bgcolor: color, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 0 2px ${v('surface')}, 0 0 0 3px ${color}55` }} />;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
