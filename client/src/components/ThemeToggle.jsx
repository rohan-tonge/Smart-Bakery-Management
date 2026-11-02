import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon, Monitor, Check } from 'lucide-react';

export default function ThemeToggle({
  variant = 'compact', // 'compact' | 'segmented'
  showLabels = false,
  className = '',
}) {
  const { themePreference, effectiveTheme, setThemePreference } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close popup when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [open]);

  const options = [
    { key: 'light', label: 'Light', icon: Sun },
    { key: 'dark', label: 'Dark', icon: Moon },
    { key: 'system', label: 'System', icon: Monitor },
  ];

  // If segmented pill view is requested (e.g. for drawers or wide settings bars)
  if (variant === 'segmented') {
    return (
      <div
        className={`theme-segmented-control ${className}`}
        role="radiogroup"
        aria-label="Theme mode"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          backgroundColor: 'var(--bg-main)',
          padding: '3px',
          borderRadius: 'var(--radius-full)',
          border: '1px solid var(--border-color)',
          gap: '2px',
        }}
      >
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = themePreference === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setThemePreference(opt.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: showLabels ? '6px 12px' : '6px 8px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: isSelected ? 'var(--card-bg)' : 'transparent',
                color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                fontWeight: isSelected ? 700 : 500,
                fontSize: '0.82rem',
                border: isSelected ? '1px solid var(--border-color)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title={`${opt.label} mode`}
            >
              <Icon size={15} />
              {showLabels && <span>{opt.label}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // Default: Compact trigger with accessible 3-option dropdown menu
  const ActiveIcon = effectiveTheme === 'dark' ? Moon : Sun;

  return (
    <div
      ref={containerRef}
      className={`theme-toggle-container ${className}`}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        aria-label={`Current theme: ${themePreference}. Click to change theme.`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '38px',
          height: '38px',
          borderRadius: 'var(--radius-full)',
          backgroundColor: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          color: effectiveTheme === 'dark' ? '#fb923c' : '#ea580c',
          boxShadow: 'var(--shadow-sm)',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        title={`Theme: ${themePreference.charAt(0).toUpperCase() + themePreference.slice(1)} (${effectiveTheme})`}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--primary)';
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-color)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <ActiveIcon size={18} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme options"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 1100,
            minWidth: '150px',
            backgroundColor: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            animation: 'fadeInUp 0.15s ease-out',
          }}
        >
          {options.map((opt) => {
            const Icon = opt.icon;
            const isSelected = themePreference === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setThemePreference(opt.key);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isSelected ? 'var(--primary-light)' : 'transparent',
                  color: isSelected ? 'var(--primary-dark)' : 'var(--text-main)',
                  fontWeight: isSelected ? 700 : 500,
                  fontSize: '0.86rem',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-main)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icon size={16} color={isSelected ? 'var(--primary)' : 'var(--text-muted)'} />
                  <span>{opt.label}</span>
                </span>
                {isSelected && <Check size={14} color="var(--primary)" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
