import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import healthHandler from '../api/health.js';
import placesHandler from '../api/places.js';

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
