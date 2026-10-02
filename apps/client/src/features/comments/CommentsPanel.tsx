import { useState } from 'react';
import { type Shape, ShapeKind } from '@crdt-canvas/engine';
import { type BoardComment } from './useBoardComments';

interface CommentsPanelProps {
  comments: BoardComment[];
  actorName: string;
  participants: Array<{ id: string; name: string; color: string }>;
  selectedShape: Shape | null;
  onAdd: (text: string, shape: Shape | null) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onReact: (id: string, emoji: string) => void;
  onClose: () => void;
}

const REACTIONS = [{ emoji: '👍', label: 'thumbs up' }, { emoji: '❤️', label: 'heart' }, { emoji: '👀', label: 'eyes' }];

export function CommentsPanel({ comments, actorName, participants, selectedShape, onAdd, onResolve, onReact, onClose }: CommentsPanelProps) {
  const [draft, setDraft] = useState('');
  const active = comments.filter(comment => !comment.resolved);
  const resolved = comments.filter(comment => comment.resolved);

  const submit = () => {
    if (!draft.trim()) return;
    onAdd(draft, selectedShape);
    setDraft('');
  };

  const insertMention = (name: string) => {
    setDraft(current => `${current}${current && !/\s$/.test(current) ? ' ' : ''}@${name} `);
  };

  const reactionControls = (comment: BoardComment) => <div aria-label="Comment reactions" style={{ display: 'flex', gap: 5, marginTop: 8 }}>
    {REACTIONS.map(({ emoji, label }) => <button key={emoji} type="button" aria-label={`Add or remove ${label} reaction`} aria-pressed={comment.myReaction === emoji} onClick={() => onReact(comment.id, emoji)} style={{ padding: '3px 6px', borderRadius: 12, border: comment.myReaction === emoji ? '1px solid rgba(167,139,250,.6)' : '1px solid rgba(255,255,255,.1)', background: comment.myReaction === emoji ? 'rgba(124,58,237,.22)' : 'rgba(255,255,255,.04)', color: '#ddd', fontSize: 10 }}>
      {emoji} {comment.reactions[emoji] ?? ''}
    </button>)}
  </div>;

  const anchorLabel = (comment: BoardComment) => {
    if (!comment.shapeId) return 'Board comment';
    return `Pinned to ${comment.shapeId === selectedShape?.id ? 'selected object' : 'object'}`;
  };

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: '#e2e2f0', background: 'rgba(15,15,22,.98)' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Comments</div>
        <div style={{ marginTop: 2, fontSize: 10, color: '#8888a8' }}>{active.length} open · {resolved.length} resolved</div>
      </div>
      <button type="button" aria-label="Close comments" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 5, color: '#b7b7c9', background: 'rgba(255,255,255,.06)' }}>×</button>
    </header>

    <div aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
      {!comments.length && <div style={{ padding: '30px 12px', textAlign: 'center', color: '#8888a8', fontSize: 12 }}>Start a discussion on this board. Select an object first to pin a comment to it.</div>}
      {active.map(comment => <article key={comment.id} style={{ padding: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.035)', borderRadius: 9 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
          <strong style={{ fontSize: 11, color: comment.actor === actorName ? '#c4b5fd' : '#93c5fd' }}>{comment.actor}</strong>
          <time dateTime={new Date(comment.ts).toISOString()} style={{ fontSize: 9, color: '#77778f' }}>{new Date(comment.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <div style={{ fontSize: 10, color: '#8888a8', marginBottom: 6 }}>{anchorLabel(comment)}</div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.text}</p>
        {reactionControls(comment)}
        <button type="button" onClick={() => onResolve(comment.id, true)} style={{ marginTop: 8, padding: '4px 7px', borderRadius: 5, background: 'rgba(16,185,129,.12)', color: '#6ee7b7', fontSize: 10 }}>Resolve</button>
      </article>)}
      {resolved.length > 0 && <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', color: '#8888a8', fontSize: 11 }}>Resolved ({resolved.length})</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {resolved.map(comment => <article key={comment.id} style={{ padding: 9, border: '1px solid rgba(255,255,255,.06)', borderRadius: 8, opacity: .72 }}>
            <strong style={{ fontSize: 10 }}>{comment.actor}</strong><p style={{ margin: '5px 0', fontSize: 11, whiteSpace: 'pre-wrap' }}>{comment.text}</p>
            {reactionControls(comment)}
            <button type="button" onClick={() => onResolve(comment.id, false)} style={{ padding: '3px 6px', borderRadius: 4, background: 'rgba(255,255,255,.08)', color: '#b7b7c9', fontSize: 10 }}>Reopen</button>
          </article>)}
        </div>
      </details>}
    </div>

    <footer style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,.08)' }}>
      <label htmlFor="board-comment-draft" style={{ display: 'block', marginBottom: 6, color: '#8888a8', fontSize: 10 }}>
        {selectedShape ? `Pinned to ${shapeLabel(selectedShape)}` : 'Comment on board'}
      </label>
      <textarea id="board-comment-draft" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(); }} placeholder="Write a comment…" rows={3} style={{ width: '100%', boxSizing: 'border-box', padding: 9, resize: 'vertical', borderRadius: 7, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: '#e2e2f0', font: '12px Inter, sans-serif' }} />
      {participants.length > 0 && <div aria-label="Mention a collaborator" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {participants.filter(participant => participant.name.trim() && participant.name !== actorName).map(participant => <button key={participant.id} type="button" aria-label={`Mention ${participant.name}`} onClick={() => insertMention(participant.name)} style={{ padding: '3px 6px', borderRadius: 10, background: 'rgba(255,255,255,.06)', color: participant.color || '#b7b7c9', fontSize: 9 }}>@{participant.name}</button>)}
      </div>}
      <button type="button" disabled={!draft.trim()} onClick={submit} style={{ marginTop: 7, padding: '7px 10px', borderRadius: 6, background: draft.trim() ? 'rgba(124,58,237,.55)' : 'rgba(255,255,255,.06)', color: draft.trim() ? '#fff' : '#77778f', fontSize: 11 }}>Comment (⌘Enter)</button>
    </footer>
  </div>;
}

function shapeLabel(shape: Shape): string {
  if (shape.data.kind === ShapeKind.Text) return 'text';
  if (shape.data.kind === ShapeKind.Note) return 'sticky note';
  if (shape.data.kind === ShapeKind.Rect && shape.data.frameTitle) return `frame “${shape.data.frameTitle}”`;
  return shape.data.kind;
}
