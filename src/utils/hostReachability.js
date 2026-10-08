// Some networks (school / office firewalls) block specific embed domains
// at DNS — e.g. on a Palo Alto-filtered network PPV's only embed host,
// embedindia.st, resolves to a sinkhole, so its player shows "Unable to
// load stream… DNS block". We can't (and don't) route around a network's
// filtering, but we can notice it: a no-cors request to a blocked host
// fails at the network level, while a reachable one resolves (opaquely).
// Unreachable servers are then skipped and labelled instead of being tried.

const cache = new Map(); // host -> Promise<boolean>
const PROBE_TIMEOUT_MS = 4000;

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

export function isHostReachable(host) {
  if (!host) return Promise.resolve(true);
  if (cache.has(host)) return cache.get(host);
  const probe = (async () => {
    try {
      await fetch(`https://${host}/favicon.ico?binge-probe=${Date.now()}`, {
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return true;
    } catch (error) {
      // A timeout is inconclusive (slow host, not blocked) — treat as reachable.
      return error?.name === 'TimeoutError';
    }
  })();
  cache.set(host, probe);
  return probe;
}

// { host: boolean } for a list of hosts, probed in parallel.
export async function reachabilityMap(hosts) {
  const unique = [...new Set(hosts.filter(Boolean))];
  const results = await Promise.all(unique.map((host) => isHostReachable(host)));
  return Object.fromEntries(unique.map((host, index) => [host, results[index]]));
}
