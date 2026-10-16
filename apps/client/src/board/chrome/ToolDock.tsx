import { useSyncExternalStore } from 'react';
import type { Editor, Tool } from '../editor';
import { IconButton } from '../../ui/primitives';
import type { IconName } from '../../ui/icons';

export const TOOLS: Array<{ id: Tool; icon: IconName; label: string; key: string }> = [
  { id: 'select', icon: 'select', label: 'Select', key: 'V' },
  { id: 'hand', icon: 'hand', label: 'Hand', key: 'H' },
  { id: 'pen', icon: 'pen', label: 'Draw', key: 'P' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'line', icon: 'line', label: 'Line', key: 'L' },
  { id: 'text', icon: 'text', label: 'Text', key: 'T' },
  { id: 'note', icon: 'note', label: 'Sticky note', key: 'N' },
  { id: 'frame', icon: 'frame', label: 'Frame', key: 'F' },
  { id: 'image', icon: 'image', label: 'Image', key: 'I' },
  { id: 'laser', icon: 'laser', label: 'Laser pointer', key: 'K' },
];

const GROUPS: Tool[][] = [['select', 'hand'], ['pen', 'eraser'], ['rect', 'ellipse', 'arrow', 'line'], ['text', 'note', 'frame', 'image'], ['laser']];

export function ToolDock({ editor, onPickImage, compact }: { editor: Editor; onPickImage: () => void; compact: boolean }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const readOnly = editor.readOnly;
  // Phones: two-finger pan replaces Hand; Line and Laser stay in the palette.
  const COMPACT: Tool[][] = [['select'], ['pen', 'eraser'], ['rect', 'ellipse', 'arrow'], ['text', 'note', 'frame', 'image']];
  const visible = readOnly ? [['select', 'hand'], ['laser']] as Tool[][] : compact ? COMPACT : GROUPS;
  return (
    <div
      className="panel"
      role="toolbar"
      aria-label="Tools"
      style={{
        position: 'absolute', left: '50%', bottom: compact ? 10 : 16, transform: 'translateX(-50%)', zIndex: 20,
        display: 'flex', alignItems: 'center', gap: compact ? 0 : 2, padding: compact ? 3 : 5, maxWidth: 'calc(100vw - 16px)', overflowX: 'auto',
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      {visible.map((group, gi) => (
        <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {gi > 0 && <div className="divider-v" />}
          {group.map(id => {
            const tool = TOOLS.find(t => t.id === id)!;
            return (
              <IconButton
                key={id}
                icon={tool.icon}
                label={tool.label}
                shortcut={tool.key}
                tooltip="top"
                size={compact ? 'sm' : 'md'}
                active={state.tool === id}
                onClick={() => {
                  if (id === 'image') { onPickImage(); return; }
                  editor.setTool(id);
                }}
              >
                {!compact && <span className="shortcut">{tool.key}</span>}
              </IconButton>
            );
          })}
        </div>
      ))}
      {!readOnly && !compact && (
        <>
          <div className="divider-v" />
          <IconButton
            icon="pin"
            label={state.toolLocked ? 'Tool lock on: keep the tool after drawing' : 'Tool lock off: return to Select after drawing'}
            shortcut="Q"
            tooltip="top"
            size="sm"
            active={state.toolLocked}
            onClick={() => editor.setState({ toolLocked: !state.toolLocked })}
          />
        </>
      )}
    </div>
  );
}
