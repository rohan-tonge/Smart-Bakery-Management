import React from 'react';

export function SkeletonItem({ width = '100%', height = '1rem', borderRadius = '8px', style = {}, className = '' }) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="product-card skeleton-card" style={{ pointerEvents: 'none' }}>
      <div style={{ height: '200px', position: 'relative' }} className="skeleton-shimmer" />
      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
        <SkeletonItem width="60%" height="1.25rem" />
        <SkeletonItem width="90%" height="0.85rem" />
        <SkeletonItem width="75%" height="0.85rem" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '1rem' }}>
          <SkeletonItem width="35%" height="1.5rem" />
          <SkeletonItem width="30%" height="2rem" borderRadius="20px" />
        </div>
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 5 }) {
  return (
    <tr className="skeleton-row">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: '1rem 0.75rem' }}>
          <SkeletonItem width={i === 0 ? '70%' : i === columns - 1 ? '50%' : '85%'} height="1rem" />
        </td>
      ))}
    </tr>
  );
}

export default function LoadingSkeleton({ type = 'card', count = 3, columns = 4 }) {
  if (type === 'product-grid') {
    return (
      <div className="product-grid" aria-label="Loading products">
        {Array.from({ length: count }).map((_, idx) => (
          <ProductCardSkeleton key={idx} />
        ))}
      </div>
    );
  }

  if (type === 'table') {
    return (
      <tbody>
        {Array.from({ length: count }).map((_, idx) => (
          <TableRowSkeleton key={idx} columns={columns} />
        ))}
      </tbody>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0' }}>
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonItem key={idx} height="2.5rem" />
      ))}
    </div>
  );
}
