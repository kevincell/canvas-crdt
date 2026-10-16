import { useState, useSyncExternalStore } from 'react';
import { ShapeKind, type Shape } from '@crdt-canvas/engine';
import type { Editor, Tool } from '../editor';
import { FILLS, FONT_SIZES, INK_COLORS, NOTE_COLORS, STROKE_SIZES, displayColor } from '../canvas/palette';
import { Icon } from '../../ui/icons';
import { IconButton } from '../../ui/primitives';

type Section = 'ink' | 'note' | 'width' | 'fill' | 'dash' | 'font';

/** Which controls make sense for a tool or a set of shapes. */
function sectionsFor(tool: Tool, shapes: Shape[]): Set<Section> {
  const out = new Set<Section>();
  const add = (...s: Section[]) => s.forEach(x => out.add(x));
  if (shapes.length) {
    for (const shape of shapes) {
      const d = shape.data;
      if (d.kind === ShapeKind.Stroke) add('ink', 'width', 'dash');
      if (d.kind === ShapeKind.Line) add('ink', 'width', 'dash');
      if (d.kind === ShapeKind.Rect && !d.frameTitle) add('ink', 'width', 'fill', 'dash');
      if (d.kind === ShapeKind.Ellipse) add('ink', 'width', 'fill', 'dash');
      if (d.kind === ShapeKind.Text) add('ink', 'font');
      if (d.kind === ShapeKind.Note) add('note', 'font');
    }
    return out;
  }
  switch (tool) {
    case 'pen': add('ink', 'width', 'dash'); break;
    case 'rect': case 'ellipse': add('ink', 'width', 'fill', 'dash'); break;
    case 'line': case 'arrow': add('ink', 'width', 'dash'); break;
    case 'text': add('ink', 'font'); break;
    case 'note': add('note', 'font'); break;
  }
  return out;
}

export function StylePanel({ editor, compact, dark }: { editor: Editor; compact: boolean; dark: boolean }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const snapshot = useSyncExternalStore(editor.session.store.subscribe, editor.session.store.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  if (editor.readOnly) return null;
  const shapes = state.selection.map(id => snapshot.byId.get(id)).filter((s): s is Shape => Boolean(s && !s.deleted));
  const sections = sectionsFor(state.tool, shapes);
  const hasSelection = shapes.length > 0;
  if (!sections.size && !hasSelection) return null;
  const style = state.style;
  const locked = hasSelection && shapes.every(s => s.data.locked);
  const notes = shapes.filter(s => s.data.kind === ShapeKind.Note).length;

  // Phones: the panel would cover the work; show a toggle instead.
  if (compact && !expanded) {
    return (
      <div className="panel" style={{ position: 'absolute', left: 12, top: 64, zIndex: 18, padding: 3 }} onPointerDown={event => event.stopPropagation()}>
        <IconButton icon="sliders" label={hasSelection ? `Style and actions (${shapes.length} selected)` : 'Style'} size="sm" onClick={() => setExpanded(true)}>
          <span style={{ position: 'absolute', right: 3, bottom: 3, width: 9, height: 9, borderRadius: 5, border: '1px solid var(--border-strong)', background: sections.has('note') && !sections.has('ink') ? style.noteColor : displayColor(style.color, dark) }} />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      className="panel"
      aria-label="Style"
      style={{
        position: 'absolute', left: 12, top: compact ? 64 : 68, zIndex: 18, width: 212, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100% - 160px)', overflowY: 'auto',
        animation: 'pop 140ms var(--ease)',
      }}
      data-scrollable
      onPointerDown={event => event.stopPropagation()}
    >
      {compact && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '-6px -6px -8px 0' }}>
          <IconButton icon="x" label="Hide style panel" size="sm" onClick={() => setExpanded(false)} />
        </div>
      )}
      {sections.has('ink') && (
        <Row label="Color">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {INK_COLORS.map(color => (
              <button key={color} type="button" className="swatch" aria-label={`Color ${color}`} aria-pressed={style.color === color} style={{ background: displayColor(color, dark) }} onClick={() => editor.setStyle({ color })} />
            ))}
            <label className="swatch" title="Custom colour" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
              <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}$/i.test(style.color) ? style.color : '#000000'} onChange={event => editor.setStyle({ color: event.target.value })} style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
            </label>
          </div>
        </Row>
      )}
      {sections.has('note') && (
        <Row label="Paper">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {NOTE_COLORS.map(color => (
              <button key={color} type="button" className="swatch" aria-label={`Note colour ${color}`} aria-pressed={style.noteColor === color} style={{ background: color, borderRadius: 5 }} onClick={() => editor.setStyle({ noteColor: color })} />
            ))}
          </div>
        </Row>
      )}
      {sections.has('width') && (
        <Row label="Stroke">
          <div className="segmented" role="group" aria-label="Stroke width">
            {STROKE_SIZES.map(size => (
              <button key={size.id} type="button" aria-label={size.label} title={size.label} aria-pressed={style.strokeWidth === size.value} onClick={() => editor.setStyle({ strokeWidth: size.value })}>
                <span style={{ width: 16, height: Math.max(1.5, size.value / 2.2), borderRadius: 4, background: 'currentColor' }} />
              </button>
            ))}
          </div>
        </Row>
      )}
      {sections.has('dash') && (
        <Row label="Line">
          <div className="segmented" role="group" aria-label="Line style">
            {(['solid', 'dashed', 'dotted'] as const).map(dash => (
              <button key={dash} type="button" aria-label={dash} title={dash} aria-pressed={style.strokeStyle === dash} onClick={() => editor.setStyle({ strokeStyle: dash })}>
                <Icon name={dash} size={16} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        </Row>
      )}
      {sections.has('fill') && (
        <Row label="Fill">
          <div className="segmented" role="group" aria-label="Fill">
            {FILLS.map(fill => (
              <button key={fill.id} type="button" aria-pressed={Math.abs(style.fill - fill.value) < 0.05} onClick={() => editor.setStyle({ fill: fill.value })}>{fill.label}</button>
            ))}
          </div>
        </Row>
      )}
      {sections.has('font') && (
        <Row label="Text size">
          <div className="segmented" role="group" aria-label="Text size">
            {FONT_SIZES.map(size => (
              <button key={size.id} type="button" aria-pressed={style.fontSize === size.value} onClick={() => editor.setStyle({ fontSize: size.value })}>{size.label}</button>
            ))}
          </div>
        </Row>
      )}

      {hasSelection && (
        <>
          <div className="divider-h" style={{ margin: 0 }} />
          <Row label={`${shapes.length} selected`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <IconButton size="sm" icon="copy" label="Duplicate" shortcut="Ctrl+D" onClick={() => editor.duplicateSelection()} disabled={locked} />
              <IconButton size="sm" icon="front" label="Bring to front" shortcut="]" onClick={() => editor.reorder('front')} disabled={locked} />
              <IconButton size="sm" icon="back" label="Send to back" shortcut="[" onClick={() => editor.reorder('back')} disabled={locked} />
              {shapes.length > 1 && <IconButton size="sm" icon="group" label="Group" shortcut="Ctrl+G" onClick={() => editor.groupSelection()} disabled={locked} />}
              {shapes.some(s => s.data.groupId) && <IconButton size="sm" icon="ungroup" label="Ungroup" shortcut="Ctrl+Shift+G" onClick={() => editor.ungroupSelection()} />}
              <IconButton size="sm" icon={locked ? 'unlock' : 'lock'} label={locked ? 'Unlock' : 'Lock'} shortcut="Ctrl+Shift+L" onClick={() => editor.toggleLock()} />
              <IconButton size="sm" icon="trash" label="Delete" shortcut="Del" onClick={() => editor.deleteSelection()} disabled={locked} />
            </div>
          </Row>
          {shapes.length > 1 && !locked && (
            <Row label="Align">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <IconButton size="sm" icon="alignLeft" label="Align left" shortcut="Alt+A" onClick={() => editor.align('left')} />
                <IconButton size="sm" icon="alignCenterH" label="Align centre" shortcut="Alt+H" onClick={() => editor.align('centerX')} />
                <IconButton size="sm" icon="alignRight" label="Align right" shortcut="Alt+D" onClick={() => editor.align('right')} />
                <IconButton size="sm" icon="alignTop" label="Align top" shortcut="Alt+W" onClick={() => editor.align('top')} />
                <IconButton size="sm" icon="alignCenterV" label="Align middle" shortcut="Alt+V" onClick={() => editor.align('centerY')} />
                <IconButton size="sm" icon="alignBottom" label="Align bottom" shortcut="Alt+S" onClick={() => editor.align('bottom')} />
                {shapes.length > 2 && <IconButton size="sm" icon="distributeH" label="Distribute horizontally" onClick={() => editor.align('distributeX')} />}
                {shapes.length > 2 && <IconButton size="sm" icon="distributeV" label="Distribute vertically" onClick={() => editor.align('distributeY')} />}
                {notes > 1 && <IconButton size="sm" icon="wand" label="Tidy notes into a grid" onClick={() => editor.tidyNotes()} />}
              </div>
            </Row>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
