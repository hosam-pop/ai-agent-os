// Renders the themed HTML for /admin/keys. Pure string template, no React.
// Styling intentionally mirrors the Keycloak login theme (ai-agent-os-v3.css)
// so admins land on a panel that feels continuous with sign-in.

const PAGE_VERSION = 'v1';

export function renderAdminKeysPage(opts: { signedIn: boolean }): string {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b0f17" />
  <title>API Keys · AI Agent OS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${PAGE_CSS}</style>
</head>
<body data-signed-in="${opts.signedIn ? '1' : '0'}">
  <header class="topbar">
    <div class="brand">
      <span class="brand-pill">AI Agent OS</span>
      <span class="brand-sep">·</span>
      <span class="brand-title" data-i18n="title">API Keys Console</span>
    </div>
    <div class="topbar-actions">
      <button id="lang-toggle" class="ghost-btn" type="button" aria-label="Switch language">العربية</button>
      <button id="signout-btn" class="ghost-btn" type="button" hidden>Sign out</button>
    </div>
  </header>

  <main class="page" id="page-root">
    <section id="login-card" class="card auth-card" hidden>
      <h1 class="card-title" data-i18n="login.title">Sign in to manage keys</h1>
      <p class="card-subtitle" data-i18n="login.subtitle">Admin password required. Same dark gradient as the sign-in page; use a private window.</p>
      <form id="login-form" class="form" autocomplete="off">
        <label class="field">
          <span class="field-label" data-i18n="login.passwordLabel">Admin password</span>
          <input id="login-password" type="password" name="password" required spellcheck="false" autocapitalize="off" autocomplete="current-password" />
        </label>
        <div id="login-error" class="alert alert-error" hidden></div>
        <button id="login-submit" type="submit" class="primary-btn" data-i18n="login.submit">Continue</button>
      </form>
    </section>

    <section id="panel" class="card" hidden>
      <h1 class="card-title" data-i18n="panel.title">Configured integrations</h1>
      <p class="card-subtitle" data-i18n="panel.subtitle">Keys are encrypted at rest with AES-256-GCM. The agent reads them lazily; nothing is logged in plain text.</p>
      <div id="provider-list" class="provider-list" aria-live="polite"></div>
    </section>
  </main>

  <footer class="footer">
    <span data-i18n="footer.note">AI Agent OS · Admin keys ${PAGE_VERSION}</span>
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

  <script>${PAGE_JS}</script>
</body>
</html>`;
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
  max-width: 880px;
  margin: 40px auto 60px;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px;
  box-shadow: var(--shadow);
}
.auth-card { max-width: 420px; margin: 0 auto; }
.card-title { margin: 0 0 6px; font-size: 22px; font-weight: 700; }
.card-subtitle { margin: 0 0 18px; color: var(--text-soft); font-size: 14px; }
.form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 13px; font-weight: 600; color: var(--text-soft); letter-spacing: 0.02em; }
input[type="password"], input[type="text"] {
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
  width: 100%;
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
.alert {
  display: block;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0;
  font-weight: 600;
  font-size: 13px;
}
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
.provider-actions .primary-btn { width: auto; flex: 1 1 auto; min-width: 100px; }
.provider[data-accent="green"] .save-btn {
  background: linear-gradient(90deg, var(--green-a), var(--green-b));
}
.footer {
  text-align: center;
  padding: 24px 0 32px;
  color: var(--text-soft);
  font-size: 12px;
}
html[dir="rtl"] .topbar { flex-direction: row-reverse; }
html[dir="rtl"] .provider-actions { flex-direction: row-reverse; }
`;

const PAGE_JS = String.raw`
(function () {
  const I18N = {
    en: {
      'title': 'API Keys Console',
      'login.title': 'Sign in to manage keys',
      'login.subtitle': 'Admin password required. Same dark gradient as the sign-in page; use a private window.',
      'login.passwordLabel': 'Admin password',
      'login.submit': 'Continue',
      'login.error.generic': 'Sign in failed. Please try again.',
      'login.error.bad': 'Wrong password.',
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
      'footer.note': 'AI Agent OS · Admin keys',
      'signout': 'Sign out',
    },
    ar: {
      'title': 'إدارة مفاتيح الـ API',
      'login.title': 'تسجيل الدخول لإدارة المفاتيح',
      'login.subtitle': 'مطلوب كلمة سر المسؤول. نفس تدرّج صفحة الدخول الداكن؛ استخدم نافذة خاصة.',
      'login.passwordLabel': 'كلمة سر المسؤول',
      'login.submit': 'متابعة',
      'login.error.generic': 'فشل تسجيل الدخول. حاول مرة أخرى.',
      'login.error.bad': 'كلمة سر غير صحيحة.',
      'panel.title': 'التكاملات المفعّلة',
      'panel.subtitle': 'المفاتيح مشفرة تلقائياً (AES-256-GCM). الوكيل يقرأها عند الحاجة فقط، ولا تظهر في السجلات أبداً.',
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
      'footer.note': 'AI Agent OS · إدارة المفاتيح',
      'signout': 'تسجيل الخروج',
    },
  };

  let currentLang = (localStorage.getItem('aaos_lang') || 'en');
  if (currentLang !== 'en' && currentLang !== 'ar') currentLang = 'en';

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

  function showAlert(el, msg, kind) {
    el.textContent = msg;
    el.classList.remove('alert-error', 'alert-ok');
    el.classList.add(kind === 'ok' ? 'alert-ok' : 'alert-error');
    el.hidden = false;
  }

  async function api(path, init) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, init || {}));
    let body = null;
    const text = await r.text();
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    return { ok: r.ok, status: r.status, body: body };
  }

  function renderStatusLabel(status) {
    if (status === 'set') return t('status.set');
    if (status === 'error') return t('status.error');
    return t('status.unset');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString(currentLang === 'ar' ? 'ar-EG' : 'en-US');
    } catch (_) { return iso; }
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
      errEl.hidden = true;
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
      errEl.hidden = true;
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
      errEl.hidden = true;
      const r = await api('/admin/keys/api/' + encodeURIComponent(p.id), { method: 'DELETE' });
      if (!r.ok) {
        showAlert(errEl, (r.body && r.body.message) || t('login.error.generic'), 'error');
        return;
      }
      applyStatus(card, r.body.status);
    });
  }

  function showLogin() {
    document.body.dataset.signedIn = '0';
    document.getElementById('login-card').hidden = false;
    document.getElementById('panel').hidden = true;
    document.getElementById('signout-btn').hidden = true;
    setTimeout(function () { document.getElementById('login-password').focus(); }, 50);
  }

  function showPanel() {
    document.body.dataset.signedIn = '1';
    document.getElementById('login-card').hidden = true;
    document.getElementById('panel').hidden = false;
    document.getElementById('signout-btn').hidden = false;
    loadProviders();
  }

  function attachAuthHandlers() {
    const form = document.getElementById('login-form');
    const errEl = document.getElementById('login-error');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      errEl.hidden = true;
      const password = document.getElementById('login-password').value;
      const r = await api('/admin/keys/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: password }),
      });
      if (!r.ok) {
        const msg = r.status === 401 ? t('login.error.bad') : ((r.body && r.body.message) || t('login.error.generic'));
        showAlert(errEl, msg, 'error');
        return;
      }
      showPanel();
    });
    document.getElementById('signout-btn').addEventListener('click', async function () {
      await api('/admin/keys/api/logout', { method: 'POST' });
      showLogin();
    });
    document.getElementById('lang-toggle').addEventListener('click', function () {
      applyLang(currentLang === 'ar' ? 'en' : 'ar');
    });
  }

  applyLang(currentLang);
  attachAuthHandlers();
  if (document.body.dataset.signedIn === '1') {
    showPanel();
  } else {
    showLogin();
  }
})();
`;
