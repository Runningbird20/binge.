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
  fetchAccountProfiles,
  createAccountProfile,
} from '../utils/supabaseData';
import { normalizeUserType } from '../utils/userAccess';
import { getActiveProfileId, setActiveProfileId, loadStoredActiveProfileId, clearActiveProfileId } from '../utils/activeProfile';

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
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [activeProfileIdState, setActiveProfileIdState] = useState(() => loadStoredActiveProfileId());
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

// Fetches this account's profiles and settles on which one is active —
  // the stored id if it still belongs to this account, else the default
  // profile. Runs whenever the logged-in account changes (not on every
  // render), and again after creating/switching profiles.
  const loadProfiles = useCallback(async () => {
    if (!user?.id) {
      setProfiles([]);
      setProfilesLoading(false);
      return;
    }
    setProfilesLoading(true);
    try {
      const list = await fetchAccountProfiles();
      setProfiles(list);
      const stored = getActiveProfileId();
      const valid = list.find((p) => p.id === stored);
      const fallback = list.find((p) => p.is_default) || list[0] || null;
      const chosen = valid || fallback;
      if (chosen && chosen.id !== stored) {
        setActiveProfileId(chosen.id);
      }
      setActiveProfileIdState(chosen?.id || null);
    } catch {
      // Leave whatever was already loaded (or empty) — the rest of the app
      // degrades gracefully to "no active profile" (unfiltered queries).
    } finally {
      setProfilesLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Hard navigation on switch: every screen's mount-time data fetch (watchlist,
  // ratings, continue watching, recommendations, ...) picks up the new active
  // profile automatically, instead of needing each of those components to
  // separately subscribe to profile changes and re-fetch.
  const switchProfile = useCallback((profileId) => {
    setActiveProfileId(profileId);
    window.location.assign('/home');
  }, []);

  const addProfile = useCallback(async ({ name, isKids }) => {
    const created = await createAccountProfile({ name, isKids });
    await loadProfiles();
    return created;
  }, [loadProfiles]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileIdState) || null,
    [profiles, activeProfileIdState]
  );

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
    clearActiveProfileId();
    setUser(null);
    setProfiles([]);
    setActiveProfileIdState(null);
    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('user');
    } catch {}
    void signOutFromSupabase().catch(() => {});
  }, []);

  // Admin/dev privileges are account-level, but must not follow onto sub-
  // profiles — a kid (or any non-default) profile shouldn't get the Admin
  // badge, admin nav, or /admin route access just because the account that
  // created it happens to be an admin. Only the default profile (the one
  // auto-created for whoever owns the account) inherits them.
  const isDefaultProfileActive = !activeProfile || activeProfile.is_default;
  const canUseAdminFeatures = Boolean(user?.isAdmin) && isDefaultProfileActive;
  const canUseDevFeatures = Boolean(user?.isDev) && isDefaultProfileActive;

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
    profiles,
    activeProfile,
    profilesLoading,
    switchProfile,
    addProfile,
    refreshProfiles: loadProfiles,
    canUseAdminFeatures,
    canUseDevFeatures,
  }), [
    authLoading, logout, refreshUser, signIn, signUp, updatePassword, updateProfile, user,
    profiles, activeProfile, profilesLoading, switchProfile, addProfile, loadProfiles,
    canUseAdminFeatures, canUseDevFeatures,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
