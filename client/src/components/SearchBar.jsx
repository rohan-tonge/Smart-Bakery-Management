import React from 'react';
import { Search, X } from 'lucide-react';

export default function SearchBar({
  value,
  onChange,
  onClear,
  placeholder = 'Search freshly baked goods, sourdough, pastries...',
  className = '',
  style = {},
  autoFocus = false,
}) {
  return (
    <div
      className={`search-bar-wrapper ${className}`}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        ...style,
      }}
    >
      <Search
        size={18}
        style={{
          position: 'absolute',
          left: '14px',
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      <input
        type="text"
        className="input-field search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        style={{
          paddingLeft: '40px',
          paddingRight: value ? '38px' : '14px',
          height: '46px',
          borderRadius: '9999px',
          backgroundColor: 'var(--input-bg, var(--card-bg))',
          border: '1px solid var(--border-color)',
          fontSize: '0.94rem',
          boxShadow: 'var(--shadow-sm)',
          margin: 0,
        }}
        aria-label="Search items"
      />

      {value && (
        <button
          type="button"
          onClick={() => {
            if (onClear) onClear();
            else onChange('');
          }}
          style={{
            position: 'absolute',
            right: '12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            padding: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
          }}
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
