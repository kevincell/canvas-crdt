import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';

// ─── Tooltip ────────────────────────────────────────────────────────────────

type TooltipState = { text: string; shortcut?: string; x: number; y: number; placement: 'top' | 'bottom' | 'right' } | null;
const TooltipContext = createContext<(state: TooltipState) => void>(() => {});

export function TooltipLayer({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TooltipState>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!state || !ref.current) { setPos(null); return; }
    const rect = ref.current.getBoundingClientRect();
    let left = state.x - rect.width / 2;
    let top = state.placement === 'top' ? state.y - rect.height - 8 : state.y + 8;
    if (state.placement === 'right') { left = state.x + 8; top = state.y - rect.height / 2; }
    left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, top));
    setPos({ left, top });
  }, [state]);
  return (
    <TooltipContext.Provider value={setState}>
      {children}
      {state && createPortal(
        <div ref={ref} className="tooltip" role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
          {state.text}{state.shortcut && <kbd>{state.shortcut}</kbd>}
        </div>,
        document.body,
      )}
    </TooltipContext.Provider>
  );
}

export function useTooltip(text: string, shortcut?: string, placement: 'top' | 'bottom' | 'right' = 'bottom') {
  const show = useContext(TooltipContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    show(null);
  }, [show]);
  const onEnter = useCallback((event: React.PointerEvent | React.FocusEvent) => {
    if ('pointerType' in event && event.pointerType === 'touch') return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const x = placement === 'right' ? rect.right : rect.left + rect.width / 2;
      const y = placement === 'top' ? rect.top : placement === 'right' ? rect.top + rect.height / 2 : rect.bottom;
      show({ text, shortcut, x, y, placement });
    }, 380);
  }, [show, text, shortcut, placement]);
  return { onPointerEnter: onEnter, onPointerLeave: hide, onFocus: onEnter, onBlur: hide, onPointerDown: hide };
}

type IconButtonProps = {
  icon?: IconName;
  label: string;
  shortcut?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  tooltip?: 'top' | 'bottom' | 'right' | false;
  badge?: ReactNode;
  className?: string;
  children?: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, onClick, active, disabled, size = 'md', tooltip = 'bottom', badge, className = '', children, ...rest },
  ref,
) {
  const tip = useTooltip(label, shortcut, tooltip || 'bottom');
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn ${size === 'sm' ? 'sm' : ''} ${className}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      aria-keyshortcuts={shortcut}
      disabled={disabled}
      onClick={onClick}
      {...(tooltip ? tip : {})}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
      {badge}
    </button>
  );
});

// ─── Popover ────────────────────────────────────────────────────────────────

export function Popover({
  anchor, open, onClose, children, placement = 'bottom-start', offset = 8,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'top' | 'right-start';
  offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !ref.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + offset;
    if (placement === 'bottom-end') left = a.right - p.width;
    if (placement.startsWith('top')) top = a.top - p.height - offset;
    if (placement === 'top-end') left = a.right - p.width;
    if (placement === 'top') left = a.left + a.width / 2 - p.width / 2;
    if (placement === 'right-start') { left = a.right + offset; top = a.top; }
    left = Math.max(8, Math.min(window.innerWidth - p.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - p.height - 8, top));
    setPos({ left, top });
  }, [open, anchor, placement, offset, children]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', zIndex: 1500, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon, label, hint, onClick, disabled, active, danger }: {
  icon?: IconName; label: ReactNode; hint?: string; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className="menu-item" data-active={active} disabled={disabled} onClick={onClick} style={danger ? { color: 'var(--danger)' } : undefined}>
      {icon ? <Icon name={icon} size={16} /> : <span style={{ width: 16 }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint && <span className="hint">{hint}</span>}
    </button>
  );
}

// ─── Dialog ─────────────────────────────────────────────────────────────────

export function Dialog({ open, onClose, title, icon, children, footer, width }: {
  open: boolean; onClose: () => void; title: string; icon?: IconName; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    // Focus synchronously: the first field, else the primary action, else anything focusable.
    const body = ref.current;
    const target = body?.querySelector<HTMLElement>('.dialog-body input:not([readonly]), .dialog-body textarea, .dialog-footer button.primary, .dialog-body button, button');
    target?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Don't hand focus back to the button that opened us (Enter would reopen it).
      if (previous && previous !== document.body && !previous.matches('button')) previous.focus?.();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="dialog-header">
          {icon && <span style={{ color: 'var(--accent)', display: 'flex' }}><Icon name={icon} size={20} /></span>}
          <h2>{title}</h2>
          <span style={{ flex: 1 }} />
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} tooltip={false} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ─── Toasts ─────────────────────────────────────────────────────────────────

export type Toast = { id: number; message: ReactNode; tone?: 'info' | 'error'; action?: { label: string; run: () => void }; duration?: number };
type ToastApi = (message: ReactNode, options?: Omit<Toast, 'id' | 'message'>) => void;
const ToastContext = createContext<ToastApi>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback<ToastApi>((message, options = {}) => {
    const id = ++seq.current;
    setToasts(list => [...list.slice(-3), { id, message, ...options }]);
    const duration = options.duration ?? (options.action ? 7000 : 3600);
    if (duration > 0) setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), duration);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'error' : ''}`}>
              {toast.tone === 'error' && <Icon name="alert" size={16} />}
              <span style={{ flex: 1 }}>{toast.message}</span>
              {toast.action && (
                <button type="button" className="btn sm" onClick={() => { toast.action!.run(); setToasts(list => list.filter(t => t.id !== toast.id)); }}>
                  {toast.action.label}
                </button>
              )}
              <button type="button" className="icon-btn sm" aria-label="Dismiss" style={{ color: '#aab' }} onClick={() => setToasts(list => list.filter(t => t.id !== toast.id))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
