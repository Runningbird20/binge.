// The words of binge.'s alert emails (routes/cron.js sends them through
// mailer.js). Plain text, like the account emails in routes/invites.js.

const DIGEST_MAX = 20;

const oneLine = (value, max = 150) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

function footer(site) {
  return `—\nYou're getting this because email alerts are on for your binge. account. Turn them off in Settings: ${site}/settings\n`;
}

// A reminder that's due: { title, url } (url a path on binge.).
function reminderEmail({ title, url }, site) {
  return {
    subject: oneLine(`Time to watch ${title}`),
    text: `You asked binge. to remind you to watch ${oneLine(title, 200)}.\n\nStart watching:\n${site}${url}\n\n${footer(site)}`,
  };
}

// The day's unread alerts: [{ title, body, url }], newest first, one each.
function digestEmail(alerts, site) {
  const shown = alerts.slice(0, DIGEST_MAX);
  const more = alerts.length - shown.length;
  const first = oneLine(alerts[0]?.title);
  const subject = alerts.length === 1 ? first : oneLine(`${first} and ${alerts.length - 1} more`);
  const entries = shown.map((alert) => [oneLine(alert.title, 200), oneLine(alert.body, 500), alert.url ? `${site}${alert.url}` : '']
    .filter(Boolean).join('\n'));
  const rest = more > 0 ? `\n\n…and ${more} more in binge.: ${site}/home` : '';
  return {
    subject,
    text: `Here's what's new for you on binge.\n\n${entries.join('\n\n')}${rest}\n\n${footer(site)}`,
  };
}

module.exports = { reminderEmail, digestEmail, DIGEST_MAX };
