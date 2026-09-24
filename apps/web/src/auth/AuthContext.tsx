import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginBody, PublicUser, SignupBody } from '@codesync/shared';
import { api, ApiError } from '../lib/api';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (body: LoginBody) => Promise<void>;
  signup: (body: SignupBody) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The JWT lives in an httpOnly cookie JS can't read, so ask the server who we are.
    api
      .me()
      .then((res) => setUser(res.user))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (body: LoginBody) => setUser((await api.login(body)).user), []);
  const signup = useCallback(async (body: SignupBody) => setUser((await api.signup(body)).user), []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
