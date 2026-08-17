'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { UserType } from '@/types';
import { ROUTES } from '@/lib/constants';
import { deactivateCurrentPushDevice } from '@/lib/firebase-messaging';

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
  mustChangePassword?: boolean;
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
const MERCHANT_TOKEN_KEY = 'wk_merchant_token';
const MERCHANT_USER_KEY = 'wk_merchant_user';
const SHOP_TOKEN_KEY = 'wk_shop_token';
const SHOP_USER_KEY = 'wk_shop_user';
const AUTH_CHANGED_EVENT = 'wekonnek-auth-changed';
const SIGNED_OUT_KEY = 'wk_customer_signed_out';

export type SessionScope = 'default' | 'merchant' | 'shop' | 'admin' | 'coordinator';

function scopeForPath(): SessionScope {
  if (typeof window === 'undefined') return 'default';
  if (window.location.pathname.startsWith('/admin')) return 'admin';
  if (window.location.pathname.startsWith('/coordinator')) return 'coordinator';
  if (window.location.pathname.startsWith('/merchant')) return 'merchant';
  if (window.location.pathname.startsWith('/shop')) return 'shop';
  return 'default';
}

function scopeForUser(user: AuthUser): SessionScope {
  if (user.userType === 'admin' || user.userType === 'staff') return 'admin';
  if (user.userType === 'coordinator') return 'coordinator';
  if (user.userType === 'merchant') return 'merchant';
  return 'default';
}

function keysForScope(scope: SessionScope) {
  if (scope === 'admin') return { token: ADMIN_TOKEN_KEY, user: ADMIN_USER_KEY };
  if (scope === 'coordinator') {
    return { token: COORDINATOR_TOKEN_KEY, user: COORDINATOR_USER_KEY };
  }
  if (scope === 'merchant') return { token: MERCHANT_TOKEN_KEY, user: MERCHANT_USER_KEY };
  if (scope === 'shop') return { token: SHOP_TOKEN_KEY, user: SHOP_USER_KEY };
  return { token: TOKEN_KEY, user: USER_KEY };
}

function storageForScope(scope: SessionScope): Storage {
  // Merchant credentials are tab-scoped so two onboarded merchants can be
  // opened in separate tabs without one login replacing the other.
  return scope === 'merchant' || scope === 'shop' ? sessionStorage : localStorage;
}

function userBelongsToScope(user: AuthUser, scope: SessionScope) {
  if (scope === 'admin') return user.userType === 'admin' || user.userType === 'staff';
  if (scope === 'coordinator') return user.userType === 'coordinator';
  if (scope === 'merchant') return user.userType === 'merchant';
  if (scope === 'shop') return user.userType === 'merchant';
  // The customer app is an independent account scope. In particular, a
  // merchant login must never be accepted as a customer session.
  return user.userType === 'customer';
}

function readStoredUser(key: string, storage: Storage = localStorage): AuthUser | null {
  try {
    const raw = storage.getItem(key);
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
  const storage = storageForScope(scope);
  if (storage.getItem(keys.token) && storage.getItem(keys.user)) return;

  const legacyToken = localStorage.getItem(TOKEN_KEY);
  const legacyUser = readStoredUser(USER_KEY);
  if (!legacyToken || !legacyUser || !userBelongsToScope(legacyUser, scope)) return;

  storage.setItem(keys.token, legacyToken);
  storage.setItem(keys.user, JSON.stringify(legacyUser));
}

// ─── Standalone helpers (usable outside React components) ──
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const scope = scopeForPath();
  migrateLegacySession(scope);
  const storage = storageForScope(scope);
  const keys = keysForScope(scope);
  const token = storage.getItem(keys.token);
  const user = readStoredUser(keys.user, storage);
  if (!token || !user || !userBelongsToScope(user, scope)) {
    // Remove stale credentials that were written before portal sessions were
    // separated. Never remove credentials belonging to another namespace.
    storage.removeItem(keys.token);
    storage.removeItem(keys.user);
    return null;
  }
  return token;
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const scope = scopeForPath();
  migrateLegacySession(scope);
  const storage = storageForScope(scope);
  const keys = keysForScope(scope);
  const user = readStoredUser(keys.user, storage);
  if (!user || !userBelongsToScope(user, scope)) return null;
  return user;
}

export function setAuth(token: string, user: AuthUser, scope: SessionScope = scopeForUser(user)) {
  const keys = keysForScope(scope);
  const storage = storageForScope(scope);
  storage.setItem(keys.token, token);
  storage.setItem(keys.user, JSON.stringify(user));
  if (scope === 'default') localStorage.removeItem(SIGNED_OUT_KEY);
  // The native storage event only fires in other tabs. Notify providers and
  // navigation components in this same window immediately.
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: { scope } }));
}

export function clearAuth() {
  const scope = scopeForPath();
  const keys = keysForScope(scope);
  const storage = storageForScope(scope);
  storage.removeItem(keys.token);
  storage.removeItem(keys.user);
  if (scope === 'default') localStorage.setItem(SIGNED_OUT_KEY, 'true');
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: { scope: scopeForPath() } }));
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
  const authRequestRef = useRef<Promise<void> | null>(null);
  const router = useRouter();

  const performLoadUser = useCallback(async () => {
    try {
      let token = getToken();
      if (!token) {
        // Crew pairing and handheld operations use their own device/session
        // credentials. They are public entry points and must not depend on (or
        // try to refresh) a customer/merchant browser session.
        if (window.location.pathname.startsWith('/crew')) {
          setUser(undefined);
          return;
        }
        if (scopeForPath() === 'default' && localStorage.getItem(SIGNED_OUT_KEY) === 'true') {
          setUser(undefined);
          return;
        }
        // Restore a session from the HTTP-only refresh cookie after a full
        // navigation or when browser storage was temporarily unavailable.
        const refreshResponse = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          credentials: 'same-origin',
        });
        if (refreshResponse.ok) {
          const session = await refreshResponse.json().catch(() => null);
          const profile = session?.user;
          const userType = (profile?.userType ?? profile?.user_type ?? profile?.role) as UserType | undefined;
          if (session?.access_token && profile?.id && userType) {
            setAuth(session.access_token, {
              id: profile.id,
              email: profile.email ?? undefined,
              phone: profile.phone ?? undefined,
              userType,
              role: userType,
              firstName: profile.firstName ?? profile.first_name ?? null,
              lastName: profile.lastName ?? profile.last_name ?? null,
              avatarUrl: profile.avatarUrl ?? profile.avatar_url ?? null,
            });
            token = getToken();
          }
        }
        if (!token) {
          setUser(undefined);
          return;
        }
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
        mustChangePassword: Boolean(profile.mustChangePassword ?? profile.must_change_password),
      };

      // Refresh the same portal session from which this token was read.
      // This matters when an admin is intentionally using the Coordinator portal.
      const keys = keysForScope(scopeForPath());
      storageForScope(scopeForPath()).setItem(keys.user, JSON.stringify(authUser));
      setUser(authUser);
    } catch {
      // Keep the last verified local session during transient network errors.
      setUser(cachedUserOrUndefined());
    } finally {
      setLoading(false);
    }
  }, []);

  // Auth is consumed by the root provider, route guards, layouts and modals.
  // Collapse simultaneous refreshes into one request so a slow/unavailable API
  // cannot exhaust the browser's connection pool with duplicate `/auth/me` calls.
  const loadUser = useCallback(() => {
    if (authRequestRef.current) return authRequestRef.current;

    const request = performLoadUser().finally(() => {
      if (authRequestRef.current === request) authRequestRef.current = null;
    });
    authRequestRef.current = request;
    return request;
  }, [performLoadUser]);

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
    const onAuthChanged = () => refreshAuth();
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, [refreshAuth]);

  const signOut = useCallback(async (redirectTo: string = ROUTES.login) => {
    try {
      const token = getToken();
      if (token) {
        await deactivateCurrentPushDevice(token);
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
