import { APIS } from './src/apis.js';
import { CACHE_KEY, createCache } from './src/cache.js';
import { renderAll } from './src/render.js';

const container = document.getElementById('api-container');
const banner = document.getElementById('banner');
const button = document.getElementById('refresh');
const cache = createCache(chrome.storage.local);

async function show() {
  renderAll(container, APIS, await cache.getAll());
}

function updateBanner() {
  banner.hidden = navigator.onLine;
  banner.textContent = navigator.onLine ? '' : 'You are offline. Showing the data saved earlier.';
}

function askForRefresh(force) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'refresh', force }, (response) => {
      resolve(chrome.runtime.lastError ? { ok: false } : (response ?? { ok: false }));
    });
  });
}

async function refresh(force) {
  button.disabled = true;
  button.textContent = 'Refreshing...';
  const answer = await askForRefresh(force);
  button.disabled = false;
  button.textContent = 'Refresh data';
  if (!answer.ok) {
    banner.textContent = 'Could not reach the background service. Showing the data saved earlier.';
    banner.hidden = false;
  }
}

// Saved data first: the popup is useful the instant it opens, with no waiting.
await show();
updateBanner();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CACHE_KEY]) show();
});
window.addEventListener('online', updateBanner);
window.addEventListener('offline', updateBanner);
button.addEventListener('click', () => refresh(true));
refresh(false); // fetches only what is out of date
