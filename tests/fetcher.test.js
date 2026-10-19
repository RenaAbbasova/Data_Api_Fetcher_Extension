import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchError, fetchJson, parseRetryAfter } from '../src/fetcher.js';

const ok = (body) => ({ ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: new Headers() });
const status = (code, headers = {}) => ({ ok: false, status: code, text: async () => '', headers: new Headers(headers) });

afterEach(() => vi.useRealTimers());

describe('fetchJson', () => {
  it('returns the parsed JSON and asks for JSON without credentials', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ a: 1 }));
    expect(await fetchJson('https://x.test/', { fetchFn })).toEqual({ a: 1 });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers.Accept).toBe('application/json');
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not retry an ordinary HTTP error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(status(404));
    await expect(fetchJson('https://x.test/', { fetchFn })).rejects.toMatchObject({ type: 'http', status: 404 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries HTTP 429 after the time the server asks for, then succeeds', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(status(429, { 'Retry-After': '2' })).mockResolvedValueOnce(ok({ done: true }));
    const sleep = vi.fn().mockResolvedValue();
    expect(await fetchJson('https://x.test/', { fetchFn, sleep })).toEqual({ done: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially without a Retry-After header and gives up after 2 retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(status(503));
    const sleep = vi.fn().mockResolvedValue();
    await expect(fetchJson('https://x.test/', { fetchFn, sleep })).rejects.toMatchObject({ type: 'http', status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('never waits more than 10 seconds, whatever the server asks', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(status(429, { 'Retry-After': '3600' })).mockResolvedValueOnce(ok({}));
    const sleep = vi.fn().mockResolvedValue();
    await fetchJson('https://x.test/', { fetchFn, sleep });
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('parses Retry-After as seconds or as a date', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(10_000);
    expect(parseRetryAfter('nonsense')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('reports a lost connection at once, without retrying', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchJson('https://x.test/', { fetchFn })).rejects.toMatchObject({ type: 'network' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const pending = fetchJson('https://x.test/', { fetchFn, timeoutMs: 8000 });
    const caught = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await caught).toMatchObject({ type: 'timeout' });
  });

  it('rejects invalid JSON and oversized answers', async () => {
    await expect(fetchJson('https://x.test/', { fetchFn: async () => ok('<html>') })).rejects.toMatchObject({ type: 'invalid_json' });
    await expect(fetchJson('https://x.test/', { fetchFn: async () => ok('"' + 'x'.repeat(250_000) + '"') })).rejects.toMatchObject({ type: 'too_large' });
    expect(new FetchError('http', 'm', 500)).toBeInstanceOf(Error);
  });
});
