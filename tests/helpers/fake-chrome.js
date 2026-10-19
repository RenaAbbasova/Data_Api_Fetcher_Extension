import { vi } from 'vitest';

/** A minimal in-memory stand-in for the chrome.* APIs the extension uses. */
export function createStorageArea(initial = {}) {
  const data = { ...initial };
  const listeners = [];
  return {
    data,
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
      listeners.forEach((fn) => fn(Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }])), 'local'));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

export function createFakeChrome({ alarms = {} } = {}) {
  const handlers = {};
  const event = (name) => ({ addListener: (fn) => { handlers[name] = fn; } });
  const alarmStore = { ...alarms };
  return {
    handlers,
    alarmStore,
    chrome: {
      runtime: { id: 'our-extension-id', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
      alarms: {
        get: vi.fn(async (name) => alarmStore[name]),
        create: vi.fn(async (name, info) => { alarmStore[name] = { name, ...info }; }),
        onAlarm: event('alarm'),
      },
      storage: { local: createStorageArea() },
    },
  };
}
