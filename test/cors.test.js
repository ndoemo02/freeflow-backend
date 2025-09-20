import assert from 'node:assert/strict';
import { applyCors } from '../api/cors.js';

function createReq({ method = 'GET', origin } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  return { method, headers };
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
    end(payload) {
      if (payload !== undefined) {
        this.body = payload;
      }
      this.ended = true;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`\u2713 ${name}`);
  } catch (error) {
    console.error(`\u2717 ${name}`);
    throw error;
  }
}

const originalOrigins = process.env.CORS_ALLOWED_ORIGINS;

try {
  await run('wildcard allows any origin header', () => {
    process.env.CORS_ALLOWED_ORIGINS = '*';
    const req = createReq({ method: 'GET', origin: 'http://example.com' });
    const res = createRes();

    const handled = applyCors(req, res);

    assert.equal(handled, false);
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://example.com');
    assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET,POST,OPTIONS');
    assert.equal(res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
    assert.equal(res.ended, false);
  });

  await run('wildcard falls back to * when origin missing', () => {
    process.env.CORS_ALLOWED_ORIGINS = '*';
    const req = createReq({ method: 'GET' });
    const res = createRes();

    const handled = applyCors(req, res);

    assert.equal(handled, false);
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  });

  await run('options request handled immediately', () => {
    process.env.CORS_ALLOWED_ORIGINS = '*';
    const req = createReq({ method: 'OPTIONS', origin: 'http://example.com' });
    const res = createRes();

    const handled = applyCors(req, res);

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.ended, true);
  });

  await run('whitelist allows configured origins', () => {

    process.env.CORS_ALLOWED_ORIGINS = 'https://freeflow-frontend.vercel.app,https://freeflo.vercel.app,http://localhost:5173';
    const req = createReq({
      method: 'GET',
      origin: 'https://freeflow-frontend.vercel.app',
    });

    const res = createRes();

    const handled = applyCors(req, res);

    assert.equal(handled, false);

    assert.equal(
      res.headers['Access-Control-Allow-Origin'],
      'https://freeflow-frontend.vercel.app',
    );

    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://freeflow-front.vercel.app');
    assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET,POST,OPTIONS');
    assert.equal(res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
  });


    process.env.CORS_ALLOWED_ORIGINS = 'https://freeflow-frontend.vercel.app,https://freeflo.vercel.app,http://localhost:5173';
    const req = createReq({ method: 'GET', origin: 'https://not-allowed.example' });
    const res = createRes();

    const handled = applyCors(req, res);

    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Origin not allowed' });
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  });

  await run('backend vercel domain is rejected', () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://freeflow-frontend.vercel.app,https://freeflo.vercel.app,http://localhost:5173';
    const req = createReq({
      method: 'GET',
      origin: 'https://freeflow-backend-vercel.vercel.app',
    });
    const res = createRes();

    const handled = applyCors(req, res);

    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Origin not allowed' });
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  });


  console.log('All CORS tests passed');
} finally {
  if (originalOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = originalOrigins;
  }
}
