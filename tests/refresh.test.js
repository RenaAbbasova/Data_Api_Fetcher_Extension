import { describe, expect, it, vi } from 'vitest';
import { ShapeError } from '../src/apis.js';
import { createCache } from '../src/cache.js';
import { createRefresher, MIN_FORCE_INTERVAL_MS } from '../src/refresh.js';
import { createStorageArea } from './helpers/fake-chrome.js';

const apis = ['a', 'b', 'c'].map((id) => ({ id, url: `https://${id}.test/`, parse: (d) => ({ id: d.id }) }));

function setup({ online = true, fetchJson } = {}) {
  let time = 10_000_000;
  const cache = createCache(createStorageArea(), () => time);
  const fetch = fetchJson ?? vi.fn(async (url) => ({ id: url.slice(8, 9) }));
  const state = { online };
  const refresher = createRefresher({ apis, fetchJson: fetch, cache, now: () => time, isOnline: () => state.online });
  return { cache, fetch, refresher, state, tick: (ms) => { time += ms; } };
}

describe('refresher', () => {
  it('fetches everything the first time, then nothing while the data is fresh', async () => {
    const { refresher, fetch, tick } = setup();
    expect((await refresher.refresh()).refreshed).toEqual(['a', 'b', 'c']);
    expect(fetch).toHaveBeenCalledTimes(3);
    tick(5 * 60_000);
    expect((await refresher.refresh()).skipped).toEqual(['a', 'b', 'c']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fetches again once the data is older than 15 minutes', async () => {
    const { refresher, fetch, tick } = setup();
    await refresher.refresh();
    tick(16 * 60_000);
    await refresher.refresh();
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('a forced refresh is throttled: pressing again within 10 seconds does nothing', async () => {
    const { refresher, fetch, tick } = setup();
    await refresher.refresh({ force: true });
    tick(MIN_FORCE_INTERVAL_MS - 1);
    expect((await refresher.refresh({ force: true })).skipped).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    tick(2);
    await refresher.refresh({ force: true });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('offline: fetches nothing, keeps the saved data and records why', async () => {
    const { refresher, fetch, cache, state, tick } = setup();
    await refresher.refresh();
    tick(20 * 60_000);
    state.online = false;
    const summary = await refresher.refresh();
    expect(summary.failed).toEqual(['a', 'b', 'c']);
    expect(fetch).toHaveBeenCalledTimes(3);
    const entry = (await cache.getAll()).a;
    expect(entry.value).toEqual({ id: 'a' });
    expect(entry.error).toMatchObject({ type: 'offline' });
  });

  it('fetches the three APIs in parallel, with no artificial delay', async () => {
    let running = 0;
    let peak = 0;
    const fetchJson = vi.fn(async (url) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running--; return { id: url[8] }; });
    await setup({ fetchJson }).refresher.refresh();
    expect(peak).toBe(3);
  });

  it('simultaneous calls (popup + alarm) share ONE refresh', async () => {
    const { refresher, fetch } = setup();
    const [one, two] = await Promise.all([refresher.refresh(), refresher.refresh({ force: true })]);
    expect(one).toBe(two);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('one failing API does not stop the others, and keeps its own last good data', async () => {
    const { refresher, cache, fetch, tick } = setup();
    await refresher.refresh();
    tick(20 * 60_000);
    fetch.mockImplementation(async (url) => { if (url.includes('b.test')) throw Object.assign(new Error('x'), { type: 'http' }); return { id: url[8] }; });
    const summary = await refresher.refresh();
    expect(summary).toMatchObject({ refreshed: ['a', 'c'], failed: ['b'] });
    expect((await cache.getAll()).b.value).toEqual({ id: 'b' });
  });

  it('an unexpected answer (ShapeError) is recorded and keeps the last good data', async () => {
    const shaped = [{ id: 'a', url: 'https://a.test/', parse: () => { throw new ShapeError('Unexpected answer: email is missing'); } }];
    const cache = createCache(createStorageArea());
    await cache.recordSuccess('a', { email: 'old@example.com' });
    const refresher = createRefresher({ apis: shaped, fetchJson: async () => ({}), cache, now: () => Date.now() + 99 * 60_000 });
    await refresher.refresh();
    const entry = (await cache.getAll()).a;
    expect(entry.value).toEqual({ email: 'old@example.com' });
    expect(entry.error).toEqual({ type: 'unexpected_answer', message: 'Unexpected answer: email is missing' });
  });
});
