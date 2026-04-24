import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Intent detection ──────────────────────────────────────────────────────────

function detectQueryIntent(query: string): string {
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

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(intent: string): string {
  const base = `You are the media assistant for "binge." — a fun platform for tracking movies, TV shows, and books.

You have access to four sources of information that will be provided to you:
1. WEB SEARCH RESULTS — real information retrieved from the internet
2. BINGE. SITE DATABASE — the actual titles currently available on the binge. platform
3. USER'S RATING HISTORY — what the user has already rated and their scores
4. USER'S WATCHLIST & ACTIVITY — what they are currently watching/reading, their plan-to-watch list, and forum posts they have written

Use the user's personal data to give tailored, personal answers. For example:
- If they ask "what should I watch next?" use their watchlist and ratings to make specific suggestions
- If they ask "what am I watching?" or "what's on my watchlist?" answer directly from their data
- If they ask about a title they've rated, mention their rating naturally
- Reference their in-progress items ("you're currently on S2E4 of...") when relevant

YOUR RESPONSE STRUCTURE — follow this for EVERY response, no exceptions:
1. Answer the question using the web search results
2. ALWAYS end with a "Here's what we have on binge.:" section — pick 3–5 titles from the BINGE. SITE DATABASE that are most relevant to the question or the themes/genres discussed. For thematic or factual questions (e.g. "what themes does Dune explore?"), suggest titles with similar themes, style, or genre. For recommendation questions, suggest direct matches. Just list the title names — no links, no URLs.

CRITICAL FORMATTING RULES — you must follow these exactly:
- NEVER include URLs, hyperlinks, or markdown links like [text](url) anywhere in your response text
- NEVER write out any web addresses or links — not even as plain text like https://...
- NEVER add a "Sources:" section at the bottom of your response
- Just mention source names naturally in text, e.g. "According to IMDb..." or "Collider ranks..."
- For the binge. section, list title names only — the UI will automatically add clickable links
- Keep responses concise and conversational`;

  if (intent === 'recommendation') return `${base}

RECOMMENDATION MODE: The user wants suggestions tailored to their taste.
Use web search to understand what makes great titles in this genre/style.
In the "Here's what we have on binge.:" section, recommend ONLY titles from the SITE DATABASE that best match the user's taste. If a great match isn't on the site, mention it as "not on binge. yet — you could request it!"`;

  if (intent === 'thematic') return `${base}

ANALYSIS MODE: Use web search results for rich context, themes, critical analysis.
Be specific and enthusiastic. In the "Here's what we have on binge.:" section, suggest titles from the SITE DATABASE that share the themes, tone, or ideas you just discussed.`;

  if (intent === 'factual') return `${base}

FACTUAL MODE: Answer directly using web search results. Be concise and accurate.
Still end with "Here's what we have on binge.:" — pick titles from the SITE DATABASE related to what was asked (same franchise, genre, director, era, or topic).`;

  return base;
}

// ─── Site catalog search ───────────────────────────────────────────────────────

function extractTerms(query: string): string[] {
  const stop = new Set(['the','and','for','with','that','this','are','was','have','from',
    'some','any','what','which','show','give','list','find','tell','me','about','on','in',
    'a','an','is','of','to','do','you','can','i','my','your','their','its','shows','movies',
    'books','films','series','tv','watch','read','best','good','great','top']);
  return query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !stop.has(t));
}

function detectMediaTypes(query: string): string[] {
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

async function searchSiteMedia(sb: ReturnType<typeof createClient>, query: string, limit = 40) {
  const terms = extractTerms(query);
  const mediaTypes = detectMediaTypes(query);
  const results: Record<string, unknown>[] = [];

  const termFilter = (cols: string[]) => {
    if (!terms.length) return undefined;
    return terms.slice(0, 5).map(t =>
      cols.map(c => `${c}.ilike.%${t}%`).join(',')
    ).join(',');
  };

  if (mediaTypes.includes('movie')) {
    const filter = termFilter(['title', 'genre', 'director', 'cast_members', 'synopsis']);
    const q = sb.from('movies').select('id, title, year, genre, director, cast_members, synopsis, source_key, poster_url').not('source_key', 'is', null).limit(30);
    const { data } = filter ? await q.or(filter) : await q;
    (data || []).forEach((r: Record<string, unknown>) => results.push({ ...r, media_type: 'movie' }));
  }

  if (mediaTypes.includes('tv_show')) {
    const filter = termFilter(['title', 'genre', 'creator', 'cast_members', 'synopsis']);
    const q = sb.from('tv_shows').select('id, title, year, genre, creator, cast_members, synopsis, seasons, source_key, poster_url').not('source_key', 'is', null).limit(30);
    const { data } = filter ? await q.or(filter) : await q;
    (data || []).forEach((r: Record<string, unknown>) => results.push({ ...r, media_type: 'tv_show' }));
  }

  if (mediaTypes.includes('book')) {
    const filter = termFilter(['title', 'genre', 'author', 'synopsis']);
    const q = sb.from('books').select('id, title, year, genre, author, synopsis, source_key, cover_url').not('source_key', 'is', null).limit(20);
    const { data } = filter ? await q.or(filter) : await q;
    (data || []).forEach((r: Record<string, unknown>) => results.push({ ...r, media_type: 'book' }));
  }

  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.media_type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

// ─── User context ──────────────────────────────────────────────────────────────

function decodeJwtUserId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.sub || null;
  } catch { return null; }
}

async function getUserContext(sb: ReturnType<typeof createClient>, userId: string) {
  const [
    { data: profile },
    { data: watchlistRaw },
    { data: posts },
    { data: movieRatings },
    { data: tvRatings },
    { data: bookRatings },
  ] = await Promise.all([
    sb.from('profiles').select('username, bio').eq('id', userId).maybeSingle(),
    sb.from('watchlist').select('media_type, media_id, status, current_season, current_episode, current_chapter, current_page, updated_at, added_at').eq('user_id', userId).order('updated_at', { ascending: false, nullsFirst: false }).limit(60),
    sb.from('posts').select('title, body, tags, score, created_at, forums(name)').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
    sb.from('movie_ratings').select('media_id, acting, writing, originality, pacing, cinematography, review').eq('user_id', userId),
    sb.from('tv_show_ratings').select('media_id, premise, originality, acting, cinematography, writing, pacing, resonance, review').eq('user_id', userId),
    sb.from('book_ratings').select('media_id, prose, plot, characters, originality, pacing, resonance, review').eq('user_id', userId),
  ]);

  // Enrich watchlist with media titles
  const mediaIds = { movie: [] as number[], tv_show: [] as number[], book: [] as number[] };
  for (const w of (watchlistRaw || [])) {
    if (w.media_type in mediaIds) (mediaIds as Record<string, number[]>)[w.media_type].push(w.media_id);
  }
  const [{ data: mMedia }, { data: tMedia }, { data: bMedia }] = await Promise.all([
    mediaIds.movie.length ? sb.from('movies').select('id, title, genre').in('id', mediaIds.movie) : Promise.resolve({ data: [] }),
    mediaIds.tv_show.length ? sb.from('tv_shows').select('id, title, genre').in('id', mediaIds.tv_show) : Promise.resolve({ data: [] }),
    mediaIds.book.length ? sb.from('books').select('id, title, genre').in('id', mediaIds.book) : Promise.resolve({ data: [] }),
  ]);
  const mMap: Record<number, { title: string; genre: string }> = {};
  const tMap: Record<number, { title: string; genre: string }> = {};
  const bMap: Record<number, { title: string; genre: string }> = {};
  (mMedia || []).forEach((r: { id: number; title: string; genre: string }) => { mMap[r.id] = r; });
  (tMedia || []).forEach((r: { id: number; title: string; genre: string }) => { tMap[r.id] = r; });
  (bMedia || []).forEach((r: { id: number; title: string; genre: string }) => { bMap[r.id] = r; });

  const watchlist = (watchlistRaw || []).map((w: Record<string, unknown>) => {
    const map = w.media_type === 'movie' ? mMap : w.media_type === 'tv_show' ? tMap : bMap;
    const info = map[w.media_id as number];
    if (!info) return null;
    return { ...w, title: info.title, genre: info.genre };
  }).filter(Boolean);

  // Enrich ratings with media titles
  const mrIds = (movieRatings || []).map((r: { media_id: number }) => r.media_id);
  const trIds = (tvRatings    || []).map((r: { media_id: number }) => r.media_id);
  const brIds = (bookRatings  || []).map((r: { media_id: number }) => r.media_id);
  const [{ data: mrMedia }, { data: trMedia }, { data: brMedia }] = await Promise.all([
    mrIds.length ? sb.from('movies').select('id, title, genre, director').in('id', mrIds) : Promise.resolve({ data: [] }),
    trIds.length ? sb.from('tv_shows').select('id, title, genre, creator').in('id', trIds) : Promise.resolve({ data: [] }),
    brIds.length ? sb.from('books').select('id, title, genre, author').in('id', brIds) : Promise.resolve({ data: [] }),
  ]);
  const mrMap: Record<number, Record<string, unknown>> = {};
  const trMap: Record<number, Record<string, unknown>> = {};
  const brMap: Record<number, Record<string, unknown>> = {};
  (mrMedia || []).forEach((r: Record<string, unknown>) => { mrMap[r.id as number] = r; });
  (trMedia || []).forEach((r: Record<string, unknown>) => { trMap[r.id as number] = r; });
  (brMedia || []).forEach((r: Record<string, unknown>) => { brMap[r.id as number] = r; });

  const ratings = [
    ...(movieRatings || []).map((r: Record<string, unknown>) => {
      const m = mrMap[r.media_id as number]; if (!m) return null;
      const score = Math.round(((r.acting as number||0)+(r.writing as number||0)+(r.originality as number||0)+(r.pacing as number||0)+(r.cinematography as number||0))/25*5);
      return { rating: score, review: r.review, media_type: 'movie', title: m.title, genre: m.genre, creator: m.director };
    }).filter(Boolean),
    ...(tvRatings || []).map((r: Record<string, unknown>) => {
      const t = trMap[r.media_id as number]; if (!t) return null;
      const score = Math.round(((r.premise as number||0)+(r.originality as number||0)+(r.acting as number||0)+(r.cinematography as number||0)+(r.writing as number||0)+(r.pacing as number||0)+(r.resonance as number||0))/38*5);
      return { rating: score, review: r.review, media_type: 'tv_show', title: t.title, genre: t.genre, creator: t.creator };
    }).filter(Boolean),
    ...(bookRatings || []).map((r: Record<string, unknown>) => {
      const b = brMap[r.media_id as number]; if (!b) return null;
      const score = Math.round(((r.prose as number||0)+(r.plot as number||0)+(r.characters as number||0)+(r.originality as number||0)+(r.pacing as number||0)+(r.resonance as number||0))/32*5);
      return { rating: score, review: r.review, media_type: 'book', title: b.title, genre: b.genre, creator: b.author };
    }).filter(Boolean),
  ].sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.rating as number) - (a.rating as number)).slice(0, 20);

  return { profile, watchlist, posts: posts || [], ratings };
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function formatSiteContext(docs: Record<string, unknown>[]): string {
  if (!docs.length) return 'No titles currently in the binge. database.';
  return docs.map(doc => {
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
    const desc = String(doc.synopsis || doc.overview || '').slice(0, 150);
    return `[binge. ${typeLabel}] "${doc.title}"${meta ? ' — '+meta : ''}${desc ? ' — '+desc : ''}`;
  }).join('\n');
}

function formatUserHistory(ratings: Record<string, unknown>[]): string {
  if (!ratings.length) return 'No rating history yet.';
  return ratings.map(r => {
    const stars = '★'.repeat(r.rating as number) + '☆'.repeat(5 - (r.rating as number));
    return `- "${r.title}" (${String(r.media_type||'').replace('_',' ')}) ${stars}${r.genre ? ` | ${r.genre}` : ''}`;
  }).join('\n');
}

function formatWatchlistContext(watchlist: Record<string, unknown>[]): string {
  if (!watchlist.length) return 'No watchlist items yet.';
  const byStatus: Record<string, Record<string, unknown>[]> = {};
  for (const w of watchlist) {
    const s = String(w.status || 'plan_to_watch');
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(w);
  }
  const statusLabel: Record<string, string> = {
    watching: 'Currently Watching', reading: 'Currently Reading',
    watched: 'Completed', read: 'Completed',
    plan_to_watch: 'Plan to Watch', plan_to_read: 'Plan to Read',
  };
  const lines: string[] = [];
  for (const [status, items] of Object.entries(byStatus)) {
    lines.push(`${statusLabel[status] || status}:`);
    for (const w of items.slice(0, 15)) {
      let progress = '';
      if (w.current_season) { progress += ` [S${w.current_season}`; if (w.current_episode) progress += `E${w.current_episode}`; progress += ']'; }
      if (w.current_chapter) progress += ` [Ch.${w.current_chapter}]`;
      if (w.current_page) progress += ` [p.${w.current_page}]`;
      lines.push(`  - "${w.title}" (${String(w.media_type||'').replace('_',' ')})${progress}${w.genre ? ' | '+w.genre : ''}`);
    }
  }
  return lines.join('\n');
}

function formatPostsContext(posts: Record<string, unknown>[]): string {
  if (!posts.length) return 'No forum posts yet.';
  return posts.map(p => {
    const forum = (p.forums as Record<string, unknown>)?.name || 'a forum';
    const tags = (p.tags as string[] || []).join(', ');
    return `- Posted in ${forum}: "${p.title}"${tags ? ` [tags: ${tags}]` : ''}`;
  }).join('\n');
}

// ─── Web search ────────────────────────────────────────────────────────────────

async function performWebSearch(query: string) {
  if (!TAVILY_API_KEY) return { results: [] };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { results: [] };
    const data = await res.json();
    const results = (data.results || []).map((r: Record<string, string>) => ({
      title: r.title,
      snippet: (r.content || '').slice(0, 300),
      url: r.url,
      source: new URL(r.url).hostname.replace('www.', ''),
    }));
    return { results };
  } catch { return { results: [] }; }
}

// ─── Groq ──────────────────────────────────────────────────────────────────────

async function callGroq(systemPrompt: string, messages: { role: string; content: string }[], intent: string): Promise<string> {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: intent === 'factual' ? 0.2 : 0.5,
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Groq API error: ${await response.text()}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response.';
}

// ─── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY is not configured.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  try {
    const body = await req.json();

    // Support both Supabase format { messages: [...] } and server format { message, conversationHistory }
    let userMessage: string;
    let history: { role: string; content: string }[];

    if (Array.isArray(body.messages)) {
      const msgs = body.messages.filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant');
      const last = msgs[msgs.length - 1];
      userMessage = last?.role === 'user' ? String(last.content || '').trim() : '';
      history = msgs.slice(0, -1);
    } else {
      userMessage = String(body.message || '').trim();
      history = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
    }

    if (!userMessage) {
      return new Response(JSON.stringify({ error: 'Message is required.' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Get user ID from JWT
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const userId = token ? decodeJwtUserId(token) : null;

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const intent = detectQueryIntent(userMessage);
    const searchQuery = userMessage.length > 80 ? userMessage.slice(0, 80) : userMessage;

    // Run catalog search, web search, and user context fetch in parallel
    const [siteDocs, { results: webResults }, userCtx] = await Promise.all([
      searchSiteMedia(sb, userMessage, 40),
      performWebSearch(searchQuery),
      userId ? getUserContext(sb, userId).catch(() => ({})) : Promise.resolve({}),
    ]);

    const { profile, watchlist = [], posts = [], ratings = [] } = userCtx as {
      profile?: { username?: string; bio?: string };
      watchlist?: Record<string, unknown>[];
      posts?: Record<string, unknown>[];
      ratings?: Record<string, unknown>[];
    };

    const webContext = webResults.length
      ? webResults.map((r: Record<string, string>, i: number) =>
          `[Web Source ${i+1}] ${r.source} — "${r.title}"\n${r.snippet}\nURL: ${r.url}`
        ).join('\n\n')
      : 'No web results found.';

    const userSection = userId ? `
=== ABOUT THIS USER ===
${profile?.username ? `Username: ${profile.username}` : ''}
${profile?.bio ? `Bio: ${profile.bio}` : ''}

=== USER'S RATING HISTORY ===
${formatUserHistory(ratings)}

=== USER'S WATCHLIST ===
${formatWatchlistContext(watchlist)}

=== USER'S FORUM ACTIVITY ===
${formatPostsContext(posts)}` : `
=== USER'S RATING HISTORY ===
No user signed in.`;

    const contextBlock = `=== WEB SEARCH RESULTS (for: "${searchQuery}") ===
${webContext}

=== BINGE. SITE DATABASE (titles on the platform) ===
${formatSiteContext(siteDocs)}
${userSection}
=== END CONTEXT ===`;

    const messages = [
      ...history.slice(-6).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
      { role: 'user', content: `${contextBlock}\n\nUser question: ${userMessage}` },
    ];

    const aiResponse = await callGroq(buildSystemPrompt(intent), messages, intent);

    // Build site sources from titles the AI mentioned
    const siteSources = siteDocs
      .filter(doc => aiResponse.toLowerCase().includes(String(doc.title || '').toLowerCase()))
      .map(doc => ({
        type: 'site',
        id: doc.id,
        title: doc.title,
        media_type: doc.media_type,
        year: doc.year,
        genre: doc.genre,
        siteUrl: doc.media_type === 'movie' ? `/movies?open=${doc.id}` : doc.media_type === 'tv_show' ? `/tv-shows?open=${doc.id}` : `/books?open=${doc.id}`,
        posterUrl: doc.poster_url || doc.cover_url || null,
      }));

    const webSources = webResults
      .filter((r: Record<string, string>) => r.url?.startsWith('http'))
      .slice(0, 4)
      .map((r: Record<string, string>) => ({ type: 'web', title: r.title, snippet: r.snippet, url: r.url, source: r.source }));

    return new Response(
      JSON.stringify({ response: aiResponse, intent, siteSources, webSources, searchQuery }),
      { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Server error.';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
});
