import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { User } from '../types';

export const AUTH_TOKEN_KEY = 'takcakap_auth_token';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signInWithGoogleCredential: (credential: string) => Promise<void>;
  signInWithAdminCredentials: (email: string, password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (payload: { name?: string; phoneNumber?: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const toUser = (raw: any): User => ({
  id: String(raw?.id || ''),
  name: String(raw?.name || 'User'),
  email: String(raw?.email || ''),
  phoneNumber: String(raw?.phoneNumber || ''),
  avatar: String(raw?.avatar || ''),
  role: raw?.role === 'admin' ? 'admin' : 'user',
  isSuspended: Boolean(raw?.isSuspended)
});

const readStoredToken = () => localStorage.getItem(AUTH_TOKEN_KEY);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = (nextToken: string | null, nextUser: User | null) => {
    if (nextToken) {
      localStorage.setItem(AUTH_TOKEN_KEY, nextToken);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    setToken(nextToken);
    setUser(nextUser);
  };

  const refreshProfile = async () => {
    const existingToken = readStoredToken();
    if (!existingToken) {
      applySession(null, null);
      return;
    }

    try {
      const profile = await api.getMe();
      applySession(existingToken, toUser(profile.user));
    } catch (error) {
      console.error('Failed to restore session:', error);
      applySession(null, null);
    }
  };

  useEffect(() => {
    const init = async () => {
      const existingToken = readStoredToken();
      setToken(existingToken);
      if (existingToken) {
        await refreshProfile();
      } else {
        setUser(null);
      }
      setIsLoading(false);
    };

    init();
  }, []);

  const signInWithGoogleCredential = async (credential: string) => {
    const response = await api.googleLogin(credential);
    applySession(response.token, toUser(response.user));
  };

  const signInWithAdminCredentials = async (email: string, password: string) => {
    const response = await api.adminLogin(email, password);
    applySession(response.token, toUser(response.user));
  };

  const updateProfile = async (payload: { name?: string; phoneNumber?: string }) => {
    const response = await api.updateMyAccount(payload);
    if (response?.user) {
      setUser(toUser(response.user));
    }
  };

  const logout = () => {
    applySession(null, null);
  };

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: Boolean(user && token),
      signInWithGoogleCredential,
      signInWithAdminCredentials,
      refreshProfile,
      updateProfile,
      logout
    }),
    [user, token, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
