import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Editor } from '../editor';
import type { Participant } from '../presence';
import type { SessionStatus } from '../session';
import { Icon, type IconName } from '../../ui/icons';
import { IconButton, MenuItem, Popover, useTooltip } from '../../ui/primitives';
import { initials } from '../../app/identity';

export type PanelId = 'comments' | 'chat' | 'facilitate' | 'versions' | 'library' | 'lab';

export const PANELS: Array<{ id: PanelId; icon: IconName; label: string }> = [
  { id: 'comments', icon: 'comment', label: 'Comments' },
  { id: 'chat', icon: 'chat', label: 'Chat' },
  { id: 'facilitate', icon: 'timer', label: 'Facilitate: timer, voting, retro' },
  { id: 'versions', icon: 'history', label: 'Versions & history' },
  { id: 'library', icon: 'shapes', label: 'Library: reusable stencils' },
  { id: 'lab', icon: 'flask', label: 'CRDT Lab: conflicts, partitions, demos' },
];

export function TopBar({
  editor, title, onRename, status, participants, onFollow, onShare, panel, onPanel, menu, compact, commentCount, readOnly,
}: {
  editor: Editor;
  title: string;
  onRename: (title: string) => void;
  status: SessionStatus;
  participants: Participant[];
  onFollow: (clientId: number | null) => void;
  onShare: () => void;
  panel: PanelId | null;
  onPanel: (panel: PanelId | null) => void;
  menu: ReactNode;
  compact: boolean;
  commentCount: number;
  readOnly: boolean;
}) {
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);

  return (
    <>
      {/* Left cluster */}
      <div className="panel" style={{ position: 'absolute', left: 12, top: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 2, padding: 4, maxWidth: compact ? 'calc(100vw - 160px)' : 460 }} onPointerDown={e => e.stopPropagation()}>
        <IconButton ref={menuRef} icon="menu" label="Menu" onClick={() => setMenuOpen(open => !open)} active={menuOpen} />
        <Popover anchor={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)}>
          <div className="menu" role="menu" onClick={() => setMenuOpen(false)} style={{ maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>{menu}</div>
        </Popover>
        {renaming ? (
          <input
            className="input"
            autoFocus
            aria-label="Board title"
            value={draft}
            maxLength={120}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => { setRenaming(false); if (draft.trim() && draft !== title) onRename(draft.trim()); }}
            onKeyDown={event => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              if (event.key === 'Escape') { setDraft(title); setRenaming(false); }
              event.stopPropagation();
            }}
            style={{ height: 30, width: 220, fontWeight: 600 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { if (!readOnly) { setDraft(title); setRenaming(true); } }}
            title={readOnly ? title : 'Rename board'}
            style={{ height: 32, padding: '0 8px', borderRadius: 'var(--radius-sm)', fontWeight: 650, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: compact ? 140 : 260, cursor: readOnly ? 'default' : 'text' }}
          >{title}</button>
        )}
        {readOnly && <span className="chip" style={{ height: 22, fontSize: 11 }}><Icon name="eye" size={13} /> View only</span>}
        <SyncPill status={status} editor={editor} compact={compact} />
      </div>

      {/* Right cluster */}
      <div style={{ position: 'absolute', right: 12, top: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8 }} onPointerDown={e => e.stopPropagation()}>
        <Avatars participants={participants} followingId={state.followingClientId} onFollow={onFollow} max={compact ? 2 : 5} />
        {!compact && (
          <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 4 }}>
            {PANELS.map(p => (
              <IconButton
                key={p.id}
                icon={p.icon}
                label={p.label}
                active={panel === p.id}
                onClick={() => onPanel(panel === p.id ? null : p.id)}
                badge={p.id === 'comments' && commentCount > 0 ? <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 14, height: 14, borderRadius: 7, background: 'var(--warning)', color: '#1e1e1e', fontSize: 9, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{commentCount}</span> : undefined}
              />
            ))}
          </div>
        )}
        <button type="button" className="btn primary" style={{ height: 36, boxShadow: 'var(--shadow-md)' }} onClick={onShare}>
          <Icon name="share" size={16} /> {!compact && 'Share'}
        </button>
      </div>
    </>
  );
}

function SyncPill({ status, editor, compact }: { status: SessionStatus; editor: Editor; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const session = editor.session;
  const { label, color, icon, detail } = describe(status);
  const tip = useTooltip(detail);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="chip"
        aria-label={`Sync status: ${label}. ${detail}`}
        onClick={() => setOpen(o => !o)}
        style={{ marginLeft: 4, height: 26, cursor: 'pointer', color: 'var(--text-muted)', background: 'transparent' }}
        {...tip}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)`, animation: status.network === 'connecting' ? 'pulse 1.4s infinite' : undefined }} />
        {!compact && label}
        {status.encrypted && <Icon name="shield" size={12} />}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)}>
        <div className="menu" style={{ width: 300, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650, marginBottom: 6 }}><Icon name={icon} size={16} /> {label}</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{detail}</p>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, marginBottom: 10 }}>
            <li style={{ display: 'flex', gap: 8 }}><Icon name="harddrive" size={14} /> {status.persistence === 'ready' ? 'Every change is saved in this browser first.' : status.persistence === 'loading' ? 'Opening the copy saved in this browser…' : status.persistenceError ?? 'Local saving is unavailable.'}</li>
            <li style={{ display: 'flex', gap: 8 }}><Icon name="users" size={14} /> {status.peers ? `Syncing directly with ${status.peers} ${status.peers === 1 ? 'device' : 'devices'} (peer-to-peer).` : 'No collaborators connected right now.'}</li>
            <li style={{ display: 'flex', gap: 8 }}><Icon name="shield" size={14} /> {status.encrypted ? 'End-to-end encrypted: the key lives only in the link.' : 'Legacy room without an encryption key. Create a new board for E2E encryption.'}</li>
            {status.unsyncedEdits > 0 && <li style={{ display: 'flex', gap: 8 }}><Icon name="cloud" size={14} /> {status.unsyncedEdits} local {status.unsyncedEdits === 1 ? 'change' : 'changes'} will merge automatically when a collaborator connects.</li>}
          </ul>
          {!editor.readOnly && (
            status.network === 'paused'
              ? <button type="button" className="btn primary sm" onClick={() => { session.resumeSync(); setOpen(false); }}><Icon name="play" size={13} /> Resume sync</button>
              : <button type="button" className="btn sm" onClick={() => { session.pauseSync(); setOpen(false); }} title="Work privately; your changes merge when you resume"><Icon name="pause" size={13} /> Pause sync (draft privately)</button>
          )}
        </div>
      </Popover>
    </>
  );
}

function describe(status: SessionStatus): { label: string; color: string; icon: IconName; detail: string } {
  if (status.persistence === 'error' || status.persistence === 'migration-error') {
    return { label: 'Not saved', color: 'var(--danger)', icon: 'alert', detail: status.persistenceError ?? 'This board could not be saved locally.' };
  }
  if (status.persistence === 'loading') return { label: 'Opening', color: 'var(--text-faint)', icon: 'harddrive', detail: 'Loading the copy saved on this device.' };
  if (status.network === 'paused') return { label: 'Sync paused', color: 'var(--warning)', icon: 'pause', detail: 'You are drafting privately. Changes stay on this device until you resume.' };
  if (status.peers > 0) return { label: `Live · ${status.peers + 1}`, color: 'var(--success)', icon: 'users', detail: 'Changes sync instantly and merge conflict-free.' };
  if (status.network === 'connected') return { label: 'Saved', color: 'var(--success)', icon: 'harddrive', detail: 'Saved on this device. Waiting for collaborators.' };
  return { label: 'Offline', color: 'var(--text-faint)', icon: 'wifiOff', detail: 'Saved on this device. Keep working; everything merges when you reconnect.' };
}

function Avatars({ participants, followingId, onFollow, max }: { participants: Participant[]; followingId: number | null; onFollow: (id: number | null) => void; max: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const others = participants.filter(p => !p.isSelf);
  const self = participants.find(p => p.isSelf);
  const shown = [...(self ? [self] : []), ...others].slice(0, max);
  const extra = participants.length - shown.length;
  return (
    <>
      <div ref={ref} className="panel" style={{ display: 'flex', alignItems: 'center', padding: '4px 6px', height: 44, borderRadius: 22, cursor: 'pointer' }} onClick={() => setOpen(o => !o)} role="button" aria-label={`${participants.length} people here`} tabIndex={0}>
        {shown.map((p, i) => (
          <span key={p.clientId} title={p.isSelf ? `${p.name} (you)` : p.name} style={{
            width: 30, height: 30, borderRadius: 15, background: p.color, color: '#fff', display: 'grid', placeItems: 'center',
            fontSize: 11, fontWeight: 700, marginLeft: i ? -6 : 0, border: `2px solid ${followingId === p.clientId ? 'var(--accent)' : 'var(--panel-solid)'}`, zIndex: max - i,
          }}>{initials(p.name)}</span>
        ))}
        {extra > 0 && <span className="muted" style={{ marginLeft: 6, fontSize: 12, fontWeight: 600 }}>+{extra}</span>}
      </div>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="bottom-end">
        <div className="menu" style={{ width: 260 }}>
          <div className="menu-heading">Here now</div>
          {participants.map(p => (
            <MenuItem
              key={p.clientId}
              label={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: p.color }} />{p.name}{p.isSelf ? ' (you)' : ''}{p.editing ? ' · typing' : ''}</span>}
              hint={p.isSelf ? '' : followingId === p.clientId ? 'Following' : 'Follow'}
              disabled={p.isSelf}
              active={followingId === p.clientId}
              onClick={() => { onFollow(followingId === p.clientId ? null : p.clientId); setOpen(false); }}
            />
          ))}
          {participants.length <= 1 && <div className="muted" style={{ padding: '6px 10px', fontSize: 12 }}>Nobody else is here yet. Share the link to collaborate.</div>}
        </div>
      </Popover>
    </>
  );
}
