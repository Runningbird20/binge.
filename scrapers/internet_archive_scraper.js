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
const DEFAULT_BULK_PAGE_SIZE = 200;
const DEFAULT_SORT = 'downloads desc';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_MIN_YEAR = 2000;
const ARCHIVE_MAX_PAGE = 400;
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
const RESEARCH_PATTERNS = [
  /\bthesis\b/i,
  /\bdissertation\b/i,
  /\bproceedings\b/i,
  /\bconference(?: presentations?)?\b/i,
  /\bresearch papers?\b/i,
  /\bscientific articles?\b/i,
  /\bworking papers?\b/i,
  /\btechnical report\b/i,
  /\bpeer[- ]review/i,
  /\beric\s+ed\d+\b/i,
  /\binternational journal\b/i,
  /\bpapers contain references\b/i,
  /\bvolume\s+\d+\s*\(\d{4}\)\s+no\s+\d+\b/i,
];
const PERIODICAL_PATTERNS = [
  /\bjournals?\b/i,
  /\bnewspapers?\b/i,
  /\bgazettes?\b/i,
  /\bmagazines?\b/i,
  /\bperiodicals?\b/i,
  /\bquarterly\b/i,
  /\bmonthly\b/i,
  /\bweekly\b/i,
  /\bnewsletter\b/i,
  /\bstudent newspapers?\b/i,
  /\bnews enterprise\b/i,
  /\btimes of india\b/i,
  /\bgleaner\b/i,
  /\bissue\s+\d+\b/i,
  /\bfull volume\b/i,
];
const TITLE_ARTIFACT_PATTERNS = [
  /\.compressed\b/i,
  /anna[’']s archive/i,
  /\bz[\s-]?lib(?:rary)?(?:\.org)?\b/i,
  /\bbookzz(?:\.org)?\b/i,
  /\bpdf archives?\b/i,
  /\bscreenshot archive\b/i,
  /\bmega image\b/i,
  /\bpages?\s*0{2,}\d+/i,
];
const FICTION_LIKE_PATTERNS = [
  /\bfiction\b/i,
  /\bnovel\b/i,
  /\bjuvenile\b/i,
  /\bfantasy\b/i,
  /\bromance\b/i,
  /\bmystery\b/i,
  /\bthriller\b/i,
  /\bscience fiction\b/i,
  /\bgraphic novel\b/i,
  /\bmanga\b/i,
  /\bcomic\b/i,
  /\bstory\b/i,
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

function normalizeArchiveTitle(value) {
  let title = compactWhitespace(value);
  if (!title) return null;

  title = title
    .replace(/^BK\s*\d+\s*-\s*/i, '')
    .replace(/^\d{4}\s+Or Before\s*-\s*/i, '')
    .replace(/^\d{4}\s*-\s*/i, '')
    .replace(/^\d+\s*[\.\-]\s*/i, '')
    .replace(
      /\[(?:[^\]]*?(?:z[\s-]?lib(?:rary)?|bookzz(?:\.org)?|kobo|yen press|kitzoku)[^\]]*)\]/ig,
      ' '
    )
    .replace(
      /\((?:[^\)]*?(?:z[\s-]?lib(?:rary)?|bookzz(?:\.org)?|anna[’']s archive)[^\)]*)\)/ig,
      ' '
    )
    .replace(/anna[’']s archive.*$/i, '')
    .replace(/\.compressed\b/ig, '')
    .replace(/[_]+/g, ' ');

  title = compactWhitespace(title);
  if (!title) return null;

  return title.replace(/[\s\-:;,.|/]+$/g, '').trim() || null;
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

function isFictionLikeBook(book) {
  const joined = [
    book?.title,
    book?.genre,
    ...(ensureArray(book?.subjects)),
  ]
    .filter(Boolean)
    .join(' ');

  return FICTION_LIKE_PATTERNS.some((pattern) => pattern.test(joined));
}

function isResearchOrPeriodicalRecord(book) {
  const title = normalizeArchiveTitle(book?.title) || '';
  const researchText = [
    title,
    book?.author,
    book?.description,
    ...(ensureArray(book?.subjects)),
  ]
    .filter(Boolean)
    .join(' ');
  const periodicalText = [
    title,
    book?.title,
    book?.author,
    ...(ensureArray(book?.subjects)),
  ]
    .filter(Boolean)
    .join(' ');
  const looksLikeNamedBook =
    /\bbook\b|\bcookbook\b|\bencyclopedia\b|\bdictionary\b|\bcompanion\b|\batlas\b|\bguide\b/i.test(
      title
    );
  const canTreatJournalAsStoryArtifact =
    /\bjournal\b/i.test(title) && isFictionLikeBook(book);

  if (RESEARCH_PATTERNS.some((pattern) => pattern.test(researchText))) {
    return true;
  }

  if (
    !looksLikeNamedBook &&
    !(canTreatJournalAsStoryArtifact && /\bjournal\b/i.test(periodicalText)) &&
    PERIODICAL_PATTERNS.some((pattern) => pattern.test(periodicalText))
  ) {
    return true;
  }

  return false;
}

function hasCoherentArchiveTitle(book) {
  const title = normalizeArchiveTitle(book?.title);
  if (!title) return false;
  if (!/[\p{L}]/u.test(title)) return false;
  if (/^[#\d]/.test(title)) return false;
  if (TITLE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(title))) return false;

  const wordCount = title.split(/\s+/).filter(Boolean).length;
  const digitCount = (title.match(/\d/g) || []).length;
  const hashTokenCount = (title.match(/\b[a-f0-9]{6,}\b/gi) || []).length;
  const punctuationCount = (title.match(/[()[\]{}|_]/g) || []).length;

  if (title.length > 180) return false;
  if (wordCount > 28) return false;
  if (hashTokenCount >= 2) return false;
  if (digitCount >= 12) return false;
  if (digitCount >= 7 && punctuationCount >= 3) return false;

  const monthDatePattern =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/i;
  if (monthDatePattern.test(title) && !isFictionLikeBook(book)) {
    return false;
  }

  return true;
}

function hasArchiveCoverArt(book) {
  const coverUrl = compactWhitespace(book?.coverUrl || book?.cover_url);
  return Boolean(coverUrl);
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
  const title = normalizeArchiveTitle(record?.title || metadata?.title) || 'Untitled';
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

function shouldKeepArchiveBook(book, minYear = DEFAULT_MIN_YEAR) {
  if (!book || isExplicitRecord(book)) {
    return false;
  }

  if (!hasArchiveCoverArt(book)) {
    return false;
  }

  if (isResearchOrPeriodicalRecord(book) || !hasCoherentArchiveTitle(book)) {
    return false;
  }

  const year = normalizeYear(book.year);
  return year != null && year >= minYear;
}

async function normalizeArchiveDocs(docs, { enrichMetadata = true, minYear = DEFAULT_MIN_YEAR } = {}) {
  const metadataByIdentifier = new Map();
  const normalizedDocs = docs
    .filter((doc) => compactWhitespace(doc?.identifier) && compactWhitespace(doc?.title))
    .filter((doc) => !isExplicitRecord(doc));

  if (enrichMetadata) {
    const metadataPayloads = await Promise.all(
      normalizedDocs.map(async (doc) => {
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

  return normalizedDocs
    .map((doc) => normalizeArchiveBook(doc, metadataByIdentifier.get(doc.identifier)))
    .filter((book) => shouldKeepArchiveBook(book, minYear));
}

async function collectInternetArchiveBooks(
  {
    query = DEFAULT_QUERY,
    limit = DEFAULT_LIMIT,
    pageSize = DEFAULT_PAGE_SIZE,
    sort = DEFAULT_SORT,
    enrichMetadata = true,
    minYear = DEFAULT_MIN_YEAR,
  } = {}
) {
  const books = [];
  let page = 1;
  let totalAvailable = 0;

  while (books.length < limit) {
    const pagePayload = await searchArchiveBooks(query, {
      page,
      rows: pageSize,
      sort,
    });

    totalAvailable = pagePayload.totalAvailable || totalAvailable;
    const filteredBooks = await normalizeArchiveDocs(pagePayload.docs, {
      enrichMetadata,
      minYear,
    });
    books.push(...filteredBooks);

    if (pagePayload.docs.length === 0 || page * pageSize >= totalAvailable) {
      break;
    }

    page += 1;
  }

  return {
    source: 'internet-archive',
    mediaType: 'book',
    collectedAt: new Date().toISOString(),
    query,
    totalAvailable,
    collected: Math.min(books.length, limit),
    books: books.slice(0, limit),
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

function readJsonlRecords(filePath) {
  const targetPath = path.resolve(filePath);
  if (!fs.existsSync(targetPath)) return [];

  return fs.readFileSync(targetPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readExistingArchiveSourceKeys(outputPath) {
  return new Set(
    readJsonlRecords(outputPath)
      .map((record) => compactWhitespace(record?.sourceKey))
      .filter(Boolean)
  );
}

function getArchiveSegmentYears(minYear = DEFAULT_MIN_YEAR, maxYear = new Date().getUTCFullYear()) {
  const normalizedMinYear = Number(minYear);
  const normalizedMaxYear = Number(maxYear);
  const years = [];

  for (let year = normalizedMaxYear; year >= normalizedMinYear; year -= 1) {
    years.push(year);
  }

  return years;
}

function buildArchiveYearQuery(query, year) {
  return `${query} AND year:[${year} TO ${year}]`;
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
    pageSize = DEFAULT_BULK_PAGE_SIZE,
    sort = DEFAULT_SORT,
    enrichMetadata = true,
    output = DEFAULT_BULK_OUTPUT,
    checkpoint = DEFAULT_CHECKPOINT,
    maxPages = Number.POSITIVE_INFINITY,
    limit = null,
    resume = false,
    minYear = DEFAULT_MIN_YEAR,
  } = {}
) {
  const outputPath = path.resolve(output);
  const checkpointPath = path.resolve(checkpoint);
  const years = getArchiveSegmentYears(minYear);
  const effectivePageSize = Math.max(Number(pageSize) || DEFAULT_BULK_PAGE_SIZE, DEFAULT_BULK_PAGE_SIZE);
  const seenSourceKeys = resume ? readExistingArchiveSourceKeys(outputPath) : new Set();

  let currentYearIndex = 0;
  let currentPage = 1;
  let collected = resume ? seenSourceKeys.size : 0;
  let processedPages = 0;
  let currentSegmentTotalAvailable = 0;
  let lastProcessedYear = null;
  let lastProcessedPage = null;
  let pagesProcessedThisRun = 0;

  if (resume) {
    const existingCheckpoint = readCheckpoint(checkpointPath);
    if (existingCheckpoint) {
      if (existingCheckpoint.mode === 'year_segments') {
        currentYearIndex = Number(existingCheckpoint.currentYearIndex) || 0;
        currentPage = Number(existingCheckpoint.nextPage) || currentPage;
        collected = Number(existingCheckpoint.collected) || collected;
        processedPages = Number(existingCheckpoint.processedPages) || processedPages;
        currentSegmentTotalAvailable =
          Number(existingCheckpoint.currentSegmentTotalAvailable) || currentSegmentTotalAvailable;
      }
    }
  } else {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  }

  appendBooksToJsonl([], outputPath);

  while (pagesProcessedThisRun < maxPages) {
    if (limit != null && collected >= limit) {
      break;
    }

    if (currentYearIndex >= years.length) {
      break;
    }

    const currentYear = years[currentYearIndex];
    const segmentQuery = buildArchiveYearQuery(query, currentYear);
    const pagePayload = await searchArchiveBooks(segmentQuery, {
      page: currentPage,
      rows: effectivePageSize,
      sort,
    });

    currentSegmentTotalAvailable = pagePayload.totalAvailable || currentSegmentTotalAvailable;
    if (pagePayload.docs.length === 0) {
      currentYearIndex += 1;
      currentPage = 1;
      currentSegmentTotalAvailable = 0;
      continue;
    }

    const books = await normalizeArchiveDocs(pagePayload.docs, {
      enrichMetadata,
      minYear,
    });
    const newBooks = books.filter((book) => !seenSourceKeys.has(book.sourceKey));
    const remainingLimit = limit == null ? newBooks.length : Math.max(limit - collected, 0);
    const selectedBooks = newBooks.slice(0, remainingLimit);
    selectedBooks.forEach((book) => {
      seenSourceKeys.add(book.sourceKey);
    });

    appendBooksToJsonl(selectedBooks, outputPath);

    collected += selectedBooks.length;
    processedPages += 1;
    pagesProcessedThisRun += 1;
    lastProcessedYear = currentYear;
    lastProcessedPage = currentPage;

    const segmentTotalPages = Math.ceil(currentSegmentTotalAvailable / effectivePageSize);
    if (
      pagePayload.docs.length < effectivePageSize ||
      currentPage >= segmentTotalPages ||
      currentPage >= ARCHIVE_MAX_PAGE
    ) {
      currentYearIndex += 1;
      currentPage = 1;
      currentSegmentTotalAvailable = 0;
    } else {
      currentPage += 1;
    }

    writeCheckpoint(checkpointPath, {
      source: 'internet-archive',
      mode: 'year_segments',
      query,
      sort,
      pageSize: effectivePageSize,
      enrichMetadata,
      minYear,
      years,
      collected,
      processedPages,
      currentYear: years[currentYearIndex] ?? null,
      currentYearIndex,
      currentSegmentTotalAvailable,
      nextPage: currentPage,
      complete: currentYearIndex >= years.length,
      updatedAt: new Date().toISOString(),
    });

    if (currentYearIndex >= years.length) break;
  }

  return {
    source: 'internet-archive',
    mediaType: 'book',
    query,
    currentYear: years[currentYearIndex] ?? null,
    collected,
    processedPages,
    nextPage: currentPage,
    lastProcessedYear,
    lastProcessedPage,
    pagesProcessedThisRun,
    complete: currentYearIndex >= years.length,
    output: outputPath,
    checkpoint: checkpointPath,
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
    minYear: DEFAULT_MIN_YEAR,
    bulk: false,
    resume: false,
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
      case '--min-year':
        options.minYear = Number(argv[index + 1]) || options.minYear;
        index += 1;
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
  --min-year <number>        Keep only books published in or after this year (default: 2000)
  --all | --bulk             Stream a large pull to JSONL instead of one JSON array file
  --checkpoint <path>        Checkpoint path for bulk mode
  --resume                   Resume bulk mode from the checkpoint file
  --max-pages <number>       Cap how many pages to process in this run
  --no-enrich                Skip per-item metadata requests

Notes:
  The scraper excludes explicit/pornographic records using keyword-based filtering.
  Books without a usable year are skipped by the minimum-year filter.
  Bulk mode crawls one publication year at a time so it can continue past Archive's page-400 search cap.
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
  hasArchiveCoverArt,
  hasCoherentArchiveTitle,
  isResearchOrPeriodicalRecord,
  normalizeArchiveTitle,
  normalizeArchiveBook,
  shouldKeepArchiveBook,
  appendBooksToJsonl,
  writeBooksToFile,
};
