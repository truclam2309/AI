import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/authApi';
import { tokenStore, UNAUTHORIZED_EVENT } from '../api/client';
import { userApi } from '../api/userApi';
import { LoginRequest, RegisterRequest, User } from '../types/auth';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (payload: LoginRequest) => Promise<void>;
  register: (payload: RegisterRequest) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(tokenStore.get() ? 'loading' : 'anonymous');

  const refreshUser = useCallback(async () => {
    const currentUser = await userApi.getMe();
    setUser(currentUser);
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) {
      setStatus('anonymous');
      return;
    }
    refreshUser().catch(() => {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
    });
  }, [refreshUser]);

  useEffect(() => {
    const onUnauthorized = () => {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (payload: LoginRequest) => {
    const response = await authApi.login(payload);
    tokenStore.set(response.access_token);
    try {
      await refreshUser();
    } catch (error) {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
      throw error;
    }
  }, [refreshUser]);

  const register = useCallback(async (payload: RegisterRequest) => {
    const response = await authApi.register(payload);
    tokenStore.set(response.access_token);
    setUser(response.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, refreshUser, logout }),
    [user, status, login, register, refreshUser, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
