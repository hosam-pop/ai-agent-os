import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AdminAuthConfig {
  // Plaintext password the admin types into the panel. Stored as a Fly secret
  // (KEYS_ADMIN_PASSWORD). Comparison is constant-time.
  password: string;
  // HMAC key used to sign session cookies. Reuses KEYS_MASTER_KEY by default.
  sessionKey: string;
  // Cookie name & ttl.
  cookieName: string;
  ttlMs: number;
  // True when the gateway is served over HTTPS (set Secure cookie).
  secureCookie: boolean;
}

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

export function buildAdminAuth(opts: {
  password: string;
  sessionKey: string;
  ttlMs?: number;
  secureCookie?: boolean;
}): AdminAuth {
  const cfg: AdminAuthConfig = {
    password: opts.password,
    sessionKey: opts.sessionKey,
    cookieName: 'aaos_admin_session',
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    secureCookie: opts.secureCookie ?? true,
  };
  return new AdminAuth(cfg);
}

export class AdminAuth {
  constructor(private readonly cfg: AdminAuthConfig) {}

  get cookieName(): string {
    return this.cfg.cookieName;
  }

  verifyPassword(submitted: string): boolean {
    if (!this.cfg.password) return false;
    const a = Buffer.from(submitted, 'utf8');
    const b = Buffer.from(this.cfg.password, 'utf8');
    if (a.length !== b.length) {
      // Constant-time fallback: hash both and compare.
      const ha = createHmac('sha256', this.cfg.sessionKey).update(a).digest();
      const hb = createHmac('sha256', this.cfg.sessionKey).update(b).digest();
      return timingSafeEqual(ha, hb);
    }
    return timingSafeEqual(a, b);
  }

  issueSession(): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + this.cfg.ttlMs;
    const payload = `${expiresAt}.admin`;
    const sig = this.sign(payload);
    return { token: `${payload}.${sig}`, expiresAt };
  }

  setSessionCookie(reply: FastifyReply, token: string): void {
    const attrs = [
      `${this.cfg.cookieName}=${token}`,
      `Max-Age=${Math.floor(this.cfg.ttlMs / 1000)}`,
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

  validateSessionFromRequest(req: FastifyRequest): { ok: boolean; reason?: string } {
    const cookieHeader = req.headers['cookie'];
    if (!cookieHeader || typeof cookieHeader !== 'string') {
      return { ok: false, reason: 'missing cookie' };
    }
    const cookies = parseCookieHeader(cookieHeader);
    const raw = cookies[this.cfg.cookieName];
    if (!raw) return { ok: false, reason: 'missing session cookie' };
    return this.validateSessionToken(raw);
  }

  validateSessionToken(token: string): { ok: boolean; reason?: string } {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [expRaw, scope, sig] = parts;
    if (scope !== 'admin') return { ok: false, reason: 'wrong scope' };
    const expected = this.sign(`${expRaw}.${scope}`);
    const ok = safeEq(expected, sig!);
    if (!ok) return { ok: false, reason: 'bad signature' };
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp <= Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true };
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
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
