import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_NOTE_TEXT_SIZE, DEFAULT_TEXT_SIZE, ShapeKind, TEXT_LINE_HEIGHT, type Shape } from '@crdt-canvas/engine';
import type { Camera, Point } from './camera';
import { contrastText, displayColor, HAND_FONT, UI_FONT } from './palette';
import { throttle } from '../presence';

export type EditTarget = { kind: 'shape'; shape: Shape } | { kind: 'new-text'; at: Point; color: string; fontSize: number };

export function TextEditor({ target, camera, dark, sketch, onCommit, onLive }: {
  target: EditTarget;
  camera: Camera;
  dark: boolean;
  sketch: boolean;
  onCommit: (text: string) => void;
  onLive?: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);
  const initial = target.kind === 'shape' ? initialText(target.shape) : '';
  const [value, setValue] = useState(initial);
  const live = useMemo(() => onLive ? throttle((text: string) => onLive(text), 450) : null, [onLive]);

  useEffect(() => {
    const focus = () => {
      const el = ref.current;
      if (!el || document.activeElement === el) return;
      el.focus({ preventScroll: true });
      el.select();
    };
    focus();
    const raf = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(raf);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    live?.flush?.();
    onCommit(ref.current?.value ?? value);
  };

  const z = camera.z;
  const font = sketch ? HAND_FONT : UI_FONT;
  let style: React.CSSProperties = {};
  let isTitle = false;

  if (target.kind === 'new-text' || target.shape.data.kind === ShapeKind.Text) {
    const size = target.kind === 'new-text' ? target.fontSize : (target.shape.data as { fontSize?: number }).fontSize ?? DEFAULT_TEXT_SIZE;
    const x = target.kind === 'new-text' ? target.at.x : (target.shape.data as { x: number }).x;
    const y = target.kind === 'new-text' ? target.at.y : (target.shape.data as { y: number }).y;
    const color = target.kind === 'new-text' ? target.color : (target.shape.data as { color: string }).color;
    style = {
      left: x * z + camera.x - 2,
      top: (y - size) * z + camera.y - 1,
      fontSize: size * z,
      lineHeight: TEXT_LINE_HEIGHT,
      color: displayColor(color, dark),
      minWidth: Math.max(24, size * z * 2),
      fontWeight: 500,
    };
  } else {
    const d = target.shape.data;
    if (d.kind === ShapeKind.Note) {
      const pad = Math.max(8, d.w * 0.07) * z;
      style = {
        left: d.x * z + camera.x, top: d.y * z + camera.y, width: d.w * z, height: d.h * z,
        padding: pad, fontSize: (d.fontSize ?? DEFAULT_NOTE_TEXT_SIZE) * z, lineHeight: TEXT_LINE_HEIGHT,
        color: d.color && d.color !== d.bgColor ? d.color : contrastText(d.bgColor), background: d.bgColor,
        borderRadius: Math.min(6, d.w / 8) * z, fontWeight: 500,
      };
    } else if (d.kind === ShapeKind.Rect && d.frameTitle) {
      isTitle = true;
      style = { left: d.x * z + camera.x, top: d.y * z + camera.y - 26, height: 22, fontSize: 12, fontWeight: 600, minWidth: 120, color: 'var(--text)', background: 'var(--panel-solid)', border: '1px solid var(--accent)', borderRadius: 5, padding: '2px 6px' };
    } else if (d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse) {
      const box = d.kind === ShapeKind.Rect
        ? { x: Math.min(d.x, d.x + d.w), y: Math.min(d.y, d.y + d.h), w: Math.abs(d.w), h: Math.abs(d.h) }
        : { x: d.cx - Math.abs(d.rx) * 0.72, y: d.cy - Math.abs(d.ry) * 0.72, w: Math.abs(d.rx) * 1.44, h: Math.abs(d.ry) * 1.44 };
      const filled = (d.fillOpacity ?? 0) >= 0.5;
      style = {
        left: box.x * z + camera.x, top: box.y * z + camera.y, width: box.w * z, height: box.h * z,
        padding: 8 * z, fontSize: 18 * z, lineHeight: TEXT_LINE_HEIGHT, textAlign: 'center',
        color: filled ? contrastText(d.color) : displayColor(d.color, dark), fontWeight: 500,
        display: 'flex', alignItems: 'center',
      };
    }
  }

  // Auto-size free text to its content.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (target.kind === 'shape' && target.shape.data.kind !== ShapeKind.Text && !isTitle)) return;
    el.style.width = '0px';
    el.style.height = '0px';
    el.style.width = `${el.scrollWidth + 4}px`;
    el.style.height = `${el.scrollHeight}px`;
  }, [value, z, target, isTitle]);

  const label = target.kind === 'new-text' ? 'New text' : target.shape.data.kind === ShapeKind.Note ? 'Edit sticky note' : isTitle ? 'Frame title' : 'Edit text';

  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      spellCheck
      rows={isTitle ? 1 : undefined}
      onChange={event => {
        const text = isTitle ? event.target.value.replace(/\n/g, ' ') : event.target.value;
        setValue(text);
        live?.(text);
      }}
      onBlur={commit}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter') || (isTitle && event.key === 'Enter')) {
          event.preventDefault();
          commit();
        }
      }}
      style={{
        position: 'absolute',
        zIndex: 30,
        margin: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        fontFamily: font,
        whiteSpace: target.kind === 'new-text' || (target.kind === 'shape' && target.shape.data.kind === ShapeKind.Text) || isTitle ? 'pre' : 'pre-wrap',
        wordBreak: 'break-word',
        caretColor: 'var(--accent)',
        padding: 0,
        ...style,
      }}
    />
  );
}

function initialText(shape: Shape): string {
  const d = shape.data;
  if (d.kind === ShapeKind.Text || d.kind === ShapeKind.Note) return d.text;
  if (d.kind === ShapeKind.Rect && d.frameTitle) return d.frameTitle;
  if (d.kind === ShapeKind.Rect || d.kind === ShapeKind.Ellipse) return d.label ?? '';
  return '';
}
