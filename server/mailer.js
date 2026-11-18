// Sends binge.'s own emails (account requests and approvals,
// routes/invites.js; email alerts, routes/cron.js) over SMTP. Supabase Auth only sends its auth emails
// (confirm, reset), so anything else needs a sender of our own.
//
// Configure with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM, for
// example a Gmail account with an app password (docs/invite-only.md). Without
// them nothing is sent: requests are still saved and listed in Admin →
// Requests, and approving one shows the invite link to pass on by hand.
const nodemailer = require('nodemailer');

let transport = null;

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT) || 465;
  return { host, port, secure: port === 465, auth: { user, pass } };
}

function emailConfigured() {
  return Boolean(smtpConfig());
}

// Links in emails point at the site itself, never a request's Origin.
function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}

// Resolves to true when the message was handed to the SMTP server, false when
// email isn't configured or the server refused it (the caller decides what to
// tell the person; nothing here throws).
async function sendMail({ to, subject, text, html, replyTo }) {
  const config = smtpConfig();
  if (!config) return false;
  try {
    transport = transport || nodemailer.createTransport(config);
    await transport.sendMail({
      from: process.env.SMTP_FROM || `binge. <${config.auth.user}>`,
      to,
      subject,
      text,
      html,
      replyTo,
    });
    return true;
  } catch (error) {
    console.error('[mail]', error.message);
    return false;
  }
}

module.exports = { sendMail, emailConfigured, siteUrl };
