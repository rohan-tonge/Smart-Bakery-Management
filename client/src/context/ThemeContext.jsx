import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';

const THEME_STORAGE_KEY = 'smart_bakery_theme';

const ThemeContext = createContext({
  themePreference: 'system',
  effectiveTheme: 'light',
  isDark: false,
  setThemePreference: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  // Read stored preference: 'light' | 'dark' | 'system'
  const [themePreference, setThemePreferenceState] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // localStorage unavailable or restricted
    }
    return 'system';
  });

  // System OS color scheme listener
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemPrefersDark(e.matches);

    // Support both modern addEventListener and legacy addListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handler);
      return () => mediaQuery.removeListener(handler);
    }
  }, []);

  // Compute effective theme: 'light' or 'dark'
  const effectiveTheme = useMemo(() => {
    if (themePreference === 'dark') return 'dark';
    if (themePreference === 'light') return 'light';
    return systemPrefersDark ? 'dark' : 'light';
  }, [themePreference, systemPrefersDark]);

  const isDark = effectiveTheme === 'dark';

  // Apply effective theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', effectiveTheme);
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [effectiveTheme]);

  // Set theme preference with persistence
  const setThemePreference = useCallback((pref) => {
    if (pref !== 'light' && pref !== 'dark' && pref !== 'system') return;
    setThemePreferenceState(pref);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch (err) {
      console.warn('Could not save theme preference to localStorage:', err);
    }
  }, []);

  // Toggle cycling: light -> dark -> system -> light
  const toggleTheme = useCallback(() => {
    setThemePreference((current) => {
      if (current === 'light') return 'dark';
      if (current === 'dark') return 'system';
      return 'light';
    });
  }, [setThemePreference]);

  const contextValue = useMemo(() => ({
    themePreference,
    effectiveTheme,
    isDark,
    setThemePreference,
    toggleTheme,
  }), [themePreference, effectiveTheme, isDark, setThemePreference, toggleTheme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
