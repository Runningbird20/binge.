// Password-reset emails, sent by binge. itself (docs/password-reset.md).
//
//   POST /api/account/password-reset  { email }   anyone
//
// Supabase's built-in email sender only reaches the Supabase team's own
// addresses, so the forgot-password page asks here first. With the service
// role, auth.admin.generateLink makes the account's one-time recovery token
// without sending anything, and mailer.js sends the link over binge.'s SMTP
// (the same sender as the invites).
//
// The link opens the site itself, /reset-password?token_hash=…&type=recovery,
// and that page trades the token for a session (verifyOtp). Mail scanners that
// fetch links don't run the page's script, so they can't use the token up, and
// no Supabase redirect URL is involved.
//
// The answer is the same whether or not the address has an account, so the
// form can't be used to find out who has one. Limits: 10 asks an hour per IP
// (per server instance), and one email a minute per account, read from the
// account's recovery_sent_at, which Supabase keeps.
//
// Without the service-role key or SMTP it answers { fallback: true }, and the
// page asks Supabase to send its own email, as before.
const express = require('express');
const { serviceClient } = require('../middleware/supabaseAdmin');
const mailer = require('../mailer');
const { createLimiter, clientIp } = require('./invites');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_MS = 60 * 1000;

function resetEmail({ email, link, site }) {
  return {
    subject: 'Reset your binge. password',
    text: `Someone asked to reset the password of the binge. account for ${email}. If that was you, choose a new password here:\n\n${link}\n\nThe link works once. If it has expired, ask for a new one: ${site}/forgot-password\n\nIf you didn't ask, you can ignore this email. Your password stays the same.\n`,
  };
}

// profiles.email is the sign-in address (handle_auth_user_changed keeps it,
// unique), stored lowercase like the invites route stores it.
function supabaseAccounts(db) {
  return {
    async find(email) {
      const { data, error } = await db.from('profiles').select('id').eq('email', email).limit(1);
      if (error) throw error;
      const id = data?.[0]?.id;
      if (!id) return null;
      const { data: found, error: userError } = await db.auth.admin.getUserById(id);
      if (userError) throw userError;
      return found?.user || null;
    },
    async recoveryToken(email) {
      const { data, error } = await db.auth.admin.generateLink({ type: 'recovery', email });
      if (error) throw error;
      return data?.properties?.hashed_token || null;
    },
  };
}

function createPasswordResetHandler({
  getAccounts = () => { const db = serviceClient(); return db ? supabaseAccounts(db) : null; },
  sendMail = mailer.sendMail,
  emailConfigured = mailer.emailConfigured,
  site = mailer.siteUrl,
  now = () => Date.now(),
  ipLimiter = createLimiter(10, 60 * 60 * 1000),
} = {}) {
  return async function passwordReset(req, res) {
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254);
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (ipLimiter(clientIp(req))) return res.status(429).json({ error: 'Too many reset requests from here. Try again in an hour.' });

    const accounts = getAccounts();
    if (!accounts || !emailConfigured()) return res.json({ fallback: true });

    try {
      const user = await accounts.find(email);
      if (!user?.email) return res.json({ sent: true });
      // A second ask within the minute: the first email is on its way.
      if (now() - Date.parse(user.recovery_sent_at || '') < RESEND_MS) return res.json({ sent: true });

      const token = await accounts.recoveryToken(user.email);
      if (!token) throw new Error('generateLink returned no token');
      const base = site();
      const link = `${base}/reset-password?token_hash=${encodeURIComponent(token)}&type=recovery`;
      const sent = await sendMail({ to: user.email, ...resetEmail({ email: user.email, link, site: base }) });
      if (!sent) return res.status(502).json({ error: "Couldn't send the email just now. Try again in a minute." });
      return res.json({ sent: true });
    } catch (error) {
      console.error('[password-reset]', error?.message);
      return res.status(500).json({ error: "Couldn't send a reset link just now. Try again in a minute." });
    }
  };
}

const router = express.Router();
router.post('/password-reset', createPasswordResetHandler());

module.exports = router;
module.exports.createPasswordResetHandler = createPasswordResetHandler;
module.exports.resetEmail = resetEmail;
