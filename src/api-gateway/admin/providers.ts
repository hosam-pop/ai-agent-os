// Catalogue of integrations that can be managed from the admin keys panel.
// Order here drives the UI order. Each entry declares its own validation and
// (optionally) live test endpoint. Test results never leak the secret value.

export type ProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'serper'
  | 'github';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  hint: string;
  // Quick syntactic validation before storing the key. Avoids stashing junk.
  validate(value: string): string | null;
  // Optional liveness probe. Returns ok=true plus a short note on success.
  testKey?(value: string): Promise<{ ok: boolean; note: string }>;
  // True for buttons that should render with the green "connect" treatment.
  greenAccent?: boolean;
}

async function postJSON(url: string, body: unknown, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function getURL(url: string, headers: Record<string, string>, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Used by the Manager Agent. Generate a key at aistudio.google.com/apikey.',
    validate: (v) => (/^AIza[\w-]{20,}$/.test(v) ? null : 'Expected a key that starts with AIza…'),
    async testKey(value) {
      const r = await postJSON(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(value)}`,
        { contents: [{ parts: [{ text: 'ping' }] }] },
      );
      if (r.ok) return { ok: true, note: 'gemini-2.5-flash answered' };
      const txt = await r.text().catch(() => '');
      const reason = txt.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] ?? `HTTP ${r.status}`;
      return { ok: false, note: reason };
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Used for DALL·E and Claude/GPT fallback. From platform.openai.com/api-keys.',
    validate: (v) => (/^sk-[\w-]{20,}$/.test(v) ? null : 'Expected sk-… token'),
    async testKey(value) {
      const r = await getURL('https://api.openai.com/v1/models', { authorization: `Bearer ${value}` });
      if (r.ok) return { ok: true, note: 'OpenAI accepted the key' };
      return { ok: false, note: `HTTP ${r.status}` };
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    hint: 'Used as a Claude fallback. From console.anthropic.com/settings/keys.',
    validate: (v) => (/^sk-ant-[\w-]{20,}$/.test(v) ? null : 'Expected sk-ant-… token'),
    async testKey(value) {
      const r = await getURL('https://api.anthropic.com/v1/models', {
        'x-api-key': value,
        'anthropic-version': '2023-06-01',
      });
      if (r.ok) return { ok: true, note: 'Anthropic accepted the key' };
      return { ok: false, note: `HTTP ${r.status}` };
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hint: 'Used as a low-cost reasoning fallback. From platform.deepseek.com/api_keys.',
    validate: (v) => (/^sk-[\w-]{20,}$/.test(v) ? null : 'Expected sk-… token'),
    async testKey(value) {
      const r = await getURL('https://api.deepseek.com/v1/models', { authorization: `Bearer ${value}` });
      if (r.ok) return { ok: true, note: 'DeepSeek accepted the key' };
      return { ok: false, note: `HTTP ${r.status}` };
    },
  },
  {
    id: 'serper',
    label: 'Serper.dev (Web search)',
    hint: 'Used by the agent for Google web search. From serper.dev/api-key.',
    validate: (v) => (v.length >= 32 && v.length <= 64 ? null : 'Expected a 32-64 char API key'),
    async testKey(value) {
      const r = await postJSON('https://google.serper.dev/search', { q: 'ping', num: 1 }, 8000).then(r => r);
      // Serper requires X-API-KEY header; we redo with proper header here:
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r2 = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': value, 'content-type': 'application/json' },
          body: JSON.stringify({ q: 'ping', num: 1 }),
          signal: ctrl.signal,
        });
        if (r2.ok) return { ok: true, note: 'Serper accepted the key' };
        return { ok: false, note: `HTTP ${r2.status}` };
      } finally {
        clearTimeout(t);
      }
    },
  },
  {
    id: 'github',
    label: 'GitHub (Connect)',
    hint: 'Lets the Manager Agent open PRs and read repos on your behalf. Use a fine-grained PAT.',
    validate: (v) =>
      /^(github_pat_|ghp_)[\w-]{20,}$/.test(v) ? null : 'Expected github_pat_… or ghp_… token',
    async testKey(value) {
      const r = await getURL('https://api.github.com/user', {
        authorization: `Bearer ${value}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-agent-os-admin',
      });
      if (r.ok) {
        const j = await r.json().catch(() => null) as { login?: string } | null;
        return { ok: true, note: `GitHub user: ${j?.login ?? 'authenticated'}` };
      }
      return { ok: false, note: `HTTP ${r.status}` };
    },
    greenAccent: true,
  },
];

export function findProvider(id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
