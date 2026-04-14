const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSb() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  return createClient(url, key);
}

async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const sb = getSb();
    const { data: { user } } = await sb.auth.getUser(token);
    return user || null;
  } catch { return null; }
}

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

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
      .insert({ id, host_id: user.id, title, media_type: media_type || 'movie', media_id: media_id || null, tmdb_id: tmdb_id || null })
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /watchroom/:id — get room info + recent messages
router.get('/:id', async (req, res) => {
  try {
    const sb = getSb();
    const [{ data: room }, { data: messages }] = await Promise.all([
      sb.from('watch_rooms').select('*, host:host_id(username, avatar_url)').eq('id', req.params.id).single(),
      sb.from('room_messages').select('*, profiles:user_id(username, avatar_url)').eq('room_id', req.params.id).order('created_at', { ascending: true }).limit(200),
    ]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room, messages: messages || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /watchroom/:id/message — send message
router.post('/:id/message', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  try {
    const sb = getSb();
    const { data, error } = await sb.from('room_messages')
      .insert({ room_id: req.params.id, user_id: user.id, message: message.trim() })
      .select('*, profiles:user_id(username, avatar_url)').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /watchroom/:id — close room (host only)
router.delete('/:id', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    await sb.from('watch_rooms').update({ is_active: false }).eq('id', req.params.id).eq('host_id', user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /watchroom/:id/messages/since/:timestamp — long-poll for new messages
router.get('/:id/messages/since/:ts', async (req, res) => {
  try {
    const sb = getSb();
    const { data } = await sb.from('room_messages')
      .select('*, profiles:user_id(username, avatar_url)')
      .eq('room_id', req.params.id)
      .gt('created_at', new Date(Number(req.params.ts)).toISOString())
      .order('created_at', { ascending: true });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
