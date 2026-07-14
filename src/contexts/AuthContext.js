import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../utils/supabase';
import { clearTokenCache, setTokenCache } from '../api';
import {
  getSupabaseSessionProfile,
  resolveSupabaseProfile,
  signInWithSupabase,
  signOutFromSupabase,
  signUpWithSupabase,
  updateSupabasePassword,
  updateSupabaseProfile,
} from '../utils/supabaseData';
import { normalizeUserType } from '../utils/userAccess';

const AuthContext = createContext(null);
// TEMP (UI preview only — do not commit): raw context export for the mock preview route
export { AuthContext as __AuthContextForPreview };

function readStoredUser() {
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStoredUser(nextUser) {
  try {
    if (nextUser) {
      window.localStorage.setItem('user', JSON.stringify(nextUser));
    } else {
      window.localStorage.removeItem('user');
    }
  } catch {}
}

function getRolePriority(userType) {
  const normalized = normalizeUserType(userType);

  if (normalized === 'admin') {
    return 2;
  }

  if (normalized === 'dev') {
    return 1;
  }

  return 0;
}

function mergeResolvedUser(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.id !== nextUser.id) {
    return nextUser;
  }

  if (getRolePriority(nextUser.userType) >= getRolePriority(currentUser.userType)) {
    return nextUser;
  }

  return {
    ...nextUser,
    userType: currentUser.userType,
    isAdmin: currentUser.isAdmin,
    isDev: currentUser.isDev,
  };
}

export function AuthProvider({ children }) {
  const storedUser = readStoredUser();
  const [user, setUser] = useState(storedUser);
  const [authLoading, setAuthLoading] = useState(!storedUser);
  const commitUser = useCallback((nextUser) => {
    setUser((currentUser) => {
      const merged = mergeResolvedUser(currentUser, nextUser);
      writeStoredUser(merged);
      return merged;
    });
    return nextUser;
  }, []);

  const refreshUser = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      const storedUser = readStoredUser();
      if (storedUser) {
        commitUser(storedUser);
        setAuthLoading(false);
        return storedUser;
      }
      setUser(null);
      setAuthLoading(false);
      return null;
    }

    const nextUser = await getSupabaseSessionProfile();
    commitUser(nextUser);
    return nextUser;
  }, [commitUser]);

  useEffect(() => {
    let active = true;
    const storedUser = readStoredUser();

    if (storedUser) {
      commitUser(storedUser);
      setAuthLoading(false);

      if (isSupabaseConfigured && supabase) {
        void refreshUser().catch(() => {});
      }

      return () => {
        active = false;
      };
    }

    async function bootstrapAuth() {
      try {
        const restoredUser = await refreshUser();
        if (active && !restoredUser) {
          // getSupabaseSessionProfile() resolved and confirmed there's no
          // active session — a trustworthy "logged out" signal, not a
          // failure, so the cache should be cleared too.
          writeStoredUser(null);
          setUser(null);
        }
      } catch {
        // The session check itself failed (network hiccup, timeout, cold
        // start) — we don't actually know whether the user is logged out,
        // so prefer the last-known cached profile over bouncing them to
        // the login screen. If there's nothing cached, fall back to null.
        if (active) {
          const cachedUser = readStoredUser();
          if (cachedUser) {
            commitUser(cachedUser);
          } else {
            setUser(null);
          }
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    }

    bootstrapAuth();

    if (!isSupabaseConfigured || !supabase) {
      return () => {
        active = false;
      };
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) {
        return;
      }

      if (!session?.user) {
        try {
          const restoredUser = await refreshUser();
          if (active && !restoredUser) {
            clearTokenCache();
            setUser(null);
          }
        } catch {
          if (active) {
            clearTokenCache();
            setUser(null);
          }
        } finally {
          if (active) {
            setAuthLoading(false);
          }
        }
        return;
      }
      // Cache the token so api.js doesn't call getSession() on every request
      if (session?.access_token) setTokenCache(session.access_token);

      try {
        const nextUser = await resolveSupabaseProfile(session.user);
        if (active) {
          commitUser(nextUser);
        }
      } catch {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [commitUser, refreshUser]);

  const signIn = useCallback(async (credentials) => {
    const nextUser = await signInWithSupabase(credentials);
    commitUser(nextUser);
    return nextUser;
  }, [commitUser]);

  const signUp = useCallback(async (payload) => {
    const result = await signUpWithSupabase(payload);
    if (result.user) {
      commitUser(result.user);
    }
    return result;
  }, [commitUser]);

  const updateProfile = useCallback(async (payload) => {
    const nextUser = await updateSupabaseProfile(payload);
    commitUser(nextUser);
    return nextUser;
  }, [commitUser]);

  const updatePassword = useCallback(async (newPassword) => {
    await updateSupabasePassword(newPassword);
  }, []);

  const logout = useCallback(async () => {
    // Clear local state up front instead of waiting on the network
    // round-trip to Supabase — the UI should leave the logged-in state
    // immediately, not stall on server/network latency. The remote
    // sign-out (revoking the session server-side) still happens, just
    // in the background.
    clearTokenCache();
    setUser(null);
    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('user');
    } catch {}
    void signOutFromSupabase().catch(() => {});
  }, []);

  const value = useMemo(() => ({
    user,
    signIn,
    signUp,
    logout,
    refreshUser,
    updateProfile,
    updatePassword,
    isAuthenticated: Boolean(user),
    authLoading,
  }), [authLoading, logout, refreshUser, signIn, signUp, updatePassword, updateProfile, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
