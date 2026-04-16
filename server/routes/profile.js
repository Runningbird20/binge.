const express = require('express');
const router  = express.Router();
const db      = require('../db');
let _sbCreateClient = null;
function getCreateClient() {
  if (!_sbCreateClient) {
    try { _sbCreateClient = require('@supabase/supabase-js').createClient; }
    catch (e) { throw new Error('supabase-js not installed. Run: npm install'); }
  }
  return _sbCreateClient;
}

function getSb() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  return getCreateClient()(url, key);
}

async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    let _sbCreateClient = null;
function getCreateClient() {
  if (!_sbCreateClient) {
    try { _sbCreateClient = require('@supabase/supabase-js').createClient; }
    catch (e) { throw new Error('supabase-js not installed. Run: npm install'); }
  }
  return _sbCreateClient;
}
    const sb = getCreateClient()(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

// GET /profile/:username — public profile
router.get('/:username', async (req, res) => {
  try {
    const sb = getSb();
    const { data: profile, error } = await sb.from('profiles')
      .select('id, username, avatar_url, bio, created_at, is_public')
      .eq('username', req.params.username)
      .single();
    if (error || !profile) return res.status(404).json({ error: 'User not found' });

    if (!profile.is_public) return res.json({ profile, ratings: [], watchlist: [], posts: [], isPrivate: true });

    // Get public data
    const [{ data: ratings }, { data: watchlist }, { data: posts }, { count: followers }, { count: following }] = await Promise.all([
      sb.from('movie_ratings').select('media_id, created_at').eq('user_id', profile.id).limit(6),
      sb.from('watchlist').select('media_type, media_id, status, added_at').eq('user_id', profile.id).order('added_at', { ascending: false }).limit(12),
      sb.from('posts').select('id, title, flair, score, comment_count, created_at, forums(name, slug, icon)').eq('user_id', profile.id).eq('is_removed', false).order('created_at', { ascending: false }).limit(10),
      sb.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
      sb.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
    ]);

    // Enrich watchlist with titles from SQLite
    const enrichedWatchlist = (watchlist || []).map(item => {
      try {
        let media = null;
        if (item.media_type === 'movie') media = db.prepare('SELECT title, poster_url FROM movies WHERE id = ?').get(item.media_id);
        else if (item.media_type === 'tv_show') media = db.prepare('SELECT title, poster_url FROM tv_shows WHERE id = ?').get(item.media_id);
        else if (item.media_type === 'book') media = db.prepare('SELECT title, cover_url as poster_url FROM books WHERE id = ?').get(item.media_id);
        return { ...item, title: media?.title, poster_url: media?.poster_url };
      } catch { return item; }
    });

    res.json({ profile, ratings: ratings || [], watchlist: enrichedWatchlist, posts: posts || [], followers: followers || 0, following: following || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /profile/:username/follow-status — am I following this user?
router.get('/:username/follow-status', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.json({ following: false });
  try {
    const sb = getSb();
    const { data: target } = await sb.from('profiles').select('id').eq('username', req.params.username).single();
    if (!target) return res.json({ following: false });
    const { data } = await sb.from('user_follows').select('id').eq('follower_id', user.id).eq('following_id', target.id).maybeSingle();
    res.json({ following: !!data });
  } catch { res.json({ following: false }); }
});

// POST /profile/:username/follow
router.post('/:username/follow', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    const { data: target } = await sb.from('profiles').select('id').eq('username', req.params.username).single();
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === user.id) return res.status(400).json({ error: "Can't follow yourself" });
    await sb.from('user_follows').upsert({ follower_id: user.id, following_id: target.id }, { onConflict: 'follower_id,following_id' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /profile/:username/follow
router.delete('/:username/follow', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    const { data: target } = await sb.from('profiles').select('id').eq('username', req.params.username).single();
    if (!target) return res.status(404).json({ error: 'User not found' });
    await sb.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', target.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
