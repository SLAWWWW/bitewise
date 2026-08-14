'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<ToastKind, string> = {
  success: 'var(--success)',
  error: 'var(--critical)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
};

const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {});

/** Call from any client component: `const toast = useToast(); toast('success', 'Approved')`. */
export function useToast() {
  return useContext(ToastContext);
}

function ToastRow({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(toast.id), 4500);
    return () => clearTimeout(timer);
  }, [toast.id, onDone]);

  const Icon = ICONS[toast.kind];
  return (
    <div className="toast" role="status">
      <Icon size={16} color={COLORS[toast.kind]} style={{ marginTop: 1, flexShrink: 0 }} />
      <span className="text-body" style={{ minWidth: 0 }}>
        {toast.message}
      </span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    // Date.now() alone can collide when two toasts fire in the same tick.
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDone={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
