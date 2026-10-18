#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const INPUT_ROOT = path.join(__dirname, '..', 'supabase', 'chunks');
const OUTPUT_ROOT = path.join(__dirname, '..', 'supabase', 'chunks_safe');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rewriteChunkSql(sql) {
  return sql
    .replace(
      /delete from public\.movies as target[\s\S]*?analyze public\.movies;\s*/g,
      '-- Non-destructive chunk import: table cleanup is intentionally skipped for chunked uploads.\n'
    )
    .replace(
      /delete from public\.tv_shows as target[\s\S]*?analyze public\.tv_shows;\s*/g,
      '-- Non-destructive chunk import: table cleanup is intentionally skipped for chunked uploads.\n'
    );
}

function processDirectory(relativeDir) {
  const inputDir = path.join(INPUT_ROOT, relativeDir);
  const outputDir = path.join(OUTPUT_ROOT, relativeDir);
  ensureDir(outputDir);

  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  let processedCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      processedCount += processDirectory(path.join(relativeDir, entry.name));
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.sql') {
      continue;
    }

    const inputPath = path.join(inputDir, entry.name);
    const outputPath = path.join(outputDir, entry.name);
    const originalSql = fs.readFileSync(inputPath, 'utf8');
    const safeSql = rewriteChunkSql(originalSql);
    fs.writeFileSync(outputPath, safeSql, 'utf8');
    processedCount += 1;
  }

  return processedCount;
}

function main() {
  if (!fs.existsSync(INPUT_ROOT)) {
    throw new Error(`Chunk directory not found: ${INPUT_ROOT}`);
  }

  ensureDir(OUTPUT_ROOT);
  const processedCount = processDirectory('');
  console.log(`Generated ${processedCount} non-destructive chunk file(s) in ${OUTPUT_ROOT}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
