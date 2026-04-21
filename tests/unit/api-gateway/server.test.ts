import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGateway } from '../../../dist/api-gateway/server.js';

test('gateway exposes /livez without auth', async () => {
  const app = await buildGateway({
    env: {
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: 0,
      GATEWAY_LOG_LEVEL: 'silent',
      GATEWAY_RATE_LIMIT_MAX: 100,
      GATEWAY_RATE_LIMIT_WINDOW: '1 minute',
      GATEWAY_CORS_ORIGINS: '',
      GATEWAY_TRUST_PROXY: true,
      GATEWAY_REQUIRE_AUTH: false,
    } as any,
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/livez' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'ok');
  } finally {
    await app.close();
  }
});

test('gateway exposes /api/health aggregator without auth', async () => {
  const app = await buildGateway({
    env: {
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: 0,
      GATEWAY_LOG_LEVEL: 'silent',
      GATEWAY_RATE_LIMIT_MAX: 100,
      GATEWAY_RATE_LIMIT_WINDOW: '1 minute',
      GATEWAY_CORS_ORIGINS: '',
      GATEWAY_TRUST_PROXY: true,
      GATEWAY_REQUIRE_AUTH: false,
    } as any,
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok'); // no upstreams configured
    assert.ok(Array.isArray(body.upstreams));
  } finally {
    await app.close();
  }
});

test('gateway returns 401 for /api/agent without bearer token when auth enabled', async () => {
  const app = await buildGateway({
    env: {
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: 0,
      GATEWAY_LOG_LEVEL: 'silent',
      GATEWAY_RATE_LIMIT_MAX: 100,
      GATEWAY_RATE_LIMIT_WINDOW: '1 minute',
      GATEWAY_CORS_ORIGINS: '',
      GATEWAY_TRUST_PROXY: true,
      GATEWAY_REQUIRE_AUTH: true,
      KEYCLOAK_ISSUER: 'https://kc.example/realms/ai-agent-os',
      KEYCLOAK_AUDIENCE: 'ai-agent-os-gateway',
      KEYCLOAK_JWKS_URI: 'https://kc.example/realms/ai-agent-os/protocol/openid-connect/certs',
    } as any,
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/agent/ping' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('gateway sets strict security headers on root', async () => {
  const app = await buildGateway({
    env: {
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: 0,
      GATEWAY_LOG_LEVEL: 'silent',
      GATEWAY_RATE_LIMIT_MAX: 100,
      GATEWAY_RATE_LIMIT_WINDOW: '1 minute',
      GATEWAY_CORS_ORIGINS: '',
      GATEWAY_TRUST_PROXY: true,
      GATEWAY_REQUIRE_AUTH: false,
    } as any,
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['strict-transport-security'] as string, /max-age=31536000/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'] as string, /default-src 'self'/);
  } finally {
    await app.close();
  }
});

test('/api/orchestrate returns 503 when upstream not configured', async () => {
  const app = await buildGateway({
    env: {
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: 0,
      GATEWAY_LOG_LEVEL: 'silent',
      GATEWAY_RATE_LIMIT_MAX: 100,
      GATEWAY_RATE_LIMIT_WINDOW: '1 minute',
      GATEWAY_CORS_ORIGINS: '',
      GATEWAY_TRUST_PROXY: true,
      GATEWAY_REQUIRE_AUTH: false,
    } as any,
  });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/orchestrate/jobs' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().service, 'qualixar');
  } finally {
    await app.close();
  }
});
