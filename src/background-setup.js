import { LEGACY_KEYS } from './cache.js';

export const ALARM_NAME = 'refresh';
export const REFRESH_EVERY_MINUTES = 15;

/**
 * Registers every listener of the service worker. It takes `chrome` and the refresher as arguments so it can be tested.
 * Nothing is fetched just because the service worker woke up: the service worker is stopped and started by the
 * browser all the time, so doing work at start-up (as version 1 did) means doing it again and again.
 */
export function setupBackground({ chrome, refresher }) {
  async function ensureAlarm() {
    // Creating an alarm that already exists RESTARTS it, so create it only when it is missing.
    if (!(await chrome.alarms.get(ALARM_NAME))) {
      await chrome.alarms.create(ALARM_NAME, { delayInMinutes: REFRESH_EVERY_MINUTES, periodInMinutes: REFRESH_EVERY_MINUTES });
    }
  }

  chrome.runtime.onInstalled.addListener(async (details) => {
    await ensureAlarm();
    if (details?.reason === 'update') await chrome.storage.local.remove(LEGACY_KEYS);
    await refresher.refresh({ force: true });
  });
  chrome.runtime.onStartup.addListener(async () => {
    await ensureAlarm();
    await refresher.refresh();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) refresher.refresh({ force: true });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || message?.type !== 'refresh') return false; // only our own popup may ask
    refresher.refresh({ force: Boolean(message.force) }).then(
      (summary) => sendResponse({ ok: true, summary }),
      (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }), // the popup never waits forever
    );
    return true;
  });

  ensureAlarm(); // in case the alarm was lost (for example after a browser update)
}
