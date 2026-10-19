/**
 * The cache keeps, for every API, the LAST GOOD value. A failed refresh never erases it:
 * it only records that the attempt failed.
 *
 *   entry = { value, fetchedAt, attemptedAt, error }
 *   value     the last good, already validated data (or null if there has never been one)
 *   fetchedAt when that value was fetched
 *   error     { type, message } of the last attempt, or null if it worked
 */

export const CACHE_KEY = 'cache';
export const TTL_MS = 15 * 60 * 1000;
/** Keys written by version 1, removed on update. */
export const LEGACY_KEYS = ['Random User', 'JSON Placeholder Posts', 'Trivia Question'];

export function createCache(area, now = () => Date.now()) {
  let queue = Promise.resolve(); // writes happen one after another, so parallel refreshes cannot overwrite each other

  async function getAll() {
    const stored = await area.get(CACHE_KEY);
    const all = stored?.[CACHE_KEY];
    return all && typeof all === 'object' ? all : {};
  }

  function update(id, change) {
    const run = async () => {
      const all = await getAll();
      all[id] = change(all[id] ?? { value: null, fetchedAt: null, attemptedAt: null, error: null });
      await area.set({ [CACHE_KEY]: all });
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    getAll,
    recordSuccess: (id, value) => update(id, () => ({ value, fetchedAt: now(), attemptedAt: now(), error: null })),
    recordFailure: (id, error) =>
      update(id, (entry) => ({ ...entry, attemptedAt: now(), error: { type: error?.type ?? 'unknown', message: String(error?.message ?? 'Unknown error').slice(0, 200) } })),
  };
}

/** True when the last good value is younger than the TTL and the last attempt did not fail. */
export function isFresh(entry, now = Date.now(), ttlMs = TTL_MS) {
  return Boolean(entry && entry.value && !entry.error && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < ttlMs);
}
