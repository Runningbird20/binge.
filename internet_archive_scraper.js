const fs = require('fs');
const https = require('https');
const path = require('path');

const fetchFn =
  typeof fetch !== 'undefined'
    ? fetch
    : (() => {
        throw new Error('This script requires Node.js 18+ with built-in fetch support.');
      })();

const DEFAULT_OUTPUT = path.join(__dirname, 'data', 'internet_archive_books.json');
const DEFAULT_BULK_OUTPUT = path.join(__dirname, 'data', 'internet_archive_books.bulk.jsonl');
const DEFAULT_CHECKPOINT = path.join(__dirname, 'data', 'internet_archive_books.bulk.checkpoint.json');
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_SORT = 'downloads desc';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_QUERY =
  'mediatype:texts AND subject:(fiction OR literature OR biography OR history OR science)';
const DEFAULT_FIELDS = [
  'identifier',
  'title',
  'creator',
  'year',
  'subject',
  'description',
  'date',
  'language',
  'mediatype',
  'downloads',
];
const EXPLICIT_PATTERNS = [
  /\bporn\b/i,
  /\bporno\b/i,
  /\bxxx\b/i,
  /\berotica\b/i,
  /\berotic\b/i,
  /\bhentai\b/i,
  /\bplayboy\b/i,
  /\bhardcore\b/i,
  /\bsoftcore\b/i,
  /\bfetish\b/i,
  /\badult video\b/i,
];

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function compactWhitespace(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function stripHtml(value) {
  if (value == null) return null;
  return compactWhitespace(String(value).replace(/<[^>]+>/g, ' '));
}

function pickFirstText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return compactWhitespace(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = pickFirstText(item);
      if (match) return match;
    }
    return null;
  }
  if (typeof value === 'object') {
    if ('value' in value) return pickFirstText(value.value);
  }
  return compactWhitespace(value);
}

function normalizeYear(value) {
  const text = pickFirstText(value);
  if (!text) return null;
  const match = text.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function normalizeCreator(value) {
  return ensureArray(value)
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean)
    .join(', ');
}

function normalizeSubjects(value) {
  return ensureArray(value)
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean);
}

function pickBookGenre(subjects) {
  const normalizedSubjects = normalizeSubjects(subjects).filter((subject) => {
    const lowered = subject.toLowerCase();
    return subject.length >= 4 && !['lit', 'par', 'ls', 'ms'].includes(lowered);
  });
  const preferredGenres = [
    [/science fiction/i, 'Science Fiction'],
    [/mystery/i, 'Mystery'],
    [/detective/i, 'Mystery'],
    [/thriller/i, 'Thriller'],
    [/romance/i, 'Romance'],
    [/fantasy/i, 'Fantasy'],
    [/historical/i, 'Historical Fiction'],
    [/classic/i, 'Classic Literature'],
    [/literature/i, 'Literature'],
    [/biography/i, 'Biography'],
    [/history/i, 'History'],
    [/science/i, 'Science'],
    [/young adult/i, 'Young Adult'],
    [/poetry/i, 'Poetry'],
  ];

  for (const [pattern, label] of preferredGenres) {
    if (normalizedSubjects.some((subject) => pattern.test(subject))) {
      return label;
    }
  }

  return normalizedSubjects[0] || 'General Interest';
}

function isExplicitRecord(record) {
  const joined = [
    record?.title,
    record?.creator,
    record?.description,
    ...normalizeSubjects(record?.subject),
  ]
    .filter(Boolean)
    .join(' ');

  return EXPLICIT_PATTERNS.some((pattern) => pattern.test(joined));
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const payload = await new Promise((resolve, reject) => {
        const request = https.get(
          url,
          {
            headers: { accept: 'application/json' },
            timeout: timeoutMs,
          },
          (response) => {
            if ((response.statusCode || 0) >= 400) {
              reject(new Error(`Internet Archive request failed with HTTP ${response.statusCode}: ${url}`));
              response.resume();
              return;
            }

            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
              body += chunk;
            });
            response.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch (error) {
                reject(error);
              }
            });
          }
        );

        request.on('timeout', () => {
          request.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${url}`));
        });
        request.on('error', reject);
      });

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw lastError;
}

async function searchArchiveBooks(
  query,
  {
    page = 1,
    rows = DEFAULT_PAGE_SIZE,
    sort = DEFAULT_SORT,
    fields = DEFAULT_FIELDS,
  } = {}
) {
  const url = new URL('https://archive.org/advancedsearch.php');
  url.searchParams.set('q', query);
  ensureArray(fields).forEach((field) => url.searchParams.append('fl[]', field));
  url.searchParams.append('sort[]', sort);
  url.searchParams.set('rows', String(rows));
  url.searchParams.set('page', String(page));
  url.searchParams.set('output', 'json');

  const payload = await fetchJson(url.toString());
  return {
    totalAvailable: payload?.response?.numFound || 0,
    docs: ensureArray(payload?.response?.docs),
  };
}

async function fetchArchiveMetadata(identifier) {
  return fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
}

function normalizeArchiveBook(record, metadataPayload = null) {
  const metadata = metadataPayload?.metadata || {};
  const identifier = compactWhitespace(record?.identifier);
  const title = compactWhitespace(record?.title || metadata?.title) || 'Untitled';
  const author = normalizeCreator(record?.creator || metadata?.creator) || 'Unknown';
  const subjects = normalizeSubjects(record?.subject || metadata?.subject);
  const synopsis =
    stripHtml(pickFirstText(metadata?.description)) ||
    stripHtml(pickFirstText(record?.description)) ||
    'No description available yet.';

  return {
    sourceKey: `internet-archive:${identifier || title}`,
    identifier,
    title,
    author,
    year: normalizeYear(record?.year || metadata?.year || metadata?.date || record?.date),
    genre: pickBookGenre(subjects),
    synopsis,
    description: synopsis,
    coverUrl: identifier ? `https://archive.org/services/img/${identifier}` : null,
    itemUrl: identifier ? `https://archive.org/details/${identifier}` : null,
    language: normalizeSubjects(record?.language || metadata?.language),
    subjects,
  };
}

async function collectInternetArchiveBooks(
  {
    query = DEFAULT_QUERY,
    limit = DEFAULT_LIMIT,
    pageSize = DEFAULT_PAGE_SIZE,
    sort = DEFAULT_SORT,
    enrichMetadata = true,
  } = {}
) {
  const collectedDocs = [];
  let page = 1;
  let totalAvailable = 0;

  while (collectedDocs.length < limit) {
    const pagePayload = await searchArchiveBooks(query, {
      page,
      rows: pageSize,
      sort,
    });

    totalAvailable = pagePayload.totalAvailable || totalAvailable;
    const filteredDocs = pagePayload.docs
      .filter((doc) => compactWhitespace(doc?.identifier) && compactWhitespace(doc?.title))
      .filter((doc) => !isExplicitRecord(doc));

    collectedDocs.push(...filteredDocs);

    if (pagePayload.docs.length === 0 || page * pageSize >= totalAvailable) {
      break;
    }

    page += 1;
  }

  const selectedDocs = collectedDocs.slice(0, limit);
  const metadataByIdentifier = new Map();

  if (enrichMetadata) {
    const metadataPayloads = await Promise.all(
      selectedDocs.map(async (doc) => {
        try {
          return [doc.identifier, await fetchArchiveMetadata(doc.identifier)];
        } catch {
          return [doc.identifier, null];
        }
      })
    );

    metadataPayloads.forEach(([identifier, metadata]) => {
      metadataByIdentifier.set(identifier, metadata);
    });
  }

  const books = selectedDocs
    .map((doc) => normalizeArchiveBook(doc, metadataByIdentifier.get(doc.identifier)))
    .filter((book) => !isExplicitRecord(book));

  return {
    source: 'internet-archive',
    mediaType: 'book',
    collectedAt: new Date().toISOString(),
    query,
    totalAvailable,
    collected: books.length,
    books,
  };
}

function writeBooksToFile(payload, outputPath = DEFAULT_OUTPUT) {
  const targetPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}

function appendBooksToJsonl(books, outputPath = DEFAULT_BULK_OUTPUT) {
  const targetPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!Array.isArray(books) || books.length === 0) {
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, '', 'utf8');
    }
    return targetPath;
  }

  const lines = books.map((book) => JSON.stringify(book)).join('\n');
  fs.appendFileSync(targetPath, `${lines}\n`, 'utf8');
  return targetPath;
}

function writeCheckpoint(checkpointPath, payload) {
  const targetPath = path.resolve(checkpointPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}

function readCheckpoint(checkpointPath) {
  const targetPath = path.resolve(checkpointPath);
  if (!fs.existsSync(targetPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
}

async function collectInternetArchiveBooksBulk(
  {
    query = DEFAULT_QUERY,
    pageSize = DEFAULT_PAGE_SIZE,
    sort = DEFAULT_SORT,
    enrichMetadata = true,
    output = DEFAULT_BULK_OUTPUT,
    checkpoint = DEFAULT_CHECKPOINT,
    startPage = 1,
    maxPages = Number.POSITIVE_INFINITY,
    limit = null,
    resume = false,
  } = {}
) {
  let currentPage = startPage;
  let collected = 0;
  let processedPages = 0;
  let totalAvailable = 0;

  if (resume) {
    const existingCheckpoint = readCheckpoint(checkpoint);
    if (existingCheckpoint) {
      currentPage = Number(existingCheckpoint.nextPage) || currentPage;
      collected = Number(existingCheckpoint.collected) || 0;
      processedPages = Number(existingCheckpoint.processedPages) || 0;
      totalAvailable = Number(existingCheckpoint.totalAvailable) || 0;
    }
  } else {
    const outputPath = path.resolve(output);
    const checkpointPath = path.resolve(checkpoint);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  }

  appendBooksToJsonl([], output);

  while (processedPages < maxPages) {
    if (limit != null && collected >= limit) {
      break;
    }

    const pagePayload = await searchArchiveBooks(query, {
      page: currentPage,
      rows: pageSize,
      sort,
    });

    totalAvailable = pagePayload.totalAvailable || totalAvailable;
    if (pagePayload.docs.length === 0) {
      break;
    }

    const filteredDocs = pagePayload.docs
      .filter((doc) => compactWhitespace(doc?.identifier) && compactWhitespace(doc?.title))
      .filter((doc) => !isExplicitRecord(doc));

    const remainingLimit =
      limit == null ? filteredDocs.length : Math.max(limit - collected, 0);
    const selectedDocs = filteredDocs.slice(0, remainingLimit);

    const metadataByIdentifier = new Map();
    if (enrichMetadata) {
      const metadataPayloads = await Promise.all(
        selectedDocs.map(async (doc) => {
          try {
            return [doc.identifier, await fetchArchiveMetadata(doc.identifier)];
          } catch {
            return [doc.identifier, null];
          }
        })
      );

      metadataPayloads.forEach(([identifier, metadata]) => {
        metadataByIdentifier.set(identifier, metadata);
      });
    }

    const books = selectedDocs
      .map((doc) => normalizeArchiveBook(doc, metadataByIdentifier.get(doc.identifier)))
      .filter((book) => !isExplicitRecord(book));

    appendBooksToJsonl(books, output);

    collected += books.length;
    processedPages += 1;
    currentPage += 1;

    writeCheckpoint(checkpoint, {
      source: 'internet-archive',
      query,
      sort,
      pageSize,
      enrichMetadata,
      totalAvailable,
      collected,
      processedPages,
      nextPage: currentPage,
      updatedAt: new Date().toISOString(),
    });

    if (pagePayload.docs.length < pageSize || currentPage > Math.ceil(totalAvailable / pageSize)) {
      break;
    }
  }

  return {
    source: 'internet-archive',
    mediaType: 'book',
    query,
    totalAvailable,
    collected,
    processedPages,
    nextPage: currentPage,
    output: path.resolve(output),
    checkpoint: path.resolve(checkpoint),
  };
}

function parseCliArgs(argv) {
  const options = {
    query: DEFAULT_QUERY,
    limit: DEFAULT_LIMIT,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: DEFAULT_SORT,
    output: DEFAULT_OUTPUT,
    checkpoint: DEFAULT_CHECKPOINT,
    enrichMetadata: true,
    bulk: false,
    resume: false,
    startPage: 1,
    maxPages: Number.POSITIVE_INFINITY,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--query':
        options.query = argv[index + 1] || options.query;
        index += 1;
        break;
      case '--limit':
        options.limit = Number(argv[index + 1]) || options.limit;
        index += 1;
        break;
      case '--page-size':
        options.pageSize = Number(argv[index + 1]) || options.pageSize;
        index += 1;
        break;
      case '--sort':
        options.sort = argv[index + 1] || options.sort;
        index += 1;
        break;
      case '--output':
        options.output = argv[index + 1] || options.output;
        index += 1;
        break;
      case '--checkpoint':
        options.checkpoint = argv[index + 1] || options.checkpoint;
        index += 1;
        break;
      case '--no-enrich':
        options.enrichMetadata = false;
        break;
      case '--all':
      case '--bulk':
        options.bulk = true;
        options.output = DEFAULT_BULK_OUTPUT;
        options.limit = null;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--start-page':
        options.startPage = Number(argv[index + 1]) || options.startPage;
        index += 1;
        break;
      case '--max-pages':
        options.maxPages = Number(argv[index + 1]) || options.maxPages;
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function printUsage() {
  console.log(`Internet Archive book scraper

Usage:
  node internet_archive_scraper.js --limit 20
  node internet_archive_scraper.js --query "mediatype:texts AND subject:(science fiction)" --limit 10
  node internet_archive_scraper.js --all --max-pages 10 --page-size 100

Options:
  --query <text>             Internet Archive advanced search query
  --limit <number>           Maximum books to collect (default: 20)
  --page-size <number>       Search page size (default: 50)
  --sort <value>             Internet Archive sort value (default: downloads desc)
  --output <path>            JSON output path (default: data/internet_archive_books.json)
  --all | --bulk             Stream a large pull to JSONL instead of one JSON array file
  --checkpoint <path>        Checkpoint path for bulk mode
  --resume                   Resume bulk mode from the checkpoint file
  --start-page <number>      Starting page for bulk mode (default: 1)
  --max-pages <number>       Cap how many pages to process in this run
  --no-enrich                Skip per-item metadata requests

Notes:
  The scraper excludes explicit/pornographic records using keyword-based filtering.
  Bulk mode writes newline-delimited JSON to data/internet_archive_books.bulk.jsonl.
`);
}

async function runCli() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options.bulk) {
    const result = await collectInternetArchiveBooksBulk(options);
    console.log(
      `Processed ${result.processedPages} page(s), collected ${result.collected} books, next page ${result.nextPage}.`
    );
    console.log(`JSONL output: ${result.output}`);
    console.log(`Checkpoint: ${result.checkpoint}`);
    return;
  }

  const payload = await collectInternetArchiveBooks(options);
  const writtenPath = writeBooksToFile(payload, options.output);
  console.log(`Wrote ${payload.collected} book records to ${writtenPath}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  collectInternetArchiveBooks,
  collectInternetArchiveBooksBulk,
  normalizeArchiveBook,
  appendBooksToJsonl,
  writeBooksToFile,
};
