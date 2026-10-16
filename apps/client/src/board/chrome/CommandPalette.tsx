import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShapeKind, type Shape } from '@crdt-canvas/engine';
import { Icon, type IconName } from '../../ui/icons';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  hint?: string;
  keywords?: string;
  run: () => void;
  disabled?: boolean;
}

type Result = { kind: 'command'; command: Command; score: number } | { kind: 'shape'; shape: Shape; label: string; score: number };

export function CommandPalette({ open, onClose, commands, shapes, onJump, initialQuery = '' }: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  shapes: Shape[];
  onJump: (shape: Shape) => void;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus synchronously so keys typed right after Ctrl+K land in the search box.
  useLayoutEffect(() => {
    if (open) { setQuery(initialQuery); setActive(0); inputRef.current?.focus(); }
  }, [open, initialQuery]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const cmd: Result[] = commands
      .filter(c => !c.disabled)
      .map(c => ({ kind: 'command' as const, command: c, score: q ? fuzzy(`${c.label} ${c.group} ${c.keywords ?? ''}`, q) : 1 }))
      .filter(r => r.score > 0);
    const found: Result[] = q.length >= 2 ? shapes.flatMap(shape => {
      const label = shapeText(shape);
      if (!label) return [];
      const score = fuzzy(label, q);
      return score > 0 ? [{ kind: 'shape' as const, shape, label, score: score + 0.5 }] : [];
    }).slice(0, 30) : [];
    return [...found, ...cmd].sort((a, b) => b.score - a.score).slice(0, 60);
  }, [query, commands, shapes]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (result: Result | undefined) => {
    if (!result) return;
    onClose();
    if (result.kind === 'command') setTimeout(result.command.run, 0);
    else onJump(result.shape);
  };

  let lastGroup = '';
  return createPortal(
    <div className="dialog-backdrop" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="Command palette" style={{ width: 'min(600px, 100%)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search commands and board content…"
            aria-label="Search commands and board content"
            aria-controls="palette-list"
            aria-activedescendant={`palette-${active}`}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15 }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)); }
              else if (event.key === 'Enter') { event.preventDefault(); run(results[active]); }
              else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
              event.stopPropagation();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" style={{ maxHeight: 420, overflowY: 'auto', padding: 6 }}>
          {results.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>No matches</div>}
          {results.map((result, index) => {
            const group = result.kind === 'shape' ? 'On this board' : result.command.group;
            const heading = group !== lastGroup ? <div className="menu-heading" key={`h-${group}-${index}`}>{group}</div> : null;
            lastGroup = group;
            return (
              <div key={result.kind === 'shape' ? result.shape.id : result.command.id}>
                {heading}
                <button
                  id={`palette-${index}`}
                  data-index={index}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className="menu-item"
                  data-active={index === active}
                  onPointerMove={() => setActive(index)}
                  onClick={() => run(result)}
                >
                  <Icon name={result.kind === 'shape' ? shapeIcon(result.shape) : result.command.icon ?? 'command'} size={16} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.kind === 'shape' ? result.label : result.command.label}</span>
                  {result.kind === 'command' && result.command.hint && <span className="hint">{result.command.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function shapeText(shape: Shape): string {
  const d = shape.data;
  if (d.kind === ShapeKind.Text || d.kind === ShapeKind.Note) return d.text.replace(/\s+/g, ' ').trim();
  if (d.kind === ShapeKind.Rect && d.frameTitle) return d.frameTitle;
  if ((d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse) && d.label) return d.label.replace(/\s+/g, ' ').trim();
  return '';
}

function shapeIcon(shape: Shape): IconName {
  const d = shape.data;
  if (d.kind === ShapeKind.Note) return 'note';
  if (d.kind === ShapeKind.Rect && d.frameTitle) return 'frame';
  if (d.kind === ShapeKind.Ellipse) return 'ellipse';
  if (d.kind === ShapeKind.Rect) return 'rect';
  return 'text';
}

/** Subsequence match with bonuses for word starts and contiguous runs. */
function fuzzy(text: string, query: string): number {
  const t = text.toLowerCase();
  if (t.includes(query)) return 3 + (t.startsWith(query) ? 1 : 0) - t.indexOf(query) / 200;
  let ti = 0, score = 0, run = 0;
  for (const ch of query) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    run = found === ti ? run + 1 : 0;
    score += 0.1 + run * 0.15 + (found === 0 || t[found - 1] === ' ' ? 0.3 : 0);
    ti = found + 1;
  }
  return score / Math.max(1, query.length);
}
