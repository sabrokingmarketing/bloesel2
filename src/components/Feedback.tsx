import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Toast = { id: number; text: string; icon: IconName };
const ToastCtx = createContext<(text: string, icon?: IconName) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, icon: IconName = 'check') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, icon }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <Icon name={t.icon} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Open sheets, innermost last: only the top one reacts to Escape and Tab. */
const openSheets: HTMLElement[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet (bottom sheet on phones, centred dialog on larger screens).
 * Focus moves in once when it opens, Tab stays inside it, Escape closes only
 * the top-most sheet, and page scrolling stays locked until the last one closes.
 */
export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Parents often pass a fresh onClose every render (e.g. while data polls); keep the
  // latest in a ref so re-renders never re-run the open effect and steal focus mid-typing.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    openSheets.push(el);
    document.body.style.overflow = 'hidden';
    el.focus();

    const onKey = (e: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        if (!items.length) return e.preventDefault();
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !el.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets.splice(openSheets.indexOf(el), 1);
      if (!openSheets.length) document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" />
        {title && (
          <div className="sheet-head">
            <h2 className="sheet-title">{title}</h2>
            <button className="icon-btn ghost" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
        )}
        {children}
      </div>
    </>
  );
}
