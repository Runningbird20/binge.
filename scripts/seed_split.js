#!/usr/bin/env node
/**
 * seed_split.js
 *
 * Splits large Supabase seed SQL files into smaller chunks and rewrites them
 * into a safer format that uses `external_id` in temp seed tables.
 *
 * Designed to handle:
 * - books
 * - movies
 * - tv_shows
 *
 * It fixes:
 * - repeated `insert into temp_*_seed (...) values` headers in the middle of the file
 * - repeated header rows inside VALUES like `(id, title, ...)`
 * - temp seed `id` -> `external_id`
 * - footer references that still point at `temp_*_seed.id`
 * - `on commit drop` -> `on commit preserve rows`
 * - `pg_get_serial_sequence` footer lines that break on non-serial columns
 *
 * Usage:
 *   node seed_split.js <input_file> [--rows 2000] [--out-dir ./chunks]
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help")) {
  console.log("Usage: node seed_split.js <input_file> [--rows 2000] [--out-dir ./chunks]");
  process.exit(0);
}

const inputFile = args[0];
let rowsPerChunk = 2000;
let outDir = "./chunks";

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--rows" && args[i + 1]) {
    rowsPerChunk = parseInt(args[++i], 10);
  } else if (args[i] === "--out-dir" && args[i + 1]) {
    outDir = args[++i];
  }
}

if (!fs.existsSync(inputFile)) {
  console.error(`ERROR: File not found: ${inputFile}`);
  process.exit(1);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function normalizeWhitespace(str) {
  return str.replace(/\s+/g, " ").trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTopLevelCSV(str) {
  const parts = [];
  let current = "";
  let inQuote = false;
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inQuote) {
      current += ch;
      if (ch === "'") {
        if (i + 1 < str.length && str[i + 1] === "'") {
          current += str[i + 1];
          i++;
        } else {
          inQuote = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inQuote = true;
      current += ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ")") {
      depth--;
      current += ch;
      continue;
    }

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseCreateTempTable(sql) {
  const match = sql.match(
    /create\s+temp\s+table\s+([a-zA-Z0-9_".]+)\s*\(([\s\S]*?)\)\s*on\s+commit\s+(drop|preserve\s+rows)/i
  );

  if (!match) {
    fail("Could not find CREATE TEMP TABLE block.");
  }

  const tableName = match[1];
  const inner = match[2];
  const defs = splitTopLevelCSV(inner);

  const columns = [];
  for (const def of defs) {
    const trimmed = def.trim();
    if (!trimmed) continue;
    if (/^(constraint|primary|unique|foreign|check)\b/i.test(trimmed)) continue;

    const colMatch = trimmed.match(/^"?(?<name>[a-zA-Z_][a-zA-Z0-9_]*)"?\s+/);
    if (colMatch?.groups?.name) {
      columns.push(colMatch.groups.name);
    }
  }

  return { tableName, columns };
}

function parseFirstInsert(sql) {
  const match = sql.match(
    /insert\s+into\s+([a-zA-Z0-9_".]+)\s*(\(([\s\S]*?)\))?\s*values/i
  );

  if (!match) {
    fail("Could not find first INSERT INTO ... VALUES block.");
  }

  const tableName = match[1];
  const rawColumns = match[3];

  let columns = null;
  if (rawColumns) {
    columns = splitTopLevelCSV(rawColumns).map((c) => c.replace(/^"|"$/g, "").trim());
  }

  return { tableName, columns };
}

function stripRepeatedInsertHeaders(sql, tempTableName) {
  const pattern = new RegExp(
    `insert\\s+into\\s+${escapeRegex(tempTableName)}\\s*(\\([\\s\\S]*?\\))?\\s*values`,
    "gi"
  );

  let seen = false;
  return sql.replace(pattern, (match) => {
    if (!seen) {
      seen = true;
      return match;
    }
    return "";
  });
}

function rewriteCreateTempTable(sql, tempTableName, oldIdName = "id", newIdName = "external_id") {
  const pattern = new RegExp(
    `(create\\s+temp\\s+table\\s+${escapeRegex(tempTableName)}\\s*\\()([\\s\\S]*?)(\\)\\s*on\\s+commit\\s+)(drop|preserve\\s+rows)`,
    "i"
  );

  return sql.replace(pattern, (match, open, inner, close) => {
    const rewrittenInner = inner.replace(
      new RegExp(`(^|\\n)(\\s*)"?(?:${escapeRegex(oldIdName)})"?(\\s+)bigint\\b[^,\\n]*(,?)`, "i"),
      `$1$2${newIdName}$3text$4`
    );
    return `${open}${rewrittenInner}${close}preserve rows`;
  });
}

function rewriteFirstInsertHeader(sql, tempTableName, originalColumns) {
  const newColumns = [...originalColumns];
  newColumns[0] = "external_id";

  const prettyCols = `(\n  ${newColumns.join(", ")}\n)`;

  const withColsPattern = new RegExp(
    `insert\\s+into\\s+${escapeRegex(tempTableName)}\\s*\\([\\s\\S]*?\\)\\s*values`,
    "i"
  );

  if (withColsPattern.test(sql)) {
    return sql.replace(
      withColsPattern,
      `insert into ${tempTableName} ${prettyCols}\nvalues`
    );
  }

  const barePattern = new RegExp(
    `insert\\s+into\\s+${escapeRegex(tempTableName)}\\s*values`,
    "i"
  );

  if (barePattern.test(sql)) {
    return sql.replace(
      barePattern,
      `insert into ${tempTableName} ${prettyCols}\nvalues`
    );
  }

  fail("Could not rewrite INSERT header.");
}

function findValuesLineIndex(lines) {
  return lines.findIndex((line) => normalizeWhitespace(line).toLowerCase() === "values");
}

function findLastDataLineIndex(lines, valuesLineIdx) {
  let last = valuesLineIdx;

  for (let i = valuesLineIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("(")) {
      last = i;
    }
  }

  return last;
}

function parseRows(rawBlock) {
  const rows = [];
  let i = 0;
  let rowStart = -1;
  let depth = 0;
  let inQuote = false;

  while (i < rawBlock.length) {
    const ch = rawBlock[i];

    if (rowStart === -1) {
      if (ch === "(") {
        rowStart = i;
        depth = 1;
        inQuote = false;
      }
      i++;
      continue;
    }

    if (inQuote) {
      if (ch === "'") {
        if (i + 1 < rawBlock.length && rawBlock[i + 1] === "'") {
          i += 2;
          continue;
        }
        inQuote = false;
      }
    } else {
      if (ch === "'") {
        inQuote = true;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          rows.push(rawBlock.slice(rowStart, i + 1));
          rowStart = -1;
        }
      }
    }

    i++;
  }

  return rows;
}

function isHeaderLikeRow(row, expectedColumns) {
  const trimmed = row.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return false;

  const inner = trimmed.slice(1, -1).trim();
  const parts = splitTopLevelCSV(inner).map((p) =>
    p.replace(/^"|"$/g, "").trim().toLowerCase()
  );

  if (parts.length !== expectedColumns.length) return false;

  const expected = expectedColumns.map((c) => c.toLowerCase());
  for (let i = 0; i < expected.length; i++) {
    if (parts[i] !== expected[i]) return false;
  }

  return true;
}

function removeHeaderLikeRows(rows, originalColumns) {
  return rows.filter((row) => !isHeaderLikeRow(row, originalColumns));
}

function inferMediaInfo(tempTableName) {
  const lower = tempTableName.toLowerCase();

  if (lower.includes("books")) {
    return {
      publicTable: "books",
      tempTable: tempTableName,
      deletePattern: /delete\s+from\s+public\.books[\s\S]*?analyze\s+public\.books\s*;/i,
      ratingsTable: "book_ratings",
      typeLiteral: "book",
    };
  }

  if (lower.includes("movies")) {
    return {
      publicTable: "movies",
      tempTable: tempTableName,
      deletePattern: /delete\s+from\s+public\.movies[\s\S]*?analyze\s+public\.movies\s*;/i,
      ratingsTable: "movie_ratings",
      typeLiteral: "movie",
    };
  }

  if (lower.includes("tv")) {
    return {
      publicTable: "tv_shows",
      tempTable: tempTableName,
      deletePattern: /delete\s+from\s+public\.tv_shows[\s\S]*?analyze\s+public\.tv_shows\s*;/i,
      ratingsTable: "tv_show_ratings",
      typeLiteral: "tv",
    };
  }

  fail(`Unsupported temp table name: ${tempTableName}`);
}

function buildSafeFooter(info, columns) {
  const publicTable = info.publicTable;
  const tempTable = info.tempTable;

  const nonIdColumns = columns.slice(1);
  const insertColumns = ["external_id", ...nonIdColumns];
  const selectColumns = ["external_id", ...nonIdColumns];

  const updateAssignments = nonIdColumns
    .map((col) => `  ${col} = excluded.${col}`)
    .join(",\n");

  return `insert into public.${publicTable} (
  ${insertColumns.join(",\n  ")}
)
select
  ${selectColumns.join(",\n  ")}
from ${tempTable}
on conflict (external_id) do update
set
${updateAssignments};

delete from public.${publicTable} as target
where target.source_key is not null
  and not exists (
    select 1
    from ${tempTable}
    where ${tempTable}.source_key = target.source_key
  );

analyze public.${publicTable};`;
}

function extractUsefulFooter(originalFooter, tempTableName) {
  let footer = originalFooter;

  footer = footer
    .split(/\r?\n/)
    .filter((line) => !/^\s*select\s+setval\s*\(\s*pg_get_serial_sequence/i.test(line))
    .join("\n");

  footer = footer.replace(
    /update\s+public\.[a-z_]+[\s\S]*?set\s+media_id\s*=\s*temp_[a-z_]+_seed\.[a-z_]+[\s\S]*?;\s*/gi,
    ""
  );

  footer = footer.replace(
    /with\s+remapped\s+as\s*\([\s\S]*?\)\s*delete\s+from\s+public\.[a-z_]+[\s\S]*?;\s*/gi,
    ""
  );

  footer = footer.replace(
    /insert\s+into\s+public\.[a-z_]+[\s\S]*?on\s+conflict[\s\S]*?;\s*/gi,
    ""
  );

  footer = footer.replace(
    /delete\s+from\s+public\.[a-z_]+[\s\S]*?analyze\s+public\.[a-z_]+\s*;\s*/gi,
    ""
  );

  footer = footer.replace(
    new RegExp(`${escapeRegex(tempTableName)}\\.id\\b`, "g"),
    `${tempTableName}.external_id`
  );

  return footer.trim();
}

console.log(`Reading ${inputFile} ...`);
let sql = fs.readFileSync(inputFile, "utf8");

// Remove duplicated INSERT headers before any structural parsing.
const initialTempInfo = parseCreateTempTable(sql);
sql = stripRepeatedInsertHeaders(sql, initialTempInfo.tableName);

const tempInfo = parseCreateTempTable(sql);
const insertInfo = parseFirstInsert(sql);

const tempTableName = tempInfo.tableName;
const insertColumns = insertInfo.columns || tempInfo.columns;

if (!insertColumns || insertColumns.length === 0) {
  fail("Could not determine seed columns.");
}

const info = inferMediaInfo(tempTableName);

// Rewrite top section.
sql = rewriteCreateTempTable(sql, tempTableName, insertColumns[0], "external_id");
sql = rewriteFirstInsertHeader(sql, tempTableName, insertColumns);

// Split into lines after rewrite.
const lines = sql.split(/\r?\n/);
const valuesLineIdx = findValuesLineIndex(lines);
if (valuesLineIdx === -1) {
  fail("Could not find VALUES line after rewrite.");
}

const lastDataLineIdx = findLastDataLineIndex(lines, valuesLineIdx);
console.log(`  Data rows span lines ${valuesLineIdx + 2} to ${lastDataLineIdx + 1}`);

// Parse rows.
console.log("Parsing rows...");
const dataLines = lines.slice(valuesLineIdx + 1, lastDataLineIdx + 1);
const rawBlock = dataLines.join("\n");
const parsedRows = parseRows(rawBlock);

if (parsedRows.length === 0) {
  fail("No rows parsed.");
}

const cleanedRows = removeHeaderLikeRows(parsedRows, insertColumns);
const removed = parsedRows.length - cleanedRows.length;

console.log(`  Parsed ${parsedRows.length.toLocaleString()} rows.`);
if (removed > 0) {
  console.log(`  Removed ${removed.toLocaleString()} duplicated header row(s).`);
}

// Rebuild header from rewritten lines up to VALUES.
const headerText = lines.slice(0, valuesLineIdx + 1).join("\n");

// Build footer.
const originalFooter = lines.slice(lastDataLineIdx + 1).join("\n");
const preservedFooter = extractUsefulFooter(originalFooter, tempTableName);
const safeFooter = buildSafeFooter(info, insertColumns);

const finalFooter = preservedFooter
  ? `${preservedFooter}\n\n${safeFooter}\n\ncommit;`
  : `${safeFooter}\n\ncommit;`;

// Write chunks.
fs.mkdirSync(outDir, { recursive: true });

const baseName = path.basename(inputFile, path.extname(inputFile));
const totalChunks = Math.ceil(cleanedRows.length / rowsPerChunk);
const pad = String(totalChunks).length;

for (let chunk = 0; chunk < totalChunks; chunk++) {
  const chunkRows = cleanedRows.slice(chunk * rowsPerChunk, (chunk + 1) * rowsPerChunk);
  const chunkNum = String(chunk + 1).padStart(pad, "0");
  const outPath = path.join(outDir, `${baseName}_chunk_${chunkNum}.sql`);

  const out = [];
  out.push(`-- Chunk ${chunk + 1} of ${totalChunks} (${chunkRows.length.toLocaleString()} rows)`);
  out.push(headerText);

  for (let r = 0; r < chunkRows.length; r++) {
    const suffix = r < chunkRows.length - 1 ? "," : ";";
    out.push(`  ${chunkRows[r]}${suffix}`);
  }

  out.push(finalFooter);

  fs.writeFileSync(outPath, out.join("\n"), "utf8");
  console.log(`  Wrote ${outPath} (${chunkRows.length.toLocaleString()} rows)`);
}

console.log(`\nDone! ${totalChunks} files written to '${outDir}/'`);
console.log("Run them in order inside the Supabase SQL editor.");