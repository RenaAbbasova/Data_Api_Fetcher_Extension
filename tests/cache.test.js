import { describe, expect, it } from 'vitest';
import { CACHE_KEY, createCache, isFresh, TTL_MS } from '../src/cache.js';
import { createStorageArea } from './helpers/fake-chrome.js';

const setup = (t = 1_000_000) => {
  const area = createStorageArea();
  let time = t;
  const cache = createCache(area, () => time);
  return { area, cache, tick: (ms) => { time += ms; } };
};

describe('cache', () => {
  it('stores a good value with the time it was fetched', async () => {
    const { cache } = setup();
    await cache.recordSuccess('a', { name: 'Ada' });
    expect((await cache.getAll()).a).toEqual({ value: { name: 'Ada' }, fetchedAt: 1_000_000, attemptedAt: 1_000_000, error: null });
  });

  it('a failed refresh KEEPS the last good value and only records the error', async () => {
    const { cache, tick } = setup();
    await cache.recordSuccess('a', { name: 'Ada' });
    tick(60_000);
    await cache.recordFailure('a', { type: 'network', message: 'Could not reach the server' });
    const entry = (await cache.getAll()).a;
    expect(entry.value).toEqual({ name: 'Ada' });
    expect(entry.fetchedAt).toBe(1_000_000);
    expect(entry.attemptedAt).toBe(1_060_000);
    expect(entry.error).toEqual({ type: 'network', message: 'Could not reach the server' });
  });

  it('a later success clears the error', async () => {
    const { cache } = setup();
    await cache.recordFailure('a', { type: 'network', message: 'x' });
    await cache.recordSuccess('a', { n: 1 });
    expect((await cache.getAll()).a.error).toBeNull();
  });

  it('a failure with no previous value leaves value null', async () => {
    const { cache } = setup();
    await cache.recordFailure('a', new Error('boom'));
    expect((await cache.getAll()).a).toMatchObject({ value: null, fetchedAt: null, error: { type: 'unknown', message: 'boom' } });
  });

  it('truncates long error messages', async () => {
    const { cache } = setup();
    await cache.recordFailure('a', { type: 'x', message: 'm'.repeat(1000) });
    expect((await cache.getAll()).a.error.message).toHaveLength(200);
  });

  it('parallel writes do not overwrite each other', async () => {
    const { cache } = setup();
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => cache.recordSuccess(id, { id })));
    expect(Object.keys(await cache.getAll()).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('survives corrupted storage', async () => {
    const { area, cache } = setup();
    area.data[CACHE_KEY] = 'garbage';
    expect(await cache.getAll()).toEqual({});
    await cache.recordSuccess('a', { n: 1 });
    expect((await cache.getAll()).a.value).toEqual({ n: 1 });
  });
});

describe('isFresh', () => {
  const entry = (over = {}) => ({ value: { n: 1 }, fetchedAt: 1000, attemptedAt: 1000, error: null, ...over });
  it('is fresh before the TTL and stale after it', () => {
    expect(isFresh(entry(), 1000 + TTL_MS - 1)).toBe(true);
    expect(isFresh(entry(), 1000 + TTL_MS)).toBe(false);
  });
  it('is never fresh without a value or after a failed attempt', () => {
    expect(isFresh(undefined)).toBe(false);
    expect(isFresh(entry({ value: null }), 1001)).toBe(false);
    expect(isFresh(entry({ error: { type: 'network', message: 'x' } }), 1001)).toBe(false);
  });
});
