/** Conflict log: every conflict with time, who caused it and before / after snapshots. */
import { useMemo, useState } from 'react';
import * as Y from 'yjs';
import { Box, Button, Chip } from '@mui/material';
import { CenterFocusStrong, CheckCircleOutlineOutlined as CheckCircleOutline, VisibilityOff, Visibility } from '@mui/icons-material';
import { SidePanel, Empty, clock, timeAgo } from './SidePanel';
import { SnapshotPreview } from './SnapshotPreview';
import { type ConflictEntry, loadSnapshot } from '../board/useBoardLogs';
import { type Bounds } from '../board/geometry';
import { ConflictIcon, Segmented } from '../board/ui';
import { type ThemeMode, v } from '../../theme/theme';

const KIND_LABEL: Record<string, string> = {
  concurrent_edit: 'Edited at the same time',
  delete_vs_edit: 'Deleted while being edited',
  concurrent_delete: 'Deleted twice',
  connector_orphan: 'Arrow lost its shape',
  overlap: 'Drawn over someone’s work',
  auto_merge: 'Resizes merged automatically',
};

export function ConflictsPanel({ doc, mode, entries, dismissed, onDismiss, onUndismiss, onResolve, onFocus, onClose, readOnly }: {
  doc: Y.Doc | null; mode: ThemeMode; entries: ConflictEntry[]; dismissed: Set<string>;
  onDismiss: (id: string) => void; onUndismiss: (id: string) => void; onResolve: (id: string) => void;
  onFocus: (area: Bounds | null, shapeIds: string[]) => void; onClose: () => void; readOnly?: boolean;
}) {
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const open = entries.filter(e => !e.resolved);
  const list = useMemo(() => (filter === 'open' ? open : entries.filter(e => e.resolved)), [filter, entries, open]);

  return (
    <SidePanel title="Conflicts" icon={<ConflictIcon />} subtitle={`${open.length} open · ${entries.length - open.length} resolved`} onClose={onClose}>
      <Box sx={{ px: 2, pt: 1.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Segmented value={filter} onChange={setFilter} options={[{ id: 'open', label: `Open (${open.length})` }, { id: 'resolved', label: 'Resolved' }]} />
        <Box sx={{ fontSize: 11.5, color: v('textMuted'), lineHeight: 1.45 }}>
          Open conflicts are outlined in yellow on the board. <b>Dismiss</b> hides the outline just for you — the
          counter stays until someone marks it resolved.
        </Box>
      </Box>
      {!list.length && <Empty>{filter === 'open' ? 'No open conflicts. 🌿' : 'Nothing resolved yet.'}</Empty>}
      {list.map(e => <ConflictCard key={e.id} e={e} doc={doc} mode={mode} dismissed={dismissed.has(e.id)} readOnly={readOnly}
        onDismiss={() => onDismiss(e.id)} onUndismiss={() => onUndismiss(e.id)} onResolve={() => onResolve(e.id)} onFocus={() => onFocus(e.area, e.shapeIds)} />)}
    </SidePanel>
  );
}

function ConflictCard({ e, doc, mode, dismissed, onDismiss, onUndismiss, onResolve, onFocus, readOnly }: {
  e: ConflictEntry; doc: Y.Doc | null; mode: ThemeMode; dismissed: boolean; readOnly?: boolean;
  onDismiss: () => void; onUndismiss: () => void; onResolve: () => void; onFocus: () => void;
}) {
  const [showPics, setShowPics] = useState(!e.resolved);
  const before = useMemo(() => (showPics ? loadSnapshot(doc, e.beforeKey) : null), [doc, e.beforeKey, showPics]);
  const after = useMemo(() => (showPics ? loadSnapshot(doc, e.afterKey) : null), [doc, e.afterKey, showPics]);
  const levelColor = e.level === 'high' ? v('danger') : e.level === 'medium' ? v('warning') : v('info');
  return (
    <Box sx={{ mx: 1.5, my: 1, p: 1.4, borderRadius: '12px', border: `1px solid ${v('border')}`, bgcolor: e.resolved ? v('surface') : v('warningSoft'), opacity: dismissed ? 0.75 : 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: levelColor }} />
        <Box sx={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{KIND_LABEL[e.kind] ?? e.kind}</Box>
        {e.resolved ? <Chip size="small" label="Resolved" sx={{ height: 20, fontSize: 10.5, bgcolor: v('successSoft'), color: v('success') }} />
          : dismissed ? <Chip size="small" label="Dismissed for you" sx={{ height: 20, fontSize: 10.5 }} /> : null}
      </Box>
      <Box sx={{ fontSize: 11.5, color: v('textMuted') }} title={clock(e.ts)}>
        {clock(e.ts)} · {timeAgo(e.ts)}
      </Box>
      <Box sx={{ fontSize: 12.5, mt: 0.6 }}>
        Caused by <b>{e.causedBy.length ? e.causedBy.join(' & ') : 'unknown'}</b>{e.description ? ` — ${e.description}` : ''}
      </Box>
      {e.resolved && e.resolvedBy && <Box sx={{ fontSize: 11.5, color: v('textMuted'), mt: 0.3 }}>Resolved by {e.resolvedBy}{e.resolvedAt ? ` · ${timeAgo(e.resolvedAt)}` : ''}</Box>}

      {showPics ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.8, mt: 1 }}>
          <SnapshotPreview shapes={before} mode={mode} focus={e.area} highlight={e.area} height={110} label="Before" />
          <SnapshotPreview shapes={after} mode={mode} focus={e.area} highlight={e.area} height={110} label="After" />
        </Box>
      ) : (
        <Box component="button" onClick={() => setShowPics(true)} sx={{ mt: 0.8, fontSize: 12, color: v('primaryStrong'), fontWeight: 600 }}>Show before / after</Box>
      )}

      <Box sx={{ display: 'flex', gap: 0.6, mt: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="text" startIcon={<CenterFocusStrong fontSize="small" />} onClick={onFocus}>Show</Button>
        {!e.resolved && !readOnly && <Button size="small" variant="contained" startIcon={<CheckCircleOutline fontSize="small" />} onClick={onResolve}>Mark resolved</Button>}
        {!e.resolved && (dismissed
          ? <Button size="small" variant="text" startIcon={<Visibility fontSize="small" />} onClick={onUndismiss}>Show outline</Button>
          : <Button size="small" variant="text" startIcon={<VisibilityOff fontSize="small" />} onClick={onDismiss}>Dismiss</Button>)}
      </Box>
    </Box>
  );
}
