// Invite-only sign-up. binge. accounts are by request (docs/invite-only.md):
//
//   POST /api/account/requests            { name, email, note }  anyone
//        saves the request and emails the admin a review link
//   GET  /api/account/requests/review     ?token=                the admin's link
//   POST /api/account/requests/decide     { token, decision }    approve | deny
//        approving emails the person an invite link to /signup?invite=…
//   GET  /api/account/invite              ?token=                who the invite is for
//   POST /api/account/signup              { token, username, password, bio, avatarUrl }
//        creates the account with the service role (public sign-ups are off)
//
//   GET  /api/admin/account-requests                     admin: every request
//   POST /api/admin/account-requests/:id/decide { decision }  admin: same as above
//
// Tokens are 32 random bytes; only their SHA-256 hashes are stored. The review
// token is only in the admin's email and the invite token only in the
// requester's, so holding one is the permission. Links point at SITE_URL (or
// Vercel's production address), never at the request's Origin header, so a
// forged request can't send the admin's token to another site.
const crypto = require('crypto');
const express = require('express');
const { serviceClient, adminOnly } = require('../middleware/supabaseAdmin');
const mailer = require('../mailer');

const INVITE_DAYS = 14;
const ADMIN_EMAILS_PER_HOUR = 20; // past this, requests are saved but not emailed

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

// ── Helpers ─────────────────────────────────────────────────────────────

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const oneLine = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

function clientIp(req) {
  return String(req.headers?.['x-real-ip'] || String(req.headers?.['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim();
}

// Per-instance sliding window (serverless instances don't share it; the
// database caps below are what really bound the admin's inbox).
function createLimiter(max, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const list = (hits.get(key) || []).filter((at) => now - at < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return list.length > max;
  };
}

// What the admin and the review page may see of a request.
function publicRequest(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at || null,
    usedAt: row.used_at || null,
  };
}

// ── The data (Supabase, service role) ───────────────────────────────────

function supabaseStore(db) {
  const table = () => db.from('account_requests');
  return {
    async emailHasAccount(email) {
      const { data } = await db.from('profiles').select('id').eq('email', email).limit(1);
      return Boolean(data?.length);
    },
    async usernameTaken(username) {
      const { data } = await db.from('profiles').select('id').eq('username', username).limit(1);
      return Boolean(data?.length);
    },
    async findOpenByEmail(email) {
      const { data } = await table().select('*').eq('email', email).in('status', ['pending', 'approved']).limit(1);
      return data?.[0] || null;
    },
    async countSince(iso) {
      const { count } = await table().select('id', { count: 'exact', head: true }).gte('created_at', iso);
      return count || 0;
    },
    async insert(row) {
      const { data, error } = await table().insert(row).select('*').single();
      if (error) throw error;
      return data;
    },
    async findBy(column, value) {
      const { data } = await table().select('*').eq(column, value).maybeSingle();
      return data || null;
    },
    async update(id, patch) {
      const { data, error } = await table().update(patch).eq('id', id).select('*').single();
      if (error) throw error;
      return data;
    },
    async list(limit) {
      const { data, error } = await table().select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    },
    async adminEmails() {
      const { data } = await db.from('profiles').select('email').eq('is_admin', true);
      return (data || []).map((row) => row.email).filter(Boolean);
    },
    createUser: (attributes) => db.auth.admin.createUser(attributes),
  };
}

// ── Handlers ────────────────────────────────────────────────────────────

function createInviteHandlers({
  getStore = () => { const db = serviceClient(); return db ? supabaseStore(db) : null; },
  sendMail = mailer.sendMail,
  now = () => new Date(),
  site = mailer.siteUrl,
  requestLimiter = createLimiter(5, 60 * 60 * 1000),
  signupLimiter = createLimiter(10, 60 * 60 * 1000),
} = {}) {
  function storeOr503(res) {
    const store = getStore();
    if (!store) res.status(503).json({ error: 'Accounts are unavailable right now. Try again later.' });
    return store;
  }

  async function notifyAdmin(store, row, reviewToken) {
    // ACCOUNT_REQUESTS_TO (comma-separated), else every admin account's email.
    const to = (process.env.ACCOUNT_REQUESTS_TO || '').split(',').map((value) => value.trim()).filter(Boolean);
    const recipients = to.length ? to : await store.adminEmails();
    if (!recipients.length) return false;
    const link = `${site()}/account-requests/review?token=${reviewToken}`;
    const note = row.note ? `Their note: “${row.note}”\n\n` : '';
    return sendMail({
      to: recipients.join(', '),
      replyTo: row.email,
      subject: `New binge. account request from ${row.name}`,
      text: `${row.name} (${row.email}) asked for a binge. account.\n\n${note}Approve or deny it here:\n${link}\n`,
    });
  }

  // Approve or deny. Approving makes the invite and emails it; the link is
  // returned too, so the admin can pass it on if the email didn't go out.
  async function decide(store, row, decision) {
    if (row.status !== 'pending') return { request: publicRequest(row), already: true };
    const decidedAt = now().toISOString();
    if (decision === 'deny') {
      const updated = await store.update(row.id, { status: 'denied', decided_at: decidedAt });
      return { request: publicRequest(updated) };
    }
    const inviteToken = newToken();
    const updated = await store.update(row.id, {
      status: 'approved',
      decided_at: decidedAt,
      invite_token_hash: hash(inviteToken),
      invite_expires_at: new Date(now().getTime() + INVITE_DAYS * 86400000).toISOString(),
    });
    const inviteLink = `${site()}/signup?invite=${inviteToken}`;
    const emailed = await sendMail({
      to: row.email,
      subject: 'Your binge. invite',
      text: `Hi ${row.name},\n\nYou asked for a binge. account, and it's ready for you. Use this link to pick a username and password (it works for ${INVITE_DAYS} days):\n\n${inviteLink}\n\nSee you there!\n`,
    });
    return { request: publicRequest(updated), emailed, inviteLink };
  }

  async function findByToken(store, column, token) {
    if (!TOKEN.test(String(token || ''))) return null;
    return store.findBy(column, hash(token));
  }

  return {
    async requestAccount(req, res) {
      const name = oneLine(req.body?.name, 80);
      const email = oneLine(req.body?.email, 254).toLowerCase();
      const note = String(req.body?.note ?? '').trim().slice(0, 500);
      if (!name) return res.status(400).json({ error: 'Add your name.' });
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (requestLimiter(clientIp(req))) return res.status(429).json({ error: 'Too many requests from here. Try again in an hour.' });
      const store = storeOr503(res);
      if (!store) return undefined;
      try {
        // The same answer whatever happens next, so the form can't be used to
        // find out who has an account.
        if (await store.emailHasAccount(email) || await store.findOpenByEmail(email)) return res.json({ ok: true });
        const reviewToken = newToken();
        let row;
        try {
          row = await store.insert({ name, email, note, review_token_hash: hash(reviewToken) });
        } catch (error) {
          if (error?.code === '23505') return res.json({ ok: true }); // asked twice at once
          throw error;
        }
        const lastHour = await store.countSince(new Date(now().getTime() - 3600000).toISOString());
        if (lastHour <= ADMIN_EMAILS_PER_HOUR) await notifyAdmin(store, row, reviewToken);
        return res.json({ ok: true });
      } catch (error) {
        console.error('[invites] request', error?.message);
        return res.status(500).json({ error: "Couldn't send your request. Try again in a moment." });
      }
    },

    async reviewRequest(req, res) {
      const store = storeOr503(res);
      if (!store) return undefined;
      const row = await findByToken(store, 'review_token_hash', req.query?.token).catch(() => null);
      if (!row) return res.status(404).json({ error: 'This review link is not valid.' });
      return res.json({ request: publicRequest(row) });
    },

    async decideByToken(req, res) {
      const decision = req.body?.decision;
      if (decision !== 'approve' && decision !== 'deny') return res.status(400).json({ error: 'Choose approve or deny.' });
      const store = storeOr503(res);
      if (!store) return undefined;
      try {
        const row = await findByToken(store, 'review_token_hash', req.body?.token);
        if (!row) return res.status(404).json({ error: 'This review link is not valid.' });
        return res.json(await decide(store, row, decision));
      } catch (error) {
        console.error('[invites] decide', error?.message);
        return res.status(500).json({ error: "Couldn't save that. Try again in a moment." });
      }
    },

    async inviteInfo(req, res) {
      const store = storeOr503(res);
      if (!store) return undefined;
      const row = await findByToken(store, 'invite_token_hash', req.query?.token).catch(() => null);
      if (!row) return res.status(404).json({ error: 'This invite link is not valid.' });
      if (row.status === 'used') return res.status(410).json({ error: 'This invite was already used. Log in instead.', used: true });
      if (row.status !== 'approved' || new Date(row.invite_expires_at) < now()) {
        return res.status(410).json({ error: 'This invite has expired. Request a new one.' });
      }
      return res.json({ email: row.email, name: row.name });
    },

    async signup(req, res) {
      const username = oneLine(req.body?.username, 40);
      const password = String(req.body?.password ?? '');
      const bio = String(req.body?.bio ?? '').trim().slice(0, 280);
      const avatar = String(req.body?.avatarUrl ?? '');
      if (!username) return res.status(400).json({ error: 'Choose a username.' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      if (signupLimiter(clientIp(req))) return res.status(429).json({ error: 'Too many tries from here. Try again in an hour.' });
      const store = storeOr503(res);
      if (!store) return undefined;
      try {
        const row = await findByToken(store, 'invite_token_hash', req.body?.token);
        if (!row) return res.status(404).json({ error: 'This invite link is not valid.' });
        if (row.status !== 'approved' || new Date(row.invite_expires_at) < now()) {
          return res.status(410).json({ error: row.status === 'used' ? 'This invite was already used. Log in instead.' : 'This invite has expired. Request a new one.' });
        }
        if (await store.usernameTaken(username)) return res.status(409).json({ error: 'That username is taken. Try another.' });
        // No is_admin / is_dev here: the profile trigger reads those from this
        // metadata, so only the server decides what goes in it.
        const { data, error } = await store.createUser({
          email: row.email,
          password,
          email_confirm: true, // the invite reached this address
          user_metadata: { username, bio, avatar_url: /^https:\/\//.test(avatar) && avatar.length <= 1000 ? avatar : null },
        });
        if (error) {
          if (error.code === 'email_exists' || /already/i.test(error.message || '')) {
            return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
          }
          if (error.code === 'weak_password') return res.status(400).json({ error: error.message || 'Choose a stronger password.' });
          throw error;
        }
        await store.update(row.id, { status: 'used', used_at: now().toISOString(), user_id: data?.user?.id || null });
        return res.json({ email: row.email });
      } catch (error) {
        console.error('[invites] signup', error?.message);
        return res.status(500).json({ error: "Couldn't create your account. Try again in a moment." });
      }
    },

    async adminList(_req, res) {
      const store = storeOr503(res);
      if (!store) return undefined;
      try {
        const rows = await store.list(200);
        return res.json({ requests: rows.map(publicRequest), pending: rows.filter((row) => row.status === 'pending').length });
      } catch (error) {
        return res.status(500).json({ error: "Couldn't load the requests." });
      }
    },

    async adminDecide(req, res) {
      const decision = req.body?.decision;
      if (decision !== 'approve' && decision !== 'deny') return res.status(400).json({ error: 'Choose approve or deny.' });
      const store = storeOr503(res);
      if (!store) return undefined;
      try {
        const row = await store.findBy('id', String(req.params?.id || ''));
        if (!row) return res.status(404).json({ error: 'That request is gone.' });
        return res.json(await decide(store, row, decision));
      } catch (error) {
        console.error('[invites] admin decide', error?.message);
        return res.status(500).json({ error: "Couldn't save that. Try again in a moment." });
      }
    },
  };
}

const handlers = createInviteHandlers();

const publicRouter = express.Router();
publicRouter.post('/requests', handlers.requestAccount);
publicRouter.get('/requests/review', handlers.reviewRequest);
publicRouter.post('/requests/decide', handlers.decideByToken);
publicRouter.get('/invite', handlers.inviteInfo);
publicRouter.post('/signup', handlers.signup);

const adminRouter = express.Router();
adminRouter.get('/', adminOnly((req, res) => handlers.adminList(req, res)));
adminRouter.post('/:id/decide', adminOnly((req, res) => handlers.adminDecide(req, res)));

module.exports = { publicRouter, adminRouter, createInviteHandlers, supabaseStore, hash };
