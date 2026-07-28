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
const ADMIN_TOKEN_KEY = 'wk_admin_token';
const ADMIN_USER_KEY = 'wk_admin_user';
const COORDINATOR_TOKEN_KEY = 'wk_coordinator_token';
const COORDINATOR_USER_KEY = 'wk_coordinator_user';

type SessionScope = 'default' | 'admin' | 'coordinator';

function scopeForPath(): SessionScope {
  if (typeof window === 'undefined') return 'default';
  if (window.location.pathname.startsWith('/admin')) return 'admin';
  if (window.location.pathname.startsWith('/coordinator')) return 'coordinator';
  return 'default';
}

function scopeForUser(user: AuthUser): SessionScope {
  if (user.userType === 'admin' || user.userType === 'staff') return 'admin';
  if (user.userType === 'coordinator') return 'coordinator';
  return 'default';
}

function keysForScope(scope: SessionScope) {
  if (scope === 'admin') return { token: ADMIN_TOKEN_KEY, user: ADMIN_USER_KEY };
  if (scope === 'coordinator') {
    return { token: COORDINATOR_TOKEN_KEY, user: COORDINATOR_USER_KEY };
  }
  return { token: TOKEN_KEY, user: USER_KEY };
}

function userBelongsToScope(user: AuthUser, scope: SessionScope) {
  if (scope === 'admin') return user.userType === 'admin' || user.userType === 'staff';
  if (scope === 'coordinator') return user.userType === 'coordinator';
  return user.userType !== 'admin' && user.userType !== 'staff' && user.userType !== 'coordinator';
}

function readStoredUser(key: string): AuthUser | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Move a compatible legacy session into its portal-specific namespace.
 * This keeps users signed in after the storage separation is deployed.
 */
function migrateLegacySession(scope: SessionScope) {
  if (scope === 'default') return;
  const keys = keysForScope(scope);
  if (localStorage.getItem(keys.token) && localStorage.getItem(keys.user)) return;

  const legacyToken = localStorage.getItem(TOKEN_KEY);
  const legacyUser = readStoredUser(USER_KEY);
  if (!legacyToken || !legacyUser || !userBelongsToScope(legacyUser, scope)) return;

  localStorage.setItem(keys.token, legacyToken);
  localStorage.setItem(keys.user, JSON.stringify(legacyUser));
}

// ─── Standalone helpers (usable outside React components) ──
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const scope = scopeForPath();
  migrateLegacySession(scope);
  return localStorage.getItem(keysForScope(scope).token);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const scope = scopeForPath();
  migrateLegacySession(scope);
  return readStoredUser(keysForScope(scope).user);
}

export function setAuth(token: string, user: AuthUser, scope: SessionScope = scopeForUser(user)) {
  const keys = keysForScope(scope);
  localStorage.setItem(keys.token, token);
  localStorage.setItem(keys.user, JSON.stringify(user));
}

export function clearAuth() {
  const keys = keysForScope(scopeForPath());
  localStorage.removeItem(keys.token);
  localStorage.removeItem(keys.user);
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
        // Only discard a session when the backend explicitly rejects it.
        // A temporary 5xx/proxy outage must not log an already authenticated
        // user out or create a redirect loop.
        if (res.status === 401 || res.status === 403) {
          clearAuth();
          setUser(undefined);
        } else {
          setUser(cachedUserOrUndefined());
        }
        return;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setUser(cachedUserOrUndefined());
        return;
      }
      const profile = await res.json().catch(() => null);
      if (!profile || typeof profile !== 'object') {
        setUser(cachedUserOrUndefined());
        return;
      }
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

      // Refresh the same portal session from which this token was read.
      // This matters when an admin is intentionally using the Coordinator portal.
      const keys = keysForScope(scopeForPath());
      localStorage.setItem(keys.user, JSON.stringify(authUser));
      setUser(authUser);
    } catch {
      // Keep the last verified local session during transient network errors.
      setUser(cachedUserOrUndefined());
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
      const keys = keysForScope(scopeForPath());
      if (e.key === keys.token || e.key === keys.user) refreshAuth();
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

function cachedUserOrUndefined(): AuthUser | undefined {
  return getUser() ?? undefined;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useRequireAuth(allowedTypes: UserType[], loginPath: string = ROUTES.login) {
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

      router.push(loginPath);
      return;
    }

    if (!allowedTypes.includes(auth.user.userType)) {
      if (auth.user.userType === 'coordinator') {
        router.replace('/coordinator/dashboard');
      } else if (auth.user.userType === 'merchant') {
        router.replace('/merchant/dashboard');
      } else {
        router.replace(loginPath);
      }
    }
  }, [auth.loading, auth.user, allowedTypes, loginPath, router]);

  return auth;
}
