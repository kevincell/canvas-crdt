import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { shapeBBox, summarizeDiff } from '@crdt-canvas/engine';
import type { Editor } from '../editor';
import type { CatchUp } from '../session';
import { Icon } from '../../ui/icons';
import { IconButton, MenuItem, Popover } from '../../ui/primitives';
import { actorLabel } from '../../app/identity';
import { unionOf } from '../canvas/transform';
import { readPeer } from '../presence';
import { withAlpha } from '../canvas/palette';

// ─── Zoom & history ─────────────────────────────────────────────────────────

export function ZoomBar({ editor, compact }: { editor: Editor; compact: boolean }) {
  const camera = useSyncExternalStore(editor.subscribeCamera, editor.getCamera);
  const snapshot = useSyncExternalStore(editor.session.store.subscribe, editor.session.store.getSnapshot);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="panel" style={{ position: 'absolute', left: 12, bottom: compact ? 66 : 16, zIndex: 20, display: 'flex', alignItems: 'center', gap: 2, padding: 4 }} onPointerDown={e => e.stopPropagation()}>
      {!editor.readOnly && (
        <>
          <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" tooltip="top" size="sm" disabled={!snapshot.canUndo} onClick={() => editor.undo()} />
          <IconButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" tooltip="top" size="sm" disabled={!snapshot.canRedo} onClick={() => editor.redo()} />
          <div className="divider-v" />
        </>
      )}
      <IconButton icon="minus" label="Zoom out" shortcut="Ctrl+-" tooltip="top" size="sm" onClick={() => editor.zoomBy(1 / 1.25)} />
      <button ref={ref} type="button" className="btn ghost sm" style={{ minWidth: 52, fontVariantNumeric: 'tabular-nums' }} onClick={() => setOpen(o => !o)} aria-label="Zoom options">
        {Math.round(camera.z * 100)}%
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="top-start">
        <div className="menu" onClick={() => setOpen(false)}>
          <MenuItem icon="fit" label="Zoom to fit" hint="Shift+1" onClick={() => editor.zoomToFit()} />
          <MenuItem icon="select" label="Zoom to selection" hint="Shift+2" disabled={!editor.getState().selection.length} onClick={() => editor.zoomToFit(editor.getState().selection)} />
          <div className="menu-sep" />
          {[0.5, 1, 2].map(z => <MenuItem key={z} label={`${z * 100}%`} hint={z === 1 ? 'Shift+0' : undefined} onClick={() => editor.zoomTo(z)} />)}
        </div>
      </Popover>
      <IconButton icon="plus" label="Zoom in" shortcut="Ctrl+=" tooltip="top" size="sm" onClick={() => editor.zoomBy(1.25)} />
    </div>
  );
}

// ─── Minimap ────────────────────────────────────────────────────────────────

export function Minimap({ editor, dark }: { editor: Editor; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const snapshot = useSyncExternalStore(editor.session.store.subscribe, editor.session.store.getSnapshot);
  const camera = useSyncExternalStore(editor.subscribeCamera, editor.getCamera);
  const [peersTick, setPeersTick] = useState(0);
  const W = 200, H = 130;
  const layout = useRef<{ minX: number; minY: number; scale: number } | null>(null);

  useEffect(() => {
    const awareness = editor.session.awareness;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => { if (!t) t = setTimeout(() => { t = null; setPeersTick(x => x + 1); }, 250); };
    awareness.on('change', onChange);
    return () => { awareness.off('change', onChange); if (t) clearTimeout(t); };
  }, [editor]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const view = editor.visibleBounds();
    const content = unionOf(snapshot.shapes.map(s => shapeBBox(s)));
    const world = unionOf([view, ...(content ? [content] : [])])!;
    const pad = 40 / Math.max(0.2, camera.z);
    const bounds = { minX: world.minX - pad, minY: world.minY - pad, maxX: world.maxX + pad, maxY: world.maxY + pad };
    const scale = Math.min(W / (bounds.maxX - bounds.minX), H / (bounds.maxY - bounds.minY));
    const ox = (W - (bounds.maxX - bounds.minX) * scale) / 2, oy = (H - (bounds.maxY - bounds.minY) * scale) / 2;
    layout.current = { minX: bounds.minX - ox / scale, minY: bounds.minY - oy / scale, scale };
    const tx = (x: number) => (x - bounds.minX) * scale + ox, ty = (y: number) => (y - bounds.minY) * scale + oy;
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.28)' : 'rgba(30,30,40,0.28)';
    for (const shape of snapshot.shapes) {
      const b = shapeBBox(shape);
      const d = shape.data as { bgColor?: string; frameTitle?: string };
      ctx.fillStyle = d.bgColor ?? (d.frameTitle ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(30,30,40,0.07)') : dark ? 'rgba(255,255,255,0.3)' : 'rgba(30,30,40,0.3)');
      ctx.fillRect(tx(b.minX), ty(b.minY), Math.max(1, (b.maxX - b.minX) * scale), Math.max(1, (b.maxY - b.minY) * scale));
    }
    // Collaborators' viewports.
    editor.session.awareness.getStates().forEach((raw, id) => {
      if (id === editor.session.awareness.clientID || !raw) return;
      const peer = readPeer(id, raw);
      if (!peer.viewport) return;
      ctx.strokeStyle = peer.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx(peer.viewport.minX), ty(peer.viewport.minY), (peer.viewport.maxX - peer.viewport.minX) * scale, (peer.viewport.maxY - peer.viewport.minY) * scale);
    });
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5bf0';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = withAlpha(accent, 0.1);
    const vx = tx(view.minX), vy = ty(view.minY), vw = (view.maxX - view.minX) * scale, vh = (view.maxY - view.minY) * scale;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeRect(vx, vy, vw, vh);
  }, [snapshot, camera, dark, editor, peersTick]);

  const jump = (event: React.PointerEvent) => {
    const l = layout.current;
    if (!l) return;
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = l.minX + (event.clientX - rect.left) / l.scale;
    const y = l.minY + (event.clientY - rect.top) / l.scale;
    const z = editor.getCamera().z;
    editor.setCamera({ z, x: editor.viewport.width / 2 - x * z, y: editor.viewport.height / 2 - y * z }, { userInitiated: true });
  };

  return (
    <div className="panel" style={{ position: 'absolute', right: 12, bottom: 16, zIndex: 20, padding: 4, overflow: 'hidden' }} onPointerDown={e => e.stopPropagation()}>
      <canvas
        ref={ref}
        aria-label="Minimap: click or drag to navigate"
        style={{ width: W, height: H, display: 'block', cursor: 'pointer', borderRadius: 8 }}
        onPointerDown={event => { (event.target as HTMLElement).setPointerCapture(event.pointerId); jump(event); }}
        onPointerMove={event => { if (event.buttons & 1) jump(event); }}
      />
    </div>
  );
}

// ─── Catch-up banner ("While you were away") ────────────────────────────────

export function CatchUpBanner({ catchUp, editor, onDismiss }: { catchUp: CatchUp; editor: Editor; onDismiss: () => void }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const showing = state.catchUp?.catchUp === catchUp;
  const heading = catchUp.reason === 'merge' ? 'Merged from file' : catchUp.reason === 'reconnect' ? 'While you were offline' : 'While you were away';
  const summary = summarizeDiff(catchUp.diff, actorLabel);
  const focus = () => { if (catchUp.diff.bounds) editor.zoomToBounds(catchUp.diff.bounds, 1); };
  return (
    <div className="panel" role="status" style={{ position: 'absolute', left: '50%', top: 64, transform: 'translateX(-50%)', zIndex: 21, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 14px', maxWidth: 'calc(100vw - 24px)', animation: 'rise 220ms var(--ease)' }} onPointerDown={e => e.stopPropagation()}>
      <span style={{ color: 'var(--accent)', display: 'flex' }}><Icon name="sparkles" size={16} /></span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontWeight: 650, fontSize: 13 }}>{heading}</span>
        <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
      </div>
      <button type="button" className="btn sm primary" onClick={() => { editor.showCatchUp(catchUp, 'replay'); focus(); }}><Icon name="replay" size={13} /> Replay</button>
      <button type="button" className="btn sm" aria-pressed={showing} onClick={() => { if (showing) editor.showCatchUp(null); else { editor.showCatchUp(catchUp, 'highlight'); focus(); } }}>{showing ? 'Hide' : 'Show'} changes</button>
      <IconButton icon="x" label="Dismiss" size="sm" onClick={() => { editor.showCatchUp(null); onDismiss(); }} />
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

export function EmptyHint({ onTemplates, readOnly }: { onTemplates: () => void; readOnly: boolean }) {
  return (
    <div style={{ position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%, -50%)', zIndex: 5, textAlign: 'center', pointerEvents: 'none', animation: 'fade 400ms var(--ease)' }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6 }}>{readOnly ? 'This board is empty' : 'Start anywhere'}</div>
      {!readOnly && (
        <>
          <div className="muted" style={{ fontSize: 14, marginBottom: 14, lineHeight: 1.6 }}>
            Draw with <kbd>P</kbd>, add a sticky with <kbd>N</kbd>, or double-click to type.<br />
            Hold still at the end of a stroke to snap it into a clean shape.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', pointerEvents: 'auto' }}>
            <button type="button" className="btn" onClick={onTemplates}><Icon name="template" size={15} /> Start from a template</button>
            <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>or press <kbd>Ctrl</kbd> <kbd>K</kbd> for everything</span>
          </div>
        </>
      )}
    </div>
  );
}
