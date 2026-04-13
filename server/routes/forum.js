const express = require('express');
const router  = express.Router();

// ── Supabase admin client ─────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

function normalizeUserType(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'admin' || normalized === 'admins') {
    return 'admin';
  }

  if (
    normalized === 'coach' ||
    normalized === 'coaches' ||
    normalized === 'developer' ||
    normalized === 'developers' ||
    normalized === 'dev'
  ) {
    return 'coach';
  }

  return 'user';
}


// Fetch usernames for a list of user_ids
async function enrichWithProfiles(sb, items) {
  if (!items || items.length === 0) return items;
  const userIds = [...new Set(items.map(i => i.user_id).filter(Boolean))];
  if (userIds.length === 0) return items;
  const { data: profiles } = await sb.from('profiles').select('id, username, avatar_url').in('id', userIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });
  return items.map(item => ({ ...item, profiles: profileMap[item.user_id] || null }));
}

// ── Groq AI moderation ────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

async function moderateContent(text) {
  if (!GROQ_API_KEY || !text?.trim()) return { allowed: true };

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 120,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are a content moderator for a media discussion forum (movies, TV, books).
Respond ONLY with valid JSON: {"allowed": true} or {"allowed": false, "reason": "short reason"}.

Reject content that contains:
- Hate speech, slurs, or targeted harassment
- Illegal activity (piracy links, drug sales, fraud, CSAM)
- Explicit sexual content or graphic violence
- Personal information / doxxing
- Spam or commercial solicitation
- Threats or calls for real-world violence

Allow: spoilers (even major ones), strong opinions, criticism, profanity in context, heated debate about media.`
          },
          { role: 'user', content: `Moderate this post/comment:\n\n${text.slice(0, 1000)}` }
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content?.trim() || '{"allowed":true}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { allowed: true }; // fail open — don't block posts if AI is down
  }
}

// ── Auth helper — get user from Supabase JWT ──────────────────────────────────
async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    // Use a user-scoped client to validate the JWT
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

async function requireUser(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Not signed in' }); return null; }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORUMS
// ─────────────────────────────────────────────────────────────────────────────

// GET /forum — list all forums
router.get('/', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('forums').select('*').order('member_count', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /forum/search?q= — search forums
router.get('/search', async (req, res) => {
  const { q = '' } = req.query;
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('forums').select('*')
      .ilike('name', `%${q}%`)
      .order('member_count', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /forum — create a forum
router.post('/', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const { name, description = '', icon = '💬', banner_color = '#1a1a1a' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    const sb = getSupabase();
    const { data: forum, error } = await sb.from('forums')
      .insert({ name: name.trim(), slug, description, icon, banner_color, creator_id: user.id, rules: req.body.rules || null })
      .select().single();
    if (error) throw error;

    // Auto-join as owner
    await sb.from('forum_members').insert({ forum_id: forum.id, user_id: user.id, role: 'owner' });
    res.status(201).json(forum);
  } catch (err) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'A forum with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// GET /forum/:slug — get single forum
router.get('/:slug', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('forums').select('*').eq('slug', req.params.slug).single();
    if (error || !data) return res.status(404).json({ error: 'Forum not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /forum/:slug/join
router.post('/:slug/join', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  try {
    const sb = getSupabase();
    const { data: forum } = await sb.from('forums').select('id').eq('slug', req.params.slug).single();
    if (!forum) return res.status(404).json({ error: 'Forum not found' });
    await sb.from('forum_members').upsert({ forum_id: forum.id, user_id: user.id, role: 'member' }, { onConflict: 'forum_id,user_id' });
    const { data: forumData } = await sb.from('forums').select('member_count').eq('id', forum.id).single();
    if (forumData) await sb.from('forums').update({ member_count: (forumData.member_count || 0) + 1 }).eq('id', forum.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /forum/:slug/leave
router.post('/:slug/leave', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  try {
    const sb = getSupabase();
    const { data: forum } = await sb.from('forums').select('id').eq('slug', req.params.slug).single();
    if (!forum) return res.status(404).json({ error: 'Forum not found' });
    await sb.from('forum_members').delete().eq('forum_id', forum.id).eq('user_id', user.id);
    const { data: fData } = await sb.from('forums').select('member_count').eq('id', forum.id).single();
    if (fData) await sb.from('forums').update({ member_count: Math.max(0, (fData.member_count || 1) - 1) }).eq('id', forum.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POSTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /forum/:slug/posts
router.get('/:slug/posts', async (req, res) => {
  const { sort = 'hot', page = 1 } = req.query;
  const limit  = 25;
  const offset = (Number(page) - 1) * limit;

  try {
    const sb = getSupabase();
    const { data: forum } = await sb.from('forums').select('id').eq('slug', req.params.slug).single();
    if (!forum) return res.status(404).json({ error: 'Forum not found' });

    let query = sb.from('posts')
      .select('*', { count: 'exact' })
      .eq('forum_id', forum.id)
      .eq('is_removed', false)
      .range(offset, offset + limit - 1);

    if (sort === 'new')  query = query.order('created_at', { ascending: false });
    else if (sort === 'top') query = query.order('score', { ascending: false });
    else query = query.order('score', { ascending: false }).order('created_at', { ascending: false }); // hot

    const { data, error, count } = await query;
    if (error) throw error;
    const enriched = await enrichWithProfiles(sb, data || []);
    res.json({ posts: enriched, total: count || 0, page: Number(page) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /forum/posts/feed — all posts across all forums (home feed)
router.get('/posts/feed', async (req, res) => {
  const { sort = 'hot', page = 1 } = req.query;
  const limit  = 25;
  const offset = (Number(page) - 1) * limit;
  try {
    const sb = getSupabase();
    let query = sb.from('posts')
      .select('*, forums(name, slug, icon)', { count: 'exact' })
      .eq('is_removed', false)
      .range(offset, offset + limit - 1);

    if (sort === 'new')  query = query.order('created_at', { ascending: false });
    else if (sort === 'top') query = query.order('score', { ascending: false });
    else query = query.order('score', { ascending: false }).order('created_at', { ascending: false });

    const { data, error, count } = await query;
    if (error) throw error;
    const enriched = await enrichWithProfiles(sb, data || []);
    res.json({ posts: enriched, total: count || 0, page: Number(page) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /forum/:slug/posts — create post (with AI moderation)
router.post('/:slug/posts', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const { title, body = '', flair, tags = [] } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  // AI moderation
  const modResult = await moderateContent(`${title}\n\n${body}`);
  if (!modResult.allowed) {
    return res.status(422).json({ error: `Post removed by AI moderator: ${modResult.reason}` });
  }

  try {
    const sb = getSupabase();
    const { data: forum } = await sb.from('forums').select('id').eq('slug', req.params.slug).single();
    if (!forum) return res.status(404).json({ error: 'Forum not found' });

    const { data, error } = await sb.from('posts')
      .insert({ forum_id: forum.id, user_id: user.id, title: title.trim(), body, flair: flair || null, tags })
      .select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /forum/post/:id — single post with comments
router.get('/post/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: post, error } = await sb.from('posts')
      .select('*, forums(name, slug, icon)')
      .eq('id', req.params.id).single();
    if (error || !post) return res.status(404).json({ error: 'Post not found' });

    // Get all comments for this post
    const { data: rawComments } = await sb.from('comments')
      .select('*')
      .eq('post_id', req.params.id)
      .order('score', { ascending: false });

    const [enrichedPost, enrichedComments] = await Promise.all([
      enrichWithProfiles(sb, [post]).then(r => r[0]),
      enrichWithProfiles(sb, rawComments || []),
    ]);

    res.json({ post: enrichedPost, comments: enrichedComments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /forum/post/:id
router.delete('/post/:id', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  try {
    const sb = getSupabase();
    const { error } = await sb.from('posts').delete().eq('id', req.params.id).eq('user_id', user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// VOTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /forum/post/:id/vote  { value: 1 | -1 | 0 }
router.post('/post/:id/vote', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const value = Number(req.body.value);
  if (![1, -1, 0].includes(value)) return res.status(400).json({ error: 'value must be 1, -1, or 0' });

  try {
    const sb = getSupabase();

    // Get existing vote
    const { data: existing } = await sb.from('post_votes')
      .select('id, value').eq('post_id', req.params.id).eq('user_id', user.id).maybeSingle();

    const oldValue = existing?.value || 0;
    const delta    = value - oldValue;

    if (value === 0) {
      if (existing) await sb.from('post_votes').delete().eq('id', existing.id);
    } else if (existing) {
      await sb.from('post_votes').update({ value }).eq('id', existing.id);
    } else {
      await sb.from('post_votes').insert({ post_id: Number(req.params.id), user_id: user.id, value });
    }

    // Update post score
    if (delta !== 0) {
      const { data: postData } = await sb.from('posts').select('score').eq('id', req.params.id).single();
    if (postData) await sb.from('posts').update({ score: (postData.score || 0) + delta }).eq('id', req.params.id);
    }

    res.json({ success: true, delta });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /forum/comment/:id/vote
router.post('/comment/:id/vote', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const value = Number(req.body.value);
  if (![1, -1, 0].includes(value)) return res.status(400).json({ error: 'value must be 1, -1, or 0' });

  try {
    const sb = getSupabase();
    const { data: existing } = await sb.from('comment_votes')
      .select('id, value').eq('comment_id', req.params.id).eq('user_id', user.id).maybeSingle();

    const oldValue = existing?.value || 0;
    const delta    = value - oldValue;

    if (value === 0) {
      if (existing) await sb.from('comment_votes').delete().eq('id', existing.id);
    } else if (existing) {
      await sb.from('comment_votes').update({ value }).eq('id', existing.id);
    } else {
      await sb.from('comment_votes').insert({ comment_id: Number(req.params.id), user_id: user.id, value });
    }

    if (delta !== 0) {
      const { data: commentData } = await sb.from('comments').select('score').eq('id', req.params.id).single();
    if (commentData) await sb.from('comments').update({ score: (commentData.score || 0) + delta }).eq('id', req.params.id);
    }

    res.json({ success: true, delta });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

// POST /forum/post/:id/comments — add comment (with AI moderation)
router.post('/post/:id/comments', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const { body, parent_comment_id = null } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Comment body is required' });

  // AI moderation
  const modResult = await moderateContent(body);
  if (!modResult.allowed) {
    return res.status(422).json({ error: `Comment removed by AI moderator: ${modResult.reason}` });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('comments')
      .insert({ post_id: Number(req.params.id), user_id: user.id, body: body.trim(), parent_comment_id })
      .select('*').single();
    if (error) throw error;
    const [enrichedComment] = await enrichWithProfiles(sb, [data]);

    // Increment post comment count
    const { data: postForCount } = await sb.from('posts').select('comment_count').eq('id', req.params.id).single();
    if (postForCount) await sb.from('posts').update({ comment_count: (postForCount.comment_count || 0) + 1 }).eq('id', req.params.id);

    res.status(201).json(enrichedComment || data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /forum/comment/:id
router.delete('/comment/:id', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  try {
    const sb = getSupabase();
    const { data: comment } = await sb.from('comments').select('post_id').eq('id', req.params.id).single();
    await sb.from('comments').delete().eq('id', req.params.id).eq('user_id', user.id);
    if (comment) {
      const { data: postForDec } = await sb.from('posts').select('comment_count').eq('id', comment.post_id).single();
      if (postForDec) await sb.from('posts').update({ comment_count: Math.max(0, (postForDec.comment_count || 1) - 1) }).eq('id', comment.post_id);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /forum/user/my-forums — forums the current user has joined
router.get('/user/my-forums', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('forum_members')
      .select('role, forums(*)')
      .eq('user_id', user.id);
    if (error) throw error;
    res.json((data || []).map(m => ({ ...m.forums, role: m.role })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /forum/comment/:id — edit own comment body
router.patch('/comment/:id', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Body is required' });

  // Moderate edited content
  const modResult = await moderateContent(body);
  if (!modResult.allowed) return res.status(422).json({ error: `Edit rejected: ${modResult.reason}` });

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('comments')
      .update({ body: body.trim() })
      .eq('id', req.params.id)
      .eq('user_id', user.id) // can only edit own
      .select('*').single();
    if (error || !data) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

async function isAdmin(user) {
  if (!user) return false;
  try {
    const sb = getSupabase();
    const { data } = await sb.from('profiles').select('user_type').eq('id', user.id).single();
    return normalizeUserType(data?.user_type || user.user_metadata?.user_type) === 'admin';
  } catch { return false; }
}

async function isForumMod(user, forumId) {
  if (!user) return false;
  try {
    const sb = getSupabase();
    const { data } = await sb.from('forum_members')
      .select('role').eq('user_id', user.id).eq('forum_id', forumId).single();
    return data?.role === 'moderator' || data?.role === 'owner';
  } catch { return false; }
}

// Admin: delete a post (and all its comments)
router.delete('/admin/post/:id', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const admin = await isAdmin(user);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  try {
    const sb = getSupabase();
    // Delete all comments first, then the post (cascade should handle it but be explicit)
    await sb.from('comments').delete().eq('post_id', req.params.id);
    await sb.from('post_votes').delete().eq('post_id', req.params.id);
    const { error } = await sb.from('posts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: redact a comment (replace body, mark removed)
router.patch('/admin/comment/:id', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const admin = await isAdmin(user);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('comments')
      .update({
        body: 'This comment was removed as it goes against community guidelines.',
        is_removed: true,
        removal_reason: req.body.reason || 'Violated community guidelines',
      })
      .eq('id', req.params.id)
      .select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: get all posts across all forums (for moderation dashboard)
router.get('/admin/posts', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const admin = await isAdmin(user);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('posts')
      .select('*, forums(name, slug)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    const enriched = await enrichWithProfiles(sb, data || []);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
