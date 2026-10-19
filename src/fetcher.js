/**
 * Fetches JSON with a timeout, a size limit and a polite retry policy.
 *
 * - Only "slow down" answers (HTTP 429 and 503) are retried, honouring the Retry-After header,
 *   at most twice. A lost connection or a timeout is reported at once instead of being retried.
 * - Every failure is a FetchError with a type the interface can show.
 */

export class FetchError extends Error {
  constructor(type, message, status) {
    super(message);
    this.name = 'FetchError';
    this.type = type; // 'network' | 'timeout' | 'http' | 'invalid_json' | 'too_large'
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_BYTES = 200_000;

/** Retry-After can be a number of seconds or a date. Returns milliseconds, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export async function fetchJson(url, options = {}) {
  const {
    fetchFn = (...args) => fetch(...args),
    timeoutMs = 8000,
    retries = 2,
    sleep = defaultSleep,
    maxRetryAfterMs = 10_000,
  } = options;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') throw new FetchError('timeout', `No answer after ${Math.round(timeoutMs / 1000)} seconds`);
      throw new FetchError('network', 'Could not reach the server');
    }

    try {
      if (!response.ok) {
        const retryable = response.status === 429 || response.status === 503;
        if (retryable && attempt < retries) {
          const asked = parseRetryAfter(response.headers?.get?.('Retry-After'));
          await sleep(Math.min(asked ?? 1000 * 2 ** attempt, maxRetryAfterMs));
          continue;
        }
        throw new FetchError('http', `The server answered HTTP ${response.status}`, response.status);
      }
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new FetchError('too_large', 'The answer is too large');
      try {
        return JSON.parse(text);
      } catch {
        throw new FetchError('invalid_json', 'The answer is not valid JSON');
      }
    } catch (error) {
      if (error instanceof FetchError) throw error;
      if (error?.name === 'AbortError') throw new FetchError('timeout', `No answer after ${Math.round(timeoutMs / 1000)} seconds`);
      throw new FetchError('network', 'Could not read the answer');
    } finally {
      clearTimeout(timer);
    }
  }
}
