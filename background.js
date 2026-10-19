import { APIS } from './src/apis.js';
import { setupBackground } from './src/background-setup.js';
import { createCache } from './src/cache.js';
import { fetchJson } from './src/fetcher.js';
import { createRefresher } from './src/refresh.js';

const cache = createCache(chrome.storage.local);
const refresher = createRefresher({ apis: APIS, fetchJson, cache, isOnline: () => navigator.onLine });

setupBackground({ chrome, refresher });
