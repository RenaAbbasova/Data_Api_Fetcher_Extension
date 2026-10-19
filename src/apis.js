/**
 * The three APIs and what we accept from each of them.
 * Every parser validates the shape of the answer and returns plain strings, or throws a ShapeError.
 * Nothing from the network reaches the page without going through one of these.
 */

export class ShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShapeError';
    this.type = 'unexpected_answer';
  }
}

const MAX_TEXT = 2000;

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new ShapeError(`Unexpected answer: ${label} is missing`);
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

export function parseRandomUser(data) {
  const user = data?.results?.[0];
  return { name: `${text(user?.name?.first, 'first name')} ${text(user?.name?.last, 'last name')}`, email: text(user?.email, 'email') };
}

export function parsePost(data) {
  return { title: text(data?.title, 'title'), body: text(data?.body, 'body') };
}

/** The trivia service is asked for URL-encoded text (encode=url3986), so no HTML entities ever have to be decoded. */
export function parseTrivia(data) {
  if (data?.response_code !== 0) throw new ShapeError(`The trivia service answered with code ${data?.response_code ?? 'unknown'}`);
  const item = data?.results?.[0];
  const decode = (value, label) => {
    try {
      return text(decodeURIComponent(text(value, label)), label);
    } catch (error) {
      if (error instanceof ShapeError) throw error;
      throw new ShapeError(`Unexpected answer: ${label} is not valid`);
    }
  };
  const wrong = item?.incorrect_answers;
  if (!Array.isArray(wrong) || wrong.length === 0 || wrong.length > 10) throw new ShapeError('Unexpected answer: incorrect answers are missing');
  return { question: decode(item?.question, 'question'), correct: decode(item?.correct_answer, 'correct answer'), incorrect: wrong.map((w) => decode(w, 'incorrect answer')) };
}

export const APIS = [
  { id: 'randomUser', name: 'Random User', url: 'https://randomuser.me/api/', parse: parseRandomUser },
  { id: 'post', name: 'JSON Placeholder Post', url: 'https://jsonplaceholder.typicode.com/posts/1', parse: parsePost },
  { id: 'trivia', name: 'Trivia Question', url: 'https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986', parse: parseTrivia },
];
