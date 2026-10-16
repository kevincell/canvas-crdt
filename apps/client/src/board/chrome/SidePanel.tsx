import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ShapeKind, type Shape } from '@crdt-canvas/engine';
import type { Editor } from '../editor';
import type { BoardSession } from '../session';
import type { Participant } from '../presence';
import { PANELS, type PanelId } from './TopBar';
import { EXPERIMENTS, runExperiment } from '../lab';
import { Icon } from '../../ui/icons';
import { IconButton } from '../../ui/primitives';
import { actorLabel, type Identity } from '../../app/identity';
import { useBoardComments } from '../../features/comments/useBoardComments';
import { useBoardCheckpoints } from '../../features/checkpoints/useBoardCheckpoints';
import { useStencils } from '../../features/stencils/useStencils';
import type { useFacilitation } from '../../features/facilitation/useFacilitation';

const CommentsPanel = lazy(() => Promise.all([import('../../ui/mui'), import('../../features/comments/CommentsPanel')]).then(([ui, m]) => ({ default: ui.withMui(m.CommentsPanel) })));
const ChatPanel = lazy(() => Promise.all([import('../../ui/mui'), import('../../features/chat/ChatPanel')]).then(([ui, m]) => ({ default: ui.withMui(m.ChatPanel) })));
const FacilitationPanel = lazy(() => Promise.all([import('../../ui/mui'), import('../../features/facilitation/FacilitationPanel')]).then(([ui, m]) => ({ default: ui.withMui(m.FacilitationPanel) })));
const CheckpointsPanel = lazy(() => Promise.all([import('../../ui/mui'), import('../../features/checkpoints/CheckpointsPanel')]).then(([ui, m]) => ({ default: ui.withMui(m.CheckpointsPanel) })));
const StencilsPanel = lazy(() => Promise.all([import('../../ui/mui'), import('../../features/stencils/StencilsPanel')]).then(([ui, m]) => ({ default: ui.withMui(m.StencilsPanel) })));

type Comments = ReturnType<typeof useBoardComments>;
type Facilitation = ReturnType<typeof useFacilitation>;

export function SidePanel({ panel, onClose, editor, session, identity, participants, comments, facilitation, timeline, compact }: {
  panel: PanelId;
  onClose: () => void;
  editor: Editor;
  session: BoardSession;
  identity: Identity;
  participants: Participant[];
  comments: Comments;
  facilitation: Facilitation;
  timeline: TimelineEntry[];
  compact: boolean;
}) {
  const snapshot = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const checkpoints = useBoardCheckpoints(session.doc);
  const stencils = useStencils();
  const selected = state.selection.map(id => snapshot.byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
  const meta = PANELS.find(p => p.id === panel)!;

  return (
    <aside
      className="panel"
      aria-label={meta.label}
      style={{
        position: 'absolute', right: 12, top: 64, bottom: compact ? 70 : 160, zIndex: 19, width: compact ? 'calc(100vw - 24px)' : 340,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'pop 160ms var(--ease)',
      }}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      data-scrollable
    >
      {(panel === 'lab' || panel === 'versions') && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 14px', borderBottom: '1px solid var(--border)' }}>
        <Icon name={meta.icon} size={16} />
        <span style={{ fontWeight: 650, flex: 1 }}>{meta.label.split(':')[0]}</span>
        <IconButton icon="x" label="Close panel" size="sm" onClick={onClose} />
      </div>}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }} className="side-panel-body">
        <Suspense fallback={<div className="muted" style={{ padding: 16 }}>Loading…</div>}>
          {panel === 'comments' && (
            <CommentsPanel
              comments={comments.comments}
              actorName={identity.name}
              participants={participants.map(p => ({ id: String(p.clientId), name: p.name, color: p.color }))}
              selectedShape={selected[0] ?? null}
              onAdd={(text, shape) => {
                const b = shape ? { x: (shape.data as { x?: number }).x ?? 0, y: (shape.data as { y?: number }).y ?? 0 } : editor.viewportCenter();
                comments.addComment({ text, actor: identity.name, shapeId: shape?.id ?? null, anchor: b });
              }}
              onResolve={comments.resolveComment}
              onReact={(id, emoji) => comments.toggleReaction(id, identity.actor, emoji)}
              onClose={onClose}
            />
          )}
          {panel === 'chat' && <ChatPanel doc={session.doc} actorName={identity.name} actorColor={identity.color} onClose={onClose} />}
          {panel === 'facilitate' && (
            <FacilitationPanel
              shapes={snapshot.shapes}
              voting={facilitation.voting}
              maxVotesPerPerson={facilitation.maxVotesPerPerson}
              voteCounts={facilitation.voteCounts}
              remainingSeconds={facilitation.remainingSeconds}
              timerLabel={facilitation.timerLabel}
              timerRunning={facilitation.timerRunning}
              retrospectiveStep={facilitation.retrospectiveStep}
              onSetVoting={facilitation.setVoting}
              onStartTimer={facilitation.startTimer}
              onStopTimer={facilitation.stopTimer}
              onSetRetrospectiveStep={facilitation.setRetrospectiveStep}
              onClose={onClose}
              actorName={identity.name}
            />
          )}
          {panel === 'versions' && (
            <>
              <Timeline editor={editor} timeline={timeline} />
              <div className="divider-h" />
              <CheckpointsPanel
                checkpoints={checkpoints.checkpoints}
                onCreate={name => checkpoints.createCheckpoint(name, identity.name, snapshot.shapes)}
                onRestore={checkpoint => {
                  const ids = editor.insertShapes(checkpoint.shapes, { center: editor.viewportCenter() });
                  editor.select(ids, { expandGroups: false });
                }}
                onDelete={checkpoints.deleteCheckpoint}
                onClose={onClose}
              />
            </>
          )}
          {panel === 'library' && (
            <StencilsPanel
              stencils={stencils.stencils}
              selectedShapes={selected}
              loading={stencils.loading}
              error={stencils.error}
              onSave={stencils.save}
              onInsert={(_stencil, version) => {
                const ids = editor.insertShapes(version.shapes, { center: editor.viewportCenter() });
                editor.select(ids, { expandGroups: false });
              }}
              onDelete={stencils.remove}
              onClose={onClose}
            />
          )}
          {panel === 'lab' && <LabPanel editor={editor} session={session} />}
        </Suspense>
      </div>
    </aside>
  );
}

// ─── Timeline (session time travel) ─────────────────────────────────────────

export interface TimelineEntry { at: number; shapes: Shape[]; actors: string[] }

/** Records the board after each burst of changes (drags collapse into one entry). */
export function useTimeline(session: BoardSession): TimelineEntry[] {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const last = useRef<Shape[] | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const record = () => {
      timer = null;
      const all = session.store.getSnapshot().all;
      if (last.current === all) return;
      const before = new Map((last.current ?? []).map(s => [s.id, s]));
      const actors = [...new Set(all.filter(s => before.get(s.id) !== s).map(s => s.actor))];
      last.current = all;
      setEntries(list => [...list, { at: Date.now(), shapes: all, actors }].slice(-300));
    };
    const onChange = () => { if (timer) clearTimeout(timer); timer = setTimeout(record, 600); };
    record();
    const off = session.store.subscribe(onChange);
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [session]);
  return entries;
}

function Timeline({ editor, timeline }: { editor: Editor; timeline: TimelineEntry[] }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const [index, setIndex] = useState(timeline.length - 1);
  const [playing, setPlaying] = useState(false);
  const active = state.timeTravel !== null;
  useEffect(() => { if (!active) setIndex(timeline.length - 1); }, [timeline.length, active]);
  useEffect(() => () => { editor.setState({ timeTravel: null }); }, [editor]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIndex(i => {
        const next = Math.min(timeline.length - 1, i + 1);
        editor.setState({ timeTravel: next === timeline.length - 1 ? null : { shapes: timeline[next].shapes, label: '' } });
        if (next === timeline.length - 1) setPlaying(false);
        return next;
      });
    }, 450);
    return () => clearInterval(t);
  }, [playing, timeline, editor]);

  const go = (i: number) => {
    setIndex(i);
    editor.setState({ timeTravel: i >= timeline.length - 1 ? null : { shapes: timeline[i].shapes, label: new Date(timeline[i].at).toLocaleTimeString() } });
  };
  const entry = timeline[Math.max(0, Math.min(index, timeline.length - 1))];
  return (
    <section style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="label" style={{ flex: 1 }}>This session</span>
        <span className="muted" style={{ fontSize: 12 }}>{timeline.length} {timeline.length === 1 ? 'version' : 'versions'}</span>
      </div>
      {timeline.length < 2 ? (
        <p className="muted" style={{ fontSize: 12.5 }}>Every burst of changes becomes a version you can scrub back to.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <IconButton size="sm" icon={playing ? 'pause' : 'play'} label={playing ? 'Pause replay' : 'Replay from start'} onClick={() => { if (!playing && index >= timeline.length - 1) go(0); setPlaying(p => !p); }} />
            <input type="range" min={0} max={timeline.length - 1} value={Math.min(index, timeline.length - 1)} onChange={event => { setPlaying(false); go(Number(event.target.value)); }} aria-label="Board history" />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {index >= timeline.length - 1 ? 'Now' : `${new Date(entry.at).toLocaleTimeString()} · ${entry.shapes.filter(s => !s.deleted).length} objects`}
            {entry?.actors.length ? ` · ${[...new Set(entry.actors.map(actorLabel))].slice(0, 3).join(', ')}` : ''}
          </div>
          {active && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn sm primary" disabled={editor.readOnly} onClick={() => { editor.revertTo(entry.shapes); setIndex(timeline.length - 1); }}>Restore this version</button>
              <button type="button" className="btn sm" onClick={() => go(timeline.length - 1)}>Back to now</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── CRDT Lab ───────────────────────────────────────────────────────────────

function LabPanel({ editor, session }: { editor: Editor; session: BoardSession }) {
  const snapshot = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
  const status = useSyncExternalStore(session.subscribeStatus, session.getStatus);
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Each experiment forks this board into a phantom peer, edits both copies concurrently, and merges them through the real sync path. Select a shape first, or a demo note is created.
      </p>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="label">Concurrency experiments</span>
        {EXPERIMENTS.map(exp => (
          <button
            key={exp.id}
            type="button"
            disabled={editor.readOnly}
            onClick={() => {
              const id = runExperiment(session, exp.id, state.selection[0] ?? null, editor.viewportCenter());
              if (id) {
                editor.select([id]);
                // Let the merged state settle, then frame the subject (and any conflict badge).
                setTimeout(() => editor.zoomToFit([id]), 60);
              }
            }}
            style={{ textAlign: 'left', padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <span style={{ fontWeight: 600 }}>{exp.title}</span>
            <span className="muted" style={{ fontSize: 12 }}>{exp.description}</span>
          </button>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="label">Network partition</span>
        <p className="muted" style={{ fontSize: 12.5 }}>Pause sync, keep editing (or edit in another tab), then resume. Changes merge, and the catch-up replay shows what happened.</p>
        <div style={{ display: 'flex', gap: 6 }}>
          {status.network === 'paused'
            ? <button type="button" className="btn sm primary" onClick={() => session.resumeSync()}><Icon name="play" size={13} /> Reconnect</button>
            : <button type="button" className="btn sm" onClick={() => session.pauseSync()}><Icon name="wifiOff" size={13} /> Disconnect</button>}
          <button type="button" className="btn sm" onClick={() => window.open(`${window.location.href.split('&as=')[0]}${window.location.hash.includes('?') ? '&' : '?'}as=Second%20peer`, '_blank', 'noopener')}>
            <Icon name="users" size={13} /> Open a second peer
          </button>
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="label">Live conflicts · {snapshot.conflicts.length}</span>
        {snapshot.conflicts.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>None. Concurrent edits to different properties merge silently; only genuinely ambiguous intent is surfaced.</p>}
        {snapshot.conflicts.map(conflict => {
          const shape = snapshot.byId.get(conflict.shapeId);
          return (
            <button key={conflict.shapeId} type="button" className="menu-item" style={{ height: 'auto', padding: 8 }} onClick={() => { editor.select([conflict.shapeId]); editor.zoomToFit([conflict.shapeId]); }}>
              <Icon name="alert" size={15} style={{ color: conflict.level === 'high' ? 'var(--danger)' : 'var(--warning)' }} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600 }}>{conflict.type === 'delete_vs_edit' ? 'Edit vs delete' : `${conflict.level} intent ambiguity`}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{conflict.actors.map(actorLabel).join(' vs ')} · {shape?.data.kind ?? 'object'}</span>
              </span>
            </button>
          );
        })}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="label">Lenses</span>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={state.authorship} onChange={event => editor.setState({ authorship: event.target.checked })} />
          Who made what (authorship lens)
        </label>
      </section>
      <section className="muted" style={{ fontSize: 11.5, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
        <span>Objects</span><span>{snapshot.shapes.length} live · {snapshot.all.length - snapshot.shapes.length} tombstones</span>
        <span>Document</span><span>client {session.doc.clientID}</span>
        <span>Schema</span><span>v2 (per-property registers)</span>
        <span>Notes</span><span>{snapshot.shapes.filter(s => s.data.kind === ShapeKind.Note).length}</span>
      </section>
    </div>
  );
}
