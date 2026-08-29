/** Minimalne atrapy req/res do testowania handlerow serverless. */
import { Readable } from 'node:stream';

export function makeReq({ method = 'POST', body = {}, headers = {} } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const stream = Readable.from([Buffer.from(raw, 'utf8')]);
  stream.method = method;
  stream.headers = { 'content-type': 'application/json', ...headers };
  stream.socket = { remoteAddress: headers['x-forwarded-for'] ?? '10.0.0.1' };
  return stream;
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    getHeader(key) { return this.headers[key.toLowerCase()]; },
    end(payload) { this.body = payload; this.ended = true; },
  };
  Object.defineProperty(res, 'json', {
    get() { return this.body ? JSON.parse(this.body) : null; },
  });
  return res;
}
