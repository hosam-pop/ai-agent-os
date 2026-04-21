import type { FastifyInstance } from 'fastify';
import type { UpstreamDescriptor } from '../config/env.js';

export interface UpstreamStatus {
  key: string;
  name: string;
  configured: boolean;
  ok: boolean;
  latencyMs?: number;
  statusCode?: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  gateway: {
    uptimeSec: number;
    version: string;
    startedAt: string;
  };
  upstreams: UpstreamStatus[];
}

export interface HealthRouteOptions {
  upstreams: UpstreamDescriptor[];
  version: string;
  startedAt: Date;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function probeUpstream(
  u: UpstreamDescriptor,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<UpstreamStatus> {
  if (!u.url) {
    return { key: u.key, name: u.name, configured: false, ok: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetchImpl(`${u.url.replace(/\/$/, '')}${u.healthPath}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'user-agent': 'ai-agent-os-gateway/health' },
    });
    return {
      key: u.key,
      name: u.name,
      configured: true,
      ok: res.ok,
      statusCode: res.status,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      key: u.key,
      name: u.name,
      configured: true,
      ok: false,
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function computeHealthReport(opts: HealthRouteOptions): Promise<HealthReport> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const results = await Promise.all(
    opts.upstreams.map(u => probeUpstream(u, fetchImpl, timeoutMs)),
  );
  const configured = results.filter(r => r.configured);
  const okCount = configured.filter(r => r.ok).length;
  let status: HealthReport['status'];
  if (configured.length === 0) status = 'ok';
  else if (okCount === 0) status = 'down';
  else if (okCount === configured.length) status = 'ok';
  else status = 'degraded';

  return {
    status,
    gateway: {
      uptimeSec: Math.round((Date.now() - opts.startedAt.getTime()) / 1000),
      version: opts.version,
      startedAt: opts.startedAt.toISOString(),
    },
    upstreams: results,
  };
}

export async function registerHealthRoute(app: FastifyInstance, opts: HealthRouteOptions) {
  app.get('/api/health', async (_req, reply) => {
    const report = await computeHealthReport(opts);
    const code = report.status === 'down' ? 503 : 200;
    return reply.code(code).send(report);
  });
  app.get('/livez', async (_req, reply) => reply.send({ status: 'ok' }));
}
