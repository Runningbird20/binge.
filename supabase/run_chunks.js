#!/usr/bin/env node
/**
 * run_chunks.js
 *
 * Runs Supabase SQL chunk files sequentially using:
 *   npm run supabase:sql -- <file>
 *
 * Usage:
 *   node run_chunks.js --start 27 --end 40 --dir supabase/chunks/movies --base repeatable_movies_seed_chunk_
 *
 * Optional:
 *   --pad 2        (zero padding, e.g., 01, 02)
 *   --delay 1000   (ms delay between runs)
 */

const { spawn } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);

let start = 28;
let end = 40;
let dir = "supabase/chunks/movies";
let base = "repeatable_movies_seed_chunk_";
let pad = 2;
let delay = 1000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--start") start = parseInt(args[++i], 10);
  else if (args[i] === "--end") end = parseInt(args[++i], 10);
  else if (args[i] === "--dir") dir = args[++i];
  else if (args[i] === "--base") base = args[++i];
  else if (args[i] === "--pad") pad = parseInt(args[++i], 10);
  else if (args[i] === "--delay") delay = parseInt(args[++i], 10);
}

if (start === null || end === null || !dir || !base) {
  console.error(`
Usage:
  node run_chunks.js --start <num> --end <num> --dir <folder> --base <filename_prefix>

Example:
  node run_chunks.js --start 27 --end 40 --dir supabase/chunks/movies --base repeatable_movies_seed_chunk_
`);
  process.exit(1);
}

function formatNumber(n) {
  if (pad > 0) {
    return String(n).padStart(pad, "0");
  }
  return String(n);
}

function runCommand(filePath) {
  return new Promise((resolve, reject) => {
    console.log(`\nRunning: ${filePath}`);

    const child = spawn("npm", ["run", "supabase:sql", "--", filePath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`Finished: ${filePath}`);
        resolve();
      } else {
        console.error(`Failed: ${filePath} (exit code ${code})`);
        reject(new Error(`Command failed: ${filePath}`));
      }
    });
  });
}

async function run() {
  for (let i = start; i <= end; i++) {
    const num = formatNumber(i);
    const fileName = `${base}${num}.sql`;
    const filePath = path.join(dir, fileName);

    try {
      await runCommand(filePath);
    } catch (err) {
      console.error("\nStopping due to error.");
      process.exit(1);
    }

    if (delay > 0 && i < end) {
      console.log(`Waiting ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  console.log("\nAll chunks completed successfully.");
}

run();