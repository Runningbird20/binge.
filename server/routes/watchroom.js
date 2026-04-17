const express = require('express');
const router  = express.Router();
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
    const sb = getCreateClient()(url, key, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Room CRUD ─────────────────────────────────────────────────

// POST /watchroom — create room
router.post('/', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { title, media_type, media_id, tmdb_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  try {
    const sb = getSb();
    const id = generateRoomId();
    const { data, error } = await sb.from('watch_rooms')
      .insert({
        id, host_id: user.id, title,
        media_type: media_type || 'movie',
        media_id: media_id || null,
        tmdb_id: tmdb_id || null,
        sync_provider: 'vidsrc-embed-ru',
        sync_season: 1,
        sync_episode: 1,
        sync_is_playing: false,
        sync_current_time: 0,
      })
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /watchroom/:id — room info + messages + viewers
router.get('/:id', async (req, res) => {
  try {
    const sb = getSb();
    const [{ data: room, error: roomErr }, { data: messages }, { data: rawViewers }] = await Promise.all([
      sb.from('watch_rooms').select('*').eq('id', req.params.id).single(),
      sb.from('room_messages').select('*').eq('room_id', req.params.id).order('created_at', { ascending: true }).limit(200),
      sb.from('room_viewers').select('user_id, last_seen')
        .eq('room_id', req.params.id)
        .gt('last_seen', new Date(Date.now() - 30000).toISOString()), // active in last 30s
    ]);
    if (roomErr || !room) return res.status(404).json({ error: 'Room not found or has ended' });

    // Enrich with profiles
    const userIds = [...new Set([room.host_id, ...(messages || []).map(m => m.user_id), ...(rawViewers || []).map(v => v.user_id)].filter(Boolean))];
    const { data: profiles } = await sb.from('profiles').select('id, username, avatar_url').in('id', userIds);
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p; });

    const enrichedRoom     = { ...room, host: profileMap[room.host_id] || null };
    const enrichedMessages = (messages || []).map(m => ({ ...m, profiles: profileMap[m.user_id] || null }));
    const viewers          = (rawViewers || []).map(v => ({ ...v, profiles: profileMap[v.user_id] || null }));

    res.json({ room: enrichedRoom, messages: enrichedMessages, viewers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sync ─────────────────────────────────────────────────────

// GET /watchroom/:id/sync — guests poll full sync state
router.get('/:id/sync', async (req, res) => {
  try {
    const sb = getSb();
    const { data, error } = await sb.from('watch_rooms')
      .select('sync_is_playing, sync_current_time, sync_updated_at, sync_provider, sync_season, sync_episode, host_id, tmdb_id, media_type, media_title, media_poster, is_active')
      .eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Room not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /watchroom/:id/sync — host pushes full playback state
router.post('/:id/sync', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { is_playing, current_time, provider, season, episode } = req.body;
  try {
    const sb = getSb();
    const { data: room } = await sb.from('watch_rooms').select('host_id').eq('id', req.params.id).single();
    if (!room || room.host_id !== user.id) return res.status(403).json({ error: 'Only the host can control playback' });
    const update = {
      sync_is_playing:   is_playing  !== undefined ? is_playing  : undefined,
      sync_current_time: current_time !== undefined ? current_time : undefined,
      sync_provider:     provider     !== undefined ? provider    : undefined,
      sync_season:       season       !== undefined ? season      : undefined,
      sync_episode:      episode      !== undefined ? episode     : undefined,
      sync_updated_at:   new Date().toISOString(),
    };
    // Remove undefined fields
    Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
    const { data, error } = await sb.from('watch_rooms').update(update).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Media ─────────────────────────────────────────────────────

// PATCH /watchroom/:id/media — host sets what to watch
router.patch('/:id/media', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { tmdb_id, media_type, media_title, media_poster } = req.body;
  try {
    const sb = getSb();
    const { data: room } = await sb.from('watch_rooms').select('host_id').eq('id', req.params.id).single();
    if (!room || room.host_id !== user.id) return res.status(403).json({ error: 'Only the host can change media' });
    const { data, error } = await sb.from('watch_rooms').update({
      tmdb_id, media_type: media_type || 'movie', media_title, media_poster,
      sync_current_time: 0, sync_is_playing: false,
      sync_season: 1, sync_episode: 1,
      sync_provider: 'vidsrc-embed-ru',
    }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Messages ──────────────────────────────────────────────────

// POST /watchroom/:id/message
router.post('/:id/message', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  try {
    const sb = getSb();
    const { data, error } = await sb.from('room_messages')
      .insert({ room_id: req.params.id, user_id: user.id, message: message.trim() })
      .select('*').single();
    if (error) throw error;
    const { data: profile } = await sb.from('profiles').select('id, username, avatar_url').eq('id', user.id).single();
    res.status(201).json({ ...data, profiles: profile || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /watchroom/:id/messages/since/:ts
router.get('/:id/messages/since/:ts', async (req, res) => {
  try {
    const sb = getSb();
    const { data } = await sb.from('room_messages').select('*')
      .eq('room_id', req.params.id)
      .gt('created_at', new Date(Number(req.params.ts)).toISOString())
      .order('created_at', { ascending: true });
    // Enrich
    const userIds = [...new Set((data || []).map(m => m.user_id).filter(Boolean))];
    let profileMap = {};
    if (userIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id, username, avatar_url').in('id', userIds);
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
    }
    res.json((data || []).map(m => ({ ...m, profiles: profileMap[m.user_id] || null })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Viewers (heartbeat) ───────────────────────────────────────

// POST /watchroom/:id/heartbeat — viewer announces presence
router.post('/:id/heartbeat', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.json({ ok: true });
  try {
    const sb = getSb();
    await sb.from('room_viewers').upsert(
      { room_id: req.params.id, user_id: user.id, last_seen: new Date().toISOString() },
      { onConflict: 'room_id,user_id' }
    );
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// GET /watchroom/:id/viewers
router.get('/:id/viewers', async (req, res) => {
  try {
    const sb = getSb();
    const { data } = await sb.from('room_viewers').select('user_id, last_seen')
      .eq('room_id', req.params.id)
      .gt('last_seen', new Date(Date.now() - 30000).toISOString());
    const userIds = (data || []).map(v => v.user_id);
    if (!userIds.length) return res.json([]);
    const { data: profiles } = await sb.from('profiles').select('id, username, avatar_url').in('id', userIds);
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p; });
    res.json((data || []).map(v => ({ ...v, profiles: profileMap[v.user_id] || null })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Room management ───────────────────────────────────────────

// PATCH /watchroom/:id/host — transfer host
router.patch('/:id/host', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { new_host_username } = req.body;
  try {
    const sb = getSb();
    const { data: room } = await sb.from('watch_rooms').select('host_id').eq('id', req.params.id).single();
    if (!room || room.host_id !== user.id) return res.status(403).json({ error: 'Only the current host can transfer' });
    const { data: newHost } = await sb.from('profiles').select('id').eq('username', new_host_username).single();
    if (!newHost) return res.status(404).json({ error: 'User not found' });
    await sb.from('watch_rooms').update({ host_id: newHost.id }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /watchroom/:id — close room
router.delete('/:id', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    await sb.from('watch_rooms').update({ is_active: false }).eq('id', req.params.id).eq('host_id', user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
