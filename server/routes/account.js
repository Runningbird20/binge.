// Self-service account deletion (Account Settings → Delete account).
//
// POST /api/account/delete  { password }   (Bearer token of the signed-in user)
//   1. the token identifies the account; the password is checked by signing
//      in with it (a stolen session alone can't delete the account)
//   2. the only admin can't delete themselves (nobody could run the panel)
//   3. auth.admin.deleteUser: every user-owned table cascades from auth.users
//      (profiles, household profiles, ratings, My List, history, …)
//   4. their avatar files are removed from Storage (the database cascade
//      doesn't reach Storage)
//
// Needs the service-role key, so it can only live here; the client's
// executeSupabaseRoute returns null for /account/* and api.js falls through.
const express = require('express');
const { serviceClient, userFromRequest } = require('../middleware/supabaseAdmin');

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map(); // user id -> { count, start }

function tooManyAttempts(userId, now = Date.now()) {
  const entry = failedAttempts.get(userId);
  if (!entry || now - entry.start > ATTEMPT_WINDOW_MS) return false;
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(userId, now = Date.now()) {
  const entry = failedAttempts.get(userId);
  if (!entry || now - entry.start > ATTEMPT_WINDOW_MS) failedAttempts.set(userId, { count: 1, start: now });
  else entry.count += 1;
}

// Signs in with the password on a throwaway client (public key, no stored
// session). True only when it's this account's password.
async function checkPassword(user, password) {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
  if (error) {
    if (error.status === 400 || error.code === 'invalid_credentials') return false;
    throw error;
  }
  return data?.user?.id === user.id;
}

async function removeAvatars(admin, userId) {
  const bucket = admin.storage.from('avatars');
  const { data: files } = await bucket.list(userId, { limit: 100 });
  const paths = (files || []).filter((f) => f.name).map((f) => `${userId}/${f.name}`);
  if (paths.length) await bucket.remove(paths);
}

function createDeleteHandler({
  getAdmin = serviceClient,
  getUser = userFromRequest,
  verifyPassword = checkPassword,
  clearStorage = removeAvatars,
} = {}) {
  return async function deleteAccount(req, res) {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) return res.status(400).json({ error: 'Enter your password to delete your account.' });

    const admin = getAdmin();
    if (!admin) return res.status(503).json({ error: "Account deletion isn't available right now. Try again later." });

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in again to delete your account.' });
    if (!user.email) return res.status(400).json({ error: "This account has no email address, so its password can't be checked." });
    if (tooManyAttempts(user.id)) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }

    let passwordOk;
    try {
      passwordOk = await verifyPassword(user, password);
    } catch {
      return res.status(503).json({ error: "Couldn't check your password just now. Try again in a moment." });
    }
    if (!passwordOk) {
      recordFailedAttempt(user.id);
      return res.status(401).json({ error: "That password isn't right." });
    }
    failedAttempts.delete(user.id);

    try {
      const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
      if (profile?.is_admin) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true);
        if ((count ?? 0) <= 1) {
          return res.status(409).json({ error: "You're the only admin. Make someone else an admin before deleting your account." });
        }
      }

      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw error;
      // After the account is gone, so a failed delete leaves everything as it was.
      await clearStorage(admin, user.id).catch(() => {});
      return res.json({ deleted: true });
    } catch {
      return res.status(500).json({ error: "Couldn't delete your account. Nothing was removed; try again in a moment." });
    }
  };
}

const router = express.Router();
router.post('/delete', createDeleteHandler());

module.exports = router;
module.exports.createDeleteHandler = createDeleteHandler;
module.exports._failedAttempts = failedAttempts;
