import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthContext {
  sub: string;
  preferredUsername?: string;
  email?: string;
  roles: string[];
  raw: JWTPayload;
}

export interface JwtVerifierOptions {
  issuer: string;
  audience?: string;
  jwksUri?: string;
  requiredRoles?: string[];
  // Allow injecting a pre-built key resolver for tests.
  jwksResolver?: JWTVerifyGetKey;
}

export class JwtConfigError extends Error {}
export class JwtAuthError extends Error {
  statusCode = 401;
}

export function buildJwtVerifier(opts: JwtVerifierOptions) {
  if (!opts.issuer) {
    throw new JwtConfigError('JWT issuer is required');
  }
  const jwksUrl = opts.jwksUri ?? `${opts.issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`;
  const resolver =
    opts.jwksResolver ??
    (createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    }) as unknown as JWTVerifyGetKey);

  const requiredRoles = opts.requiredRoles ?? [];

  async function verify(token: string): Promise<AuthContext> {
    const { payload } = await jwtVerify(token, resolver, {
      issuer: opts.issuer,
      audience: opts.audience,
      clockTolerance: '30s',
    });
    const ctx = toAuthContext(payload);
    if (requiredRoles.length > 0) {
      const missing = requiredRoles.filter(r => !ctx.roles.includes(r));
      if (missing.length > 0) {
        const err = new JwtAuthError(`missing required roles: ${missing.join(', ')}`);
        err.statusCode = 403;
        throw err;
      }
    }
    return ctx;
  }

  return { verify, jwksUrl };
}

export function toAuthContext(payload: JWTPayload): AuthContext {
  const realmAccess = (payload as { realm_access?: { roles?: string[] } }).realm_access;
  const resourceAccess = (payload as { resource_access?: Record<string, { roles?: string[] }> })
    .resource_access;

  const roles = new Set<string>();
  if (Array.isArray(realmAccess?.roles)) {
    realmAccess!.roles!.forEach(r => roles.add(r));
  }
  if (resourceAccess) {
    for (const entry of Object.values(resourceAccess)) {
      if (Array.isArray(entry?.roles)) {
        entry.roles!.forEach(r => roles.add(r));
      }
    }
  }

  return {
    sub: String(payload.sub ?? ''),
    preferredUsername: payload['preferred_username'] as string | undefined,
    email: payload['email'] as string | undefined,
    roles: Array.from(roles),
    raw: payload,
  };
}

export function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

export function makeJwtPreHandler(verifier: ReturnType<typeof buildJwtVerifier>) {
  return async function jwtPreHandler(req: FastifyRequest, reply: FastifyReply) {
    const token = extractBearerToken(req);
    if (!token) {
      return reply.code(401).send({ error: 'missing Bearer token' });
    }
    try {
      const ctx = await verifier.verify(token);
      (req as FastifyRequest & { auth?: AuthContext }).auth = ctx;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 401;
      return reply.code(status).send({
        error: 'unauthorized',
        message: (err as Error).message,
      });
    }
  };
}
