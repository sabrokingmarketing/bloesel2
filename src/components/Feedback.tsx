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

export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
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
