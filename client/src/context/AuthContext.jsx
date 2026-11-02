import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

export function normalizeRole(role) {
  if (!role) return null;
  return String(role).toUpperCase();
}

let authCheckPromise = null;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = async () => {
    if (authCheckPromise) {
      return authCheckPromise;
    }

    authCheckPromise = (async () => {
      let token = getToken();

      // If an access token exists, attempt to verify it with getMe
      if (token) {
        try {
          const res = await api.getMe();
          const userData = res.data?.user || res.data;
          if (userData) {
            setUser({
              ...userData,
              role: normalizeRole(userData.role),
            });
            return;
          }
        } catch (err) {
          console.warn('Access token verification failed, attempting session refresh via cookie:', err.message);
        }
      }

      // If token was missing or expired, attempt seamless restoration via HttpOnly refresh cookie
      try {
        const res = await api.refreshToken();
        const newToken =
          res.data?.accessToken ||
          res.data?.token ||
          res.accessToken ||
          res.token;
        const userData = res.data?.user || res.user || res.data;
        if (newToken && userData) {
          setToken(newToken);
          setUser({
            ...userData,
            role: normalizeRole(userData.role),
          });
        } else {
          setToken(null);
          setUser(null);
        }
      } catch (refreshErr) {
        console.warn('Session restoration failed:', refreshErr?.message || refreshErr);
        setToken(null);
        setUser(null);
      }
    })().finally(() => {
      authCheckPromise = null;
      setLoading(false);
    });

    return authCheckPromise;
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const login = async (email, password) => {
    const res = await api.login(email, password);
    const token =
      res.data?.accessToken ||
      res.data?.token ||
      res.accessToken ||
      res.token;
    const userData = res.data?.user || res.user || res.data;
    if (token) {
      setToken(token);
    }
    const normalizedUser = {
      ...userData,
      role: normalizeRole(userData?.role),
    };
    setUser(normalizedUser);
    return normalizedUser;
  };

  const register = async (payload) => {
    const res = await api.register(payload);
    const token =
      res.data?.accessToken ||
      res.data?.token ||
      res.accessToken ||
      res.token;
    const userData = res.data?.user || res.user || res.data;
    if (token) {
      setToken(token);
    }
    const normalizedUser = userData ? {
      ...userData,
      role: normalizeRole(userData?.role),
    } : null;
    setUser(normalizedUser);
    return normalizedUser;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore logout api errors
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  const value = {
    user,
    role: user?.role || null,
    isAuthenticated: !!user,
    loading,
    login,
    register,
    logout,
    refreshUser: fetchCurrentUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
