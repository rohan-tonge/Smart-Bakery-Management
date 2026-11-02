import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { role, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem auto' }}></div>
          <p style={{ color: 'var(--text-muted)' }}>Loading authentication state...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    // Redirect to their respective authorized dashboard
    if (role === 'OWNER_MANAGER' || role === 'OWNER') {
      return <Navigate to="/owner" replace />;
    }
    if (role === 'MANAGER') return <Navigate to="/manager" replace />;
    if (role === 'PRODUCTION_STAFF') {
      return <Navigate to="/production" replace />;
    }
    if (role === 'CUSTOMER') {
      return <Navigate to="/customer" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return children;
}
