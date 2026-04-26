import { Pool } from 'https://deno.land/x/postgres@v0.19.3/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const DEFAULT_PROMPT_PROFILES = [
  {
    intent: 'general',
    label: 'General',
    description: 'Balanced everyday assistant behavior for broad questions.',
    systemPrompt:
      'Answer in a warm, natural voice. Prefer short paragraphs, stay grounded in the provided catalog and knowledge base, and do not use markdown bullets unless the user asks for a list.',
    temperature: 0.45,
    maxTitles: 5,
  },
  {
    intent: 'factual',
    label: 'Factual Lookup',
    description: 'Direct answers for cast, release, runtime, and title lookups.',
    systemPrompt:
      'Answer directly and accurately. Lead with the answer, keep the wording compact, and only mention supporting context that helps the user verify the fact.',
    temperature: 0.2,
    maxTitles: 3,
  },
  {
    intent: 'thematic',
    label: 'Explanation',
    description: 'Interpretive answers about themes, comparisons, and analysis.',
    systemPrompt:
      'Explain ideas clearly and conversationally. Focus on meaning, themes, and comparisons, and connect the answer back to the user question instead of sounding academic.',
    temperature: 0.4,
    maxTitles: 4,
  },
  {
    intent: 'recommendation',
    label: 'Recommendation',
    description: 'Recommendation mode for shortlist-style answers.',
    systemPrompt:
      'Recommend only the strongest matches. Keep the answer human and specific, mention why each suggestion fits, and avoid dumping a long catalog.',
    temperature: 0.55,
    maxTitles: 5,
  },
  {
    intent: 'creative',
    label: 'Creative',
    description: 'Creative responses such as pitches, rewrites, and alternate versions.',
    systemPrompt:
      'Be imaginative while still respecting the supplied context. Use an engaging voice, but keep the output readable and avoid heavy markdown formatting.',
    temperature: 0.75,
    maxTitles: 4,
  },
];

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';

const GROQ_API_KEY = (
  Deno.env.get('GROQ_API_KEY') ||
  Deno.env.get('REACT_APP_GROQ_API_KEY') ||
  ''
).trim();
const TAVILY_API_KEY = (Deno.env.get('TAVILY_API_KEY') || '').trim();
const TMDB_API_KEY = (Deno.env.get('TMDB_API_KEY') || '').trim();
const DATABASE_URL = resolveDatabaseUrl(
  Deno.env.get('SUPABASE_DB_URL') ||
    Deno.env.get('DATABASE_URL') ||
    Deno.env.get('POSTGRES_URL') ||
    ''
);

const pool = DATABASE_URL ? new Pool(DATABASE_URL, 3, true) : null;
let schemaReadyPromise: Promise<void> | null = null;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function resolveDatabaseUrl(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function jsonResponse(status: number, body: JsonValue) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

async function readRequestBody(req: Request) {
  const text = await req.text();
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
      } catch {
        return {};
      }
    }

    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    return {};
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function resolveTemperature(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return 0.7;
}

function normalizeTagList(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))];
  }

  return String(tags || '')
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, values) => values.indexOf(tag) === index);
}

function summarizeText(text: unknown, limit = 420) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trim()}...`;
}

function extractTextFromHtml(html: unknown) {
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

function getArrayInput(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsPhrase(haystack: unknown, needle: unknown) {
  return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function detectPromptIntent(queryText: unknown) {
  const q = String(queryText || '').toLowerCase();

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

function toPlainTextList(items: unknown[] = [], formatter = (item: unknown) => String(item)) {
  if (!items.length) {
    return 'None.';
  }

  return items.map((item, index) => `${index + 1}. ${formatter(item)}`).join('\n');
}

function buildKnowledgeContext(documents: Array<Record<string, unknown>> = []) {
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
        Array.isArray(document.tags) && document.tags.length
          ? `Tags: ${document.tags.join(', ')}`
          : null,
      ]
        .filter(Boolean)
        .join(' | ');

      return `[Knowledge ${index + 1}] ${document.title}${metadata ? ` - ${metadata}` : ''}\n${document.summary || document.excerpt || ''}`;
    })
    .join('\n\n');
}

function buildSiteContext(documents: Array<Record<string, unknown>> = []) {
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

function buildSiteUrl(document: Record<string, unknown>) {
  if (document.media_type === 'movie') return `/movies?open=${document.id}`;
  if (document.media_type === 'tv_show') return `/tv-shows?open=${document.id}`;
  return `/books?open=${document.id}`;
}

function joinUniqueNames(values: unknown[] = []) {
  return (
    [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))].join(', ') ||
    null
  );
}

function parseUsMovieCertification(releaseDates: Record<string, unknown> | null) {
  const results = Array.isArray(releaseDates?.results) ? releaseDates.results : [];
  const usRelease = results.find(
    (entry: Record<string, unknown>) => entry.iso_3166_1 === 'US'
  ) as Record<string, unknown> | undefined;
  const releaseEntries = Array.isArray(usRelease?.release_dates) ? usRelease.release_dates : [];
  const certification = releaseEntries.find(
    (entry: Record<string, unknown>) => entry.certification
  ) as Record<string, unknown> | undefined;
  return certification?.certification || null;
}

function parseUsTvRating(contentRatings: Record<string, unknown> | null) {
  const results = Array.isArray(contentRatings?.results) ? contentRatings.results : [];
  const usRating = results.find(
    (entry: Record<string, unknown>) => entry.iso_3166_1 === 'US'
  ) as Record<string, unknown> | undefined;
  return usRating?.rating || null;
}

function isBlockedHost(hostname: unknown) {
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

function requireDatabase() {
  if (!pool) {
    throw new Error(
      'Dev lab storage is unavailable. Add the SUPABASE_DB_URL secret to this Supabase function to enable prompt profiles, knowledge documents, imports, and evaluations.'
    );
  }

  return pool;
}

async function execute(text: string, args: unknown[] = []) {
  const database = requireDatabase();
  const client = await database.connect();

  try {
    await client.queryArray({ text, args });
  } finally {
    client.release();
  }
}

async function queryRows<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  args: unknown[] = []
) {
  const database = requireDatabase();
  const client = await database.connect();

  try {
    const result = await client.queryObject<T>({ text, args });
    return result.rows;
  } finally {
    client.release();
  }
}

async function ensureDevLabSchema() {
  requireDatabase();

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const statements = [
        'create extension if not exists pgcrypto',
        `
          create table if not exists public.chatbot_knowledge_documents (
            id uuid primary key default gen_random_uuid(),
            title text not null,
            source_type text not null,
            media_type text,
            source_url text,
            source_label text,
            tags text[] not null default '{}',
            content text not null,
            summary text,
            metadata jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `,
        `
          create index if not exists idx_chatbot_knowledge_documents_title
          on public.chatbot_knowledge_documents (lower(title))
        `,
        `
          create index if not exists idx_chatbot_knowledge_documents_source_type
          on public.chatbot_knowledge_documents (source_type)
        `,
        `
          create index if not exists idx_chatbot_knowledge_documents_tags
          on public.chatbot_knowledge_documents using gin (tags)
        `,
        `
          create table if not exists public.chatbot_prompt_profiles (
            intent text primary key,
            label text not null,
            description text,
            system_prompt text not null,
            temperature real not null default 0.4,
            max_titles integer not null default 5,
            updated_at timestamptz not null default now()
          )
        `,
        `
          create table if not exists public.chatbot_eval_cases (
            id bigint generated by default as identity primary key,
            label text not null,
            question text not null,
            expected_intent text,
            expected_phrases text[] not null default '{}',
            forbidden_phrases text[] not null default '{}',
            notes text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )
        `,
        `
          create table if not exists public.chatbot_eval_runs (
            id bigint generated by default as identity primary key,
            case_id bigint references public.chatbot_eval_cases(id) on delete set null,
            label text,
            question text not null,
            selected_intent text,
            intent_match boolean not null default true,
            passed boolean not null default false,
            expected_hits text[] not null default '{}',
            missing_expected text[] not null default '{}',
            forbidden_hits text[] not null default '{}',
            response_text text not null,
            system_prompt text,
            latency_ms integer,
            created_at timestamptz not null default now()
          )
        `,
        `
          create index if not exists idx_chatbot_eval_runs_created_at
          on public.chatbot_eval_runs (created_at desc)
        `,
      ];

      for (const statement of statements) {
        await execute(statement);
      }

      for (const profile of DEFAULT_PROMPT_PROFILES) {
        await execute(
          `
            insert into public.chatbot_prompt_profiles (
              intent,
              label,
              description,
              system_prompt,
              temperature,
              max_titles
            )
            values ($1, $2, $3, $4, $5, $6)
            on conflict (intent) do nothing
          `,
          [
            profile.intent,
            profile.label,
            profile.description,
            profile.systemPrompt,
            profile.temperature,
            profile.maxTitles,
          ]
        );
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}

async function listPromptProfiles() {
  if (!pool) {
    return DEFAULT_PROMPT_PROFILES.map((profile) => ({
      ...profile,
      updatedAt: null,
    }));
  }

  await ensureDevLabSchema();
  return queryRows(
    `
      select
        intent,
        label,
        description,
        system_prompt as "systemPrompt",
        temperature,
        max_titles as "maxTitles",
        updated_at as "updatedAt"
      from public.chatbot_prompt_profiles
      order by intent asc
    `
  );
}

async function upsertPromptProfile(profile: Record<string, unknown>) {
  await ensureDevLabSchema();

  const rows = await queryRows(
    `
      insert into public.chatbot_prompt_profiles (
        intent,
        label,
        description,
        system_prompt,
        temperature,
        max_titles,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (intent) do update
      set
        label = excluded.label,
        description = excluded.description,
        system_prompt = excluded.system_prompt,
        temperature = excluded.temperature,
        max_titles = excluded.max_titles,
        updated_at = now()
      returning
        intent,
        label,
        description,
        system_prompt as "systemPrompt",
        temperature,
        max_titles as "maxTitles",
        updated_at as "updatedAt"
    `,
    [
      String(profile.intent || '').trim(),
      String(profile.label || '').trim(),
      String(profile.description || '').trim() || null,
      String(profile.systemPrompt || '').trim(),
      Number(profile.temperature) || 0.4,
      Math.max(1, Math.min(12, Number(profile.maxTitles) || 5)),
    ]
  );

  return rows[0];
}

async function listKnowledgeDocuments(limit = 20) {
  if (!pool) {
    return [];
  }

  await ensureDevLabSchema();
  return queryRows(
    `
      select
        id,
        title,
        source_type as "sourceType",
        media_type as "mediaType",
        source_url as "sourceUrl",
        source_label as "sourceLabel",
        tags,
        left(content, 480) as excerpt,
        summary,
        metadata,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from public.chatbot_knowledge_documents
      order by updated_at desc, created_at desc
      limit $1
    `,
    [Math.max(1, Math.min(100, Number(limit) || 20))]
  );
}

async function createKnowledgeDocument(document: Record<string, unknown>) {
  await ensureDevLabSchema();

  const rows = await queryRows(
    `
      insert into public.chatbot_knowledge_documents (
        title,
        source_type,
        media_type,
        source_url,
        source_label,
        tags,
        content,
        summary,
        metadata,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9::jsonb, now())
      returning
        id,
        title,
        source_type as "sourceType",
        media_type as "mediaType",
        source_url as "sourceUrl",
        source_label as "sourceLabel",
        tags,
        left(content, 480) as excerpt,
        summary,
        metadata,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      String(document.title || '').trim(),
      String(document.sourceType || '').trim(),
      String(document.mediaType || '').trim() || null,
      String(document.sourceUrl || '').trim() || null,
      String(document.sourceLabel || '').trim() || null,
      normalizeTagList(document.tags),
      String(document.content || '').trim(),
      String(document.summary || '').trim() || null,
      JSON.stringify(document.metadata || {}),
    ]
  );

  return rows[0];
}

async function deleteKnowledgeDocument(id: unknown) {
  await ensureDevLabSchema();
  await execute('delete from public.chatbot_knowledge_documents where id = $1', [String(id || '')]);
}

async function searchKnowledgeDocuments(search: unknown, limit = 4) {
  if (!pool) {
    return [];
  }

  await ensureDevLabSchema();

  const terms = String(search || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 5);

  if (!terms.length) {
    return [];
  }

  const args: unknown[] = [];
  const clauses = terms.map((term) => {
    args.push(`%${term}%`);
    return `(
      lower(title) like $${args.length}
      or lower(content) like $${args.length}
      or lower(coalesce(summary, '')) like $${args.length}
      or lower(array_to_string(tags, ' ')) like $${args.length}
    )`;
  });

  args.push(Math.max(1, Math.min(12, Number(limit) || 4)));

  return queryRows(
    `
      select
        id,
        title,
        source_type as "sourceType",
        media_type as "mediaType",
        source_url as "sourceUrl",
        source_label as "sourceLabel",
        tags,
        left(content, 900) as excerpt,
        summary,
        metadata,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from public.chatbot_knowledge_documents
      where ${clauses.join(' or ')}
      order by updated_at desc, created_at desc
      limit $${args.length}
    `,
    args
  );
}

async function listEvalCases(limit = 30) {
  if (!pool) {
    return [];
  }

  await ensureDevLabSchema();
  return queryRows(
    `
      select
        id,
        label,
        question,
        expected_intent as "expectedIntent",
        expected_phrases as "expectedPhrases",
        forbidden_phrases as "forbiddenPhrases",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from public.chatbot_eval_cases
      order by updated_at desc, created_at desc
      limit $1
    `,
    [Math.max(1, Math.min(100, Number(limit) || 30))]
  );
}

async function createEvalCase(testCase: Record<string, unknown>) {
  await ensureDevLabSchema();

  const rows = await queryRows(
    `
      insert into public.chatbot_eval_cases (
        label,
        question,
        expected_intent,
        expected_phrases,
        forbidden_phrases,
        notes,
        updated_at
      )
      values ($1, $2, $3, $4::text[], $5::text[], $6, now())
      returning
        id,
        label,
        question,
        expected_intent as "expectedIntent",
        expected_phrases as "expectedPhrases",
        forbidden_phrases as "forbiddenPhrases",
        notes,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      String(testCase.label || '').trim(),
      String(testCase.question || '').trim(),
      String(testCase.expectedIntent || '').trim() || null,
      normalizeTagList(testCase.expectedPhrases),
      normalizeTagList(testCase.forbiddenPhrases),
      String(testCase.notes || '').trim() || null,
    ]
  );

  return rows[0];
}

async function deleteEvalCase(id: unknown) {
  await ensureDevLabSchema();
  await execute('delete from public.chatbot_eval_cases where id = $1', [Number(id)]);
}

async function createEvalRun(run: Record<string, unknown>) {
  await ensureDevLabSchema();

  const rows = await queryRows(
    `
      insert into public.chatbot_eval_runs (
        case_id,
        label,
        question,
        selected_intent,
        intent_match,
        passed,
        expected_hits,
        missing_expected,
        forbidden_hits,
        response_text,
        system_prompt,
        latency_ms
      )
      values ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10, $11, $12)
      returning
        id,
        case_id as "caseId",
        label,
        question,
        selected_intent as "selectedIntent",
        intent_match as "intentMatch",
        passed,
        expected_hits as "expectedHits",
        missing_expected as "missingExpected",
        forbidden_hits as "forbiddenHits",
        response_text as "responseText",
        system_prompt as "systemPrompt",
        latency_ms as "latencyMs",
        created_at as "createdAt"
    `,
    [
      run.caseId ? Number(run.caseId) : null,
      String(run.label || '').trim() || null,
      String(run.question || '').trim(),
      String(run.selectedIntent || '').trim() || null,
      Boolean(run.intentMatch),
      Boolean(run.passed),
      normalizeTagList(run.expectedHits),
      normalizeTagList(run.missingExpected),
      normalizeTagList(run.forbiddenHits),
      String(run.responseText || '').trim(),
      String(run.systemPrompt || '').trim() || null,
      Number(run.latencyMs) || null,
    ]
  );

  return rows[0];
}

async function listEvalRuns(limit = 20) {
  if (!pool) {
    return [];
  }

  await ensureDevLabSchema();
  return queryRows(
    `
      select
        id,
        case_id as "caseId",
        label,
        question,
        selected_intent as "selectedIntent",
        intent_match as "intentMatch",
        passed,
        expected_hits as "expectedHits",
        missing_expected as "missingExpected",
        forbidden_hits as "forbiddenHits",
        response_text as "responseText",
        system_prompt as "systemPrompt",
        latency_ms as "latencyMs",
        created_at as "createdAt"
      from public.chatbot_eval_runs
      order by created_at desc
      limit $1
    `,
    [Math.max(1, Math.min(100, Number(limit) || 20))]
  );
}

async function getDashboardSnapshot() {
  if (!pool) {
    return {
      counts: {
        movie_count: 0,
        tv_count: 0,
        book_count: 0,
        knowledge_count: 0,
        eval_case_count: 0,
      },
      prompts: DEFAULT_PROMPT_PROFILES.map((profile) => ({ ...profile, updatedAt: null })),
      knowledge: [],
      evalCases: [],
      evalRuns: [],
      degraded: true,
    };
  }

  await ensureDevLabSchema();

  const [countsRows, prompts, knowledge, evalCases, evalRuns] = await Promise.all([
    queryRows<{
      movie_count: number;
      tv_count: number;
      book_count: number;
      knowledge_count: number;
      eval_case_count: number;
    }>(`
      select
        (select count(*)::int from public.movies where source_key is not null) as movie_count,
        (select count(*)::int from public.tv_shows where source_key is not null) as tv_count,
        (select count(*)::int from public.books) as book_count,
        (select count(*)::int from public.chatbot_knowledge_documents) as knowledge_count,
        (select count(*)::int from public.chatbot_eval_cases) as eval_case_count
    `),
    listPromptProfiles(),
    listKnowledgeDocuments(),
    listEvalCases(),
    listEvalRuns(),
  ]);

  return {
    counts: countsRows[0] || {
      movie_count: 0,
      tv_count: 0,
      book_count: 0,
      knowledge_count: 0,
      eval_case_count: 0,
    },
    prompts,
    knowledge,
    evalCases,
    evalRuns,
    degraded: false,
  };
}

async function queryCatalogTable(options: {
  table: string;
  mediaType: string;
  fields: string[];
  selectSql: string;
  terms: string[];
  limit: number;
}) {
  if (!pool) {
    return [];
  }

  const { table, mediaType, fields, selectSql, terms, limit } = options;
  const args: unknown[] = [];
  let text = `
    select ${selectSql}
    from public.${table}
    where source_key is not null and source_key <> ''
  `;

  if (terms.length && fields.length) {
    const clauses = terms.slice(0, 4).map((term) => {
      args.push(`%${term}%`);
      const placeholder = `$${args.length}`;
      return `(${fields
        .map((field) => `lower(coalesce(${field}::text, '')) like lower(${placeholder})`)
        .join(' or ')})`;
    });

    text += ` and (${clauses.join(' or ')})`;
  }

  args.push(limit);
  text += ` limit $${args.length}`;

  const rows = await queryRows(text, args);
  return rows.map((row) => ({ ...row, media_type: mediaType }));
}

async function fetchCatalog(queryText: unknown, limit = 20) {
  if (!pool) {
    return [];
  }

  const terms = String(queryText || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 5);

  const [movies, tvShows, books] = await Promise.all([
    queryCatalogTable({
      table: 'movies',
      mediaType: 'movie',
      fields: ['title', 'genre', 'director', 'cast_members', 'overview', 'synopsis'],
      selectSql:
        'id, title, year, genre, director, cast_members, overview, synopsis, source_key, poster_url',
      terms,
      limit,
    }),
    queryCatalogTable({
      table: 'tv_shows',
      mediaType: 'tv_show',
      fields: ['title', 'genre', 'creator', 'cast_members', 'overview', 'synopsis'],
      selectSql:
        'id, title, year, genre, creator, cast_members, overview, synopsis, seasons, source_key, poster_url',
      terms,
      limit,
    }),
    queryCatalogTable({
      table: 'books',
      mediaType: 'book',
      fields: ['title', 'genre', 'author', 'synopsis'],
      selectSql: 'id, title, year, genre, author, synopsis, cover_url, source_key',
      terms,
      limit,
    }),
  ]);

  const combined = [...movies, ...tvShows, ...books];
  const seen = new Set<string>();

  return combined
    .filter((item) => {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function performWebSearch(queryText: string) {
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
    return (data.results || []).map((result: Record<string, unknown>) => ({
      title: result.title,
      snippet: result.content || '',
      url: result.url,
      source: String(new URL(String(result.url)).hostname).replace(/^www\./, ''),
    }));
  } catch {
    return [];
  }
}

async function callGroq(options: {
  systemPrompt: string;
  question: string;
  temperature: number;
}) {
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
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.question },
      ],
      temperature: options.temperature,
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

async function callPreviewModel(options: {
  systemPrompt: string;
  question: string;
  temperature: number;
}) {
  return callGroq(options);
}

async function loadPromptMap() {
  const profiles = await listPromptProfiles();
  return new Map(profiles.map((profile: Record<string, unknown>) => [profile.intent, profile]));
}

async function previewQuestion(options: {
  question: unknown;
  forcedIntent?: unknown;
  includeWebSearch?: boolean;
}) {
  const trimmedQuestion = String(options.question || '').trim();
  if (!trimmedQuestion) {
    throw new Error('Question is required.');
  }

  const promptMap = await loadPromptMap();
  const selectedIntent =
    options.forcedIntent && options.forcedIntent !== 'auto'
      ? String(options.forcedIntent)
      : detectPromptIntent(trimmedQuestion);
  const promptProfile =
    promptMap.get(selectedIntent) || promptMap.get('general') || DEFAULT_PROMPT_PROFILES[0];

  const [knowledgeDocs, siteDocs, webSources] = await Promise.all([
    searchKnowledgeDocuments(trimmedQuestion, 4),
    fetchCatalog(trimmedQuestion, Number(promptProfile?.maxTitles) || 5),
    options.includeWebSearch !== false
      ? performWebSearch(trimmedQuestion)
      : Promise.resolve([]),
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
    toPlainTextList(webSources, (source: Record<string, unknown>) => {
      return `${source.source}: ${source.title} - ${summarizeText(source.snippet, 180)}`;
    }),
    '',
    'Answer the developer question now.',
  ].join('\n');

  const startTime = Date.now();
  const responseText = await callPreviewModel({
    systemPrompt,
    question: userPrompt,
    temperature: resolveTemperature(promptProfile?.temperature),
  });
  const latencyMs = Date.now() - startTime;

  const lowerResponse = responseText.toLowerCase();
  const siteSources = siteDocs
    .filter((document) => lowerResponse.includes(String(document.title || '').toLowerCase()))
    .slice(0, Number(promptProfile?.maxTitles) || 5)
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

async function fetchTmdbJson(pathname: string, params: Record<string, unknown> = {}) {
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

function formatTmdbMovie(detail: Record<string, unknown>) {
  const detailAny = detail as Record<string, any>;
  const credits = detailAny.credits || {};
  const crew = Array.isArray(credits.crew) ? credits.crew : [];
  const cast = Array.isArray(credits.cast) ? credits.cast : [];
  const genres = Array.isArray(detailAny.genres) ? detailAny.genres : [];

  return {
    title: detailAny.title,
    year: detailAny.release_date ? Number(String(detailAny.release_date).slice(0, 4)) : null,
    genre: joinUniqueNames(genres.map((genre: Record<string, unknown>) => genre.name)),
    director: joinUniqueNames(
      crew
        .filter((member: Record<string, unknown>) => member.job === 'Director')
        .map((member: Record<string, unknown>) => member.name)
    ),
    writers: joinUniqueNames(
      crew
        .filter((member: Record<string, unknown>) =>
          ['Writer', 'Screenplay', 'Story', 'Novel'].includes(String(member.job || ''))
        )
        .map((member: Record<string, unknown>) => member.name)
    ),
    cast_members: joinUniqueNames(
      cast.slice(0, 8).map((member: Record<string, unknown>) => member.name)
    ),
    age_rating: parseUsMovieCertification(
      (detailAny.release_dates || null) as Record<string, unknown> | null
    ),
    overview: detailAny.overview || null,
    synopsis: detailAny.overview || null,
    poster_url: detailAny.poster_path ? `${TMDB_POSTER_BASE_URL}${detailAny.poster_path}` : null,
    source_key: `tmdb:movie:${detailAny.id}`,
  };
}

function formatTmdbTv(detail: Record<string, unknown>) {
  const detailAny = detail as Record<string, any>;
  const credits = detailAny.credits || {};
  const crew = Array.isArray(credits.crew) ? credits.crew : [];
  const cast = Array.isArray(credits.cast) ? credits.cast : [];
  const genres = Array.isArray(detailAny.genres) ? detailAny.genres : [];
  const createdBy = Array.isArray(detailAny.created_by) ? detailAny.created_by : [];

  return {
    title: detailAny.name,
    year: detailAny.first_air_date ? Number(String(detailAny.first_air_date).slice(0, 4)) : null,
    genre: joinUniqueNames(genres.map((genre: Record<string, unknown>) => genre.name)),
    creator: joinUniqueNames([
      ...createdBy.map((person: Record<string, unknown>) => person.name),
      ...crew
        .filter((member: Record<string, unknown>) => member.job === 'Creator')
        .map((member: Record<string, unknown>) => member.name),
    ]),
    writers: joinUniqueNames(
      crew
        .filter((member: Record<string, unknown>) =>
          ['Writer', 'Screenplay', 'Story'].includes(String(member.job || ''))
        )
        .map((member: Record<string, unknown>) => member.name)
    ),
    cast_members: joinUniqueNames(
      cast.slice(0, 8).map((member: Record<string, unknown>) => member.name)
    ),
    age_rating: parseUsTvRating(
      (detailAny.content_ratings || null) as Record<string, unknown> | null
    ),
    overview: detailAny.overview || null,
    synopsis: detailAny.overview || null,
    poster_url: detailAny.poster_path ? `${TMDB_POSTER_BASE_URL}${detailAny.poster_path}` : null,
    seasons: detailAny.number_of_seasons || null,
    source_key: `tmdb:tv:${detailAny.id}`,
  };
}

async function upsertMovie(record: Record<string, unknown>) {
  const rows = await queryRows(
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

  return rows[0];
}

async function upsertTvShow(record: Record<string, unknown>) {
  const rows = await queryRows(
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

  return rows[0];
}

async function upsertBook(record: Record<string, unknown>) {
  const rows = await queryRows(
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

  return rows[0];
}

async function fetchOpenLibraryDescription(key: unknown) {
  if (!key) {
    return null;
  }

  try {
    const response = await fetch(`https://openlibrary.org${String(key)}.json`, {
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

async function importCatalogFromApi(payload: Record<string, unknown>) {
  requireDatabase();

  const provider = String(payload.provider || '').trim().toLowerCase();
  const mediaType = String(payload.mediaType || '').trim();
  const searchQuery = String(payload.query || '').trim();
  const limit = Math.max(1, Math.min(10, Number(payload.limit) || 5));

  if (!provider) {
    throw new Error('Provider is required.');
  }

  if (!searchQuery) {
    throw new Error('Query is required.');
  }

  if (provider === 'tmdb') {
    if (!['movie', 'tv_show'].includes(mediaType)) {
      throw new Error('TMDB imports support movie or tv_show media types.');
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
      const detailPath = mediaType === 'movie' ? `/movie/${result.id}` : `/tv/${result.id}`;
      const detail = await fetchTmdbJson(detailPath, {
        append_to_response:
          mediaType === 'movie' ? 'credits,release_dates' : 'credits,content_ratings',
      });

      const savedRow =
        mediaType === 'movie'
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

    return {
      message: `Imported ${imported.length} ${mediaType === 'movie' ? 'movie' : 'TV show'} records from TMDB into Supabase.`,
      imported,
    };
  }

  if (provider === 'openlibrary') {
    if (mediaType !== 'book') {
      throw new Error('Open Library imports support the book media type.');
    }

    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('title', searchQuery);
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      throw new Error(`Open Library request failed with status ${response.status}.`);
    }

    const payloadJson = await response.json();
    const topDocs = (payloadJson.docs || []).slice(0, limit);
    const imported = [];

    for (const doc of topDocs) {
      const description = await fetchOpenLibraryDescription(doc.key);
      const savedRow = await upsertBook({
        title: doc.title,
        author: joinUniqueNames(doc.author_name || []),
        year: Number(doc.first_publish_year) || null,
        genre: joinUniqueNames((doc.subject || []).slice(0, 6)),
        synopsis: description || doc.first_sentence?.[0] || doc.first_sentence || null,
        cover_url: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
          : null,
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

    return {
      message: `Imported ${imported.length} books from Open Library into Supabase.`,
      imported,
    };
  }

  throw new Error('Unsupported provider.');
}

async function runEvaluations(payload: Record<string, unknown>) {
  requireDatabase();

  const requestedIds = Array.isArray(payload.caseIds)
    ? payload.caseIds.map((id) => Number(id)).filter(Number.isFinite)
    : [];
  const allCases = await listEvalCases(100);
  const casesToRun = requestedIds.length
    ? allCases.filter((testCase) => requestedIds.includes(Number(testCase.id)))
    : allCases;

  if (!casesToRun.length) {
    throw new Error('No evaluation cases were selected.');
  }

  const results = [];

  for (const testCase of casesToRun) {
    const preview = await previewQuestion({
      question: testCase.question,
      forcedIntent: testCase.expectedIntent || 'auto',
      includeWebSearch: payload.includeWebSearch !== false,
    });

    const expectedPhrases = normalizeTagList(testCase.expectedPhrases);
    const forbiddenPhrases = normalizeTagList(testCase.forbiddenPhrases);
    const expectedHits = expectedPhrases.filter((phrase) =>
      containsPhrase(preview.responseText, phrase)
    );
    const missingExpected = expectedPhrases.filter(
      (phrase) => !containsPhrase(preview.responseText, phrase)
    );
    const forbiddenHits = forbiddenPhrases.filter((phrase) =>
      containsPhrase(preview.responseText, phrase)
    );
    const intentMatch = testCase.expectedIntent
      ? preview.intent === testCase.expectedIntent
      : true;
    const passed =
      intentMatch && missingExpected.length === 0 && forbiddenHits.length === 0;

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

  return {
    message: `Ran ${results.length} evaluation ${results.length === 1 ? 'case' : 'cases'}.`,
    results,
  };
}

async function handleAction(body: Record<string, unknown>) {
  const action = String(body.action || '').trim();

  switch (action) {
    case 'dashboard':
      return getDashboardSnapshot();
    case 'knowledge:list':
      return { items: await listKnowledgeDocuments(Number(body.limit) || 20) };
    case 'knowledge:create-manual': {
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();

      if (!title) {
        throw new Error('Title is required.');
      }

      if (!content) {
        throw new Error('Content is required.');
      }

      const document = await createKnowledgeDocument({
        title,
        content,
        mediaType: body.mediaType,
        tags: body.tags,
        sourceLabel: body.sourceLabel,
        sourceType: body.sourceType || 'manual_text',
        summary: summarizeText(content),
        metadata: { contentLength: content.length },
      });

      return {
        message: 'Manual knowledge document saved to Supabase.',
        document,
      };
    }
    case 'knowledge:scrape-url': {
      const rawUrl = String(body.url || '').trim();

      if (!rawUrl) {
        throw new Error('URL is required.');
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        throw new Error('URL must be a valid absolute URL.');
      }

      if (
        !['http:', 'https:'].includes(parsedUrl.protocol) ||
        isBlockedHost(parsedUrl.hostname)
      ) {
        throw new Error('That URL is blocked for safety reasons.');
      }

      const response = await fetch(parsedUrl, {
        headers: { 'User-Agent': 'binge-dev-lab/1.0' },
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) {
        throw new Error(`Remote fetch failed with status ${response.status}.`);
      }

      const contentType = response.headers.get('content-type') || '';
      const rawBody = await response.text();
      const scrapedText = contentType.includes('html')
        ? extractTextFromHtml(rawBody)
        : rawBody.trim();

      if (!scrapedText) {
        throw new Error('No readable text was extracted from that URL.');
      }

      const fallbackTitle = contentType.includes('html')
        ? rawBody.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || parsedUrl.hostname
        : parsedUrl.pathname.split('/').filter(Boolean).pop() || parsedUrl.hostname;

      const document = await createKnowledgeDocument({
        title: String(body.title || '').trim() || fallbackTitle.trim(),
        content: scrapedText.slice(0, 40000),
        mediaType: body.mediaType,
        tags: body.tags,
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

      return {
        message: 'URL content scraped and saved to the Supabase knowledge base.',
        document,
      };
    }
    case 'catalog:import-api':
      return importCatalogFromApi(body);
    case 'prompts:save': {
      const intent = String(body.intent || '').trim();
      if (!intent) {
        throw new Error('Intent is required.');
      }

      if (!String(body.systemPrompt || '').trim()) {
        throw new Error('System prompt is required.');
      }

      const prompt = await upsertPromptProfile({
        intent,
        label: body.label || intent,
        description: body.description || '',
        systemPrompt: body.systemPrompt,
        temperature: body.temperature,
        maxTitles: body.maxTitles,
      });

      return {
        message: `Saved the ${intent} prompt profile.`,
        prompt,
      };
    }
    case 'preview':
      return previewQuestion({
        question: body.question,
        forcedIntent: body.forcedIntent,
        includeWebSearch: body.includeWebSearch !== false,
      });
    case 'evaluations:list': {
      const [cases, runs] = await Promise.all([listEvalCases(), listEvalRuns()]);
      return { cases, runs };
    }
    case 'evaluations:create-case': {
      if (!String(body.label || '').trim()) {
        throw new Error('Case label is required.');
      }

      if (!String(body.question || '').trim()) {
        throw new Error('Case question is required.');
      }

      const testCase = await createEvalCase({
        label: body.label,
        question: body.question,
        expectedIntent: body.expectedIntent,
        expectedPhrases: getArrayInput(body.expectedPhrases),
        forbiddenPhrases: getArrayInput(body.forbiddenPhrases),
        notes: body.notes,
      });

      return {
        message: 'Saved the evaluation case.',
        testCase,
      };
    }
    case 'evaluations:delete-case':
      await deleteEvalCase(body.id);
      return { ok: true };
    case 'evaluations:run':
      return runEvaluations(body);
    case 'knowledge:delete':
      await deleteKnowledgeDocument(body.id);
      return { ok: true };
    default:
      throw new Error('Unknown dev action.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return jsonResponse(200, {
      ok: true,
      message: 'dev function is live',
      hasDatabaseUrl: Boolean(DATABASE_URL),
      hasGroqKey: Boolean(GROQ_API_KEY),
      hasTavilyKey: Boolean(TAVILY_API_KEY),
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = await readRequestBody(req);
    const payload = await handleAction(body);
    return jsonResponse(200, payload as JsonValue);
  } catch (error) {
    console.error('Dev function error:', error);
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
