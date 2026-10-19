import { isFresh, TTL_MS } from './cache.js';

/** A manual "refresh" pressed again within this time does nothing: these free APIs rate-limit aggressively. */
export const MIN_FORCE_INTERVAL_MS = 10_000;

/**
 * Decides what to fetch and keeps the cache up to date.
 *  - fresh data is not fetched again (unless forced, and then at most every MIN_FORCE_INTERVAL_MS)
 *  - offline: nothing is fetched and the saved data is untouched
 *  - the APIs are different servers, so they are fetched in parallel (no artificial delays)
 *  - simultaneous calls (popup + alarm) share one refresh instead of doubling the requests
 */
export function createRefresher({ apis, fetchJson, cache, now = () => Date.now(), isOnline = () => true, ttlMs = TTL_MS, minForceIntervalMs = MIN_FORCE_INTERVAL_MS }) {
  let inFlight = null;

  async function run(force) {
    const entries = await cache.getAll();
    const t = now();
    const summary = { refreshed: [], failed: [], skipped: [] };

    const due = apis.filter((api) => {
      const entry = entries[api.id];
      if (!force) return !isFresh(entry, t, ttlMs);
      return !(entry?.attemptedAt && t - entry.attemptedAt < minForceIntervalMs);
    });
    summary.skipped = apis.filter((api) => !due.includes(api)).map((api) => api.id);

    if (!isOnline()) {
      await Promise.all(due.map((api) => cache.recordFailure(api.id, { type: 'offline', message: 'You are offline' })));
      summary.failed = due.map((api) => api.id);
      return summary;
    }

    await Promise.all(
      due.map(async (api) => {
        try {
          const value = api.parse(await fetchJson(api.url));
          await cache.recordSuccess(api.id, value);
          summary.refreshed.push(api.id);
        } catch (error) {
          await cache.recordFailure(api.id, error);
          summary.failed.push(api.id);
        }
      }),
    );
    return summary;
  }

  return {
    refresh({ force = false } = {}) {
      if (!inFlight) inFlight = run(force).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
