import { describe, expect, it } from 'vitest';
import { APIS, parsePost, parseRandomUser, parseTrivia, ShapeError } from '../src/apis.js';

const enc = encodeURIComponent;
const trivia = (over = {}) => ({ response_code: 0, results: [{ question: enc('What is "2+2" & more?'), correct_answer: enc('4'), incorrect_answers: [enc('3'), enc('5'), enc('Ñandú é')] }], ...over });

describe('parsers', () => {
  it('random user', () => {
    expect(parseRandomUser({ results: [{ name: { first: 'Ada', last: 'Lovelace' }, email: 'a@b.c' }] })).toEqual({ name: 'Ada Lovelace', email: 'a@b.c' });
  });
  it.each([[{}], [null], [{ results: [] }], [{ results: [{ name: { first: 'A' }, email: 'x' }] }], [{ results: [{ name: { first: 'A', last: 'B' }, email: 5 }] }]])('random user rejects %j', (data) => {
    expect(() => parseRandomUser(data)).toThrow(ShapeError);
  });
  it('post', () => {
    expect(parsePost({ title: 't', body: 'b', id: 1 })).toEqual({ title: 't', body: 'b' });
    expect(() => parsePost({ title: 't' })).toThrow(ShapeError);
    expect(() => parsePost({ title: 5, body: 'b' })).toThrow(ShapeError);
  });
  it('trivia decodes the URL-encoded text exactly (no HTML entities involved)', () => {
    expect(parseTrivia(trivia())).toEqual({ question: 'What is "2+2" & more?', correct: '4', incorrect: ['3', '5', 'Ñandú é'] });
  });
  it('trivia keeps hostile markup as plain text', () => {
    const payload = '<img src=x onerror=alert(1)>';
    expect(parseTrivia(trivia({ results: [{ question: enc(payload), correct_answer: enc(payload), incorrect_answers: [enc(payload)] }] })).question).toBe(payload);
  });
  it('trivia rejects a rate-limit answer (the service answers HTTP 200 with response_code 5)', () => {
    expect(() => parseTrivia({ response_code: 5, results: [] })).toThrow(/code 5/);
    expect(() => parseTrivia(null)).toThrow(ShapeError);
  });
  it('trivia rejects malformed percent-encoding with a ShapeError, not a URIError', () => {
    expect(() => parseTrivia(trivia({ results: [{ question: '%E0%A4%A', correct_answer: 'x', incorrect_answers: ['y'] }] }))).toThrow(ShapeError);
  });
  it('trivia rejects missing or absurd answer lists', () => {
    expect(() => parseTrivia(trivia({ results: [{ question: 'q', correct_answer: 'a', incorrect_answers: [] }] }))).toThrow(ShapeError);
    expect(() => parseTrivia(trivia({ results: [{ question: 'q', correct_answer: 'a', incorrect_answers: Array(11).fill('x') }] }))).toThrow(ShapeError);
  });
  it('long text is cut', () => {
    expect(parsePost({ title: 't'.repeat(5000), body: 'b' }).title).toHaveLength(2000);
  });
});

describe('API list', () => {
  it('has the three APIs over https, and the trivia API is asked for URL-encoded text', () => {
    expect(APIS.map((a) => a.id)).toEqual(['randomUser', 'post', 'trivia']);
    for (const api of APIS) expect(new URL(api.url).protocol).toBe('https:');
    expect(APIS[2].url).toContain('encode=url3986');
  });
});
