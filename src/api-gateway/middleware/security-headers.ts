import type { FastifyInstance } from 'fastify';

// Minimal CSP / transport hardening.
// Kept deliberately conservative: no inline scripts, HSTS on, XFO DENY.
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    // Only set the default strict CSP if a route handler hasn't already
    // set its own (e.g. the admin keys page needs inline styles + Google Fonts).
    if (!reply.getHeader('Content-Security-Policy')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
      );
    }
    reply.removeHeader('X-Powered-By');
    return payload;
  });
}
