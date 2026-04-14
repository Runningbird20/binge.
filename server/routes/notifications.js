const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSb(token) {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  return createClient(url, key, token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {});
}

async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

// GET /notifications — get unread + recent notifications
router.get('/', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    const { data, error } = await sb.from('notifications')
      .select('*, actor:actor_id(username, avatar_url)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /notifications/unread-count
router.get('/unread-count', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.json({ count: 0 });
  try {
    const sb = getSb();
    const { count } = await sb.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false);
    res.json({ count: count || 0 });
  } catch { res.json({ count: 0 }); }
});

// POST /notifications/read-all — mark all read
router.post('/read-all', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    await sb.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /notifications/read/:id
router.post('/read/:id', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSb();
    await sb.from('notifications').update({ read: true }).eq('id', req.params.id).eq('user_id', user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Internal helper — create notification (called from other routes)
async function createNotification(sb, { userId, type, actorId, postId, commentId, message }) {
  if (userId === actorId) return; // don't notify yourself
  try {
    await sb.from('notifications').insert({ user_id: userId, type, actor_id: actorId, post_id: postId || null, comment_id: commentId || null, message });
  } catch { /* non-fatal */ }
}

module.exports = router;
module.exports.createNotification = createNotification;
