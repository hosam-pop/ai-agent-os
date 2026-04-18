import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { feature } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';
import type { AgentLoop } from '../core/agent-loop.js';

/**
 * BRIDGE — remote control surface.
 *
 * Port of Claude-Code's BRIDGE module. Opens a tiny local HTTP listener so
 * external tooling (IDEs, scripts) can submit goals to a running agent. Only
 * binds to 127.0.0.1 and only serves a single POST /run endpoint.
 *
 * Gated by DOGE_FEATURE_BRIDGE=true.
 */

export interface BridgeOptions {
  port?: number;
  host?: string;
  token?: string;
}

export class Bridge {
  private server: Server | null = null;

  constructor(
    private readonly agent: AgentLoop,
    private readonly opts: BridgeOptions = {},
  ) {}

  start(): void {
    if (!feature('BRIDGE')) {
      logger.debug('bridge.disabled');
      return;
    }
    const port = this.opts.port ?? 0;
    const host = this.opts.host ?? '127.0.0.1';
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
    });
    this.server.listen(port, host, () => {
      const addr = this.server?.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : port;
      logger.info('bridge.listening', { host, port: realPort });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/run') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    if (this.opts.token) {
      const auth = req.headers['authorization'] ?? '';
      if (auth !== `Bearer ${this.opts.token}`) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }
    }
    const body = await this.readBody(req);
    let goal = '';
    try {
      const parsed = JSON.parse(body) as { goal?: unknown };
      if (typeof parsed.goal === 'string') goal = parsed.goal;
    } catch {
      res.statusCode = 400;
      res.end('bad json');
      return;
    }
    if (!goal) {
      res.statusCode = 400;
      res.end('goal required');
      return;
    }
    const result = await this.agent.run(goal);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: result.finalText, iterations: result.iterations, usage: result.usage }));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
}
