import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { KeycloakAdmin } from './keycloak-admin.js';

export interface AdminSession {
  userId: string;
  username: string;
  email?: string;
  roles: string[];
  expiresAt: number;
}

export interface AdminAuthConfig {
  // HMAC key used to sign session cookies (reuses KEYS_MASTER_KEY).
  sessionKey: string;
  cookieName: string;
  ttlMs: number;
  secureCookie: boolean;
  // Realm role required to access the admin panel.
  requiredRole: string;
  // Keycloak admin bridge client used for ROPC + admin REST calls.
  keycloak: KeycloakAdmin;
}

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

export function buildAdminAuth(opts: {
  sessionKey: string;
  keycloak: KeycloakAdmin;
  ttlMs?: number;
  secureCookie?: boolean;
  requiredRole?: string;
}): AdminAuth {
  const cfg: AdminAuthConfig = {
    sessionKey: opts.sessionKey,
    cookieName: 'aaos_admin_session',
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    secureCookie: opts.secureCookie ?? true,
    requiredRole: opts.requiredRole ?? 'agent-admin',
    keycloak: opts.keycloak,
  };
  return new AdminAuth(cfg);
}

export interface LoginOutcome {
  ok: boolean;
  reason?: string;
  status?: number;
  session?: AdminSession;
  rawToken?: string; // exposed once, used by callers that want to forward it
}

export class AdminAuth {
  constructor(private readonly cfg: AdminAuthConfig) {}

  get cookieName(): string {
    return this.cfg.cookieName;
  }

  get keycloak(): KeycloakAdmin {
    return this.cfg.keycloak;
  }

  // Username + password -> ROPC -> validated session. Rejects users without
  // the agent-admin realm role even if Keycloak accepts the credentials.
  async loginWithPassword(username: string, password: string): Promise<LoginOutcome> {
    const result = await this.cfg.keycloak.loginWithPassword(username, password);
    if (!result.ok || !result.accessToken) {
      return {
        ok: false,
        status: result.status,
        reason: result.errorDescription ?? 'invalid credentials',
      };
    }
    const payload = KeycloakAdmin.decodeJwtPayload(result.accessToken);
    const roles = payload.realm_access?.roles ?? [];
    if (!roles.includes(this.cfg.requiredRole)) {
      return {
        ok: false,
        status: 403,
        reason: `account lacks ${this.cfg.requiredRole} role`,
      };
    }
    const expiresAt = Date.now() + this.cfg.ttlMs;
    const session: AdminSession = {
      userId: String(payload.sub ?? ''),
      username: String(payload.preferred_username ?? username),
      email: payload.email,
      roles,
      expiresAt,
    };
    return { ok: true, session, rawToken: result.accessToken };
  }

  encodeSessionCookie(sess: AdminSession): string {
    const payload = Buffer.from(JSON.stringify(sess), 'utf8').toString('base64url');
    const sig = this.sign(payload);
    return `${payload}.${sig}`;
  }

  decodeSessionCookie(raw: string): { ok: boolean; reason?: string; session?: AdminSession } {
    const idx = raw.lastIndexOf('.');
    if (idx <= 0) return { ok: false, reason: 'malformed' };
    const payload = raw.slice(0, idx);
    const sig = raw.slice(idx + 1);
    const expected = this.sign(payload);
    if (!safeEq(expected, sig)) return { ok: false, reason: 'bad signature' };
    let sess: AdminSession;
    try {
      sess = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed payload' };
    }
    if (typeof sess.expiresAt !== 'number' || sess.expiresAt <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, session: sess };
  }

  setSessionCookie(reply: FastifyReply, sess: AdminSession): void {
    const token = this.encodeSessionCookie(sess);
    const maxAge = Math.max(0, Math.floor((sess.expiresAt - Date.now()) / 1000));
    const attrs = [
      `${this.cfg.cookieName}=${token}`,
      `Max-Age=${maxAge}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (this.cfg.secureCookie) attrs.push('Secure');
    reply.header('Set-Cookie', attrs.join('; '));
  }

  clearSessionCookie(reply: FastifyReply): void {
    const attrs = [
      `${this.cfg.cookieName}=`,
      'Max-Age=0',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (this.cfg.secureCookie) attrs.push('Secure');
    reply.header('Set-Cookie', attrs.join('; '));
  }

  validateSessionFromRequest(req: FastifyRequest): { ok: boolean; reason?: string; session?: AdminSession } {
    const cookieHeader = req.headers['cookie'];
    if (!cookieHeader || typeof cookieHeader !== 'string') {
      return { ok: false, reason: 'missing cookie' };
    }
    const cookies = parseCookieHeader(cookieHeader);
    const raw = cookies[this.cfg.cookieName];
    if (!raw) return { ok: false, reason: 'missing session cookie' };
    return this.decodeSessionCookie(raw);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.cfg.sessionKey).update(payload).digest('hex');
  }
}

function parseCookieHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      out[trimmed] = '';
      continue;
    }
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}
