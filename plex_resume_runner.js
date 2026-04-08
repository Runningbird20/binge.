const fs = require('fs');
const path = require('path');
const {
  collectPlexResultsBulk,
  getPlexPathDefaults,
  readCheckpoint,
} = require('./plex_importer');

const DEFAULT_DELAY_MS = 1500;
const DEFAULT_MAX_ITEMS = 25;
const MAX_BACKOFF_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function appendLogLine(logFile, message) {
  if (!logFile) return;

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${message}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = {
    type: 'movie',
    output: null,
    checkpoint: null,
    pidFile: null,
    logFile: null,
    delayMs: DEFAULT_DELAY_MS,
    maxItems: DEFAULT_MAX_ITEMS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--type':
        options.type = argv[index + 1] || options.type;
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
      case '--pid-file':
        options.pidFile = argv[index + 1] || options.pidFile;
        index += 1;
        break;
      case '--log-file':
        options.logFile = argv[index + 1] || options.logFile;
        index += 1;
        break;
      case '--delay-ms':
        options.delayMs = Number(argv[index + 1]) || options.delayMs;
        index += 1;
        break;
      case '--max-items':
        options.maxItems = Number(argv[index + 1]) || options.maxItems;
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
  console.log(`Plex resume runner

Usage:
  node plex_resume_runner.js --type movie
  node plex_resume_runner.js --type tv --max-items 50

Options:
  --type <movie|tv>          Which Plex catalog to keep resuming
  --output <path>            Override the JSONL output path
  --checkpoint <path>        Override the checkpoint path
  --pid-file <path>          Override the runner pid file path
  --log-file <path>          Override the runner log file path
  --delay-ms <number>        Delay between resume passes (default: 1500)
  --max-items <number>       Titles to process per resume pass (default: 25)
`);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!['movie', 'tv'].includes(options.type)) {
    throw new Error('plex_resume_runner.js only supports --type movie or --type tv.');
  }

  const defaults = getPlexPathDefaults(options.type);
  const outputPath = path.resolve(options.output || defaults.bulkOutput);
  const checkpointPath = path.resolve(options.checkpoint || defaults.checkpoint);
  const pidFilePath = path.resolve(options.pidFile || defaults.pidFile);
  const logFilePath = path.resolve(options.logFile || defaults.logFile);
  const existingPidRecord = readCheckpoint(pidFilePath);
  const log = (message) => {
    console.log(message);
    appendLogLine(logFilePath, message);
  };
  const logError = (message) => {
    console.error(message);
    appendLogLine(logFilePath, message);
  };

  if (existingPidRecord?.pid && isProcessRunning(Number(existingPidRecord.pid))) {
    log(`Plex ${options.type} resume runner is already active with PID ${existingPidRecord.pid}.`);
    return;
  }

  writePidFile(pidFilePath);
  appendLogLine(logFilePath, `[${new Date().toISOString()}] Starting Plex ${options.type} resume runner.`);

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
    const checkpoint = readCheckpoint(checkpointPath);
    const totalPages = Number(checkpoint?.totalPages) || null;
    if (checkpoint?.nextPage && totalPages && Number(checkpoint.nextPage) > totalPages) {
      log(`[${new Date().toISOString()}] Plex ${options.type} crawl complete at page ${totalPages}.`);
      break;
    }

    try {
      const result = await collectPlexResultsBulk({
        mediaType: options.type,
        output: outputPath,
        checkpoint: checkpointPath,
        resume: true,
        maxPages: Number.POSITIVE_INFINITY,
        maxItems: options.maxItems,
        delayMs: 0,
      });

      consecutiveFailures = 0;
      log(
        `[${new Date().toISOString()}] Processed ${result.itemsProcessedThisRun} ${options.type} title(s) in this pass. ` +
          `Completed ${result.processedPages}/${result.totalPages || '?'} catalog page(s), next page ${result.nextPage}.`
      );

      if (result.complete) {
        log(
          `[${new Date().toISOString()}] Plex ${options.type} crawl complete. Output at ${outputPath}.`
        );
        break;
      }

      await sleep(options.delayMs);
    } catch (error) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(options.delayMs * Math.max(consecutiveFailures, 1), MAX_BACKOFF_MS);
      logError(
        `[${new Date().toISOString()}] Plex ${options.type} resume pass failed (${consecutiveFailures} consecutive): ${
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
