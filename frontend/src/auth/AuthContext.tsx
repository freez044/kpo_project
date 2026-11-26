import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '../api/auth';
import { onSessionLost, refreshSession } from '../api/client';
import type { RegisterInput, User } from '../api/types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: Status;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<User | null>(null);

  const signedOut = useCallback(() => {
    setUserState(null);
    setStatus('anonymous');
  }, []);

  // При запуске пробуем восстановить сеанс по refresh-cookie: так вход переживает перезагрузку страницы.
  useEffect(() => {
    let cancelled = false;
    onSessionLost(signedOut);
    refreshSession()
      .then((result) => {
        if (cancelled) return;
        setUserState(result.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });
    return () => {
      cancelled = true;
      onSessionLost(null);
    };
  }, [signedOut]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      async login(email, password) {
        const u = await authApi.login(email, password);
        setUserState(u);
        setStatus('authenticated');
      },
      async register(input) {
        const u = await authApi.register(input);
        setUserState(u);
        setStatus('authenticated');
      },
      async logout() {
        try {
          await authApi.logout();
        } finally {
          signedOut();
        }
      },
      setUser: setUserState,
    }),
    [status, user, signedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth нужно вызывать внутри <AuthProvider>');
  return value;
}
