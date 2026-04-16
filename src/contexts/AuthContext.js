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

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setUser(null);
      setAuthLoading(false);
      return null;
    }

    const nextUser = await getSupabaseSessionProfile();
    setUser(nextUser);
    return nextUser;
  }, []);

  useEffect(() => {
    let active = true;

    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('user');
    } catch {}

    async function bootstrapAuth() {
      try {
        const nextUser = await refreshUser();
        if (active) {
          setUser(nextUser);
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
        clearTokenCache();
        setUser(null);
        setAuthLoading(false);
        return;
      }
      // Cache the token so api.js doesn't call getSession() on every request
      if (session?.access_token) setTokenCache(session.access_token);

      try {
        const nextUser = await resolveSupabaseProfile(session.user);
        if (active) {
          setUser(nextUser);
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
  }, [refreshUser]);

  const signIn = useCallback(async (credentials) => {
    const nextUser = await signInWithSupabase(credentials);
    setUser(nextUser);
    return nextUser;
  }, []);

  const signUp = useCallback(async (payload) => {
    const result = await signUpWithSupabase(payload);
    if (result.user) {
      setUser(result.user);
    }
    return result;
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const nextUser = await updateSupabaseProfile(payload);
    setUser(nextUser);
    return nextUser;
  }, []);

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
