import { describe, expect, it, vi } from 'vitest';
import { LEGACY_KEYS } from '../src/cache.js';
import { ALARM_NAME, REFRESH_EVERY_MINUTES, setupBackground } from '../src/background-setup.js';
import { createFakeChrome } from './helpers/fake-chrome.js';

function setup(options) {
  const fake = createFakeChrome(options);
  const refresher = { refresh: vi.fn().mockResolvedValue({ refreshed: [], failed: [], skipped: [] }) };
  setupBackground({ chrome: fake.chrome, refresher });
  return { ...fake, refresher };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('service worker', () => {
  it('does NOT fetch anything just because it woke up', async () => {
    const { refresher } = setup();
    await flush();
    expect(refresher.refresh).not.toHaveBeenCalled();
  });

  it('creates the 15-minute alarm when it is missing', async () => {
    const { chrome } = setup();
    await flush();
    expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
    expect(chrome.alarms.create).toHaveBeenCalledWith(ALARM_NAME, { delayInMinutes: REFRESH_EVERY_MINUTES, periodInMinutes: REFRESH_EVERY_MINUTES });
  });

  it('does NOT recreate an alarm that already exists (that would restart its 15-minute wait)', async () => {
    const { chrome, handlers } = setup({ alarms: { [ALARM_NAME]: { name: ALARM_NAME, periodInMinutes: 15 } } });
    await flush();
    await handlers.startup();
    await handlers.installed({ reason: 'chrome_update' });
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('on install it ensures the alarm and fetches', async () => {
    const { handlers, refresher } = setup();
    await handlers.installed({ reason: 'install' });
    expect(refresher.refresh).toHaveBeenCalledWith({ force: true });
  });

  it('on update it also removes the keys written by version 1', async () => {
    const { chrome, handlers } = setup();
    await chrome.storage.local.set(Object.fromEntries(LEGACY_KEYS.map((k) => [k, { old: true }])));
    await chrome.storage.local.set({ cache: { keep: true } });
    await handlers.installed({ reason: 'update' });
    expect(Object.keys(await chrome.storage.local.get(null))).toEqual(['cache']);
  });

  it('on browser start it refreshes only what is stale', async () => {
    const { handlers, refresher } = setup();
    await handlers.startup();
    expect(refresher.refresh).toHaveBeenCalledWith();
  });

  it('the alarm triggers a refresh; other alarms are ignored', () => {
    const { handlers, refresher } = setup();
    handlers.alarm({ name: 'something-else' });
    expect(refresher.refresh).not.toHaveBeenCalled();
    handlers.alarm({ name: ALARM_NAME });
    expect(refresher.refresh).toHaveBeenCalledWith({ force: true });
  });

  describe('messages from the popup', () => {
    const own = { id: 'our-extension-id' };

    it('answers a refresh request with its summary', async () => {
      const { handlers, refresher } = setup();
      const reply = vi.fn();
      expect(handlers.message({ type: 'refresh', force: true }, own, reply)).toBe(true); // keeps the channel open for the answer
      await flush();
      expect(refresher.refresh).toHaveBeenCalledWith({ force: true });
      expect(reply).toHaveBeenCalledWith({ ok: true, summary: { refreshed: [], failed: [], skipped: [] } });
    });

    it('always answers, even if the refresh blows up (the popup never waits forever)', async () => {
      const { handlers, refresher } = setup();
      refresher.refresh.mockRejectedValue(new Error('boom'));
      const reply = vi.fn();
      handlers.message({ type: 'refresh' }, own, reply);
      await flush();
      expect(reply).toHaveBeenCalledWith({ ok: false, error: 'boom' });
    });

    it('ignores messages from other extensions and unknown message types', () => {
      const { handlers, refresher } = setup();
      const reply = vi.fn();
      expect(handlers.message({ type: 'refresh' }, { id: 'another-extension' }, reply)).toBe(false);
      expect(handlers.message({ type: 'something' }, own, reply)).toBe(false);
      expect(handlers.message(undefined, own, reply)).toBe(false);
      expect(refresher.refresh).not.toHaveBeenCalled();
      expect(reply).not.toHaveBeenCalled();
    });
  });
});
