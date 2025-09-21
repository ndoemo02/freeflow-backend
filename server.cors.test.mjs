import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

function restoreEnvVariable(key, previousValue) {
  if (typeof previousValue === 'undefined') {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function requestHealth(port, origin) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        headers: {
          Origin: origin
        }
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

test('CORS_ALLOWED_ORIGINS=* reflects arbitrary origins', async t => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigins = process.env.CORS_ALLOWED_ORIGINS;

  process.env.NODE_ENV = 'test';
  process.env.CORS_ALLOWED_ORIGINS = ' * ';

  const { app } = await import('./server.js');

  const listener = app.listen(0);
  await once(listener, 'listening');

  t.after(() => {
    listener.close();
    restoreEnvVariable('NODE_ENV', previousNodeEnv);
    restoreEnvVariable('CORS_ALLOWED_ORIGINS', previousCorsOrigins);
  });

  const origin = 'https://arbitrary.origin.example';
  const response = await requestHealth(listener.address().port, origin);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.ok(response.body.includes('status'));
});
