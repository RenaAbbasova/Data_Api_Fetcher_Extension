import { formatAge, truncate } from './format.js';

/**
 * Draws the cards. Everything that comes from the network is put on the page with textContent,
 * never as HTML, and one broken card cannot break the others.
 */

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Saved data is read strictly too: anything that is not a string is refused, so a card shows an error, never "undefined". */
const str = (value) => {
  if (typeof value !== 'string') throw new TypeError('Unexpected saved data');
  return value;
};

/** The label/value pairs shown for each API. */
const FIELDS = {
  randomUser: (v) => [['Name', str(v.name)], ['Email', str(v.email)]],
  post: (v) => [['Title', str(v.title)], ['Body', str(v.body)]],
  trivia: (v) => [['Question', str(v.question)], ['Correct answer', str(v.correct)], ['Incorrect answers', v.incorrect.map(str).join(', ')]],
};

export function stateOf(entry) {
  if (entry?.value && !entry.error) return 'ok';
  if (entry?.value && entry.error) return 'stale';
  if (entry?.error) return 'error';
  return 'loading';
}

const CHIP = { ok: 'Updated', stale: 'Saved data', error: 'Error', loading: 'Loading' };

function buildCard(doc, api, entry, now) {
  const state = stateOf(entry);
  const card = el(doc, 'section', `api-data ${state}`);
  card.setAttribute('aria-labelledby', `title-${api.id}`);

  const header = el(doc, 'div', 'api-header');
  const title = el(doc, 'h2', '', api.name);
  title.id = `title-${api.id}`;
  header.append(title, el(doc, 'span', 'status', CHIP[state]));

  const content = el(doc, 'div', 'api-content');
  if (state === 'error') content.append(el(doc, 'p', 'error-message', entry.error.message));
  if (state === 'loading') content.append(el(doc, 'p', 'loading', 'Waiting for the first data...'));
  if (state === 'ok' || state === 'stale') {
    const list = el(doc, 'dl', 'fields');
    for (const [label, value] of FIELDS[api.id]?.(entry.value) ?? [['Data', JSON.stringify(entry.value)]]) {
      list.append(el(doc, 'dt', '', label), el(doc, 'dd', '', truncate(value)));
    }
    content.append(list);
    if (state === 'stale') {
      content.append(el(doc, 'p', 'error-message', `Could not refresh (${entry.error.message}). Showing the data saved ${formatAge(now - entry.fetchedAt)}.`));
    } else {
      const stamp = el(doc, 'p', 'timestamp');
      const time = el(doc, 'time', '', `Updated ${formatAge(now - entry.fetchedAt)}`);
      time.setAttribute('datetime', new Date(entry.fetchedAt).toISOString());
      stamp.append(time);
      content.append(stamp);
    }
  }
  card.append(header, content);
  return card;
}

export function renderAll(container, apis, entries, { now = Date.now() } = {}) {
  const doc = container.ownerDocument;
  const cards = apis.map((api) => {
    try {
      return buildCard(doc, api, entries?.[api.id], now);
    } catch {
      const card = el(doc, 'section', 'api-data error');
      const header = el(doc, 'div', 'api-header');
      header.append(el(doc, 'h2', '', api.name), el(doc, 'span', 'status', 'Error'));
      card.append(header, el(doc, 'div', 'api-content', 'This data could not be shown.'));
      return card;
    }
  });
  container.replaceChildren(...cards);
  container.setAttribute('aria-busy', 'false');
}
