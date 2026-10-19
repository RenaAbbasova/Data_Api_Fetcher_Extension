// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { APIS } from '../src/apis.js';
import { formatAge, truncate } from '../src/format.js';
import { renderAll, stateOf } from '../src/render.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const HOSTILE = '<img src=x onerror="window.__pwned=1"><b id="injected">X</b><a href="https://evil.example">login</a>';
const good = (over = {}) => ({
  randomUser: { value: { name: 'Ada Lovelace', email: 'ada@example.com' }, fetchedAt: NOW - 120_000, attemptedAt: NOW - 120_000, error: null },
  post: { value: { title: 'A title', body: 'A body' }, fetchedAt: NOW - 120_000, attemptedAt: NOW - 120_000, error: null },
  trivia: { value: { question: 'Q?', correct: 'A', incorrect: ['B', 'C', 'D'] }, fetchedAt: NOW - 120_000, attemptedAt: NOW - 120_000, error: null },
  ...over,
});
const mount = () => { document.body.innerHTML = '<div id="c"></div>'; return document.getElementById('c'); };

describe('renderAll', () => {
  it('shows one card per API with the data and a relative time', () => {
    const c = mount();
    renderAll(c, APIS, good(), { now: NOW });
    expect(c.querySelectorAll('section.api-data')).toHaveLength(3);
    expect(c.textContent).toContain('Ada Lovelace');
    expect(c.textContent).toContain('Updated 2 minutes ago');
    expect(c.querySelector('time').getAttribute('datetime')).toBe(new Date(NOW - 120_000).toISOString());
    expect(c.getAttribute('aria-busy')).toBe('false');
  });

  it('shows hostile text from the network as TEXT: no elements are created from it', () => {
    const c = mount();
    const entries = good({ randomUser: { value: { name: HOSTILE, email: HOSTILE }, fetchedAt: NOW, attemptedAt: NOW, error: null } });
    renderAll(c, APIS, entries, { now: NOW });
    expect(c.querySelector('img, #injected, a')).toBeNull();
    expect(c.textContent).toContain(HOSTILE);
  });

  it('never uses innerHTML to draw', () => {
    const c = mount();
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get: descriptor.get, set() { throw new Error('innerHTML was used'); } });
    try { renderAll(c, APIS, good(), { now: NOW }); } finally { Object.defineProperty(Element.prototype, 'innerHTML', descriptor); }
    expect(c.querySelectorAll('section')).toHaveLength(3);
  });

  it('after a failed refresh it shows the SAVED data and says why', () => {
    const c = mount();
    const entries = good({ randomUser: { ...good().randomUser, fetchedAt: NOW - 3 * 3600_000, error: { type: 'network', message: 'Could not reach the server' } } });
    renderAll(c, APIS, entries, { now: NOW });
    const card = c.querySelector('section.stale');
    expect(card.textContent).toContain('Saved data');
    expect(card.textContent).toContain('Ada Lovelace');
    expect(card.textContent).toContain('Could not reach the server');
    expect(card.textContent).toContain('saved 3 hours ago');
  });

  it('with no data at all it shows the error, or a waiting message', () => {
    const c = mount();
    renderAll(c, APIS, { randomUser: { value: null, error: { type: 'http', message: 'The server answered HTTP 500' } } }, { now: NOW });
    expect(c.querySelector('section.error').textContent).toContain('HTTP 500');
    expect(c.querySelectorAll('section.loading')).toHaveLength(2);
    expect(c.textContent).toContain('Waiting for the first data');
  });

  it('one broken card does not break the others', () => {
    const c = mount();
    renderAll(c, APIS, good({ post: { value: { unexpected: true }, fetchedAt: NOW, attemptedAt: NOW, error: null } }), { now: NOW });
    expect(c.querySelectorAll('section.api-data')).toHaveLength(3);
    expect(c.textContent).toContain('This data could not be shown');
    expect(c.textContent).toContain('Ada Lovelace');
  });

  it('is accessible by structure: each card is labelled by its title', () => {
    const c = mount();
    renderAll(c, APIS, good(), { now: NOW });
    for (const card of c.querySelectorAll('section')) expect(c.querySelector('#' + card.getAttribute('aria-labelledby'))).not.toBeNull();
  });
});

describe('helpers', () => {
  it('stateOf', () => {
    expect(stateOf(undefined)).toBe('loading');
    expect(stateOf({ value: { a: 1 }, error: null })).toBe('ok');
    expect(stateOf({ value: { a: 1 }, error: { type: 'x', message: 'm' } })).toBe('stale');
    expect(stateOf({ value: null, error: { type: 'x', message: 'm' } })).toBe('error');
  });
  it('formatAge', () => {
    expect(formatAge(10_000)).toBe('just now');
    expect(formatAge(60_000)).toBe('1 minute ago');
    expect(formatAge(5 * 60_000)).toBe('5 minutes ago');
    expect(formatAge(2 * 3600_000)).toBe('2 hours ago');
    expect(formatAge(3 * 86400_000)).toBe('3 days ago');
    expect(formatAge(-5)).toBe('just now');
  });
  it('truncate', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('x'.repeat(600))).toHaveLength(500);
  });
});
