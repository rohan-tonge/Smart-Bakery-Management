import React, { useState, useEffect, useRef } from 'react';
import { usePwa } from '../../context/PwaContext';
import { WifiOff, Wifi } from 'lucide-react';

export default function OfflineBanner() {
  const { isOnline } = usePwa();
  const [showRestored, setShowRestored] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setShowRestored(false);
    } else if (wasOffline.current) {
      wasOffline.current = false;
      setShowRestored(true);
      const timer = setTimeout(() => setShowRestored(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  if (isOnline && !showRestored) {
    return null;
  }

  if (showRestored) {
    return (
      <aside
        role="status"
        aria-live="polite"
        className="pwa-status-banner pwa-status-online"
        style={{
          backgroundColor: 'var(--success, #15803d)',
          color: '#ffffff',
          padding: '0.625rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          zIndex: 9999,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <Wifi size={18} strokeWidth={2.5} />
        <span>Back online — Live bakery connection restored.</span>
      </aside>
    );
  }

  return (
    <aside
      role="status"
      aria-live="assertive"
      className="pwa-status-banner pwa-status-offline"
      style={{
        backgroundColor: '#78350f',
        color: '#fef3c7',
        borderBottom: '1px solid #92400e',
        padding: '0.625rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.625rem',
        fontSize: '0.85rem',
        fontWeight: 500,
        zIndex: 9999,
        lineHeight: 1.4,
        textAlign: 'center',
      }}
    >
      <WifiOff size={18} strokeWidth={2.2} style={{ flexShrink: 0, color: '#fde68a' }} />
      <span>
        <strong>You are offline.</strong> Browsing previously cached menu is available. Live ordering, UPI payments, and kitchen workstation updates require an active internet connection.
      </span>
    </aside>
  );
}
