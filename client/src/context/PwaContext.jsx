import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const PwaContext = createContext(null);

const DISMISSED_KEY = 'smart_bakery_pwa_dismissed';

export function PwaProvider({ children }) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const [showIosInstructions, setShowIosInstructions] = useState(false);

  // Register service worker with prompt mode for reliable user-controlled updates
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (import.meta.env.DEV) {
        console.log('[PWA] Service worker registered successfully:', swUrl, r);
      }
      // Periodically check for updates (e.g., every 60 minutes)
      if (r) {
        setInterval(() => {
          r.update().catch((err) => {
            console.warn('[PWA] Failed to check for service worker updates:', err);
          });
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.warn('[PWA] Service worker registration error:', error);
      setRegistrationError(error);
    },
  });

  // Check standalone display mode and dismissal persistence
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(Boolean(isStandaloneMode));
      if (isStandaloneMode) {
        setIsInstalled(true);
      }
    };

    checkStandalone();
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = (e) => {
      setIsStandalone(e.matches);
      if (e.matches) setIsInstalled(true);
    };
    mediaQuery.addEventListener?.('change', handleDisplayChange);

    // Check dismissal state in localStorage
    try {
      const dismissedUntil = localStorage.getItem(DISMISSED_KEY);
      if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
        setInstallDismissed(true);
      } else if (dismissedUntil) {
        localStorage.removeItem(DISMISSED_KEY);
      }
    } catch {
      // Ignore localStorage access failures
    }

    return () => {
      mediaQuery.removeEventListener?.('change', handleDisplayChange);
    };
  }, []);

  // Monitor network online / offline status
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Capture beforeinstallprompt event
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (e) => {
      // Prevent automatic browser mini-infobar on mobile
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      if (import.meta.env.DEV) {
        console.log('[PWA] Smart Bakery was successfully installed');
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Detect iOS Safari for manual install guidance
  const isIos = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isWebkit = /safari/.test(ua) && !/chrome|crios|fxios|edgios/.test(ua);
    return isAppleDevice && isWebkit;
  }, []);

  const canInstall = Boolean(deferredPrompt && !isInstalled && !isStandalone && !installDismissed);

  // Trigger browser install prompt
  const promptInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
        }
        setDeferredPrompt(null);
      } catch (err) {
        console.error('[PWA] Error launching install prompt:', err);
      }
    } else if (isIos && !isStandalone) {
      setShowIosInstructions(true);
    }
  }, [deferredPrompt, isIos, isStandalone]);

  // Dismiss install banner for a given number of days
  const dismissInstall = useCallback((days = 7) => {
    setInstallDismissed(true);
    try {
      const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
      localStorage.setItem(DISMISSED_KEY, String(expiresAt));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Trigger app update by notifying service worker
  const updateApp = useCallback(() => {
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  const value = useMemo(
    () => ({
      isOnline,
      isStandalone,
      isInstalled,
      canInstall,
      needRefresh,
      offlineReady,
      registrationError,
      isIos,
      showIosInstructions,
      setShowIosInstructions,
      promptInstall,
      dismissInstall,
      updateApp,
      setOfflineReady,
      setNeedRefresh,
    }),
    [
      isOnline,
      isStandalone,
      isInstalled,
      canInstall,
      needRefresh,
      offlineReady,
      registrationError,
      isIos,
      showIosInstructions,
      promptInstall,
      dismissInstall,
      updateApp,
      setOfflineReady,
      setNeedRefresh,
    ]
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) {
    throw new Error('usePwa must be used within a PwaProvider');
  }
  return context;
}
