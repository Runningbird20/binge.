const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Intent detection ─────────────────────────────────────────────────────────

function detectQueryIntent(query) {
  const q = query.toLowerCase();
  if (q.includes('recommend') || q.includes('suggest') || q.includes('what should i') ||
      q.includes('similar to') || q.includes('based on my') || q.includes('for me') ||
      q.includes('my taste') || q.includes('my history') || q.includes('i enjoy') ||
      q.includes('i like') || q.includes('discover')) return 'recommendation';

  if (q.includes('theme') || q.includes('explain') || q.includes('why') ||
      q.includes('how does') || q.includes('compare') || q.includes('differ') ||
      q.includes('symbol') || q.includes('analyz') || q.includes('what does')) return 'thematic';

  if (q.includes('who direct') || q.includes('who wrote') || q.includes('who star') ||
      q.includes('when was') || q.includes('what year') || q.includes('cast') ||
      q.includes('author') || q.includes('creator') || q.includes('how many season') ||
      q.includes('synopsis')) return 'factual';

  return 'general';
}

// ─── System prompts ───────────────────────────────────────────────────────────

function buildSystemPrompt(intent) {
  const base = `You are the media assistant for "binge." — a platform where users track movies, TV shows, and books.

CRITICAL RULES you must follow without exception:
1. You may ONLY mention or recommend titles that appear in the SITE DATABASE CONTEXT provided.
2. NEVER invent, hallucinate, or suggest titles from your own training data that are not in the context.
3. If the context does not contain titles matching the request, say so honestly and list only what IS available.
4. Do not pivot away from the context to make up alternatives. Stay strictly within what the database contains.
5. When listing titles, be specific about which ones are movies, TV shows, or books.`;

  if (intent === 'recommendation') return `${base}\n\nYour task: recommend titles from the database based on the user's taste. Explain briefly why each fits. Only use titles from the context.`;
  if (intent === 'thematic') return `${base}\n\nYour task: provide thematic or analytical insight about titles in the database. Only reference titles in the context.`;
  if (intent === 'factual') return `${base}\n\nYour task: answer factual questions using only information from the context. If the answer isn't there, say so.`;
  return `${base}\n\nAnswer using only the titles and information in the database context.`;
}

// ─── RAG retrieval ────────────────────────────────────────────────────────────

function detectMediaTypes(query) {
  const q = query.toLowerCase();
  const wantsMovies  = q.includes('movie') || q.includes('film') || q.includes('cinema');
  const wantsTV      = q.includes('tv') || q.includes('show') || q.includes('series') || q.includes('episode') || q.includes('season');
  const wantsBooks   = q.includes('book') || q.includes('novel') || q.includes('read') || q.includes('author');
  if (!wantsMovies && !wantsTV && !wantsBooks) return ['movie', 'tv_show', 'book'];
  const types = [];
  if (wantsMovies) types.push('movie');
  if (wantsTV)     types.push('tv_show');
  if (wantsBooks)  types.push('book');
  return types;
}

function extractTerms(query) {
  const stop = new Set(['the','and','for','with','that','this','are','was','have','from',
    'some','any','what','which','show','give','list','find','tell','me','about','on','in',
    'a','an','is','of','to','do','you','can','i','my','your','their','its','shows','movies',
    'books','films','series','tv']);
  return query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !stop.has(t));
}

function searchMedia(query, limit = 20) {
  const mediaTypes = detectMediaTypes(query);
  const terms = extractTerms(query);
  const sources = [];

  if (mediaTypes.includes('movie')) {
    // Term-based search
    for (const term of terms.slice(0, 5)) {
      sources.push(...db.prepare(`
        SELECT id, title, year, genre, director, cast_members, synopsis, overview,
               source_key, poster_url, 'movie' as media_type
        FROM movies WHERE source_key IS NOT NULL
          AND (title LIKE ? OR genre LIKE ? OR director LIKE ? OR cast_members LIKE ? OR synopsis LIKE ? OR overview LIKE ?)
        LIMIT 10
      `).all(...Array(6).fill(`%${term}%`)));
    }
    // Always include full movie catalog (small dataset)
    sources.push(...db.prepare(`
      SELECT id, title, year, genre, director, cast_members, synopsis, overview,
             source_key, poster_url, 'movie' as media_type
      FROM movies WHERE source_key IS NOT NULL LIMIT 50
    `).all());
  }

  if (mediaTypes.includes('tv_show')) {
    for (const term of terms.slice(0, 5)) {
      sources.push(...db.prepare(`
        SELECT id, title, year, genre, creator, cast_members, synopsis, overview,
               seasons, source_key, poster_url, 'tv_show' as media_type
        FROM tv_shows WHERE source_key IS NOT NULL
          AND (title LIKE ? OR genre LIKE ? OR creator LIKE ? OR cast_members LIKE ? OR synopsis LIKE ? OR overview LIKE ?)
        LIMIT 10
      `).all(...Array(6).fill(`%${term}%`)));
    }
    // Include all TV shows
    sources.push(...db.prepare(`
      SELECT id, title, year, genre, creator, cast_members, synopsis, overview,
             seasons, source_key, poster_url, 'tv_show' as media_type
      FROM tv_shows WHERE source_key IS NOT NULL LIMIT 100
    `).all());
  }

  if (mediaTypes.includes('book')) {
    for (const term of terms.slice(0, 5)) {
      sources.push(...db.prepare(`
        SELECT id, title, year, genre, author, synopsis,
               source_key, cover_url, 'book' as media_type
        FROM books WHERE source_key IS NOT NULL
          AND (title LIKE ? OR genre LIKE ? OR author LIKE ? OR synopsis LIKE ?)
        LIMIT 10
      `).all(...Array(4).fill(`%${term}%`)));
    }
    sources.push(...db.prepare(`
      SELECT id, title, year, genre, author, synopsis,
             source_key, cover_url, 'book' as media_type
      FROM books WHERE source_key IS NOT NULL LIMIT 50
    `).all());
  }

  // Deduplicate
  const seen = new Set();
  return sources.filter(s => {
    const key = `${s.media_type}:${s.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function buildSiteUrl(doc) {
  if (doc.media_type === 'movie')   return `/movies?open=${doc.id}`;
  if (doc.media_type === 'tv_show') return `/tv-shows?open=${doc.id}`;
  if (doc.media_type === 'book')    return `/books?open=${doc.id}`;
  return null;
}

function getUserRatingHistory(userId) {
  if (!userId) return [];
  return db.prepare(`
    SELECT r.rating, r.review, r.media_type, r.media_id,
      CASE r.media_type WHEN 'movie' THEN m.title WHEN 'tv_show' THEN t.title WHEN 'book' THEN b.title END as title,
      CASE r.media_type WHEN 'movie' THEN m.genre WHEN 'tv_show' THEN t.genre WHEN 'book' THEN b.genre END as genre,
      CASE r.media_type WHEN 'movie' THEN m.director WHEN 'tv_show' THEN t.creator WHEN 'book' THEN b.author END as creator
    FROM ratings r
    LEFT JOIN movies   m ON r.media_type = 'movie'   AND r.media_id = m.id
    LEFT JOIN tv_shows t ON r.media_type = 'tv_show' AND r.media_id = t.id
    LEFT JOIN books    b ON r.media_type = 'book'    AND r.media_id = b.id
    WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 20
  `).all(userId);
}

function formatDocumentContext(docs) {
  return docs.map((doc, i) => {
    const typeLabel = doc.media_type === 'movie' ? 'Movie' : doc.media_type === 'tv_show' ? 'TV Show' : 'Book';
    const meta = [
      doc.year         ? `Year: ${doc.year}`           : null,
      doc.genre        ? `Genre: ${doc.genre}`          : null,
      doc.director     ? `Director: ${doc.director}`    : null,
      doc.creator      ? `Creator: ${doc.creator}`      : null,
      doc.author       ? `Author: ${doc.author}`        : null,
      doc.cast_members ? `Cast: ${doc.cast_members}`    : null,
      doc.seasons      ? `Seasons: ${doc.seasons}`      : null,
    ].filter(Boolean).join(' | ');
    const desc = (doc.synopsis || doc.overview || '').slice(0, 250);
    return `[${typeLabel} #${i+1}] "${doc.title}"${meta ? '\n'+meta : ''}${desc ? '\nDescription: '+desc : ''}`;
  }).join('\n\n');
}

function formatUserHistory(history) {
  if (!history.length) return 'No rating history yet.';
  return history.map(r => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    return `- "${r.title}" (${r.media_type.replace('_',' ')}) ${stars}${r.genre ? ` | ${r.genre}` : ''}${r.creator ? ` | By: ${r.creator}` : ''}`;
  }).join('\n');
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({ ok: !!GROQ_API_KEY, models: [GROQ_MODEL] });
});

router.post('/', requireAuth, async (req, res) => {
  const { message, conversationHistory = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
  if (!GROQ_API_KEY)    return res.status(503).json({ error: 'GROQ_API_KEY is not configured.' });

  const userId = req.user.id;
  const startTime = Date.now();

  try {
    const intent       = detectQueryIntent(message);
    const retrievedDocs = searchMedia(message, 20);
    const userHistory  = getUserRatingHistory(userId);

    const contextBlock = `=== SITE DATABASE CONTEXT (ONLY reference titles from here) ===
${formatDocumentContext(retrievedDocs)}

=== USER'S RATING HISTORY ON BINGE. ===
${formatUserHistory(userHistory)}
=== END OF CONTEXT ===`;

    const messages = [
      ...conversationHistory.slice(-6).map(t => ({ role: t.role, content: t.content })),
      { role: 'user', content: `${contextBlock}\n\nUser question: ${message}` },
    ];

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: buildSystemPrompt(intent) }, ...messages],
        temperature: intent === 'factual' ? 0.2 : 0.5,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!groqRes.ok) {
      console.error('Groq error:', await groqRes.text());
      return res.status(502).json({ error: 'Groq API error. Check your API key.' });
    }

    const groqData  = await groqRes.json();
    const aiResponse = groqData.choices?.[0]?.message?.content || 'No response from model.';

    // Sources = docs whose title appears in the response, with internal site links
    const citedSources = retrievedDocs
      .filter(doc => aiResponse.toLowerCase().includes(doc.title.toLowerCase()))
      .map(doc => ({
        id:        doc.id,
        title:     doc.title,
        media_type: doc.media_type,
        year:      doc.year,
        genre:     doc.genre,
        siteUrl:   buildSiteUrl(doc),
        posterUrl: doc.poster_url || doc.cover_url || null,
      }));

    const latency = Date.now() - startTime;

    try {
      db.prepare(`INSERT INTO chat_logs (user_id, query, intent, response_length, sources_count, latency_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .run(userId, message.slice(0, 500), intent, aiResponse.length, citedSources.length, latency);
    } catch { /* non-fatal */ }

    res.json({ response: aiResponse, intent, sources: citedSources, latency });

  } catch (err) {
    console.error('Chat error:', err);
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'Request timed out.' });
    res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/logs', requireAuth, (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT cl.id, u.username, cl.query, cl.intent, cl.response_length,
             cl.sources_count, cl.latency_ms, cl.created_at
      FROM chat_logs cl JOIN users u ON cl.user_id = u.id
      ORDER BY cl.created_at DESC LIMIT 100
    `).all());
  } catch { res.json([]); }
});

module.exports = router;
