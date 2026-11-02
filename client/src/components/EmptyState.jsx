import React from 'react';
import { ShoppingBag } from 'lucide-react';

export default function EmptyState({
  icon: Icon = ShoppingBag,
  title = 'Nothing found here',
  description = 'There are currently no items matching this criteria.',
  actionLabel,
  onAction,
  actionLink,
  className = '',
}) {
  return (
    <div
      className={`empty-state-box ${className}`}
      style={{
        textAlign: 'center',
        padding: '3.5rem 1.5rem',
        backgroundColor: 'var(--card-bg)',
        borderRadius: '16px',
        border: '1px dashed var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '1.5rem 0',
      }}
    >
      <div
        className="empty-state-icon-float"
        style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          backgroundColor: 'var(--primary-light)',
          color: 'var(--primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.25rem',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <Icon size={30} aria-hidden="true" />
      </div>

      <h3
        style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: 'var(--text-main)',
          margin: '0 0 0.5rem 0',
        }}
      >
        {title}
      </h3>

      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: '0.92rem',
          maxWidth: '420px',
          margin: '0 0 1.5rem 0',
          lineHeight: 1.55,
        }}
      >
        {description}
      </p>

      {actionLabel && (
        actionLink ? (
          <a href={actionLink} className="btn btn-primary btn-sm">
            {actionLabel}
          </a>
        ) : (
          <button type="button" onClick={onAction} className="btn btn-primary btn-sm">
            {actionLabel}
          </button>
        )
      )}
    </div>
  );
}
