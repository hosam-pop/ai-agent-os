import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { buildJwtVerifier, toAuthContext, extractBearerToken } from '../../../dist/api-gateway/middleware/jwt.js';

async function makeKeyAndResolver() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const resolver = async () => publicKey;
  return { privateKey, jwk, resolver };
}

test('toAuthContext flattens realm and resource roles', () => {
  const ctx = toAuthContext({
    sub: 'u-1',
    preferred_username: 'alice',
    email: 'alice@example.com',
    realm_access: { roles: ['user', 'agent-caller'] },
    resource_access: {
      'ai-agent-os-gateway': { roles: ['admin'] },
      'other-client': { roles: ['user'] },
    },
  });
  assert.equal(ctx.sub, 'u-1');
  assert.equal(ctx.preferredUsername, 'alice');
  assert.equal(ctx.email, 'alice@example.com');
  assert.deepEqual(ctx.roles.sort(), ['admin', 'agent-caller', 'user']);
});

test('extractBearerToken parses canonical header', () => {
  const req = { headers: { authorization: 'Bearer abc.def.ghi' } } as any;
  assert.equal(extractBearerToken(req), 'abc.def.ghi');
});

test('extractBearerToken returns null when missing or malformed', () => {
  assert.equal(extractBearerToken({ headers: {} } as any), null);
  assert.equal(extractBearerToken({ headers: { authorization: 'Basic xyz' } } as any), null);
});

test('buildJwtVerifier accepts a valid token signed by injected key', async () => {
  const { privateKey, resolver } = await makeKeyAndResolver();
  const token = await new SignJWT({
    realm_access: { roles: ['user'] },
    preferred_username: 'bob',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://kc.example/realms/ai-agent-os')
    .setAudience('ai-agent-os-gateway')
    .setSubject('u-2')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(privateKey);

  const verifier = buildJwtVerifier({
    issuer: 'https://kc.example/realms/ai-agent-os',
    audience: 'ai-agent-os-gateway',
    jwksResolver: resolver as any,
  });
  const ctx = await verifier.verify(token);
  assert.equal(ctx.sub, 'u-2');
  assert.equal(ctx.preferredUsername, 'bob');
  assert.deepEqual(ctx.roles, ['user']);
});

test('buildJwtVerifier rejects wrong audience', async () => {
  const { privateKey, resolver } = await makeKeyAndResolver();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://kc.example/realms/ai-agent-os')
    .setAudience('someone-else')
    .setSubject('u-3')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(privateKey);

  const verifier = buildJwtVerifier({
    issuer: 'https://kc.example/realms/ai-agent-os',
    audience: 'ai-agent-os-gateway',
    jwksResolver: resolver as any,
  });
  await assert.rejects(() => verifier.verify(token));
});

test('buildJwtVerifier rejects when required role missing', async () => {
  const { privateKey, resolver } = await makeKeyAndResolver();
  const token = await new SignJWT({
    realm_access: { roles: ['user'] },
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://kc.example/realms/ai-agent-os')
    .setAudience('gw')
    .setSubject('u-4')
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(privateKey);

  const verifier = buildJwtVerifier({
    issuer: 'https://kc.example/realms/ai-agent-os',
    audience: 'gw',
    jwksResolver: resolver as any,
    requiredRoles: ['admin'],
  });
  await assert.rejects(() => verifier.verify(token), /missing required roles/);
});
