import React, { useState } from 'react';
import { Croissant } from 'lucide-react';

export default function CatalogImage({
  src,
  alt,
  className = '',
  style = {},
  compact = false,
}) {
  const [failed, setFailed] = useState(false);
  const isValidUrl =
    typeof src === 'string' &&
    src.trim().length > 0 &&
    (/^(https?:\/\/|\/|data:image\/)/i.test(src.trim()));

  if (isValidUrl && !failed) {
    return (
      <img
        className={`catalog-image ${compact ? 'compact' : ''} ${className}`.trim()}
        src={src}
        alt={alt || 'Bakery product'}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          ...style,
        }}
      />
    );
  }

  return (
    <div
      className={`catalog-image-placeholder ${compact ? 'compact' : ''} ${className}`}
      role="img"
      aria-label={alt ? `${alt} image placeholder` : 'Fresh bakery item'}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? '2px' : '6px',
        backgroundColor: '#fff7ed',
        background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
        color: '#c2410c',
        borderRadius: compact ? '8px' : 'inherit',
        padding: compact ? '4px' : '12px',
        textAlign: 'center',
        ...style,
      }}
    >
      <Croissant size={compact ? 18 : 36} strokeWidth={1.5} aria-hidden="true" />
      {!compact && (
        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#9a3412',
            letterSpacing: '0.01em',
          }}
        >
          Fresh from Kitchen
        </span>
      )}
    </div>
  );
}
