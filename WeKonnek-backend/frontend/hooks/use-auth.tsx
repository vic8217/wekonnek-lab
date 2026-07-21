'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { UserType } from '@/types';
import { ROUTES } from '@/lib/constants';

// Authentication is forwarded by the same-origin /api/auth/* Next.js rewrite.
const API = '';

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  /** Mirrors `userType`; kept for components that read `user.role`. */
  role?: UserType;
  userType: UserType;
  firstName: string | null;
  lastName: string | null;
  avatarUrl?: string | null;
}

interface AuthState {
  /** `null` while auth is loading; `undefined` when confirmed unauthenticated. */
  user: AuthUser | null | undefined;
  loading: boolean;
  /** Signs out and redirects. Defaults to the login page; pass a path to override. */
  signOut: (redirectTo?: string) => Promise<void>;
  /** Call after setAuth() so the context picks up the new token immediately. */
  refreshAuth: () => Promise<void>;
}

const TOKEN_KEY = 'wk_token';
const USER_KEY = 'wk_user';

// ─── Standalone helpers (usable outside React components) ──
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ─── React context ────────────────────────────────────────
const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signOut: async () => {},
  refreshAuth: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadUser = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) {
        setUser(undefined);
        return;
      }

      const res = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        clearAuth();
        setUser(undefined);
        return;
      }

      const profile = await res.json();
      const userType = (profile.userType ?? profile.user_type ?? profile.role ?? 'customer') as UserType;
      const authUser: AuthUser = {
        id: profile.id ?? profile.userId ?? '',
        email: profile.email ?? '',
        phone: profile.phone ?? undefined,
        userType,
        role: userType,
        firstName: profile.firstName ?? profile.first_name ?? null,
        lastName: profile.lastName ?? profile.last_name ?? null,
        avatarUrl: profile.avatarUrl ?? profile.avatar_url ?? null,
      };

      localStorage.setItem(USER_KEY, JSON.stringify(authUser));
      setUser(authUser);
    } catch {
      setUser(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    const cached = getUser();
    const token = getToken();
    if (cached && token) {
      setUser(cached);
      setLoading(false);
    }
    await loadUser();
    // Yield to let React commit state updates before callers navigate
    await new Promise((r) => setTimeout(r, 0));
  }, [loadUser]);

  useEffect(() => {
    const cached = getUser();
    if (cached && getToken()) {
      setUser(cached);
      setLoading(false);
      loadUser();
    } else {
      loadUser();
    }
  }, [loadUser]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY || e.key === USER_KEY) refreshAuth();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshAuth]);

  const signOut = useCallback(async (redirectTo: string = ROUTES.login) => {
    try {
      const token = getToken();
      if (token) {
        await fetch(`${API}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    } finally {
      clearAuth();
      setUser(undefined);
      // Full-page navigation so route guards on protected pages (e.g. the
      // profile page) can't bounce the now-signed-out user to /auth/login
      // before the client-side push to `redirectTo` completes.
      if (typeof window !== 'undefined') {
        window.location.assign(redirectTo);
      } else {
        router.push(redirectTo);
      }
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useRequireAuth(allowedTypes: UserType[]) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.loading) return;

    if (!auth.user) {
      // Before redirecting to login, check localStorage directly.
      // This prevents a race condition where the context hasn't caught up
      // after login but the token/user are already saved in localStorage.
      const cachedUser = getUser();
      const token = getToken();
      if (cachedUser && token) return;

      router.push(ROUTES.login);
      return;
    }

    if (!allowedTypes.includes(auth.user.userType)) {
      switch (auth.user.userType) {
        case 'admin':
        case 'staff':
          router.push(ROUTES.adminDashboard);
          break;
        case 'merchant':
          router.push(ROUTES.merchantDashboard);
          break;
        default:
          router.push(ROUTES.customerDashboard);
      }
    }
  }, [auth.loading, auth.user, allowedTypes, router]);

  return auth;
}
