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
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const commitUser = useCallback((nextUser) => {
    setUser((currentUser) => mergeResolvedUser(currentUser, nextUser));
    return nextUser;
  }, []);

  const refreshUser = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
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

    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('user');
    } catch {}

    async function bootstrapAuth() {
      try {
        await refreshUser();
      } catch {
        if (active) {
          setUser(null);
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
    await signOutFromSupabase();
    setUser(null);
    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('user');
    } catch {}
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
