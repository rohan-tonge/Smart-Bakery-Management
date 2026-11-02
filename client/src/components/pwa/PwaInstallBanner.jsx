import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePwa } from '../../context/PwaContext';
import { Download, X, Croissant, Share, PlusSquare, Smartphone } from 'lucide-react';

export default function PwaInstallBanner() {
  const location = useLocation();
  const {
    canInstall,
    promptInstall,
    dismissInstall,
    isStandalone,
    showIosInstructions,
    setShowIosInstructions,
  } = usePwa();

  const isCheckoutOrPayment =
    location.pathname === '/checkout' ||
    location.pathname.startsWith('/payment-upi');

  if (isStandalone || isCheckoutOrPayment) {
    return null;
  }

  return (
    <>
      {/* Native Install Prompt Banner */}
      {canInstall && (
        <aside
          role="region"
          aria-label="Install Smart Bakery App"
          className="pwa-install-banner"
          style={{
            position: 'fixed',
            bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '520px',
            width: 'calc(100vw - 2rem)',
            backgroundColor: 'var(--card-bg, #ffffff)',
            color: 'var(--text-main, #1c1917)',
            borderRadius: 'var(--radius-lg, 16px)',
            boxShadow: 'var(--shadow-xl)',
            border: '1px solid var(--border-color, #ede8e1)',
            padding: '0.875rem 1.25rem',
            zIndex: 9990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            animation: 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                backgroundColor: 'var(--primary-light, #fff7ed)',
                color: 'var(--primary, #ea580c)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Croissant size={24} strokeWidth={2.2} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <strong style={{ fontSize: '0.925rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Install Smart Bakery
                </strong>
                <span
                  style={{
                    fontSize: '0.68rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--primary-light, #fff7ed)',
                    color: 'var(--primary, #ea580c)',
                  }}
                >
                  App
                </span>
              </div>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: '0.785rem',
                  color: 'var(--text-muted, #78716c)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Fast ordering, home screen launch & offline menu
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={promptInstall}
              className="btn btn-primary"
              style={{
                padding: '0.5rem 0.95rem',
                fontSize: '0.825rem',
                borderRadius: '9999px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 600,
              }}
            >
              <Download size={15} />
              <span>Install</span>
            </button>
            <button
              onClick={() => dismissInstall(7)}
              aria-label="Dismiss installation banner for 7 days"
              title="Not now"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted, #78716c)',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </aside>
      )}

      {/* iOS Safari Installation Instructions Modal */}
      {showIosInstructions && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--modal-overlay, rgba(28, 25, 23, 0.65))',
            backdropFilter: 'blur(4px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setShowIosInstructions(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--card-bg, #ffffff)',
              color: 'var(--text-main, #1c1917)',
              borderRadius: 'var(--radius-xl, 24px)',
              padding: '1.75rem',
              maxWidth: '460px',
              width: '100%',
              boxShadow: 'var(--shadow-xl)',
              border: '1px solid var(--border-color, #ede8e1)',
              animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <Smartphone size={22} color="var(--primary, #ea580c)" />
                <h3 id="ios-install-title" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                  Install on iPhone / iPad
                </h3>
              </div>
              <button
                onClick={() => setShowIosInstructions(false)}
                aria-label="Close instructions"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted, #78716c)',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #78716c)', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
              Safari on iOS does not support one-click installation prompts, but you can add Smart Bakery to your home screen in seconds:
            </p>

            <ol style={{ paddingLeft: '1.25rem', margin: '0 0 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
              <li style={{ lineHeight: 1.4 }}>
                Tap the <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Share size={15} /> Share</strong> button in the bottom Safari toolbar.
              </li>
              <li style={{ lineHeight: 1.4 }}>
                Scroll down in the action menu and tap <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><PlusSquare size={15} /> Add to Home Screen</strong>.
              </li>
              <li style={{ lineHeight: 1.4 }}>
                Tap <strong>Add</strong> in the top-right corner to finish.
              </li>
            </ol>

            <button
              onClick={() => setShowIosInstructions(false)}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', borderRadius: '12px', fontWeight: 600 }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
