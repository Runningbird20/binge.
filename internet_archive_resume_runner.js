const fs = require('fs');
const path = require('path');
const { collectInternetArchiveBooksBulk } = require('./internet_archive_scraper');

const DEFAULT_CHECKPOINT = path.join(__dirname, 'data', 'internet_archive_books.bulk.checkpoint.json');
const DEFAULT_OUTPUT = path.join(__dirname, 'data', 'internet_archive_books.bulk.jsonl');
const DEFAULT_PID_FILE = path.join(__dirname, 'data', 'internet_archive_books.runner.pid');
const DEFAULT_DELAY_MS = 1500;
const MAX_BACKOFF_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    checkpoint: DEFAULT_CHECKPOINT,
    output: DEFAULT_OUTPUT,
    pidFile: DEFAULT_PID_FILE,
    delayMs: DEFAULT_DELAY_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--checkpoint':
        options.checkpoint = argv[index + 1] || options.checkpoint;
        index += 1;
        break;
      case '--output':
        options.output = argv[index + 1] || options.output;
        index += 1;
        break;
      case '--pid-file':
        options.pidFile = argv[index + 1] || options.pidFile;
        index += 1;
        break;
      case '--delay-ms':
        options.delayMs = Number(argv[index + 1]) || options.delayMs;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function totalPagesFor(checkpoint) {
  const totalAvailable = Number(checkpoint?.totalAvailable);
  const pageSize = Number(checkpoint?.pageSize);
  if (!Number.isFinite(totalAvailable) || !Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }

  return Math.ceil(totalAvailable / pageSize);
}

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePidFile(pidFile) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(
    pidFile,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function clearPidFile(pidFile) {
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {
    // best effort cleanup
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const checkpointPath = path.resolve(options.checkpoint);
  const outputPath = path.resolve(options.output);
  const pidFilePath = path.resolve(options.pidFile);
  const existingPidRecord = readJsonIfExists(pidFilePath);

  if (existingPidRecord?.pid && isProcessRunning(Number(existingPidRecord.pid))) {
    console.log(
      `Archive resume runner is already active with PID ${existingPidRecord.pid}.`
    );
    return;
  }

  writePidFile(pidFilePath);

  const shutdown = () => {
    clearPidFile(pidFilePath);
  };

  process.on('exit', shutdown);
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  let consecutiveFailures = 0;

  while (true) {
    const checkpoint = readJsonIfExists(checkpointPath);
    const totalPages = totalPagesFor(checkpoint);
    if (checkpoint?.nextPage && totalPages && Number(checkpoint.nextPage) > totalPages) {
      console.log(
        `[${new Date().toISOString()}] Archive crawl complete at page ${totalPages}.`
      );
      break;
    }

    try {
      const processedPages = Number(checkpoint?.processedPages) || 0;
      const result = await collectInternetArchiveBooksBulk({
        output: outputPath,
        checkpoint: checkpointPath,
        resume: true,
        maxPages: processedPages + 1,
        pageSize: Number(checkpoint?.pageSize) || 25,
        query: checkpoint?.query,
        sort: checkpoint?.sort,
        enrichMetadata: checkpoint?.enrichMetadata ?? true,
      });

      consecutiveFailures = 0;
      const totalPagesAfterRun =
        Math.ceil(result.totalAvailable / (Number(checkpoint?.pageSize) || 25));
      console.log(
        `[${new Date().toISOString()}] Finished page ${result.nextPage - 1}. ` +
          `Processed ${result.processedPages}/${totalPagesAfterRun} page(s), ` +
          `collected ${result.collected} books so far.`
      );

      if (result.nextPage > totalPagesAfterRun) {
        console.log(
          `[${new Date().toISOString()}] Archive crawl complete. Output at ${outputPath}.`
        );
        break;
      }

      await sleep(options.delayMs);
    } catch (error) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(options.delayMs * Math.max(consecutiveFailures, 1), MAX_BACKOFF_MS);
      console.error(
        `[${new Date().toISOString()}] Page run failed (${consecutiveFailures} consecutive): ${
          error?.stack || error?.message || error
        }`
      );
      await sleep(backoffMs);
    }
  }

  clearPidFile(pidFilePath);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
