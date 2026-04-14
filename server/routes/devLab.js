const express = require('express');

const {
  ensureDevLabSchema,
  getDashboardSnapshot,
  listPromptProfiles,
  upsertPromptProfile,
  listKnowledgeDocuments,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  searchKnowledgeDocuments,
  listEvalCases,
  createEvalCase,
  deleteEvalCase,
  createEvalRun,
  listEvalRuns,
  normalizeTagList,
  query,
} = require('../utils/devLabStore');
const {
  fetchSupabaseCatalog,
  isSupabaseConfigured,
} = require('../utils/supabaseClient');

const router = express.Router();

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '').trim();
const SUPABASE_FUNCTION_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY
  || ''
).trim();
const SUPABASE_AI_CHAT_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/ai-chat`
  : '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.REACT_APP_GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';

router.use(async (_req, _res, next) => {
  try {
    await ensureDevLabSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function detectPromptIntent(query) {
  const q = String(query || '').toLowerCase();

  if (
    q.includes('recommend') ||
    q.includes('suggest') ||
    q.includes('what should i') ||
    q.includes('similar to') ||
    q.includes('what to watch') ||
    q.includes('what to read')
  ) {
    return 'recommendation';
  }

  if (
    q.includes('theme') ||
    q.includes('explain') ||
    q.includes('compare') ||
    q.includes('why') ||
    q.includes('meaning') ||
    q.includes('analysis')
  ) {
    return 'thematic';
  }

  if (
    q.includes('rewrite') ||
    q.includes('story') ||
    q.includes('pitch') ||
    q.includes('creative') ||
    q.includes('alternate ending') ||
    q.includes('imagine') ||
    q.includes('trailer')
  ) {
    return 'creative';
  }

  if (
    q.includes('who') ||
    q.includes('when') ||
    q.includes('what year') ||
    q.includes('cast') ||
    q.includes('runtime') ||
    q.includes('release') ||
    q.includes('how many')
  ) {
    return 'factual';
  }

  return 'general';
}

function toPlainTextList(items = [], formatter = (item) => item) {
  if (!items.length) {
    return 'None.';
  }

  return items.map((item, index) => `${index + 1}. ${formatter(item)}`).join('\n');
}

function buildKnowledgeContext(documents = []) {
  if (!documents.length) {
    return 'No developer knowledge documents matched this question.';
  }

  return documents
    .map((document, index) => {
      const metadata = [
        document.sourceType ? `Source type: ${document.sourceType}` : null,
        document.mediaType ? `Media type: ${document.mediaType}` : null,
        document.sourceLabel ? `Label: ${document.sourceLabel}` : null,
        document.sourceUrl ? `URL: ${document.sourceUrl}` : null,
        document.tags?.length ? `Tags: ${document.tags.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      return `[Knowledge ${index + 1}] ${document.title}${metadata ? ` - ${metadata}` : ''}\n${document.summary || document.excerpt || ''}`;
    })
    .join('\n\n');
}

function buildSiteContext(documents = []) {
  if (!documents.length) {
    return 'No binge catalog matches were found.';
  }

  return documents
    .map((document, index) => {
      const typeLabel =
        document.media_type === 'movie'
          ? 'Movie'
          : document.media_type === 'tv_show'
            ? 'TV Show'
            : 'Book';
      const metadata = [
        document.year ? `Year: ${document.year}` : null,
        document.genre ? `Genre: ${document.genre}` : null,
        document.director ? `Director: ${document.director}` : null,
        document.creator ? `Creator: ${document.creator}` : null,
        document.author ? `Author: ${document.author}` : null,
        document.seasons ? `Seasons: ${document.seasons}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      return `[Catalog ${index + 1}] ${typeLabel}: ${document.title}${metadata ? ` - ${metadata}` : ''}`;
    })
    .join('\n');
}

function buildSiteUrl(document) {
  if (document.media_type === 'movie') return `/movies?open=${document.id}`;
  if (document.media_type === 'tv_show') return `/tv-shows?open=${document.id}`;
  return `/books?open=${document.id}`;
}

function extractTextFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeText(text, limit = 420) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trim()}...`;
}

function getArrayInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsPhrase(haystack, needle) {
  return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1'
  ) {
    return true;
  }

  return (
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

async function performWebSearch(queryText) {
  if (!TAVILY_API_KEY) {
    return [];
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: queryText,
        search_depth: 'basic',
        max_results: 4,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return (data.results || []).map((result) => ({
      title: result.title,
      snippet: result.content || '',
      url: result.url,
      source: new URL(result.url).hostname.replace(/^www\./, ''),
    }));
  } catch {
    return [];
  }
}

async function callGroq({ systemPrompt, question, temperature }) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured for prompt preview.');
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
      temperature,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${await response.text()}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'No response.';
}

async function callSupabaseAiChat({ systemPrompt, question, temperature }) {
  if (!SUPABASE_AI_CHAT_URL || !SUPABASE_FUNCTION_KEY) {
    throw new Error('Supabase ai-chat is not configured for prompt preview.');
  }

  const response = await fetch(SUPABASE_AI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_FUNCTION_KEY}`,
      apikey: SUPABASE_FUNCTION_KEY,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: question }],
      systemPromptOverride: systemPrompt,
      temperature,
      includeWebSearch: false,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      payload?.error ||
      payload?.message ||
      `Supabase ai-chat responded with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return payload?.content || payload?.choices?.[0]?.message?.content || payload?.response || 'No response.';
}

async function callPreviewModel({ systemPrompt, question, temperature }) {
  if (SUPABASE_AI_CHAT_URL && SUPABASE_FUNCTION_KEY) {
    try {
      return await callSupabaseAiChat({ systemPrompt, question, temperature });
    } catch (error) {
      if (!GROQ_API_KEY) {
        throw error;
      }

      console.warn('Falling back to direct Groq preview call after Supabase ai-chat failure:', error?.message || error);
    }
  }

  return callGroq({ systemPrompt, question, temperature });
}

async function loadPromptMap() {
  const profiles = await listPromptProfiles();
  return new Map(profiles.map((profile) => [profile.intent, profile]));
}

async function previewQuestion({ question, forcedIntent, includeWebSearch = true }) {
  const trimmedQuestion = String(question || '').trim();
  if (!trimmedQuestion) {
    throw new Error('Question is required.');
  }

  const promptMap = await loadPromptMap();
  const selectedIntent =
    forcedIntent && forcedIntent !== 'auto'
      ? forcedIntent
      : detectPromptIntent(trimmedQuestion);
  const promptProfile = promptMap.get(selectedIntent) || promptMap.get('general');

  const [knowledgeDocs, siteDocs, webSources] = await Promise.all([
    searchKnowledgeDocuments(trimmedQuestion, 4),
    isSupabaseConfigured() ? fetchSupabaseCatalog(trimmedQuestion, promptProfile?.maxTitles || 5) : Promise.resolve([]),
    includeWebSearch ? performWebSearch(trimmedQuestion) : Promise.resolve([]),
  ]);

  const systemPrompt = [
    'You are the developer preview assistant for binge.',
    `Selected intent: ${selectedIntent}.`,
    'Always write like a human teammate: plain text, short paragraphs, no markdown bold, and no numbered lists unless the question explicitly asks for a list.',
    `If you mention binge titles, keep the shortlist to at most ${promptProfile?.maxTitles || 5} titles.`,
    promptProfile?.systemPrompt || 'Answer clearly and naturally.',
    'Only use the supplied knowledge base, catalog matches, and optional web results. If the context is thin, say what is uncertain instead of pretending.',
  ].join('\n\n');

  const userPrompt = [
    `Developer question: ${trimmedQuestion}`,
    '',
    'Knowledge base snippets:',
    buildKnowledgeContext(knowledgeDocs),
    '',
    'Binge catalog matches:',
    buildSiteContext(siteDocs),
    '',
    'Web research snippets:',
    toPlainTextList(webSources, (source) => `${source.source}: ${source.title} - ${summarizeText(source.snippet, 180)}`),
    '',
    'Answer the developer question now.',
  ].join('\n');

  const startTime = Date.now();
  const responseText = await callPreviewModel({
    systemPrompt,
    question: userPrompt,
    temperature: Number(promptProfile?.temperature) || 0.4,
  });
  const latencyMs = Date.now() - startTime;

  const lowerResponse = responseText.toLowerCase();
  const siteSources = siteDocs
    .filter((document) => lowerResponse.includes(String(document.title || '').toLowerCase()))
    .slice(0, promptProfile?.maxTitles || 5)
    .map((document) => ({
      id: document.id,
      title: document.title,
      media_type: document.media_type,
      year: document.year,
      genre: document.genre,
      siteUrl: buildSiteUrl(document),
    }));

  return {
    intent: selectedIntent,
    promptProfile,
    systemPrompt,
    responseText,
    knowledgeDocs,
    siteSources,
    webSources,
    latencyMs,
  };
}

function parseUsMovieCertification(releaseDates) {
  const usRelease = (releaseDates?.results || []).find((entry) => entry.iso_3166_1 === 'US');
  const certification = usRelease?.release_dates?.find((entry) => entry.certification)?.certification;
  return certification || null;
}

function parseUsTvRating(contentRatings) {
  const usRating = (contentRatings?.results || []).find((entry) => entry.iso_3166_1 === 'US');
  return usRating?.rating || null;
}

function joinUniqueNames(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))].join(', ') || null;
}

async function fetchTmdbJson(pathname, params = {}) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured.');
  }

  const url = new URL(`${TMDB_BASE_URL}${pathname}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'en-US');

  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error(`TMDB request failed with status ${response.status}`);
  }

  return response.json();
}

function formatTmdbMovie(detail) {
  const crew = detail?.credits?.crew || [];
  const cast = detail?.credits?.cast || [];

  return {
    title: detail.title,
    year: detail.release_date ? Number(String(detail.release_date).slice(0, 4)) : null,
    genre: joinUniqueNames((detail.genres || []).map((genre) => genre.name)),
    director: joinUniqueNames(crew.filter((member) => member.job === 'Director').map((member) => member.name)),
    writers: joinUniqueNames(
      crew
        .filter((member) => ['Writer', 'Screenplay', 'Story', 'Novel'].includes(member.job))
        .map((member) => member.name)
    ),
    cast_members: joinUniqueNames(cast.slice(0, 8).map((member) => member.name)),
    age_rating: parseUsMovieCertification(detail.release_dates),
    overview: detail.overview || null,
    synopsis: detail.overview || null,
    poster_url: detail.poster_path ? `${TMDB_POSTER_BASE_URL}${detail.poster_path}` : null,
    source_key: `tmdb:movie:${detail.id}`,
  };
}

function formatTmdbTv(detail) {
  const crew = detail?.credits?.crew || [];
  const cast = detail?.credits?.cast || [];

  return {
    title: detail.name,
    year: detail.first_air_date ? Number(String(detail.first_air_date).slice(0, 4)) : null,
    genre: joinUniqueNames((detail.genres || []).map((genre) => genre.name)),
    creator: joinUniqueNames([
      ...(detail.created_by || []).map((person) => person.name),
      ...crew.filter((member) => member.job === 'Creator').map((member) => member.name),
    ]),
    writers: joinUniqueNames(
      crew
        .filter((member) => ['Writer', 'Screenplay', 'Story'].includes(member.job))
        .map((member) => member.name)
    ),
    cast_members: joinUniqueNames(cast.slice(0, 8).map((member) => member.name)),
    age_rating: parseUsTvRating(detail.content_ratings),
    overview: detail.overview || null,
    synopsis: detail.overview || null,
    poster_url: detail.poster_path ? `${TMDB_POSTER_BASE_URL}${detail.poster_path}` : null,
    seasons: detail.number_of_seasons || null,
    source_key: `tmdb:tv:${detail.id}`,
  };
}

async function upsertMovie(record) {
  const result = await query(
    `
      insert into public.movies (
        title,
        year,
        genre,
        director,
        writers,
        cast_members,
        age_rating,
        overview,
        synopsis,
        poster_url,
        source_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (source_key) where source_key is not null do update
      set
        title = excluded.title,
        year = excluded.year,
        genre = excluded.genre,
        director = excluded.director,
        writers = excluded.writers,
        cast_members = excluded.cast_members,
        age_rating = excluded.age_rating,
        overview = excluded.overview,
        synopsis = excluded.synopsis,
        poster_url = excluded.poster_url
      returning id, title, year, source_key as "sourceKey"
    `,
    [
      record.title,
      record.year,
      record.genre,
      record.director,
      record.writers,
      record.cast_members,
      record.age_rating,
      record.overview,
      record.synopsis,
      record.poster_url,
      record.source_key,
    ]
  );

  return result.rows[0];
}

async function upsertTvShow(record) {
  const result = await query(
    `
      insert into public.tv_shows (
        title,
        year,
        genre,
        creator,
        writers,
        cast_members,
        age_rating,
        overview,
        synopsis,
        poster_url,
        seasons,
        source_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (source_key) where source_key is not null do update
      set
        title = excluded.title,
        year = excluded.year,
        genre = excluded.genre,
        creator = excluded.creator,
        writers = excluded.writers,
        cast_members = excluded.cast_members,
        age_rating = excluded.age_rating,
        overview = excluded.overview,
        synopsis = excluded.synopsis,
        poster_url = excluded.poster_url,
        seasons = excluded.seasons
      returning id, title, year, source_key as "sourceKey"
    `,
    [
      record.title,
      record.year,
      record.genre,
      record.creator,
      record.writers,
      record.cast_members,
      record.age_rating,
      record.overview,
      record.synopsis,
      record.poster_url,
      record.seasons,
      record.source_key,
    ]
  );

  return result.rows[0];
}

async function fetchOpenLibraryDescription(key) {
  if (!key) {
    return null;
  }

  try {
    const response = await fetch(`https://openlibrary.org${key}.json`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (typeof data.description === 'string') {
      return data.description;
    }
    if (typeof data.description?.value === 'string') {
      return data.description.value;
    }
  } catch {
    return null;
  }

  return null;
}

async function upsertBook(record) {
  const result = await query(
    `
      insert into public.books (
        title,
        author,
        year,
        genre,
        synopsis,
        cover_url,
        item_url,
        source_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (source_key) where source_key is not null do update
      set
        title = excluded.title,
        author = excluded.author,
        year = excluded.year,
        genre = excluded.genre,
        synopsis = excluded.synopsis,
        cover_url = excluded.cover_url,
        item_url = excluded.item_url
      returning id, title, year, source_key as "sourceKey"
    `,
    [
      record.title,
      record.author,
      record.year,
      record.genre,
      record.synopsis,
      record.cover_url,
      record.item_url,
      record.source_key,
    ]
  );

  return result.rows[0];
}

router.get('/dashboard', async (_req, res) => {
  res.json(await getDashboardSnapshot());
});

router.get('/knowledge', async (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json({ items: await listKnowledgeDocuments(limit) });
});

router.post('/ingest/manual', async (req, res) => {
  const { title, content, mediaType, tags, sourceLabel, sourceType } = req.body || {};

  if (!String(title || '').trim()) {
    return res.status(400).json({ error: 'Title is required.' });
  }

  if (!String(content || '').trim()) {
    return res.status(400).json({ error: 'Content is required.' });
  }

  const document = await createKnowledgeDocument({
    title,
    content,
    mediaType,
    tags,
    sourceLabel,
    sourceType: sourceType || 'manual_text',
    summary: summarizeText(content),
    metadata: {
      contentLength: String(content).length,
    },
  });

  res.status(201).json({
    message: 'Manual knowledge document saved to Supabase.',
    document,
  });
});

router.post('/ingest/url', async (req, res) => {
  const { url, title, mediaType, tags } = req.body || {};

  if (!String(url || '').trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(String(url).trim());
  } catch {
    return res.status(400).json({ error: 'URL must be a valid absolute URL.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || isBlockedHost(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'That URL is blocked for safety reasons.' });
  }

  const response = await fetch(parsedUrl, {
    headers: { 'User-Agent': 'binge-dev-lab/1.0' },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    return res.status(502).json({ error: `Remote fetch failed with status ${response.status}.` });
  }

  const contentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  const scrapedText = contentType.includes('html') ? extractTextFromHtml(rawBody) : rawBody.trim();

  if (!scrapedText) {
    return res.status(422).json({ error: 'No readable text was extracted from that URL.' });
  }

  const fallbackTitle = contentType.includes('html')
    ? (rawBody.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || parsedUrl.hostname)
    : parsedUrl.pathname.split('/').filter(Boolean).pop() || parsedUrl.hostname;

  const document = await createKnowledgeDocument({
    title: String(title || '').trim() || fallbackTitle.trim(),
    content: scrapedText.slice(0, 40000),
    mediaType,
    tags,
    sourceType: 'url_scrape',
    sourceLabel: parsedUrl.hostname,
    sourceUrl: parsedUrl.toString(),
    summary: summarizeText(scrapedText),
    metadata: {
      contentType,
      contentLength: scrapedText.length,
      hostname: parsedUrl.hostname,
    },
  });

  res.status(201).json({
    message: 'URL content scraped and saved to the Supabase knowledge base.',
    document,
  });
});

router.post('/ingest/api', async (req, res) => {
  const provider = String(req.body?.provider || '').trim().toLowerCase();
  const mediaType = String(req.body?.mediaType || '').trim();
  const searchQuery = String(req.body?.query || '').trim();
  const limit = Math.max(1, Math.min(10, Number(req.body?.limit) || 5));

  if (!provider) {
    return res.status(400).json({ error: 'Provider is required.' });
  }

  if (!searchQuery) {
    return res.status(400).json({ error: 'Query is required.' });
  }

  if (provider === 'tmdb') {
    if (!['movie', 'tv_show'].includes(mediaType)) {
      return res.status(400).json({ error: 'TMDB imports support movie or tv_show media types.' });
    }

    const searchPath = mediaType === 'movie' ? '/search/movie' : '/search/tv';
    const searchResults = await fetchTmdbJson(searchPath, {
      query: searchQuery,
      include_adult: 'false',
      page: 1,
    });

    const topResults = (searchResults.results || []).slice(0, limit);
    const imported = [];

    for (const result of topResults) {
      const detailPath =
        mediaType === 'movie'
          ? `/movie/${result.id}`
          : `/tv/${result.id}`;
      const detail = await fetchTmdbJson(detailPath, {
        append_to_response: mediaType === 'movie' ? 'credits,release_dates' : 'credits,content_ratings',
      });

      const savedRow = mediaType === 'movie'
        ? await upsertMovie(formatTmdbMovie(detail))
        : await upsertTvShow(formatTmdbTv(detail));

      imported.push({
        id: savedRow.id,
        title: savedRow.title,
        year: savedRow.year,
        mediaType,
        sourceKey: savedRow.sourceKey,
      });
    }

    return res.status(201).json({
      message: `Imported ${imported.length} ${mediaType === 'movie' ? 'movie' : 'TV show'} records from TMDB into Supabase.`,
      imported,
    });
  }

  if (provider === 'openlibrary') {
    if (mediaType !== 'book') {
      return res.status(400).json({ error: 'Open Library imports support the book media type.' });
    }

    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('title', searchQuery);
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      return res.status(502).json({ error: `Open Library request failed with status ${response.status}.` });
    }

    const payload = await response.json();
    const topDocs = (payload.docs || []).slice(0, limit);
    const imported = [];

    for (const doc of topDocs) {
      const description = await fetchOpenLibraryDescription(doc.key);
      const savedRow = await upsertBook({
        title: doc.title,
        author: joinUniqueNames(doc.author_name || []),
        year: Number(doc.first_publish_year) || null,
        genre: joinUniqueNames((doc.subject || []).slice(0, 6)),
        synopsis: description || doc.first_sentence?.[0] || doc.first_sentence || null,
        cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
        item_url: doc.key ? `https://openlibrary.org${doc.key}` : null,
        source_key: `openlibrary:${doc.key || doc.cover_edition_key || doc.cover_i || doc.title}`,
      });

      imported.push({
        id: savedRow.id,
        title: savedRow.title,
        year: savedRow.year,
        mediaType: 'book',
        sourceKey: savedRow.sourceKey,
      });
    }

    return res.status(201).json({
      message: `Imported ${imported.length} books from Open Library into Supabase.`,
      imported,
    });
  }

  return res.status(400).json({ error: 'Unsupported provider.' });
});

router.get('/prompts', async (_req, res) => {
  res.json({ items: await listPromptProfiles() });
});

router.put('/prompts/:intent', async (req, res) => {
  const intent = String(req.params.intent || '').trim();
  if (!intent) {
    return res.status(400).json({ error: 'Intent is required.' });
  }

  if (!String(req.body?.systemPrompt || '').trim()) {
    return res.status(400).json({ error: 'System prompt is required.' });
  }

  const prompt = await upsertPromptProfile({
    intent,
    label: req.body?.label || intent,
    description: req.body?.description || '',
    systemPrompt: req.body?.systemPrompt,
    temperature: req.body?.temperature,
    maxTitles: req.body?.maxTitles,
  });

  res.json({
    message: `Saved the ${intent} prompt profile.`,
    prompt,
  });
});

router.post('/chat/preview', async (req, res) => {
  const preview = await previewQuestion({
    question: req.body?.question,
    forcedIntent: req.body?.forcedIntent,
    includeWebSearch: req.body?.includeWebSearch !== false,
  });

  res.json(preview);
});

router.get('/evaluations', async (_req, res) => {
  const [cases, runs] = await Promise.all([listEvalCases(), listEvalRuns()]);
  res.json({ cases, runs });
});

router.post('/evaluations/cases', async (req, res) => {
  if (!String(req.body?.label || '').trim()) {
    return res.status(400).json({ error: 'Case label is required.' });
  }

  if (!String(req.body?.question || '').trim()) {
    return res.status(400).json({ error: 'Case question is required.' });
  }

  const testCase = await createEvalCase({
    label: req.body.label,
    question: req.body.question,
    expectedIntent: req.body.expectedIntent,
    expectedPhrases: getArrayInput(req.body.expectedPhrases),
    forbiddenPhrases: getArrayInput(req.body.forbiddenPhrases),
    notes: req.body.notes,
  });

  res.status(201).json({
    message: 'Saved the evaluation case.',
    testCase,
  });
});

router.delete('/knowledge/:id', async (req, res) => {
  await deleteKnowledgeDocument(req.params.id);
  res.json({ ok: true });
});

router.delete('/evaluations/cases/:id', async (req, res) => {
  await deleteEvalCase(req.params.id);
  res.json({ ok: true });
});

router.post('/evaluations/run', async (req, res) => {
  const requestedIds = Array.isArray(req.body?.caseIds)
    ? req.body.caseIds.map((id) => Number(id)).filter(Number.isFinite)
    : [];
  const allCases = await listEvalCases(100);
  const casesToRun = requestedIds.length
    ? allCases.filter((testCase) => requestedIds.includes(Number(testCase.id)))
    : allCases;

  if (!casesToRun.length) {
    return res.status(400).json({ error: 'No evaluation cases were selected.' });
  }

  const results = [];

  for (const testCase of casesToRun) {
    const preview = await previewQuestion({
      question: testCase.question,
      forcedIntent: testCase.expectedIntent || 'auto',
      includeWebSearch: req.body?.includeWebSearch !== false,
    });

    const expectedPhrases = normalizeTagList(testCase.expectedPhrases);
    const forbiddenPhrases = normalizeTagList(testCase.forbiddenPhrases);
    const expectedHits = expectedPhrases.filter((phrase) => containsPhrase(preview.responseText, phrase));
    const missingExpected = expectedPhrases.filter((phrase) => !containsPhrase(preview.responseText, phrase));
    const forbiddenHits = forbiddenPhrases.filter((phrase) => containsPhrase(preview.responseText, phrase));
    const intentMatch = testCase.expectedIntent
      ? preview.intent === testCase.expectedIntent
      : true;
    const passed = intentMatch && missingExpected.length === 0 && forbiddenHits.length === 0;

    const savedRun = await createEvalRun({
      caseId: testCase.id,
      label: testCase.label,
      question: testCase.question,
      selectedIntent: preview.intent,
      intentMatch,
      passed,
      expectedHits,
      missingExpected,
      forbiddenHits,
      responseText: preview.responseText,
      systemPrompt: preview.systemPrompt,
      latencyMs: preview.latencyMs,
    });

    results.push({
      ...savedRun,
      expectedIntent: testCase.expectedIntent,
      responsePreview: summarizeText(preview.responseText, 240),
    });
  }

  res.json({
    message: `Ran ${results.length} evaluation ${results.length === 1 ? 'case' : 'cases'}.`,
    results,
  });
});

router.use((error, _req, res, _next) => {
  console.error('Dev lab route error:', error);
  if (
    error?.code === 'ENOTFOUND' ||
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ETIMEDOUT'
  ) {
    return res.status(503).json({
      error:
        'The dev lab could not reach Supabase through the server-side database connection. Check SUPABASE_DB_URL or DATABASE_URL and make sure the direct Postgres host is reachable from this environment.',
    });
  }

  res.status(500).json({ error: error.message || 'Dev lab request failed.' });
});

module.exports = router;
