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

    if (!profile.is_public) return res.json({ profile, ratings: [], watchlist: [], isPrivate: true });

    // Get public data
    const [
      { data: movieRatings }, { data: tvRatings }, { data: bookRatings },
      { data: watchlist },
      { count: followers }, { count: following },
    ] = await Promise.all([
      sb.from('movie_ratings').select('media_id, created_at, review, acting, writing, originality, pacing, cinematography').eq('user_id', profile.id).limit(50),
      sb.from('tv_show_ratings').select('media_id, created_at, review, premise, originality, acting, cinematography, writing, pacing, resonance').eq('user_id', profile.id).limit(50),
      sb.from('book_ratings').select('media_id, created_at, review, prose, plot, characters, originality, pacing, resonance').eq('user_id', profile.id).limit(50),
      sb.from('watchlist').select('id, media_type, media_id, status, added_at, current_season, current_episode, current_page, current_chapter').eq('user_id', profile.id).order('added_at', { ascending: false }),
      sb.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
      sb.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
    ]);

    // Build Supabase media lookup maps (primary source — SQLite used as fallback)
    const watchlistRows = watchlist || [];
    const allRatingRows = [
      ...(movieRatings || []).map(r => ({ ...r, _type: 'movie' })),
      ...(tvRatings    || []).map(r => ({ ...r, _type: 'tv_show' })),
      ...(bookRatings  || []).map(r => ({ ...r, _type: 'book' })),
    ];

    function collectIds(rows, type) {
      return [...new Set(rows.filter(r => (r.media_type || r._type) === type).map(r => r.media_id).filter(Boolean))];
    }

    const movieIds   = [...new Set([...collectIds(watchlistRows, 'movie'),   ...collectIds(allRatingRows, 'movie')])];
    const tvIds      = [...new Set([...collectIds(watchlistRows, 'tv_show'), ...collectIds(allRatingRows, 'tv_show')])];
    const bookIds    = [...new Set([...collectIds(watchlistRows, 'book'),    ...collectIds(allRatingRows, 'book')])];

    const [sbMovies, sbTv, sbBooks] = await Promise.all([
      movieIds.length ? sb.from('movies').select('id, title, year, poster_url').in('id', movieIds).then(r => r.data || []) : [],
      tvIds.length    ? sb.from('tv_shows').select('id, title, year, poster_url').in('id', tvIds).then(r => r.data || []) : [],
      bookIds.length  ? sb.from('books').select('id, title, year, cover_url').in('id', bookIds).then(r => r.data || []) : [],
    ]);

    const movieMap = new Map(sbMovies.map(m => [m.id, { title: m.title, year: m.year, image_url: m.poster_url }]));
    const tvMap    = new Map(sbTv.map(t    => [t.id, { title: t.title, year: t.year, image_url: t.poster_url }]));
    const bookMap  = new Map(sbBooks.map(b => [b.id, { title: b.title, year: b.year, image_url: b.cover_url }]));

    function sbMeta(mediaType, mediaId) {
      const map = mediaType === 'movie' ? movieMap : mediaType === 'tv_show' ? tvMap : bookMap;
      if (map.has(mediaId)) return map.get(mediaId);
      // SQLite fallback for items only in local DB
      try {
        let row = null;
        if (mediaType === 'movie')   row = db.prepare('SELECT title, year, poster_url as image_url FROM movies WHERE id = ?').get(mediaId);
        if (mediaType === 'tv_show') row = db.prepare('SELECT title, year, poster_url as image_url FROM tv_shows WHERE id = ?').get(mediaId);
        if (mediaType === 'book')    row = db.prepare('SELECT title, year, cover_url  as image_url FROM books  WHERE id = ?').get(mediaId);
        return row || null;
      } catch { return null; }
    }

    // Enrich ratings
    function enrichRatings(rows, mediaType) {
      return (rows || []).map(item => {
        const meta = sbMeta(mediaType, item.media_id);
        return { ...item, media_type: mediaType, title: meta?.title, year: meta?.year, image_url: meta?.image_url };
      });
    }

    const ratings = [
      ...enrichRatings(movieRatings, 'movie'),
      ...enrichRatings(tvRatings, 'tv_show'),
      ...enrichRatings(bookRatings, 'book'),
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // Enrich watchlist (poster_url alias kept for WatchlistCard compatibility)
    const enrichedWatchlist = watchlistRows.map(item => {
      const meta = sbMeta(item.media_type, item.media_id);
      return { ...item, title: meta?.title, year: meta?.year, poster_url: meta?.image_url };
    });

    res.json({ profile, ratings, watchlist: enrichedWatchlist, followers: followers || 0, following: following || 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
