const express = require('express');
const webpush = require('web-push');

const router = express.Router();

// Daily new-episode alerts (Vercel cron → GET /api/cron/new-episodes, see
// vercel.json). For every profile with a push subscription: look at the TV
// shows in its list / Continue Watching, ask TMDB for each show's latest
// aired episode, and notify once per new episode (push_notified dedupes).
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY +
// VAPID_PRIVATE_KEY (+ VAPID_SUBJECT), TMDB_API_KEY, and CRON_SECRET.

const NEW_WITHIN_DAYS = 2;

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return require('@supabase/supabase-js').createClient(url, key, { auth: { persistSession: false } });
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

async function latestEpisode(tmdbId) {
  const key = process.env.TMDB_API_KEY || process.env.REACT_APP_TMDB_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  return { name: data.name, last: data.last_episode_to_air };
}

router.get('/new-episodes', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const db = getAdminClient();
  if (!db || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'push not configured' });
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@binge.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const { data: subs, error } = await db.from('push_subscriptions').select('id, user_id, profile_id, endpoint, p256dh, auth');
  if (error) return res.status(500).json({ error: error.message });

  const cutoff = Date.now() - NEW_WITHIN_DAYS * 86400000;
  const showCache = new Map(); // tv_shows.id -> latest episode info
  let sent = 0;
  let removed = 0;

  // Group subscriptions by profile so each profile's list is read once.
  const byProfile = new Map();
  (subs || []).forEach((sub) => {
    const key = `${sub.user_id}|${sub.profile_id || ''}`;
    byProfile.set(key, [...(byProfile.get(key) || []), sub]);
  });

  for (const [profileKey, profileSubs] of byProfile) {
    const [userId, profileId] = profileKey.split('|');
    const scope = (query) => (profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null));
    const [{ data: list }, { data: watching }] = await Promise.all([
      scope(db.from('watchlist').select('media_id, status').eq('user_id', userId).eq('media_type', 'tv_show')),
      scope(db.from('continue_watching').select('media_id').eq('user_id', userId).eq('media_type', 'tv_show')),
    ]);
    const showIds = [...new Set([
      ...(list || []).filter((row) => row.status !== 'watched').map((row) => Number(row.media_id)),
      ...(watching || []).map((row) => Number(row.media_id)),
    ])].slice(0, 60);
    if (!showIds.length) continue;

    const { data: shows } = await db.from('tv_shows').select('id, title, source_key').in('id', showIds);
    for (const show of shows || []) {
      const tmdbId = String(show.source_key || '').match(/^tmdb:tv:(\d+)$/)?.[1];
      if (!tmdbId) continue;
      if (!showCache.has(show.id)) showCache.set(show.id, await latestEpisode(tmdbId).catch(() => null));
      const info = showCache.get(show.id);
      const last = info?.last;
      if (!last?.air_date || new Date(`${last.air_date}T23:59:59Z`).getTime() < cutoff) continue;

      const episodeKey = `S${last.season_number}E${last.episode_number}`;
      const { data: already } = await db.from('push_notified').select('episode_key')
        .eq('user_id', userId).eq('media_id', show.id).eq('episode_key', episodeKey).maybeSingle();
      if (already) continue;

      const payload = JSON.stringify({
        title: `New episode: ${show.title}`,
        body: `S${last.season_number} · E${last.episode_number}${last.name ? ` — ${last.name}` : ''} is out now.`,
        url: `/tv-show/${show.id}?play=1&season=${last.season_number}&episode=${last.episode_number}`,
        tag: `new-episode-${show.id}`,
      });
      let delivered = false;
      for (const sub of profileSubs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
          delivered = true;
          sent += 1;
        } catch (err) {
          // Gone / expired subscriptions are cleaned up.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.from('push_subscriptions').delete().eq('id', sub.id);
            removed += 1;
          }
        }
      }
      if (delivered) {
        await db.from('push_notified').insert({ user_id: userId, profile_id: profileId || null, media_id: show.id, episode_key: episodeKey });
      }
    }
  }

  res.json({ profiles: byProfile.size, sent, removedSubscriptions: removed });
});

module.exports = router;
