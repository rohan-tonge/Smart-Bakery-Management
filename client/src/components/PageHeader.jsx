import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel = 'Back',
  actions,
  badge,
  className = '',
}) {
  return (
    <div
      className={`page-header-component ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        marginBottom: '2rem',
      }}
    >
      {backTo && (
        <div>
          <Link
            to={backTo}
            className="btn btn-outline btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
            }}
          >
            <ArrowLeft size={15} />
            <span>{backLabel}</span>
          </Link>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h1
              style={{
                fontSize: 'clamp(1.5rem, 3.5vw, 2.1rem)',
                fontWeight: 800,
                color: 'var(--text-main)',
                margin: 0,
                lineHeight: 1.25,
                letterSpacing: '-0.02em',
              }}
            >
              {title}
            </h1>
            {badge && <div>{badge}</div>}
          </div>

          {subtitle && (
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.94rem',
                margin: '0.35rem 0 0 0',
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
