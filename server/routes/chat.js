const express = require('express');
const db = require('../db');
const { optionalAuth, requireAuth } = require('../middleware/auth');

const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ─── Intent detection ─────────────────────────────────────────────────────────

function detectQueryIntent(query) {
  const q = query.toLowerCase();
  if (q.includes('recommend') || q.includes('suggest') || q.includes('what should i') ||
      q.includes('similar to') || q.includes('based on my') || q.includes('for me') ||
      q.includes('my taste') || q.includes('my history') || q.includes('i enjoy') ||
      q.includes('i like') || q.includes('discover') || q.includes('what to watch') ||
      q.includes('what to read')) return 'recommendation';

  if (q.includes('theme') || q.includes('explain') || q.includes('why') ||
      q.includes('how does') || q.includes('compare') || q.includes('differ') ||
      q.includes('symbol') || q.includes('analyz') || q.includes('what does') ||
      q.includes('meaning') || q.includes('review')) return 'thematic';

  if (q.includes('who direct') || q.includes('who wrote') || q.includes('who star') ||
      q.includes('when was') || q.includes('what year') || q.includes('cast') ||
      q.includes('how many season') || q.includes('synopsis') || q.includes('plot') ||
      q.includes('runtime') || q.includes('release')) return 'factual';

  return 'general';
}

// ─── System prompts ───────────────────────────────────────────────────────────

function buildSystemPrompt(intent) {
  const base = `You are the media assistant for "binge." — a fun platform for tracking movies, TV shows, and books.

You have access to two sources of information that will be provided to you:
1. WEB SEARCH RESULTS — real information retrieved from the internet
2. BINGE. SITE DATABASE — the actual titles currently available on the binge. platform

YOUR RESPONSE STRUCTURE (always follow this for general/list questions):
1. Answer the question using the web search results (e.g. "According to Collider, the best drama TV shows are...")
2. Then say "Here's what we have on binge.:" and list which of those (or related) titles are in the site database — just the title names, no links

CRITICAL FORMATTING RULES — you must follow these exactly:
- NEVER include URLs, hyperlinks, or markdown links like [text](url) anywhere in your response text
- NEVER write out any web addresses or links — not even as plain text like https://...
- NEVER add a "Sources:" section at the bottom of your response
- Just mention source names naturally in text, e.g. "According to IMDb..." or "Collider ranks..."
- For binge. titles, just list the title names — the UI will automatically add clickable links
- Keep responses concise and conversational — no need to list every single title, pick the best ones`;

  if (intent === 'recommendation') return `${base}

RECOMMENDATION MODE: The user wants suggestions tailored to their taste.
Use web search to understand what makes great titles in this genre/style.
Recommend ONLY titles from the SITE DATABASE. If a great match isn't on the site, mention it as "not on binge. yet — you could request it!"
List title names only — no links or URLs.`;

  if (intent === 'thematic') return `${base}

ANALYSIS MODE: Use web search results for rich context, themes, critical analysis.
Be specific and enthusiastic. Mention source names naturally but never include URLs.`;

  if (intent === 'factual') return `${base}

FACTUAL MODE: Answer directly using web search results. Be concise and accurate.
Mention the source name naturally (e.g. "According to IMDb...") but never include URLs.`;

  return base;
}

// ─── Site database retrieval ──────────────────────────────────────────────────

function detectMediaTypes(query) {
  const q = query.toLowerCase();
  const wantsMovies = q.includes('movie') || q.includes('film') || q.includes('cinema');
  const wantsTV     = q.includes('tv') || q.includes('show') || q.includes('series') || q.includes('episode') || q.includes('season');
  const wantsBooks  = q.includes('book') || q.includes('novel') || q.includes('read') || q.includes('author');
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
    'books','films','series','tv','watch','read','best','good','great','top']);
  return query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !stop.has(t));
}

function searchSiteMedia(query, limit = 20) {
  const mediaTypes = detectMediaTypes(query);
  const terms = extractTerms(query);
  const sources = [];

  if (mediaTypes.includes('movie')) {
    if (terms.length > 0) {
      for (const term of terms.slice(0, 5)) {
        sources.push(...db.prepare(`
          SELECT id, title, year, genre, director, cast_members, synopsis, overview,
                 source_key, poster_url, 'movie' as media_type
          FROM movies WHERE source_key IS NOT NULL
            AND (title LIKE ? OR genre LIKE ? OR director LIKE ? OR cast_members LIKE ? OR synopsis LIKE ? OR overview LIKE ?)
          LIMIT 10
        `).all(...Array(6).fill(`%${term}%`)));
      }
    }
    sources.push(...db.prepare(`
      SELECT id, title, year, genre, director, cast_members, synopsis, overview,
             source_key, poster_url, 'movie' as media_type
      FROM movies WHERE source_key IS NOT NULL LIMIT 50
    `).all());
  }

  if (mediaTypes.includes('tv_show')) {
    if (terms.length > 0) {
      for (const term of terms.slice(0, 5)) {
        sources.push(...db.prepare(`
          SELECT id, title, year, genre, creator, cast_members, synopsis, overview,
                 seasons, source_key, poster_url, 'tv_show' as media_type
          FROM tv_shows WHERE source_key IS NOT NULL
            AND (title LIKE ? OR genre LIKE ? OR creator LIKE ? OR cast_members LIKE ? OR synopsis LIKE ? OR overview LIKE ?)
          LIMIT 10
        `).all(...Array(6).fill(`%${term}%`)));
      }
    }
    sources.push(...db.prepare(`
      SELECT id, title, year, genre, creator, cast_members, synopsis, overview,
             seasons, source_key, poster_url, 'tv_show' as media_type
      FROM tv_shows WHERE source_key IS NOT NULL LIMIT 100
    `).all());
  }

  if (mediaTypes.includes('book')) {
    if (terms.length > 0) {
      for (const term of terms.slice(0, 5)) {
        sources.push(...db.prepare(`
          SELECT id, title, year, genre, author, synopsis,
                 source_key, cover_url, 'book' as media_type
          FROM books WHERE source_key IS NOT NULL
            AND (title LIKE ? OR genre LIKE ? OR author LIKE ? OR synopsis LIKE ?)
          LIMIT 10
        `).all(...Array(4).fill(`%${term}%`)));
      }
    }
    sources.push(...db.prepare(`
      SELECT id, title, year, genre, author, synopsis,
             source_key, cover_url, 'book' as media_type
      FROM books WHERE source_key IS NOT NULL LIMIT 50
    `).all());
  }

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
  const movies = db.prepare(`
    SELECT ROUND(CAST(acting+writing+originality+pacing+cinematography AS REAL)/25*5, 1) AS rating,
           'movie' AS media_type, m.title, m.genre, m.director AS creator
    FROM movie_ratings r JOIN movies m ON r.media_id = m.id
    WHERE r.user_id = ?
  `).all(userId);
  const shows = db.prepare(`
    SELECT ROUND(CAST(premise+originality+acting+cinematography+writing+pacing+resonance AS REAL)/38*5, 1) AS rating,
           'tv_show' AS media_type, t.title, t.genre, t.creator AS creator
    FROM tv_show_ratings r JOIN tv_shows t ON r.media_id = t.id
    WHERE r.user_id = ?
  `).all(userId);
  const books = db.prepare(`
    SELECT ROUND(CAST(prose+plot+characters+originality+pacing+resonance AS REAL)/32*5, 1) AS rating,
           'book' AS media_type, b.title, b.genre, b.author AS creator
    FROM book_ratings r JOIN books b ON r.media_id = b.id
    WHERE r.user_id = ?
  `).all(userId);
  return [...movies, ...shows, ...books]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 20);
}

function formatSiteContext(docs) {
  if (!docs.length) return 'No titles currently in the binge. database.';
  return docs.map((doc, i) => {
    const typeLabel = doc.media_type === 'movie' ? 'Movie' : doc.media_type === 'tv_show' ? 'TV Show' : 'Book';
    const meta = [
      doc.year         ? `Year: ${doc.year}`        : null,
      doc.genre        ? `Genre: ${doc.genre}`       : null,
      doc.director     ? `Director: ${doc.director}` : null,
      doc.creator      ? `Creator: ${doc.creator}`   : null,
      doc.author       ? `Author: ${doc.author}`     : null,
      doc.cast_members ? `Cast: ${doc.cast_members}` : null,
      doc.seasons      ? `Seasons: ${doc.seasons}`   : null,
    ].filter(Boolean).join(' | ');
    const desc = (doc.synopsis || doc.overview || '').slice(0, 150);
    return `[binge. ${typeLabel}] "${doc.title}"${meta ? ' — '+meta : ''}${desc ? ' — '+desc : ''}`;
  }).join('\n');
}

function formatUserHistory(history) {
  if (!history.length) return 'No rating history yet.';
  return history.map(r => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    return `- "${r.title}" (${r.media_type.replace('_',' ')}) ${stars}${r.genre ? ` | ${r.genre}` : ''}`;
  }).join('\n');
}

// ─── Web search using Tavily API ─────────────────────────────────────────────
// Get a free key at https://tavily.com (1000 searches/month free)

async function performWebSearch(query) {
  const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  if (!TAVILY_API_KEY) {
    console.warn('No TAVILY_API_KEY set — web search disabled');
    return {
      results: [{
        title: `Search: "${query}"`,
        snippet: 'Add a TAVILY_API_KEY to your .env to enable real web search results.',
        url: fallbackUrl,
        source: 'Google',
      }],
      searchUrl: fallbackUrl,
    };
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error('Tavily error:', res.status, await res.text());
      return { results: [], searchUrl: fallbackUrl };
    }

    const data = await res.json();

    const results = (data.results || []).map(r => ({
      title: r.title,
      snippet: r.content?.slice(0, 300) || '',
      url: r.url,
      source: new URL(r.url).hostname.replace('www.', ''),
    }));

    return { results, searchUrl: fallbackUrl };
  } catch (err) {
    console.error('Tavily search error:', err.message);
    return {
      results: [{
        title: `Search: "${query}"`,
        snippet: 'Web search temporarily unavailable.',
        url: fallbackUrl,
        source: 'Google',
      }],
      searchUrl: fallbackUrl,
    };
  }
}

// ─── Main Groq call ───────────────────────────────────────────────────────────

async function callGroq(systemPrompt, messages, intent) {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: intent === 'factual' ? 0.2 : 0.5,
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response.';
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({ ok: !!GROQ_API_KEY, models: [GROQ_MODEL] });
});

router.post('/', optionalAuth, async (req, res) => {
  const { message, conversationHistory = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
  if (!GROQ_API_KEY)    return res.status(503).json({ error: 'GROQ_API_KEY is not configured.' });

  const userId = req.user?.id || null;
  const startTime = Date.now();

  try {
    const intent      = detectQueryIntent(message);
    const siteDocs    = searchSiteMedia(message, 20);
    const userHistory = getUserRatingHistory(userId);

    // Always search the web — build a good query from the user's message
    const searchQuery = message.length > 80 ? message.slice(0, 80) : message;
    const { results: webResults, searchUrl } = await performWebSearch(searchQuery);

    // Format web results for the model
    const webContext = webResults.length
      ? webResults.map((r, i) =>
          `[Web Source ${i+1}] ${r.source} — "${r.title}"\n${r.snippet}\nURL: ${r.url}`
        ).join('\n\n')
      : 'No web results found.';

    // Build full context for the model
    const contextBlock = `=== WEB SEARCH RESULTS (for: "${searchQuery}") ===
${webContext}

=== BINGE. SITE DATABASE (titles on the platform) ===
${formatSiteContext(siteDocs)}

=== USER'S RATING HISTORY ===
${formatUserHistory(userHistory)}
=== END CONTEXT ===`;

    const messages = [
      ...conversationHistory.slice(-6).map(t => ({ role: t.role, content: t.content })),
      { role: 'user', content: `${contextBlock}\n\nUser question: ${message}` },
    ];

    const aiResponse = await callGroq(buildSystemPrompt(intent), messages, intent);

    // Site sources — db titles mentioned in the response
    const siteSources = siteDocs
      .filter(doc => aiResponse.toLowerCase().includes(doc.title.toLowerCase()))
      .map(doc => ({
        type: 'site',
        id: doc.id,
        title: doc.title,
        media_type: doc.media_type,
        year: doc.year,
        genre: doc.genre,
        siteUrl: buildSiteUrl(doc),
        posterUrl: doc.poster_url || doc.cover_url || null,
      }));

    // Web sources — real sites from Brave Search (IMDb, Collider, Ranker, etc.)
    const webSources = webResults
      .filter(r => r.url?.startsWith('http'))
      .slice(0, 4)
      .map(r => ({
        type: 'web',
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        source: r.source,
      }));

    const latency = Date.now() - startTime;

    if (userId != null) {
      try {
        db.prepare(`INSERT INTO chat_logs (user_id, query, intent, response_length, sources_count, latency_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
          .run(userId, message.slice(0, 500), intent, aiResponse.length, siteSources.length + webSources.length, latency);
      } catch {
        /* non-fatal */
      }
    }

    res.json({
      response: aiResponse,
      intent,
      siteSources,
      webSources,
      searchQuery,
      latency,
      sources: siteSources, // legacy
    });

  } catch (err) {
    console.error('Chat error:', err);
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'Request timed out.' });
    res.status(500).json({ error: err.message || 'Server error.' });
  }
});

// ─── Dedicated recommendations endpoint ──────────────────────────────────────

router.get('/recommendations', optionalAuth, async (req, res) => {
  if (!GROQ_API_KEY) return res.status(503).json({ error: 'GROQ_API_KEY not configured.' });

  const userId = req.user?.id || null;
  const isSupabaseUser = req.user?.fromSupabase === true;
  console.log('[ForYou] userId:', userId, 'isSupabase:', isSupabaseUser);

  try {
    if (!userId) {
      return res.json({
        recommendations: [],
        tasteProfile: null,
        message: 'Sign in to get personalized recommendations!',
      });
    }

    let history = [];

    if (isSupabaseUser) {
      // Fetch ratings from Supabase for Supabase users
      const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error('Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
      let sbCreate;
      try { sbCreate = require('@supabase/supabase-js').createClient; }
      catch { throw new Error('Run npm install to install @supabase/supabase-js'); }
      const sb = sbCreate(url, key);

      // Fetch ratings (just IDs + scores), then look up media info from Supabase separately
      const [{ data: movieRatings }, { data: tvRatings }, { data: bookRatings }] = await Promise.all([
        sb.from('movie_ratings').select('media_id, acting, writing, originality, pacing, cinematography, review').eq('user_id', userId),
        sb.from('tv_show_ratings').select('media_id, premise, originality, acting, cinematography, writing, pacing, resonance, review').eq('user_id', userId),
        sb.from('book_ratings').select('media_id, prose, plot, characters, originality, pacing, resonance, review').eq('user_id', userId),
      ]);

      // Fetch media info from Supabase by ID (separate queries to avoid FK join issues)
      const movieIds  = (movieRatings || []).map(r => r.media_id);
      const tvIds     = (tvRatings    || []).map(r => r.media_id);
      const bookIds   = (bookRatings  || []).map(r => r.media_id);

      const [{ data: movieMedia }, { data: tvMedia }, { data: bookMedia }] = await Promise.all([
        movieIds.length ? sb.from('movies').select('id, title, genre, director, synopsis, source_key').in('id', movieIds) : Promise.resolve({ data: [] }),
        tvIds.length    ? sb.from('tv_shows').select('id, title, genre, creator, synopsis, source_key').in('id', tvIds)   : Promise.resolve({ data: [] }),
        bookIds.length  ? sb.from('books').select('id, title, genre, author, synopsis, source_key').in('id', bookIds)    : Promise.resolve({ data: [] }),
      ]);

      const movieMap = {}; (movieMedia || []).forEach(m => { movieMap[m.id] = m; });
      const tvMap    = {}; (tvMedia    || []).forEach(t => { tvMap[t.id]    = t; });
      const bookMap  = {}; (bookMedia  || []).forEach(b => { bookMap[b.id]  = b; });

      const enrichMovie = (r) => {
        const m = movieMap[r.media_id];
        if (!m) return null;
        const rating = Math.round(((r.acting||0)+(r.writing||0)+(r.originality||0)+(r.pacing||0)+(r.cinematography||0))/25*5);
        const sqliteRow = m.source_key ? db.prepare('SELECT id FROM movies WHERE source_key = ?').get(m.source_key) : null;
        return { rating, review: r.review, media_type: 'movie', media_id: sqliteRow?.id || r.media_id, title: m.title, genre: m.genre, creator: m.director, synopsis: m.synopsis };
      };
      const enrichTV = (r) => {
        const t = tvMap[r.media_id];
        if (!t) return null;
        const rating = Math.round(((r.premise||0)+(r.originality||0)+(r.acting||0)+(r.cinematography||0)+(r.writing||0)+(r.pacing||0)+(r.resonance||0))/38*5);
        const sqliteRow = t.source_key ? db.prepare('SELECT id FROM tv_shows WHERE source_key = ?').get(t.source_key) : null;
        return { rating, review: r.review, media_type: 'tv_show', media_id: sqliteRow?.id || r.media_id, title: t.title, genre: t.genre, creator: t.creator, synopsis: t.synopsis };
      };
      const enrichBook = (r) => {
        const b = bookMap[r.media_id];
        if (!b) return null;
        const rating = Math.round(((r.prose||0)+(r.plot||0)+(r.characters||0)+(r.originality||0)+(r.pacing||0)+(r.resonance||0))/32*5);
        const sqliteRow = b.source_key ? db.prepare('SELECT id FROM books WHERE source_key = ?').get(b.source_key) : null;
        return { rating, review: r.review, media_type: 'book', media_id: sqliteRow?.id || r.media_id, title: b.title, genre: b.genre, creator: b.author, synopsis: b.synopsis };
      };

      history = [
        ...(movieRatings || []).map(enrichMovie).filter(Boolean),
        ...(tvRatings   || []).map(enrichTV).filter(Boolean),
        ...(bookRatings || []).map(enrichBook).filter(Boolean),
      ].sort((a, b) => b.rating - a.rating).slice(0, 30);
      console.log('[ForYou] Supabase ratings fetched:', (movieRatings||[]).length, 'movies,', (tvRatings||[]).length, 'tv,', (bookRatings||[]).length, 'books. History after enrich:', history.length);
    } else {
      // Legacy SQLite ratings for legacy JWT users
      const movieHistory = db.prepare(`
        SELECT ROUND(CAST(acting+writing+originality+pacing+cinematography AS REAL)/25*5, 1) AS rating,
               r.review, 'movie' AS media_type, r.media_id,
               m.title, m.genre, m.director AS creator, m.synopsis
        FROM movie_ratings r JOIN movies m ON r.media_id = m.id WHERE r.user_id = ?
      `).all(userId);
      const tvHistory = db.prepare(`
        SELECT ROUND(CAST(premise+originality+acting+cinematography+writing+pacing+resonance AS REAL)/38*5, 1) AS rating,
               r.review, 'tv_show' AS media_type, r.media_id,
               t.title, t.genre, t.creator AS creator, t.synopsis
        FROM tv_show_ratings r JOIN tv_shows t ON r.media_id = t.id WHERE r.user_id = ?
      `).all(userId);
      const bookHistory = db.prepare(`
        SELECT ROUND(CAST(prose+plot+characters+originality+pacing+resonance AS REAL)/32*5, 1) AS rating,
               r.review, 'book' AS media_type, r.media_id,
               b.title, b.genre, b.author AS creator, b.synopsis
        FROM book_ratings r JOIN books b ON r.media_id = b.id WHERE r.user_id = ?
      `).all(userId);
      history = [...movieHistory, ...tvHistory, ...bookHistory]
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 30);
    }

    if (history.length === 0) {
      return res.json({
        recommendations: [],
        tasteProfile: null,
        message: 'Rate some movies, TV shows, or books first to get personalized recommendations!',
      });
    }

    // Get all site content to recommend from
    const allMovies = db.prepare(`SELECT id, title, year, genre, director, cast_members, synopsis, overview, source_key, poster_url, 'movie' as media_type FROM movies WHERE source_key IS NOT NULL`).all();
    const allTV    = db.prepare(`SELECT id, title, year, genre, creator, cast_members, synopsis, overview, seasons, source_key, poster_url, 'tv_show' as media_type FROM tv_shows WHERE source_key IS NOT NULL`).all();
    const allBooks = db.prepare(`SELECT id, title, year, genre, author, synopsis, source_key, cover_url, 'book' as media_type FROM books WHERE source_key IS NOT NULL LIMIT 100`).all();

    // Exclude already-rated items
    const ratedIds = new Set(history.map(r => `${r.media_type}:${r.media_id}`));
    const unratedMedia = [...allMovies, ...allTV, ...allBooks]
      .filter(m => !ratedIds.has(`${m.media_type}:${m.id}`));

    const historyText = history.map(r => {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      return `- "${r.title}" (${r.media_type.replace('_',' ')}) ${stars} | Genre: ${r.genre || 'unknown'} | By: ${r.creator || 'unknown'}${r.review ? ` | Review: "${r.review.slice(0,80)}"` : ''}`;
    }).join('\n');

    const catalogText = unratedMedia.slice(0, 60).map(m => {
      const typeLabel = m.media_type === 'movie' ? 'Movie' : m.media_type === 'tv_show' ? 'TV Show' : 'Book';
      return `[${typeLabel} ID:${m.id}] "${m.title}" | Genre: ${m.genre || ''} | ${m.director ? 'Director: '+m.director : m.creator ? 'Creator: '+m.creator : m.author ? 'Author: '+m.author : ''} | ${(m.synopsis || m.overview || '').slice(0,120)}`;
    }).join('\n');

    const systemPrompt = `You are a personalized media recommendation engine for "binge." 
Analyze the user's rating history carefully to identify their taste patterns — which genres, directors, themes, tones, and styles they love.
Then pick the 5 best matches from the available catalog.

RULES:
- Only recommend titles from the AVAILABLE CATALOG provided
- For each recommendation give: the exact title, the media type, and a specific 1-2 sentence explanation referencing something they've actually rated
- Be specific — e.g. "Since you gave Breaking Bad 5 stars, you'll love Severance's intense workplace tension"
- Do NOT include any URLs or links
- Respond in this exact JSON format, nothing else:
{
  "tasteProfile": "2-3 sentence summary of what this user loves based on their ratings",
  "recommendations": [
    { "id": <number>, "title": "<exact title>", "media_type": "<movie|tv_show|book>", "reason": "<specific 1-2 sentence explanation>" },
    ...10 items total
  ]
}`;

    const userMessage = `USER'S RATING HISTORY (what they've already seen/read):
${historyText}

AVAILABLE CATALOG (titles NOT yet rated — only pick from these):
${catalogText}

Analyze the user's taste and return 10 personalized recommendations from the catalog in the JSON format specified.`;

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 1800,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`Groq error: ${await response.text()}`);

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';

    // Parse JSON from model response
    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse recommendation response' });
    }

    // Enrich recommendations with full media data and site URLs
    const enriched = (parsed.recommendations || []).map(rec => {
      const mediaItem = unratedMedia.find(m => m.id === rec.id && m.media_type === rec.media_type)
        || unratedMedia.find(m => m.title.toLowerCase() === rec.title.toLowerCase());
      if (!mediaItem) return null;
      return {
        id: mediaItem.id,
        title: mediaItem.title,
        media_type: mediaItem.media_type,
        year: mediaItem.year,
        genre: mediaItem.genre,
        posterUrl: mediaItem.poster_url || mediaItem.cover_url || null,
        siteUrl: mediaItem.media_type === 'movie' ? `/movies?open=${mediaItem.id}` :
                 mediaItem.media_type === 'tv_show' ? `/tv-shows?open=${mediaItem.id}` :
                 `/books?open=${mediaItem.id}`,
        reason: rec.reason,
      };
    }).filter(Boolean);

    res.json({
      tasteProfile: parsed.tasteProfile || null,
      recommendations: enriched,
    });

  } catch (err) {
    console.error('Recommendations error:', err);
    res.status(500).json({ error: err.message });
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
