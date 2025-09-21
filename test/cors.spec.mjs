import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import healthHandler from '../api/health.js';
import placesHandler from '../api/places.js';
import authHandler from '../api/auth.js';
import whisperHandler from '../api/whisper.js';

const originalCors = process.env.CORS_ALLOWED_ORIGINS;

after(() => {
  if (originalCors === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = originalCors;
  }
});

function createReq({ method = 'GET', origin, query = {}, body } = {}) {
  const headers = {};
  if (origin !== undefined) {
    headers.origin = origin;
  }
  return { method, headers, query, body };
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end(payload) {
      if (payload !== undefined) {
        this.body = payload;
      }
      this.ended = true;
      return this;
    },
  };
}

test('OPTIONS /api/places allows configured origin and returns 204', async () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://freeflow-frontend-seven.vercel.app,http://localhost:5173';

  const req = createReq({
    method: 'OPTIONS',
    origin: 'https://freeflow-frontend-seven.vercel.app',
  });
  const res = createRes();

  await placesHandler(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://freeflow-frontend-seven.vercel.app');
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET,POST,OPTIONS');
  assert.equal(res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
  assert.equal(res.headers['Vary'], 'Origin');
});

test('GET /api/health without Origin passes through', async () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://freeflow-frontend-seven.vercel.app,http://localhost:5173';

  const req = createReq({ method: 'GET' });
  const res = createRes();

  await healthHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.ended, true);
  assert.equal(res.headers['Vary'], 'Origin');
  assert.equal(res.body?.status, 'ok');
});

test('GET /api/places with disallowed origin is blocked', async () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://freeflow-frontend-seven.vercel.app,http://localhost:5173';

  const req = createReq({
    method: 'GET',
    origin: 'https://not-allowed.example',
    query: {},
  });
  const res = createRes();

  await placesHandler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.ended, true);
  assert.deepEqual(res.body, { error: 'Origin not allowed' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(res.headers['Vary'], 'Origin');
});

test('POST /api/auth poprawne dane zwraca token', async () => {
  const req = createReq({
    method: 'POST',
    body: { email: 'ndoemo02@gmail.com', password: 'abc123' }
  });
  const res = createRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data?.token);
  assert.equal(res.body.data?.user?.email, 'ndoemo02@gmail.com');
});

test('POST /api/auth błędne dane zwraca 401', async () => {
  const req = createReq({
    method: 'POST',
    body: { email: 'wrong@example.com', password: 'badpass' }
  });
  const res = createRes();
  await authHandler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'INVALID_CREDENTIALS');
});

test('POST /api/whisper bez klucza API zwraca błąd', async () => {
  const req = createReq({
    method: 'POST',
  });
  // symulujemy strumień audio (pusty)
  req[Symbol.asyncIterator] = async function* () { yield Buffer.from(''); };
  const res = createRes();
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await whisperHandler(req, res);
  if (oldKey) process.env.OPENAI_API_KEY = oldKey;
  assert.ok(res.statusCode === 500 || res.statusCode === 401 || res.statusCode === 400);
  assert.ok(res.body?.error);
});
