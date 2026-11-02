import React from 'react';
import { Utensils, Sparkles } from 'lucide-react';
import CatalogImage from './CatalogImage';

export default function CategoryNavigation({
  categories = [],
  selectedCategory,
  onSelectCategory,
  totalItemsCount = 0,
}) {
  return (
    <div className="category-navigation-container" style={{ margin: '1rem 0 1.5rem 0' }}>
      <div
        className="category-filter-pills"
        role="tablist"
        aria-label="Filter menu by category"
        style={{
          display: 'flex',
          gap: '0.6rem',
          overflowX: 'auto',
          paddingBottom: '0.5rem',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={!selectedCategory}
          onClick={() => onSelectCategory('')}
          className={`category-pill category-filter-pill ${!selectedCategory ? 'active' : ''}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '9999px',
            fontSize: '0.88rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            whiteSpace: 'nowrap',
            border: !selectedCategory ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
            backgroundColor: !selectedCategory ? 'var(--primary-light)' : 'var(--card-bg)',
            color: !selectedCategory ? 'var(--primary-dark)' : 'var(--text-main)',
            boxShadow: !selectedCategory ? 'var(--shadow-sm)' : 'none',
          }}
        >
          <Sparkles size={16} color={!selectedCategory ? 'var(--primary)' : 'var(--text-muted)'} />
          <span>All Items</span>
          {totalItemsCount > 0 && (
            <span
              style={{
                fontSize: '0.75rem',
                opacity: 0.85,
                background: !selectedCategory ? 'var(--primary-lighter)' : 'var(--bg-main)',
                padding: '1px 6px',
                borderRadius: '10px',
              }}
            >
              {totalItemsCount}
            </span>
          )}
        </button>

        {categories.map((cat) => {
          const catId = cat._id || cat.id;
          const isSelected = selectedCategory === catId;
          const imgUrl = cat.imageUrl || cat.image;

          return (
            <button
              key={catId}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelectCategory(catId)}
              className={`category-pill category-filter-pill ${isSelected ? 'active' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '9999px',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                whiteSpace: 'nowrap',
                border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                backgroundColor: isSelected ? 'var(--primary-light)' : 'var(--card-bg)',
                color: isSelected ? 'var(--primary-dark)' : 'var(--text-main)',
                boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {imgUrl ? (
                <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  <CatalogImage compact src={imgUrl} alt="" />
                </div>
              ) : (
                <Utensils size={15} color={isSelected ? 'var(--primary)' : 'var(--text-muted)'} />
              )}
              <span>{cat.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
