import React, { useState } from 'react';
import { usePwa } from '../../context/PwaContext';
import { RefreshCw, X, Sparkles } from 'lucide-react';

export default function PwaUpdateBanner() {
  const { needRefresh, updateApp, setNeedRefresh } = usePwa();
  const [deferred, setDeferred] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!needRefresh || deferred) {
    return null;
  }

  const handleUpdate = () => {
    setUpdating(true);
    updateApp();
  };

  const handleLater = () => {
    setDeferred(true);
  };

  return (
    <aside
      role="region"
      aria-label="Application Update Notice"
      className="pwa-update-banner"
      style={{
        position: 'fixed',
        bottom: '1.25rem',
        right: '1.25rem',
        maxWidth: '420px',
        width: 'calc(100vw - 2.5rem)',
        backgroundColor: 'var(--card-bg, #ffffff)',
        color: 'var(--text-main, #1c1917)',
        borderRadius: 'var(--radius, 14px)',
        boxShadow: 'var(--shadow-xl)',
        border: '1px solid var(--border-color, #ede8e1)',
        padding: '1rem 1.25rem',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'var(--primary-light, #fff7ed)',
              color: 'var(--primary, #ea580c)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Sparkles size={20} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Update Ready</h4>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-muted, #78716c)' }}>
              A new version of Smart Bakery with the latest items and fixes is available.
            </p>
          </div>
        </div>
        <button
          onClick={handleLater}
          aria-label="Dismiss update for now"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #78716c)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
        <button
          onClick={handleLater}
          className="btn btn-outline"
          style={{
            padding: '0.45rem 0.85rem',
            fontSize: '0.825rem',
            borderRadius: '8px',
          }}
        >
          Later
        </button>
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="btn btn-primary"
          style={{
            padding: '0.45rem 1rem',
            fontSize: '0.825rem',
            borderRadius: '8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <RefreshCw size={14} className={updating ? 'spin' : ''} />
          <span>{updating ? 'Updating...' : 'Update Now'}</span>
        </button>
      </div>
    </aside>
  );
}
