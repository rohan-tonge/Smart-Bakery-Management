import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(({ message, type = 'success', title = null, duration = 3200 }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newToast = { id, message, type, title, duration };

    setToasts((prev) => [...prev.slice(-3), newToast]); // keep max 4 toasts at a time

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    return id;
  }, [removeToast]);

  const success = useCallback((message, title) => showToast({ message, type: 'success', title }), [showToast]);
  const info = useCallback((message, title) => showToast({ message, type: 'info', title }), [showToast]);
  const warning = useCallback((message, title) => showToast({ message, type: 'warning', title }), [showToast]);
  const error = useCallback((message, title) => showToast({ message, type: 'error', title }), [showToast]);

  const value = useMemo(
    () => ({ showToast, removeToast, success, info, warning, error }),
    [showToast, removeToast, success, info, warning, error]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Return graceful no-op if used outside provider
    return {
      showToast: () => {},
      removeToast: () => {},
      success: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    };
  }
  return context;
}

function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Notification alerts"
      style={{
        position: 'fixed',
        top: '1.25rem',
        right: '1.25rem',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        pointerEvents: 'none',
        maxWidth: '380px',
        width: 'calc(100vw - 2rem)',
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const isSuccess = toast.type === 'success';
  const isError = toast.type === 'error';
  const isWarning = toast.type === 'warning';

  const IconComponent = isSuccess
    ? CheckCircle2
    : isError
    ? AlertCircle
    : isWarning
    ? AlertTriangle
    : Info;

  const accentColor = isSuccess
    ? 'var(--success)'
    : isError
    ? 'var(--danger)'
    : isWarning
    ? 'var(--warning)'
    : 'var(--primary)';

  const accentBg = isSuccess
    ? 'var(--success-light)'
    : isError
    ? 'var(--danger-light)'
    : isWarning
    ? 'var(--warning-light)'
    : 'var(--primary-light)';

  return (
    <div
      className="toast-notification-item animate-toast-in"
      role="alert"
      style={{
        pointerEvents: 'auto',
        backgroundColor: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-lg)',
        padding: '0.85rem 1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        backdropFilter: 'blur(10px)',
        borderLeft: `4px solid ${accentColor}`,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          backgroundColor: accentBg,
          color: accentColor,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          marginTop: '1px',
        }}
      >
        <IconComponent size={16} strokeWidth={2.5} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <div
            style={{
              fontSize: '0.88rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              marginBottom: '2px',
              lineHeight: 1.3,
            }}
          >
            {toast.title}
          </div>
        )}
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-main)',
            lineHeight: 1.45,
            fontWeight: toast.title ? 500 : 600,
          }}
        >
          {toast.message}
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="toast-close-btn"
        aria-label="Dismiss notification"
        style={{
          background: 'none',
          border: 'none',
          padding: '4px',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s ease',
          flexShrink: 0,
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
