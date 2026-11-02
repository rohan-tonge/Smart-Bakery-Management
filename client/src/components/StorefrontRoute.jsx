import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function StorefrontRoute({ children }) {
  const { role, loading } = useAuth();
  if (loading) return <div className="container" style={{ padding: '4rem 1rem', textAlign: 'center' }}>Loading…</div>;
  if (role === 'OWNER_MANAGER' || role === 'OWNER') return <Navigate to="/owner" replace />;
  if (role === 'MANAGER') return <Navigate to="/manager" replace />;
  if (role === 'PRODUCTION_STAFF') return <Navigate to="/production" replace />;
  return children;
}
