// Renders the themed HTML for /admin/keys. Pure string template, no React.
// Styling intentionally mirrors the Keycloak login theme (ai-agent-os-v3.css)
// so admins land on a panel that feels continuous with sign-in.

const PAGE_VERSION = 'v2';

export interface RenderAdminKeysPageOptions {
  signedIn: boolean;
  username?: string;
  email?: string;
}

export function renderAdminKeysPage(opts: RenderAdminKeysPageOptions): string {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b0f17" />
  <title>Admin Console · AI Agent OS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${PAGE_CSS}</style>
</head>
<body data-signed-in="${opts.signedIn ? '1' : '0'}" data-username="${escapeAttr(opts.username ?? '')}" data-email="${escapeAttr(opts.email ?? '')}">
  <header class="topbar">
    <div class="brand">
      <span class="brand-pill">AI Agent OS</span>
      <span class="brand-sep">·</span>
      <span class="brand-title" data-i18n="title">Admin Console</span>
    </div>
    <div class="topbar-actions">
      <span id="who" class="who" hidden></span>
      <button id="lang-toggle" class="ghost-btn" type="button" aria-label="Switch language">العربية</button>
      <button id="signout-btn" class="ghost-btn" type="button" hidden>Sign out</button>
    </div>
  </header>

  <main class="page" id="page-root">
    <section id="login-card" class="card auth-card" hidden>
      <h1 class="card-title" data-i18n="login.title">Sign in to the admin console</h1>
      <p class="card-subtitle" data-i18n="login.subtitle">Authenticate with your AI Agent OS account. Same gradient as the SSO login page.</p>
      <form id="login-form" class="form" autocomplete="off">
        <label class="field">
          <span class="field-label" data-i18n="login.usernameLabel">Username</span>
          <input id="login-username" type="text" name="username" required spellcheck="false" autocapitalize="off" autocomplete="username" />
        </label>
        <label class="field">
          <span class="field-label" data-i18n="login.passwordLabel">Password</span>
          <input id="login-password" type="password" name="password" required spellcheck="false" autocapitalize="off" autocomplete="current-password" />
        </label>
        <div id="login-error" class="alert alert-error" hidden></div>
        <button id="login-submit" type="submit" class="primary-btn" data-i18n="login.submit">Continue</button>
      </form>
    </section>

    <section id="panel" class="panel" hidden>
      <nav class="tabs" role="tablist" aria-label="Admin sections">
        <button class="tab-btn" data-tab="keys" role="tab" aria-selected="true"><span data-i18n="tab.keys">API Keys</span></button>
        <button class="tab-btn" data-tab="users" role="tab" aria-selected="false"><span data-i18n="tab.users">Users</span></button>
        <button class="tab-btn" data-tab="agents" role="tab" aria-selected="false"><span data-i18n="tab.agents">Agent Permissions</span></button>
        <button class="tab-btn" data-tab="account" role="tab" aria-selected="false"><span data-i18n="tab.account">My Account</span></button>
      </nav>

      <section class="card tab-panel" data-tab="keys" role="tabpanel">
        <h1 class="card-title" data-i18n="panel.title">Configured integrations</h1>
        <p class="card-subtitle" data-i18n="panel.subtitle">Keys are encrypted at rest with AES-256-GCM. The agent reads them lazily; nothing is logged in plain text.</p>
        <div id="provider-list" class="provider-list" aria-live="polite"></div>
      </section>

      <section class="card tab-panel" data-tab="users" role="tabpanel" hidden>
        <h1 class="card-title" data-i18n="users.title">Users</h1>
        <p class="card-subtitle" data-i18n="users.subtitle">Add or remove people who can sign in across LibreChat, Keycloak and this console. New accounts are created in the AI Agent OS realm.</p>
        <form id="user-create-form" class="user-create form" autocomplete="off">
          <div class="user-create-row">
            <label class="field">
              <span class="field-label" data-i18n="users.field.username">Username</span>
              <input id="new-username" type="text" required spellcheck="false" />
            </label>
            <label class="field">
              <span class="field-label" data-i18n="users.field.email">Email (optional)</span>
              <input id="new-email" type="text" spellcheck="false" />
            </label>
          </div>
          <div class="user-create-row">
            <label class="field">
              <span class="field-label" data-i18n="users.field.firstName">First name</span>
              <input id="new-firstname" type="text" spellcheck="false" />
            </label>
            <label class="field">
              <span class="field-label" data-i18n="users.field.lastName">Last name</span>
              <input id="new-lastname" type="text" spellcheck="false" />
            </label>
          </div>
          <div class="user-create-row">
            <label class="field">
              <span class="field-label" data-i18n="users.field.password">Initial password</span>
              <input id="new-password" type="password" required spellcheck="false" autocomplete="new-password" />
            </label>
            <label class="checkbox-field">
              <input id="new-temporary" type="checkbox" />
              <span data-i18n="users.field.temporary">Force change on first login</span>
            </label>
          </div>
          <div class="user-create-row">
            <label class="checkbox-field">
              <input id="new-grant-admin" type="checkbox" />
              <span data-i18n="users.field.grantAdmin">Grant admin role (agent-admin)</span>
            </label>
          </div>
          <div id="user-create-error" class="alert alert-error" hidden></div>
          <div id="user-create-ok" class="alert alert-ok" hidden></div>
          <button type="submit" class="primary-btn" data-i18n="users.create">Create user</button>
        </form>
        <h2 class="section-title" data-i18n="users.listTitle">Existing users</h2>
        <div id="user-list" class="user-list" aria-live="polite"></div>
      </section>

      <section class="card tab-panel" data-tab="agents" role="tabpanel" hidden>
        <h1 class="card-title" data-i18n="agents.title">Agent permissions</h1>
        <p class="card-subtitle" data-i18n="agents.subtitle">Decide what each agent is allowed to do. Disabling a capability removes the matching tool from the agent's runtime.</p>
        <div id="agents-runtime" class="runtime-panel" aria-live="polite" hidden>
          <div class="runtime-row">
            <span class="runtime-label" data-i18n="agents.runtime.effectiveTools">Effective LibreChat tools</span>
            <span id="agents-runtime-tools" class="runtime-value"></span>
          </div>
          <div class="runtime-row">
            <span class="runtime-label" data-i18n="agents.runtime.sync">Runtime sync</span>
            <span id="agents-runtime-sync" class="runtime-value"></span>
          </div>
        </div>
        <div id="agents-list" class="agent-list" aria-live="polite"></div>
        <div id="agents-error" class="alert alert-error" hidden></div>
        <div id="agents-ok" class="alert alert-ok" hidden></div>
      </section>

      <section class="card tab-panel" data-tab="account" role="tabpanel" hidden>
        <h1 class="card-title" data-i18n="account.title">My account</h1>
        <p class="card-subtitle" data-i18n="account.subtitle">Change the password for your own AI Agent OS account. The new password applies everywhere (LibreChat, Keycloak, this console).</p>
        <dl id="account-info" class="account-info"></dl>
        <form id="account-password-form" class="form">
          <label class="field">
            <span class="field-label" data-i18n="account.current">Current password</span>
            <input id="account-current" type="password" required autocomplete="current-password" />
          </label>
          <label class="field">
            <span class="field-label" data-i18n="account.next">New password</span>
            <input id="account-next" type="password" required autocomplete="new-password" />
          </label>
          <label class="field">
            <span class="field-label" data-i18n="account.confirm">Confirm new password</span>
            <input id="account-confirm" type="password" required autocomplete="new-password" />
          </label>
          <div id="account-error" class="alert alert-error" hidden></div>
          <div id="account-ok" class="alert alert-ok" hidden></div>
          <button type="submit" class="primary-btn" data-i18n="account.submit">Update password</button>
        </form>
      </section>
    </section>
  </main>

  <footer class="footer">
    <span data-i18n="footer.note">AI Agent OS · Admin console ${PAGE_VERSION}</span>
  </footer>

  <template id="provider-card-tpl">
    <article class="provider" data-provider="">
      <header class="provider-head">
        <div>
          <h2 class="provider-title"></h2>
          <p class="provider-hint"></p>
        </div>
        <span class="provider-status" data-status="unset">…</span>
      </header>
      <div class="provider-meta" hidden>
        <code class="provider-preview"></code>
        <span class="provider-updated"></span>
        <span class="provider-test" hidden></span>
      </div>
      <form class="provider-form">
        <label class="field">
          <span class="field-label" data-i18n="form.keyLabel">API key</span>
          <input type="password" class="provider-input" autocomplete="off" spellcheck="false" />
        </label>
        <div class="provider-error alert alert-error" hidden></div>
        <div class="provider-actions">
          <button type="submit" class="primary-btn save-btn"><span data-i18n="form.save">Save</span></button>
          <button type="button" class="secondary-btn test-btn"><span data-i18n="form.test">Test</span></button>
          <button type="button" class="danger-btn clear-btn" hidden><span data-i18n="form.clear">Clear</span></button>
        </div>
      </form>
    </article>
  </template>

  <template id="user-row-tpl">
    <article class="user-row">
      <div class="user-row-info">
        <h3 class="user-row-name"></h3>
        <p class="user-row-meta"></p>
        <p class="user-row-roles"></p>
      </div>
      <div class="user-row-actions">
        <button type="button" class="secondary-btn user-reset-btn"><span data-i18n="users.row.reset">Reset password</span></button>
        <button type="button" class="secondary-btn user-toggle-admin-btn"><span></span></button>
        <button type="button" class="danger-btn user-delete-btn"><span data-i18n="users.row.delete">Delete</span></button>
      </div>
    </article>
  </template>

  <template id="agent-card-tpl">
    <article class="agent-card" data-agent="">
      <header class="agent-head">
        <h2 class="agent-title"></h2>
        <span class="agent-id"></span>
      </header>
      <div class="agent-caps"></div>
      <div class="agent-actions">
        <button type="button" class="primary-btn save-agent-btn"><span data-i18n="agents.save">Save permissions</span></button>
        <span class="agent-status" hidden></span>
      </div>
    </article>
  </template>

  <script>${PAGE_JS}</script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}

const PAGE_CSS = `
:root {
  color-scheme: dark;
  --bg: #0b0f17;
  --surface: #141a26;
  --surface-2: #1a2230;
  --border: #29334a;
  --text: #f2f6fc;
  --text-soft: #a4adc1;
  --accent-a: rgb(79, 157, 255);
  --accent-b: rgb(122, 92, 255);
  --green-a: rgb(34, 197, 94);
  --green-b: rgb(16, 185, 129);
  --danger-bg: rgb(42, 18, 20);
  --danger-border: rgb(178, 65, 65);
  --danger-fg: rgb(255, 179, 179);
  --ok-bg: rgb(18, 36, 28);
  --ok-border: rgb(72, 167, 119);
  --ok-fg: rgb(174, 232, 200);
  --shadow: 0 30px 60px -25px rgba(7, 12, 24, 0.85);
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top left, #14213a 0%, #0b0f17 60%) fixed;
  color: var(--text);
  font-family: 'Inter', 'Cairo', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
html[lang="ar"], html[lang="ar"] body {
  font-family: 'Cairo', 'Inter', system-ui, sans-serif;
}
html[dir="rtl"] body { direction: rtl; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 28px;
  border-bottom: 1px solid var(--border);
  background: rgba(11, 15, 23, 0.85);
  backdrop-filter: saturate(140%) blur(14px);
  position: sticky;
  top: 0;
  z-index: 5;
}
.brand { display: flex; align-items: center; gap: 12px; font-weight: 600; }
.brand-pill {
  background: linear-gradient(90deg, var(--accent-a), var(--accent-b));
  color: white;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  letter-spacing: 0.04em;
}
.brand-sep { color: var(--text-soft); }
.brand-title { color: var(--text); font-weight: 600; }
.topbar-actions { display: flex; gap: 8px; align-items: center; }
.who { color: var(--text-soft); font-size: 13px; padding: 0 4px; }
.ghost-btn {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.ghost-btn:hover { background: var(--surface-2); border-color: #3a4768; }
.page {
  max-width: 980px;
  margin: 32px auto 60px;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.panel { display: flex; flex-direction: column; gap: 20px; }
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}
.tab-btn {
  background: transparent;
  color: var(--text-soft);
  border: 1px solid transparent;
  border-radius: 10px 10px 0 0;
  padding: 10px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}
.tab-btn:hover { color: var(--text); }
.tab-btn[aria-selected="true"] {
  color: var(--text);
  background: var(--surface);
  border-color: var(--border);
  border-bottom-color: transparent;
  margin-bottom: -1px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px;
  box-shadow: var(--shadow);
}
.auth-card { max-width: 440px; margin: 0 auto; }
.card-title { margin: 0 0 6px; font-size: 22px; font-weight: 700; }
.card-subtitle { margin: 0 0 18px; color: var(--text-soft); font-size: 14px; }
.section-title { font-size: 16px; font-weight: 700; margin: 28px 0 14px; color: var(--text); }
.form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 13px; font-weight: 600; color: var(--text-soft); letter-spacing: 0.02em; }
.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
}
.checkbox-field input { width: 16px; height: 16px; accent-color: var(--accent-a); }
input[type="password"], input[type="text"], input[type="email"] {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  padding: 12px 14px;
  font: inherit;
  width: 100%;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
input:focus {
  border-color: var(--accent-a);
  box-shadow: 0 0 0 3px rgba(79, 157, 255, 0.18);
}
.primary-btn, .secondary-btn, .danger-btn {
  border: none;
  border-radius: 10px;
  padding: 12px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  min-height: 44px;
  transition: filter 0.15s ease, transform 0.05s ease;
}
.primary-btn:active, .secondary-btn:active, .danger-btn:active { transform: translateY(1px); }
.primary-btn {
  background: linear-gradient(90deg, var(--accent-a), var(--accent-b));
  color: white;
}
.primary-btn:hover { filter: brightness(1.05); }
.secondary-btn {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
}
.secondary-btn:hover { background: #202a3d; }
.danger-btn {
  background: rgba(178, 65, 65, 0.18);
  color: rgb(255, 188, 188);
  border: 1px solid rgba(178, 65, 65, 0.4);
}
.danger-btn:hover { background: rgba(178, 65, 65, 0.28); }
#login-form .primary-btn { width: 100%; }
.alert {
  display: block;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0;
  font-weight: 600;
  font-size: 13px;
}
.alert[hidden] { display: none; }
[hidden] { display: none !important; }
.alert-error {
  background-color: var(--danger-bg);
  border: 1px solid var(--danger-border);
  color: var(--danger-fg);
}
.alert-ok {
  background-color: var(--ok-bg);
  border: 1px solid var(--ok-border);
  color: var(--ok-fg);
}
.provider-list { display: grid; grid-template-columns: 1fr; gap: 18px; }
@media (min-width: 720px) { .provider-list { grid-template-columns: 1fr 1fr; } }
.provider {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
  overflow: hidden;
}
.provider[data-accent="green"] {
  border-color: rgba(52, 211, 153, 0.55);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.25), 0 18px 40px -25px rgba(16, 185, 129, 0.55);
}
.provider[data-accent="green"]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), transparent 70%);
  pointer-events: none;
}
.provider-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.provider-title { margin: 0 0 4px; font-size: 17px; font-weight: 700; }
.provider-hint { margin: 0; color: var(--text-soft); font-size: 13px; }
.provider-status {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-soft);
  white-space: nowrap;
}
.provider-status[data-status="set"] {
  border-color: rgba(72, 167, 119, 0.6);
  color: rgb(174, 232, 200);
  background: rgba(34, 197, 94, 0.12);
}
.provider-status[data-status="error"] {
  border-color: rgba(178, 65, 65, 0.6);
  color: rgb(255, 179, 179);
  background: rgba(178, 65, 65, 0.18);
}
.provider-meta {
  font-size: 12px;
  color: var(--text-soft);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
}
.provider-preview {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  color: var(--text);
}
.provider-test[data-ok="true"] { color: rgb(174, 232, 200); }
.provider-test[data-ok="false"] { color: rgb(255, 179, 179); }
.provider-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.provider-actions .primary-btn { flex: 1 1 auto; min-width: 100px; }
.provider[data-accent="green"] .save-btn {
  background: linear-gradient(90deg, var(--green-a), var(--green-b));
}
.user-create { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
.user-create-row { display: grid; grid-template-columns: 1fr; gap: 14px; }
@media (min-width: 720px) { .user-create-row { grid-template-columns: 1fr 1fr; } }
.user-list { display: flex; flex-direction: column; gap: 10px; }
.user-row {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
}
.user-row-info { flex: 1 1 240px; min-width: 0; }
.user-row-name { margin: 0 0 4px; font-size: 15px; font-weight: 600; word-break: break-all; }
.user-row-meta { margin: 0; font-size: 12px; color: var(--text-soft); word-break: break-all; }
.user-row-roles {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.role-pill {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.05);
  font-weight: 600;
  font-size: 11px;
  color: var(--text-soft);
}
.role-pill[data-admin="true"] {
  border-color: rgba(122, 92, 255, 0.55);
  color: #cdb6ff;
  background: rgba(122, 92, 255, 0.18);
}
.user-row-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.agent-list { display: flex; flex-direction: column; gap: 18px; }
.runtime-panel {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.runtime-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 13px;
}
.runtime-label { color: var(--text-soft); min-width: 220px; }
.runtime-value { color: var(--text); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.runtime-value .tool-pill {
  display: inline-block;
  padding: 2px 8px;
  margin-right: 6px;
  margin-bottom: 4px;
  background: rgba(79, 157, 255, 0.15);
  border: 1px solid rgba(79, 157, 255, 0.45);
  border-radius: 999px;
  color: #c8dfff;
  font-size: 12px;
}
.runtime-value[data-state="ok"] { color: var(--ok-fg); }
.runtime-value[data-state="warn"] { color: #f5d08a; }
.runtime-value[data-state="err"] { color: var(--danger-fg); }
.agent-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.agent-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; justify-content: space-between; }
.agent-title { margin: 0; font-size: 17px; font-weight: 700; }
.agent-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-soft);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255,255,255,0.03);
}
.agent-caps {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px 18px;
}
@media (min-width: 720px) { .agent-caps { grid-template-columns: 1fr 1fr; } }
.cap-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
}
.cap-row:hover { background: rgba(255,255,255,0.03); border-color: var(--border); }
.cap-row input { width: 16px; height: 16px; accent-color: var(--accent-a); }
.cap-row .cap-id { color: var(--text-soft); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }
.agent-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.agent-status { font-size: 13px; font-weight: 600; }
.agent-status[data-state="ok"] { color: var(--ok-fg); }
.agent-status[data-state="err"] { color: var(--danger-fg); }
.account-info {
  margin: 0 0 22px;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  font-size: 14px;
}
.account-info dt { color: var(--text-soft); font-weight: 600; }
.account-info dd { margin: 0; color: var(--text); word-break: break-all; }
.footer {
  text-align: center;
  padding: 24px 0 32px;
  color: var(--text-soft);
  font-size: 12px;
}
html[dir="rtl"] .topbar { flex-direction: row-reverse; }
html[dir="rtl"] .provider-actions { flex-direction: row-reverse; }
html[dir="rtl"] .user-row-actions { flex-direction: row-reverse; }
`;

const PAGE_JS = String.raw`
(function () {
  const I18N = {
    en: {
      'title': 'Admin Console',
      'login.title': 'Sign in to the admin console',
      'login.subtitle': 'Authenticate with your AI Agent OS account. Same gradient as the SSO login page.',
      'login.usernameLabel': 'Username',
      'login.passwordLabel': 'Password',
      'login.submit': 'Continue',
      'login.error.generic': 'Sign in failed. Please try again.',
      'login.error.bad': 'Wrong username or password.',
      'login.error.forbidden': "You don't have admin access. Ask another admin to grant the agent-admin role.",
      'tab.keys': 'API Keys',
      'tab.users': 'Users',
      'tab.agents': 'Agent Permissions',
      'tab.account': 'My Account',
      'panel.title': 'Configured integrations',
      'panel.subtitle': 'Keys are encrypted at rest with AES-256-GCM. The agent reads them lazily; nothing is logged in plain text.',
      'form.keyLabel': 'API key',
      'form.save': 'Save',
      'form.test': 'Test',
      'form.clear': 'Clear',
      'status.set': 'Configured',
      'status.unset': 'Not set',
      'status.error': 'Test failed',
      'meta.updated': 'Updated',
      'meta.never': 'Never tested',
      'connect.github': 'Connect GitHub',
      'users.title': 'Users',
      'users.subtitle': 'Add or remove people who can sign in across LibreChat, Keycloak and this console. New accounts are created in the AI Agent OS realm.',
      'users.field.username': 'Username',
      'users.field.email': 'Email (optional)',
      'users.field.firstName': 'First name',
      'users.field.lastName': 'Last name',
      'users.field.password': 'Initial password',
      'users.field.temporary': 'Force change on first login',
      'users.field.grantAdmin': 'Grant admin role (agent-admin)',
      'users.create': 'Create user',
      'users.created': 'User created.',
      'users.listTitle': 'Existing users',
      'users.row.reset': 'Reset password',
      'users.row.delete': 'Delete',
      'users.row.makeAdmin': 'Grant admin',
      'users.row.removeAdmin': 'Revoke admin',
      'users.row.deleteConfirm': 'Delete this user permanently?',
      'users.row.resetPrompt': 'Enter a new password',
      'agents.title': 'Agent permissions',
      'agents.subtitle': "Decide what each agent is allowed to do. Disabling a capability removes the matching tool from the agent's runtime.",
      'agents.save': 'Save permissions',
      'agents.saved': 'Permissions saved.',
      'agents.runtime.effectiveTools': 'Effective LibreChat tools',
      'agents.runtime.sync': 'Runtime sync',
      'agents.runtime.syncOk': 'Synced to LibreChat MongoDB ({tools})',
      'agents.runtime.syncUnchanged': 'Already up to date in LibreChat MongoDB',
      'agents.runtime.syncSkipped': 'MongoDB not configured — saved on volume only',
      'agents.runtime.syncFailed': 'Sync failed: {message}',
      'agents.runtime.noTools': '(no runtime-gated tools enabled)',
      'account.title': 'My account',
      'account.subtitle': 'Change the password for your own AI Agent OS account. The new password applies everywhere (LibreChat, Keycloak, this console).',
      'account.username': 'Username',
      'account.email': 'Email',
      'account.roles': 'Roles',
      'account.current': 'Current password',
      'account.next': 'New password',
      'account.confirm': 'Confirm new password',
      'account.submit': 'Update password',
      'account.updated': 'Password updated.',
      'account.mismatch': 'Passwords do not match.',
      'footer.note': 'AI Agent OS · Admin console',
      'signout': 'Sign out',
    },
    ar: {
      'title': 'لوحة الإدارة',
      'login.title': 'تسجيل الدخول للوحة الإدارة',
      'login.subtitle': 'سجّل الدخول بحسابك في AI Agent OS. نفس تدرّج صفحة الدخول الموحدة.',
      'login.usernameLabel': 'اسم المستخدم',
      'login.passwordLabel': 'كلمة السر',
      'login.submit': 'متابعة',
      'login.error.generic': 'فشل تسجيل الدخول. حاول مرة أخرى.',
      'login.error.bad': 'اسم مستخدم أو كلمة سر غير صحيحة.',
      'login.error.forbidden': 'حسابك ليس له صلاحية الإدارة. اطلب من مسؤول آخر منحك دور agent-admin.',
      'tab.keys': 'مفاتيح الـ API',
      'tab.users': 'المستخدمون',
      'tab.agents': 'صلاحيات الوكلاء',
      'tab.account': 'حسابي',
      'panel.title': 'التكاملات المفعّلة',
      'panel.subtitle': 'المفاتيح مشفّرة تلقائياً (AES-256-GCM). الوكيل يقرأها عند الحاجة فقط، ولا تظهر في السجلات أبداً.',
      'form.keyLabel': 'مفتاح API',
      'form.save': 'حفظ',
      'form.test': 'اختبار',
      'form.clear': 'حذف',
      'status.set': 'مفعّل',
      'status.unset': 'غير مضبوط',
      'status.error': 'الاختبار فشل',
      'meta.updated': 'آخر تحديث',
      'meta.never': 'لم يُختبر بعد',
      'connect.github': 'ربط GitHub',
      'users.title': 'المستخدمون',
      'users.subtitle': 'أضف أو احذف الأشخاص الذين يمكنهم الدخول للموقع و LibreChat و Keycloak ولوحة الإدارة. الحسابات الجديدة تُنشأ في realm الخاص بـ AI Agent OS.',
      'users.field.username': 'اسم المستخدم',
      'users.field.email': 'البريد الإلكتروني (اختياري)',
      'users.field.firstName': 'الاسم الأول',
      'users.field.lastName': 'الاسم الأخير',
      'users.field.password': 'كلمة السر المبدئية',
      'users.field.temporary': 'إجبار تغيير كلمة السر عند أول دخول',
      'users.field.grantAdmin': 'منح صلاحية الإدارة (agent-admin)',
      'users.create': 'إنشاء مستخدم',
      'users.created': 'تم إنشاء المستخدم.',
      'users.listTitle': 'المستخدمون الحاليون',
      'users.row.reset': 'إعادة ضبط كلمة السر',
      'users.row.delete': 'حذف',
      'users.row.makeAdmin': 'منح صلاحية الإدارة',
      'users.row.removeAdmin': 'سحب صلاحية الإدارة',
      'users.row.deleteConfirm': 'هل تريد حذف هذا المستخدم نهائياً؟',
      'users.row.resetPrompt': 'أدخل كلمة السر الجديدة',
      'agents.title': 'صلاحيات الوكلاء',
      'agents.subtitle': 'حدّد ما يستطيع كل وكيل فعله. إلغاء أي قدرة يُزيل الأداة المقابلة من بيئة تشغيل الوكيل.',
      'agents.save': 'حفظ الصلاحيات',
      'agents.saved': 'تم حفظ الصلاحيات.',
      'agents.runtime.effectiveTools': 'أدوات LibreChat الفعّالة',
      'agents.runtime.sync': 'حالة المزامنة',
      'agents.runtime.syncOk': 'تمت المزامنة مع LibreChat MongoDB ({tools})',
      'agents.runtime.syncUnchanged': 'الإعدادات في LibreChat MongoDB مطابقة بالفعل',
      'agents.runtime.syncSkipped': 'MongoDB غير معدّ — الحفظ تمّ على الوحدة فقط',
      'agents.runtime.syncFailed': 'فشلت المزامنة: {message}',
      'agents.runtime.noTools': '(لا توجد أدوات محصورة بالصلاحيات)',
      'account.title': 'حسابي',
      'account.subtitle': 'غيّر كلمة سر حسابك في AI Agent OS. الكلمة الجديدة تنطبق في كل مكان (LibreChat و Keycloak ولوحة الإدارة).',
      'account.username': 'اسم المستخدم',
      'account.email': 'البريد الإلكتروني',
      'account.roles': 'الأدوار',
      'account.current': 'كلمة السر الحالية',
      'account.next': 'كلمة السر الجديدة',
      'account.confirm': 'تأكيد كلمة السر الجديدة',
      'account.submit': 'تحديث كلمة السر',
      'account.updated': 'تم تحديث كلمة السر.',
      'account.mismatch': 'كلمتا السر غير متطابقتين.',
      'footer.note': 'AI Agent OS · لوحة الإدارة',
      'signout': 'تسجيل الخروج',
    },
  };

  const CAP_LABELS = {
    en: {
      'keys.read': 'View API keys',
      'keys.write': 'Add or update API keys',
      'keys.delete': 'Delete API keys',
      'keys.test': 'Run live test on API keys',
      'code.read': 'Read repository files',
      'code.write': 'Edit repository files',
      'code.commit': 'Commit changes to git',
      'code.pr': 'Open or update GitHub pull requests',
      'users.read': 'View users',
      'users.invite': 'Invite or create new users',
      'shell.run': 'Execute shell commands in sandbox',
      'web.search': 'Run web searches',
      'web.fetch': 'Fetch arbitrary URLs',
      'sandbox.run': 'Run code in execution sandbox',
    },
    ar: {
      'keys.read': 'عرض مفاتيح الـ API',
      'keys.write': 'إضافة أو تعديل مفاتيح الـ API',
      'keys.delete': 'حذف مفاتيح الـ API',
      'keys.test': 'تشغيل اختبار حقيقي للمفاتيح',
      'code.read': 'قراءة ملفات المستودع',
      'code.write': 'تعديل ملفات المستودع',
      'code.commit': 'حفظ التغييرات في git',
      'code.pr': 'فتح أو تعديل Pull Requests على GitHub',
      'users.read': 'عرض المستخدمين',
      'users.invite': 'إضافة مستخدمين جدد',
      'shell.run': 'تنفيذ أوامر shell داخل الـ sandbox',
      'web.search': 'إجراء بحث على الإنترنت',
      'web.fetch': 'تحميل أي رابط من الإنترنت',
      'sandbox.run': 'تشغيل الكود داخل sandbox تنفيذي',
    },
  };

  let currentLang = (localStorage.getItem('aaos_lang') || 'en');
  if (currentLang !== 'en' && currentLang !== 'ar') currentLang = 'en';
  let activeTab = 'keys';
  let cachedAccount = null;
  let cachedCapabilities = null;

  function applyLang(lang) {
    currentLang = lang;
    localStorage.setItem('aaos_lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      const val = (I18N[lang] || I18N.en)[key];
      if (val != null) el.textContent = val;
    });
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) langBtn.textContent = lang === 'ar' ? 'English' : 'العربية';
    const signOutBtn = document.getElementById('signout-btn');
    if (signOutBtn) signOutBtn.textContent = (I18N[lang] || I18N.en)['signout'];
  }

  function t(key) {
    return (I18N[currentLang] || I18N.en)[key] || I18N.en[key] || key;
  }

  function capLabel(id) {
    return (CAP_LABELS[currentLang] || CAP_LABELS.en)[id] || id;
  }

  function showAlert(el, msg, kind) {
    el.textContent = msg;
    el.classList.remove('alert-error', 'alert-ok');
    el.classList.add(kind === 'ok' ? 'alert-ok' : 'alert-error');
    el.hidden = false;
  }

  function hideAlert(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  async function api(path, init) {
    const opts = Object.assign({ credentials: 'same-origin' }, init || {});
    if (opts.body) {
      opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    }
    const r = await fetch(path, opts);
    let body = null;
    const text = await r.text();
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    return { ok: r.ok, status: r.status, body: body };
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString(currentLang === 'ar' ? 'ar-EG' : 'en-US');
    } catch (_) { return iso; }
  }

  // ---------- API keys tab (existing behaviour) ----------
  function renderStatusLabel(status) {
    if (status === 'set') return t('status.set');
    if (status === 'error') return t('status.error');
    return t('status.unset');
  }

  function buildProviderCard(p) {
    const tpl = document.getElementById('provider-card-tpl');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.provider = p.id;
    if (p.greenAccent) node.dataset.accent = 'green';
    node.querySelector('.provider-title').textContent = p.greenAccent ? t('connect.github') : p.label;
    node.querySelector('.provider-hint').textContent = p.hint;
    return node;
  }

  function applyStatus(card, statusObj) {
    const badge = card.querySelector('.provider-status');
    const meta = card.querySelector('.provider-meta');
    const preview = card.querySelector('.provider-preview');
    const updated = card.querySelector('.provider-updated');
    const test = card.querySelector('.provider-test');
    const clearBtn = card.querySelector('.clear-btn');
    if (statusObj.configured) {
      let kind = 'set';
      if (statusObj.lastTestOk === false) kind = 'error';
      badge.dataset.status = kind;
      badge.textContent = renderStatusLabel(kind);
      meta.hidden = false;
      preview.textContent = statusObj.preview || '••••';
      updated.textContent = statusObj.updatedAt ? (t('meta.updated') + ': ' + formatDate(statusObj.updatedAt)) : '';
      if (statusObj.lastTestAt) {
        test.hidden = false;
        test.dataset.ok = statusObj.lastTestOk ? 'true' : 'false';
        test.textContent = statusObj.lastTestNote ? (statusObj.lastTestNote + ' · ' + formatDate(statusObj.lastTestAt)) : formatDate(statusObj.lastTestAt);
      } else {
        test.hidden = true;
      }
      clearBtn.hidden = false;
    } else {
      badge.dataset.status = 'unset';
      badge.textContent = renderStatusLabel('unset');
      meta.hidden = true;
      clearBtn.hidden = true;
    }
  }

  async function loadProviders() {
    const list = document.getElementById('provider-list');
    list.innerHTML = '';
    const r = await api('/admin/keys/api/list');
    if (!r.ok) {
      if (r.status === 401) { showLogin(); return; }
      const err = document.createElement('div');
      err.className = 'alert alert-error';
      err.textContent = (r.body && r.body.message) || 'Failed to load providers';
      list.appendChild(err);
      return;
    }
    const providers = r.body.providers || [];
    providers.forEach(function (p) {
      const card = buildProviderCard(p);
      applyStatus(card, p.status);
      attachCardHandlers(card, p);
      list.appendChild(card);
    });
  }

  function attachCardHandlers(card, p) {
    const form = card.querySelector('.provider-form');
    const input = card.querySelector('.provider-input');
    const errEl = card.querySelector('.provider-error');
    const testBtn = card.querySelector('.test-btn');
    const clearBtn = card.querySelector('.clear-btn');

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      hideAlert(errEl);
      const value = input.value.trim();
      if (!value) {
        showAlert(errEl, t('login.error.generic'), 'error');
        return;
      }
      const r = await api('/admin/keys/api/' + encodeURIComponent(p.id), {
        method: 'POST',
        body: JSON.stringify({ value: value }),
      });
      if (!r.ok) {
        showAlert(errEl, (r.body && r.body.message) || t('login.error.generic'), 'error');
        return;
      }
      input.value = '';
      applyStatus(card, r.body.status);
    });

    testBtn.addEventListener('click', async function () {
      hideAlert(errEl);
      testBtn.disabled = true;
      try {
        const r = await api('/admin/keys/api/' + encodeURIComponent(p.id) + '/test', { method: 'POST' });
        if (!r.ok) {
          showAlert(errEl, (r.body && r.body.message) || t('login.error.generic'), 'error');
          return;
        }
        applyStatus(card, r.body.status);
      } finally {
        testBtn.disabled = false;
      }
    });

    clearBtn.addEventListener('click', async function () {
      hideAlert(errEl);
      const r = await api('/admin/keys/api/' + encodeURIComponent(p.id), { method: 'DELETE' });
      if (!r.ok) {
        showAlert(errEl, (r.body && r.body.message) || t('login.error.generic'), 'error');
        return;
      }
      applyStatus(card, r.body.status);
    });
  }

  // ---------- Users tab ----------
  function userIsAdmin(u) {
    return Array.isArray(u.realmRoles) && u.realmRoles.indexOf('agent-admin') !== -1;
  }

  function buildUserRow(u) {
    const tpl = document.getElementById('user-row-tpl');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.userid = u.id;
    node.querySelector('.user-row-name').textContent = u.username;
    const metaParts = [];
    if (u.email) metaParts.push(u.email);
    metaParts.push((u.firstName || '') + (u.lastName ? ' ' + u.lastName : ''));
    if (u.enabled === false) metaParts.push('(disabled)');
    node.querySelector('.user-row-meta').textContent = metaParts.filter(Boolean).join(' · ');
    const rolesEl = node.querySelector('.user-row-roles');
    rolesEl.innerHTML = '';
    (u.realmRoles || []).forEach(function (r) {
      const pill = document.createElement('span');
      pill.className = 'role-pill';
      if (r === 'agent-admin') pill.dataset.admin = 'true';
      pill.textContent = r;
      rolesEl.appendChild(pill);
    });
    const isAdmin = userIsAdmin(u);
    const toggleBtn = node.querySelector('.user-toggle-admin-btn');
    toggleBtn.querySelector('span').textContent = isAdmin ? t('users.row.removeAdmin') : t('users.row.makeAdmin');

    const isSelf = cachedAccount && cachedAccount.userId === u.id;
    if (isSelf) {
      node.querySelector('.user-delete-btn').disabled = true;
      toggleBtn.disabled = true;
    }
    attachUserRowHandlers(node, u);
    return node;
  }

  function attachUserRowHandlers(node, u) {
    const resetBtn = node.querySelector('.user-reset-btn');
    const toggleBtn = node.querySelector('.user-toggle-admin-btn');
    const deleteBtn = node.querySelector('.user-delete-btn');

    resetBtn.addEventListener('click', async function () {
      const next = window.prompt(t('users.row.resetPrompt'));
      if (!next) return;
      const r = await api('/admin/keys/api/users/' + encodeURIComponent(u.id) + '/password', {
        method: 'POST',
        body: JSON.stringify({ password: next, temporary: false }),
      });
      if (!r.ok) {
        window.alert((r.body && r.body.message) || 'Reset failed');
      }
    });

    toggleBtn.addEventListener('click', async function () {
      const isAdmin = userIsAdmin(u);
      const body = isAdmin
        ? { revoke: ['agent-admin'] }
        : { grant: ['agent-admin', 'agent-user'] };
      const r = await api('/admin/keys/api/users/' + encodeURIComponent(u.id) + '/roles', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        window.alert((r.body && r.body.message) || 'Update failed');
        return;
      }
      loadUsers();
    });

    deleteBtn.addEventListener('click', async function () {
      if (!window.confirm(t('users.row.deleteConfirm'))) return;
      const r = await api('/admin/keys/api/users/' + encodeURIComponent(u.id), { method: 'DELETE' });
      if (!r.ok) {
        window.alert((r.body && r.body.message) || 'Delete failed');
        return;
      }
      loadUsers();
    });
  }

  async function loadUsers() {
    const list = document.getElementById('user-list');
    list.innerHTML = '';
    const r = await api('/admin/keys/api/users');
    if (!r.ok) {
      if (r.status === 401) { showLogin(); return; }
      const err = document.createElement('div');
      err.className = 'alert alert-error';
      err.textContent = (r.body && r.body.message) || 'Failed to load users';
      list.appendChild(err);
      return;
    }
    const users = (r.body && r.body.users) || [];
    users.sort(function (a, b) { return (a.username || '').localeCompare(b.username || ''); });
    users.forEach(function (u) { list.appendChild(buildUserRow(u)); });
  }

  function attachUserCreateHandler() {
    const form = document.getElementById('user-create-form');
    const errEl = document.getElementById('user-create-error');
    const okEl = document.getElementById('user-create-ok');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      hideAlert(errEl);
      hideAlert(okEl);
      const payload = {
        username: document.getElementById('new-username').value.trim(),
        email: document.getElementById('new-email').value.trim(),
        firstName: document.getElementById('new-firstname').value.trim(),
        lastName: document.getElementById('new-lastname').value.trim(),
        password: document.getElementById('new-password').value,
        temporary: document.getElementById('new-temporary').checked,
        grantAdmin: document.getElementById('new-grant-admin').checked,
      };
      const r = await api('/admin/keys/api/users', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok) {
        showAlert(errEl, (r.body && r.body.message) || t('login.error.generic'), 'error');
        return;
      }
      showAlert(okEl, t('users.created'), 'ok');
      form.reset();
      loadUsers();
    });
  }

  // ---------- Agent permissions tab ----------
  function buildAgentCard(agent) {
    const tpl = document.getElementById('agent-card-tpl');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.agent = agent.agentId;
    node.querySelector('.agent-title').textContent = agent.label || agent.agentId;
    node.querySelector('.agent-id').textContent = agent.agentId;
    const capsEl = node.querySelector('.agent-caps');
    (cachedCapabilities || []).forEach(function (cap) {
      const row = document.createElement('label');
      row.className = 'cap-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.cap = cap.id;
      checkbox.checked = !!agent.capabilities[cap.id];
      const text = document.createElement('span');
      text.textContent = capLabel(cap.id);
      const id = document.createElement('span');
      id.className = 'cap-id';
      id.textContent = cap.id;
      row.appendChild(checkbox);
      row.appendChild(text);
      row.appendChild(id);
      capsEl.appendChild(row);
    });
    node.querySelector('.save-agent-btn').addEventListener('click', function () {
      saveAgentPolicy(node, agent.agentId);
    });
    return node;
  }

  function renderRuntimeTools(tools) {
    const el = document.getElementById('agents-runtime-tools');
    if (!el) return;
    el.innerHTML = '';
    if (!tools || tools.length === 0) {
      el.textContent = t('agents.runtime.noTools');
      return;
    }
    tools.forEach(function (toolName) {
      const pill = document.createElement('span');
      pill.className = 'tool-pill';
      pill.textContent = toolName;
      el.appendChild(pill);
    });
  }

  function renderRuntimeSync(state, text) {
    const el = document.getElementById('agents-runtime-sync');
    if (!el) return;
    el.dataset.state = state || '';
    el.textContent = text || '';
  }

  function applyRuntimeFromResponse(runtime) {
    const panel = document.getElementById('agents-runtime');
    if (!panel) return;
    if (!runtime) { panel.hidden = true; return; }
    panel.hidden = false;
    if (runtime.effectiveTools) {
      renderRuntimeTools(runtime.effectiveTools);
    } else if (runtime.toolsAfter) {
      renderRuntimeTools(runtime.toolsAfter);
    }
    if (runtime.ok === false && runtime.reason === 'no_mongo_uri') {
      renderRuntimeSync('warn', t('agents.runtime.syncSkipped'));
    } else if (runtime.ok === false) {
      renderRuntimeSync('err', t('agents.runtime.syncFailed').replace('{message}', runtime.message || runtime.reason || ''));
    } else if (runtime.ok && runtime.changed === false) {
      renderRuntimeSync('ok', t('agents.runtime.syncUnchanged'));
    } else if (runtime.ok) {
      const tools = (runtime.toolsAfter || []).join(', ');
      renderRuntimeSync('ok', t('agents.runtime.syncOk').replace('{tools}', tools));
    } else if (runtime.mongoConfigured === false) {
      renderRuntimeSync('warn', t('agents.runtime.syncSkipped'));
    } else {
      renderRuntimeSync('', '');
    }
  }

  async function saveAgentPolicy(node, agentId) {
    const status = node.querySelector('.agent-status');
    status.hidden = true;
    const policyResp = await api('/admin/keys/api/policies');
    if (!policyResp.ok) {
      status.hidden = false;
      status.dataset.state = 'err';
      status.textContent = (policyResp.body && policyResp.body.message) || 'Load failed';
      return;
    }
    const doc = policyResp.body.policy;
    const idx = doc.agents.findIndex(function (a) { return a.agentId === agentId; });
    if (idx === -1) return;
    const caps = {};
    node.querySelectorAll('input[type="checkbox"][data-cap]').forEach(function (cb) {
      caps[cb.dataset.cap] = cb.checked;
    });
    doc.agents[idx].capabilities = caps;
    const save = await api('/admin/keys/api/policies', {
      method: 'PUT',
      body: JSON.stringify({ policy: doc }),
    });
    status.hidden = false;
    if (!save.ok) {
      status.dataset.state = 'err';
      status.textContent = (save.body && save.body.message) || 'Save failed';
    } else {
      status.dataset.state = 'ok';
      status.textContent = t('agents.saved');
      if (save.body && save.body.runtime) {
        applyRuntimeFromResponse(save.body.runtime);
      }
    }
  }

  async function loadAgents() {
    const list = document.getElementById('agents-list');
    list.innerHTML = '';
    const errEl = document.getElementById('agents-error');
    hideAlert(errEl);
    const r = await api('/admin/keys/api/policies');
    if (!r.ok) {
      if (r.status === 401) { showLogin(); return; }
      showAlert(errEl, (r.body && r.body.message) || 'Failed to load policies', 'error');
      return;
    }
    cachedCapabilities = r.body.capabilities || [];
    const agents = (r.body.policy && r.body.policy.agents) || [];
    agents.forEach(function (a) { list.appendChild(buildAgentCard(a)); });

    if (r.body.runtime) {
      const panel = document.getElementById('agents-runtime');
      if (panel) panel.hidden = false;
      renderRuntimeTools(r.body.runtime.effectiveTools);
      if (r.body.runtime.mongoConfigured === false) {
        renderRuntimeSync('warn', t('agents.runtime.syncSkipped'));
      } else {
        renderRuntimeSync('ok', t('agents.runtime.syncUnchanged'));
      }
    }
  }

  // ---------- Account tab ----------
  function renderAccountInfo() {
    const dl = document.getElementById('account-info');
    if (!dl) return;
    dl.innerHTML = '';
    if (!cachedAccount) return;
    const rows = [
      ['account.username', cachedAccount.username || '—'],
      ['account.email', cachedAccount.email || '—'],
      ['account.roles', (cachedAccount.roles || []).join(', ') || '—'],
    ];
    rows.forEach(function (row) {
      const dt = document.createElement('dt');
      dt.textContent = t(row[0]);
      const dd = document.createElement('dd');
      dd.textContent = row[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
  }

  async function loadAccount() {
    const r = await api('/admin/keys/api/account');
    if (!r.ok) {
      if (r.status === 401) { showLogin(); }
      return;
    }
    cachedAccount = r.body;
    const who = document.getElementById('who');
    if (who) {
      who.hidden = false;
      who.textContent = cachedAccount.username || '';
    }
    renderAccountInfo();
  }

  function attachAccountFormHandler() {
    const form = document.getElementById('account-password-form');
    const errEl = document.getElementById('account-error');
    const okEl = document.getElementById('account-ok');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      hideAlert(errEl);
      hideAlert(okEl);
      const current = document.getElementById('account-current').value;
      const next = document.getElementById('account-next').value;
      const confirm = document.getElementById('account-confirm').value;
      if (next !== confirm) {
        showAlert(errEl, t('account.mismatch'), 'error');
        return;
      }
      const r = await api('/admin/keys/api/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!r.ok) {
        showAlert(errEl, (r.body && r.body.message) || t('login.error.generic'), 'error');
        return;
      }
      form.reset();
      showAlert(okEl, t('account.updated'), 'ok');
    });
  }

  // ---------- Tabs ----------
  function setActiveTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      const isActive = btn.dataset.tab === tab;
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.hidden = panel.dataset.tab !== tab;
    });
    if (tab === 'keys') loadProviders();
    else if (tab === 'users') loadUsers();
    else if (tab === 'agents') loadAgents();
    else if (tab === 'account') renderAccountInfo();
  }

  function attachTabHandlers() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setActiveTab(btn.dataset.tab); });
    });
  }

  // ---------- Auth ----------
  function showLogin() {
    document.body.dataset.signedIn = '0';
    document.getElementById('login-card').hidden = false;
    document.getElementById('panel').hidden = true;
    document.getElementById('signout-btn').hidden = true;
    const who = document.getElementById('who');
    if (who) { who.hidden = true; who.textContent = ''; }
    setTimeout(function () { document.getElementById('login-username').focus(); }, 50);
  }

  async function showPanel() {
    document.body.dataset.signedIn = '1';
    document.getElementById('login-card').hidden = true;
    document.getElementById('panel').hidden = false;
    document.getElementById('signout-btn').hidden = false;
    await loadAccount();
    setActiveTab('keys');
  }

  function attachAuthHandlers() {
    const form = document.getElementById('login-form');
    const errEl = document.getElementById('login-error');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      hideAlert(errEl);
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const r = await api('/admin/keys/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password }),
      });
      if (!r.ok) {
        let msg = t('login.error.generic');
        if (r.status === 401) msg = t('login.error.bad');
        else if (r.status === 403) msg = t('login.error.forbidden');
        else if (r.body && r.body.message) msg = r.body.message;
        showAlert(errEl, msg, 'error');
        return;
      }
      showPanel();
    });
    document.getElementById('signout-btn').addEventListener('click', async function () {
      await api('/admin/keys/api/logout', { method: 'POST' });
      cachedAccount = null;
      showLogin();
    });
    document.getElementById('lang-toggle').addEventListener('click', function () {
      applyLang(currentLang === 'ar' ? 'en' : 'ar');
      // re-render any tab content that contains translatable labels
      if (document.body.dataset.signedIn === '1') {
        if (activeTab === 'agents') loadAgents();
        else if (activeTab === 'users') loadUsers();
        else if (activeTab === 'account') renderAccountInfo();
      }
    });
  }

  applyLang(currentLang);
  attachAuthHandlers();
  attachTabHandlers();
  attachUserCreateHandler();
  attachAccountFormHandler();
  if (document.body.dataset.signedIn === '1') {
    showPanel();
  } else {
    showLogin();
  }
})();
`;
