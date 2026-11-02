import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export default function PageTransition({ children }) {
  const location = useLocation();
  const containerRef = useRef(null);

  useEffect(() => {
    // Scroll window to top smoothly on route change, unless an anchor/hash was specified
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    const node = containerRef.current;
    if (!node) return;

    // Trigger page entrance animation cleanly
    node.classList.remove('page-enter-active');
    // Force a DOM reflow so the re-added class triggers the animation
    void node.offsetWidth;
    node.classList.add('page-enter-active');
  }, [location.pathname, location.hash]);

  return (
    <div
      ref={containerRef}
      key={location.pathname}
      className="page-enter-active page-transition-wrapper"
      style={{
        width: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
      }}
    >
      {children}
    </div>
  );
}
