import { lazy, Suspense, useMemo, useState } from 'react';
import { removeBoard, upsertBoard, useBoards, type BoardEntry } from '../app/boards';
import { boardHash, navigate, parseRoute, sanitizeRoomId } from '../app/router';
import { createBoard } from '../app/newBoard';
import { initials, saveIdentity, makeActor, type Identity } from '../app/identity';
import { setThemePreference, useThemePreference } from '../app/theme';
import { Icon, type IconName } from '../ui/icons';
import { IconButton, useToast } from '../ui/primitives';

const TemplatesModal = lazy(() => Promise.all([import('../ui/mui'), import('../features/templates/TemplatesModal')]).then(([ui, m]) => ({ default: ui.withMui(m.TemplatesModal) })));

export function HomeScreen({ identity, onIdentity }: { identity: Identity; onIdentity: (identity: Identity) => void }) {
  const boards = useBoards();
  const toast = useToast();
  const theme = useThemePreference();
  const [query, setQuery] = useState('');
  const [join, setJoin] = useState('');
  const [templates, setTemplates] = useState(false);
  const [name, setName] = useState(identity.name);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return boards
      .filter(b => !q || `${b.title} ${b.id}`.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.lastOpened - a.lastOpened);
  }, [boards, query]);

  const saveName = (value: string) => {
    const clean = value.trim().slice(0, 32);
    if (!clean || clean === identity.name) return;
    saveIdentity({ name: clean, color: identity.color });
    onIdentity({ ...identity, name: clean, actor: makeActor(clean, identity.deviceId) });
  };

  const joinBoard = () => {
    const value = join.trim();
    if (!value) return;
    let hash = '';
    try {
      const url = new URL(value);
      const route = parseRoute(url.hash);
      if (route.name === 'board') hash = boardHash(route.roomId, { key: route.key, viewOnly: route.viewOnly, present: route.present });
      else {
        const legacy = url.searchParams.get('room');
        if (legacy) hash = boardHash(sanitizeRoomId(legacy));
      }
    } catch {
      const id = sanitizeRoomId(value);
      if (id) hash = boardHash(id);
    }
    if (!hash) { toast('That does not look like a board link or code.', { tone: 'error' }); return; }
    if (name.trim()) saveName(name);
    navigate(hash);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'var(--bg)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '14px clamp(16px, 4vw, 24px)', background: 'color-mix(in srgb, var(--bg) 85%, transparent)', backdropFilter: 'var(--blur)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ flex: 'none', display: 'flex' }}><Logo /></span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
          <span style={{ fontWeight: 750, fontSize: 15, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>CRDT Canvas</span>
          <span className="muted home-tagline" style={{ fontSize: 11.5 }}>Free, offline-first, peer-to-peer whiteboard</span>
        </div>
        <span style={{ flex: 1 }} />
        <IconButton icon={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} label={`Theme: ${theme}`} onClick={() => setThemePreference(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: identity.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>{initials(name || 'Guest')}</span>
          <input className="input" aria-label="Your name" placeholder="Your name" value={name} maxLength={32} onChange={e => setName(e.target.value)} onBlur={() => saveName(name)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} style={{ width: 'min(150px, 32vw)', height: 32 }} />
        </label>
      </header>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px clamp(16px, 4vw, 24px) 64px' }}>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 36 }}>
          <ActionCard icon="plus" title="New board" description="Encrypted, saved on this device" primary onClick={() => { if (name.trim()) saveName(name); createBoard(); }} />
          <ActionCard icon="template" title="Start from a template" description="Retro, brainstorm, kanban, architecture" onClick={() => setTemplates(true)} />
          <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650 }}><Icon name="link" size={17} /> Join with a link</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" placeholder="Paste a link or board code" value={join} onChange={e => setJoin(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') joinBoard(); }} aria-label="Board link or code" />
              <button type="button" className="btn primary" onClick={joinBoard} disabled={!join.trim()}>Join</button>
            </div>
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Your boards</h2>
            <span className="muted">{boards.length}</span>
            <span style={{ flex: 1 }} />
            {boards.length > 3 && (
              <div style={{ position: 'relative', width: 240 }}>
                <span style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-faint)' }}><Icon name="search" size={16} /></span>
                <input className="input" placeholder="Search boards" value={query} onChange={e => setQuery(e.target.value)} style={{ paddingLeft: 32 }} aria-label="Search boards" />
              </div>
            )}
          </div>
          {boards.length === 0 ? (
            <div className="panel" style={{ padding: 40, textAlign: 'center', boxShadow: 'none', borderStyle: 'dashed' }}>
              <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 6 }}>No boards yet</div>
              <div className="muted">Boards you create or join appear here. They live in this browser and work offline.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {filtered.map(board => <BoardCard key={board.id} board={board} onDelete={() => { removeBoard(board.id); toast(`Deleted “${board.title}” from this device`); }} />)}
            </div>
          )}
        </section>

        <section style={{ marginTop: 48, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
          <Feature icon="harddrive" title="Offline-first" text="Every board is saved in your browser first. No connection? Keep working; it merges later." />
          <Feature icon="shield" title="End-to-end encrypted" text="The key lives only in the link. The relay that introduces peers cannot read your board." />
          <Feature icon="merge" title="Merges, never overwrites" text="Concurrent edits combine property by property. Real conflicts are shown, never hidden." />
          <Feature icon="sparkles" title="Free, no account" text="Unlimited boards, unlimited collaborators. Install it as an app and use it on a plane." />
        </section>
      </main>

      {templates && (
        <Suspense fallback={null}>
          <TemplatesModal
            open
            onClose={() => setTemplates(false)}
            isCanvasEmpty
            onCreateNewBoard={(shapes, title) => { setTemplates(false); createBoard({ title, content: { kind: 'shapes', shapes } }); }}
            onInsertToCanvas={(shapes, title) => { setTemplates(false); createBoard({ title, content: { kind: 'shapes', shapes } }); }}
          />
        </Suspense>
      )}
    </div>
  );
}

function BoardCard({ board, onDelete }: { board: BoardEntry; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const open = () => navigate(boardHash(board.id, { key: board.key }));
  return (
    <div className="panel" style={{ overflow: 'hidden', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', transition: 'transform 140ms var(--ease), box-shadow 140ms var(--ease)' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'none'; }}>
      <button type="button" onClick={open} aria-label={`Open ${board.title}`} style={{ height: 150, background: 'var(--canvas)', borderBottom: '1px solid var(--border)', display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 0 }}>
        {board.thumbnail
          ? <img src={board.thumbnail} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span className="faint"><Icon name="frame" size={28} /></span>}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 8px 10px 12px' }}>
        <button type="button" onClick={open} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.title}</div>
          <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            {relativeTime(board.lastOpened)}
            {typeof board.shapeCount === 'number' && <span>· {board.shapeCount} objects</span>}
            {board.key && <Icon name="shield" size={11} aria-label="Encrypted" />}
            {board.parentId && <span title="Branch">· branch</span>}
          </div>
        </button>
        <IconButton size="sm" icon="star" label={board.favorite ? 'Unfavourite' : 'Favourite'} active={Boolean(board.favorite)} onClick={() => upsertBoard(board.id, { favorite: !board.favorite })} />
        {confirm
          ? <button type="button" className="btn sm danger" onClick={onDelete} onBlur={() => setConfirm(false)} autoFocus>Delete?</button>
          : <IconButton size="sm" icon="trash" label="Delete from this device" onClick={() => setConfirm(true)} />}
      </div>
    </div>
  );
}

function ActionCard({ icon, title, description, onClick, primary }: { icon: IconName; title: string; description: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="panel" style={{
      padding: 16, display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: 'var(--shadow-sm)',
      background: primary ? 'var(--accent)' : undefined, color: primary ? 'var(--accent-contrast)' : undefined, borderColor: primary ? 'transparent' : undefined,
    }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: primary ? 'rgba(255,255,255,0.18)' : 'var(--accent-soft)', color: primary ? 'inherit' : 'var(--accent)', flex: 'none' }}>
        <Icon name={icon} size={20} />
      </span>
      <span>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, opacity: 0.8 }}>{description}</span>
      </span>
    </button>
  );
}

function Feature({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }}><Icon name={icon} size={18} /></span>
      <div>
        <div style={{ fontWeight: 650, marginBottom: 2 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>{text}</div>
      </div>
    </div>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M9 20.5c2.2-5.8 4.6-9 7-9s2.2 5 4.5 5 2.4-2.6 2.5-3.5" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="23" cy="13" r="2.2" fill="#fff" />
    </svg>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} d ago`;
  return new Date(ts).toLocaleDateString();
}

