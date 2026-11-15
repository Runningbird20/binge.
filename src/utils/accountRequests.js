// Invite-only sign-up, the browser's side (server/routes/invites.js,
// docs/invite-only.md): ask for an account, the admin's review page, the
// invite link, and making the account from it.
import { api } from '../api';
import { signInWithSupabase, updateSupabaseProfile } from './supabaseData';

const q = (token) => encodeURIComponent(token || '');

export function requestAccount({ name, email, note }) {
  return api.post('/account/requests', { name, email, note });
}

// The admin's review link (/account-requests/review?token=…).
export async function fetchAccountRequest(token) {
  const { request } = await api.get(`/account/requests/review?token=${q(token)}`);
  return request;
}

export function decideAccountRequest(token, decision) {
  return api.post('/account/requests/decide', { token, decision });
}

// Who an invite link is for ({ email, name }); throws when it's expired or used.
export function fetchInvite(token) {
  return api.get(`/account/invite?token=${q(token)}`);
}

// The regular sign-up form, with an invite: the server makes the account (public
// sign-ups are off in Supabase), then this signs in. An uploaded avatar is an
// inline image too big for that request, so it's saved after signing in, the
// way it always was.
export async function signUpWithInvite({ inviteToken, username, password, bio, avatarUrl }) {
  const inline = typeof avatarUrl === 'string' && avatarUrl.startsWith('data:');
  const { email } = await api.post('/account/signup', {
    token: inviteToken,
    username,
    password,
    bio,
    avatarUrl: inline ? null : avatarUrl || null,
  });
  let user = await signInWithSupabase({ email, password });
  if (inline) {
    user = await updateSupabaseProfile({ username, email, bio, avatarUrl }).catch(() => user);
  }
  return { user, requiresEmailConfirmation: false };
}

// Admin → Requests.
export function fetchAdminAccountRequests() {
  return api.get('/admin/account-requests');
}

export function decideAdminAccountRequest(id, decision) {
  return api.post(`/admin/account-requests/${encodeURIComponent(id)}/decide`, { decision });
}
