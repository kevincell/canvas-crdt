import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { summarizeDiff, type MergePreview, type BoardFileHeader } from '@crdt-canvas/engine';
import { Dialog } from '../../ui/primitives';
import { Icon } from '../../ui/icons';
import { boardUrl } from '../../app/router';
import { actorLabel, PEER_COLORS, type Identity } from '../../app/identity';

// ─── Share ──────────────────────────────────────────────────────────────────

export function ShareDialog({ open, onClose, roomId, boardKey, title, onSaveMergeFile, readOnly }: {
  open: boolean; onClose: () => void; roomId: string; boardKey?: string; title: string; onSaveMergeFile: () => void; readOnly: boolean;
}) {
  const [lanHost, setLanHost] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'view' | 'present'>(readOnly ? 'view' : 'edit');

  useEffect(() => {
    if (!open) return;
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') { setLanHost(null); return; }
    // On localhost, links are useless to other devices; offer the LAN address.
    fetch('/api/ip').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.ip && data.ip !== '127.0.0.1') setLanHost(data.ip);
    }).catch(() => {});
  }, [open]);

  const link = useMemo(() => {
    const url = boardUrl(roomId, { key: boardKey, viewOnly: mode !== 'edit', present: mode === 'present' });
    if (!lanHost) return url;
    const parsed = new URL(url);
    parsed.hostname = lanHost;
    return parsed.toString();
  }, [roomId, boardKey, mode, lanHost]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1600); }
    catch { window.prompt('Copy this link', text); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Share “${title}”`} icon="share" width={540}>
      <div className="segmented" role="group" aria-label="Link type" style={{ alignSelf: 'flex-start' }}>
        {!readOnly && <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Can edit</button>}
        <button type="button" aria-pressed={mode === 'view'} onClick={() => setMode('view')}>View only</button>
        <button type="button" aria-pressed={mode === 'present'} onClick={() => setMode('present')}>Present</button>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" readOnly value={link} onFocus={event => event.target.select()} aria-label="Share link" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
            <button type="button" className="btn primary" onClick={() => copy(link, 'link')}>
              <Icon name={copied === 'link' ? 'check' : 'copy'} size={15} /> {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }} className="muted">
            <li style={{ display: 'flex', gap: 8 }}><Icon name="shield" size={15} style={{ flex: 'none', color: boardKey ? 'var(--success)' : 'var(--warning)' }} />
              {boardKey
                ? <span><b style={{ color: 'var(--text)' }}>End-to-end encrypted.</b> The key is in the part of the link after <code>#</code>, which browsers never send to a server. The signaling relay cannot read your board.</span>
                : <span>This is a legacy board without an encryption key. Duplicate it to get an encrypted link.</span>}
            </li>
            <li style={{ display: 'flex', gap: 8 }}><Icon name="users" size={15} style={{ flex: 'none' }} />
              <span>Collaborators connect directly to each other (peer-to-peer). Each copy is saved on each device, so the board survives even if everyone goes offline.</span>
            </li>
            {mode !== 'edit' && <li style={{ display: 'flex', gap: 8 }}><Icon name="eye" size={15} style={{ flex: 'none' }} />
              <span>View-only links hide editing tools. They prevent accidental edits, but anyone holding the key could still write, so share edit-sensitive boards carefully.</span>
            </li>}
            {lanHost && <li style={{ display: 'flex', gap: 8 }}><Icon name="wifi" size={15} style={{ flex: 'none' }} /><span>Using your network address <code>{lanHost}</code> so phones and laptops on the same Wi-Fi can join.</span></li>}
          </ul>
        </div>
        <QrCode value={link} />
      </div>
      <div className="divider-h" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="merge" size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
        <div style={{ flex: 1, fontSize: 12.5 }}>
          <div style={{ fontWeight: 600 }}>No network? Send a merge file.</div>
          <div className="muted">Email it or put it on a USB stick. When someone opens it, their edits and yours combine without overwriting each other.</div>
        </div>
        <button type="button" className="btn" onClick={onSaveMergeFile}><Icon name="download" size={15} /> Save</button>
      </div>
    </Dialog>
  );
}

function QrCode({ value }: { value: string }) {
  const path = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return { d, n };
    } catch {
      return null;
    }
  }, [value]);
  if (!path) return null;
  return (
    <div style={{ padding: 8, background: '#fff', borderRadius: 10, border: '1px solid var(--border)', alignSelf: 'flex-start' }} title="Scan to open on a phone or tablet">
      <svg width={128} height={128} viewBox={`-1 -1 ${path.n + 2} ${path.n + 2}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the share link">
        <path d={path.d} fill="#111" />
      </svg>
    </div>
  );
}

// ─── Merge preview ──────────────────────────────────────────────────────────

export function MergeDialog({ open, onClose, header, preview, onMerge, onImportCopy }: {
  open: boolean; onClose: () => void; header: BoardFileHeader | null; preview: MergePreview | null; onMerge: () => void; onImportCopy: () => void;
}) {
  if (!header || !preview) return null;
  const { diff } = preview;
  return (
    <Dialog open={open} onClose={onClose} title="Merge a board file" icon="merge" width={480}
      footer={<>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        {preview.unrelatedHistory && <button type="button" className="btn" onClick={onImportCopy}>Add as a copy</button>}
        <button type="button" className="btn primary" disabled={!preview.hasNewOperations} onClick={onMerge}>{preview.hasNewOperations ? 'Merge changes' : 'Already up to date'}</button>
      </>}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="filePlus" size={20} /></div>
        <div>
          <div style={{ fontWeight: 650 }}>{header.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {header.shapeCount} objects{header.exportedBy ? ` · saved by ${actorLabel(header.exportedBy)}` : ''} · {new Date(header.exportedAt).toLocaleString()}
          </div>
        </div>
      </div>
      {preview.hasNewOperations ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[['Added', diff.added.length, 'var(--success)'], ['Changed', diff.changed.length, 'var(--accent)'], ['Removed', diff.removed.length, 'var(--danger)'], ['People', diff.byActor.size, 'var(--text)']].map(([label, value, color]) => (
            <div key={label as string} style={{ padding: 10, borderRadius: 10, background: 'var(--surface)', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: color as string }}>{value as number}</div>
              <div className="muted" style={{ fontSize: 11 }}>{label as string}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">This board already contains everything in the file.</p>
      )}
      {preview.hasNewOperations && !diff.isEmpty && <p className="muted" style={{ fontSize: 12.5 }}>{summarizeDiff(diff, actorLabel)}. Edits made on both sides are kept property by property; nothing is overwritten wholesale.</p>}
      {preview.unrelatedHistory && (
        <p style={{ fontSize: 12.5, padding: 10, borderRadius: 8, background: 'var(--warning-soft)' }}>
          This file comes from a different board. Merging adds all of its objects here; “Add as a copy” places them beside your work instead.
        </p>
      )}
    </Dialog>
  );
}

// ─── Shortcuts ──────────────────────────────────────────────────────────────

const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
  ['Tools', [['V', 'Select'], ['H / Space', 'Pan'], ['P', 'Draw'], ['E', 'Eraser'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['A', 'Arrow'], ['L', 'Line'], ['T', 'Text'], ['N', 'Sticky note'], ['F', 'Frame'], ['I', 'Image'], ['K', 'Laser'], ['Q', 'Keep tool after drawing']]],
  ['Edit', [['Ctrl Z / Ctrl Shift Z', 'Undo / redo'], ['Ctrl C / X / V', 'Copy / cut / paste'], ['Ctrl D', 'Duplicate'], ['Alt + drag', 'Duplicate while dragging'], ['Del', 'Delete'], ['Ctrl A', 'Select all'], ['Ctrl G / Ctrl Shift G', 'Group / ungroup'], ['] / [', 'Bring to front / send to back'], ['Ctrl Shift L', 'Lock / unlock'], ['Arrows (Shift)', 'Nudge 1 px (10 px)'], ['Enter', 'Edit text'], ['Double-click', 'Edit, or add text']]],
  ['Drawing', [['Shift', 'Square / straight / keep proportions'], ['Alt', 'Draw or resize from centre'], ['Ctrl while moving', 'Disable snapping'], ['Hold still', 'Snap ink into a clean shape']]],
  ['View', [['Ctrl K', 'Command palette & search'], ['Ctrl F', 'Find on board'], ['Ctrl + / -', 'Zoom'], ['Shift 1', 'Zoom to fit'], ['Shift 2', 'Zoom to selection'], ['Shift 0', 'Zoom to 100%'], ['Ctrl wheel / pinch', 'Zoom at pointer'], ['Wheel / two fingers', 'Pan'], ['G', 'Toggle grid'], ['?', 'This help']]],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" icon="keyboard" width={760}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '6px 28px' }}>
        {SHORTCUTS.map(([group, items]) => (
          <div key={group} style={{ marginBottom: 10 }}>
            <div className="label" style={{ margin: '6px 0' }}>{group}</div>
            {items.map(([key, label]) => (
              <div key={key + label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                <span>{label}</span><span style={{ display: 'flex', gap: 3 }}>{key.split(' / ').map(k => <kbd key={k}>{k}</kbd>)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ─── Profile ────────────────────────────────────────────────────────────────

export function ProfileDialog({ open, onClose, identity, onSave }: { open: boolean; onClose: () => void; identity: Identity; onSave: (name: string, color: string) => void }) {
  const [name, setName] = useState(identity.name);
  const [color, setColor] = useState(identity.color);
  useEffect(() => { if (open) { setName(identity.name); setColor(identity.color); } }, [open, identity]);
  return (
    <Dialog open={open} onClose={onClose} title="Your profile" icon="users" width={400}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!name.trim()} onClick={() => { onSave(name.trim(), color); onClose(); }}>Save</button></>}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="label">Name shown to collaborators</span>
        <input className="input" value={name} maxLength={32} onChange={event => setName(event.target.value)} onKeyDown={event => event.stopPropagation()} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="label">Cursor colour</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PEER_COLORS.map(c => <button key={c} type="button" className="swatch" aria-label={`Colour ${c}`} aria-pressed={color === c} style={{ background: c, width: 26, height: 26 }} onClick={() => setColor(c)} />)}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>No account needed. Your name and colour are stored on this device only.</p>
    </Dialog>
  );
}
