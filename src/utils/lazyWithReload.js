import { lazy } from 'react';

// After a deploy, a tab that was already open asks for the old build's page
// scripts, which no longer exist. Instead of a blank page, reload once to get
// the new build (at most once a minute, so a real outage can't loop).
const KEY = 'binge:chunkReloadAt';

export function isChunkLoadError(error) {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unexpected token '<'/i
    .test(`${error?.name || ''} ${error?.message || error || ''}`);
}

export function reloadForNewBuild(storage = window.sessionStorage, reload = () => window.location.reload(), now = Date.now()) {
  let last = 0;
  try { last = Number(storage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
  if (now - last < 60_000) return false;
  try { storage.setItem(KEY, String(now)); } catch { /* storage blocked */ }
  reload();
  return true;
}

export default function lazyWithReload(load) {
  return lazy(() => load().catch((error) => {
    if (isChunkLoadError(error) && reloadForNewBuild()) return new Promise(() => {}); // the page is reloading
    throw error;
  }));
}
