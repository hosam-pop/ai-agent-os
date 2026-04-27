// Keycloak Admin REST API client used by the /admin/keys panel for:
//   * password-grant login (username + password -> token)
//   * service-account user CRUD
//   * password resets
//
// All admin operations go through a single confidential client
// (`ai-agent-os-admin-bridge`) with directAccessGrants + serviceAccounts both
// enabled. The client's service account holds the realm-management roles:
// view-users, query-users, manage-users, view-realm.

export interface KeycloakAdminConfig {
  issuer: string; // e.g. https://kc.example.com/realms/ai-agent-os
  clientId: string;
  clientSecret: string;
}

export interface ROPCLoginResult {
  ok: boolean;
  status: number;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  errorDescription?: string;
}

export interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  createdTimestamp?: number;
  realmRoles?: string[];
}

export interface CreateUserInput {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password: string;
  temporary?: boolean;
  realmRoles?: string[];
  enabled?: boolean;
}

const SAFE_USERNAME = /^[a-z0-9._-]{3,64}$/i;

export class KeycloakAdmin {
  private saToken?: { value: string; expiresAt: number };

  constructor(private readonly cfg: KeycloakAdminConfig) {
    if (!cfg.issuer) throw new Error('keycloak issuer is required');
    if (!cfg.clientId) throw new Error('keycloak admin client id is required');
    if (!cfg.clientSecret) throw new Error('keycloak admin client secret is required');
  }

  // Issuer = https://kc.example.com/realms/<realm>
  // Realm-base for admin API = https://kc.example.com/admin/realms/<realm>
  get realmBase(): string {
    const u = new URL(this.cfg.issuer);
    return `${u.origin}/admin/realms/${u.pathname.split('/').filter(Boolean).pop() ?? ''}`;
  }

  get tokenUrl(): string {
    return `${this.cfg.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`;
  }

  // Username + password -> access token. We do NOT keep this token; we extract
  // the roles + sub and embed them in our own signed session cookie.
  async loginWithPassword(username: string, password: string): Promise<ROPCLoginResult> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      username,
      password,
      scope: 'openid roles profile email',
    });
    const resp = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error_description: text.slice(0, 200) };
    }
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        errorDescription:
          (json['error_description'] as string | undefined) ??
          (json['error'] as string | undefined) ??
          'login failed',
      };
    }
    return {
      ok: true,
      status: resp.status,
      accessToken: json['access_token'] as string,
      refreshToken: json['refresh_token'] as string | undefined,
      expiresIn: json['expires_in'] as number | undefined,
    };
  }

  // Lazy service-account token, cached until ~30s before expiry.
  private async serviceAccountToken(): Promise<string> {
    const now = Date.now();
    if (this.saToken && this.saToken.expiresAt > now + 30_000) {
      return this.saToken.value;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });
    const resp = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`service-account token request failed: ${resp.status} ${text.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { access_token: string; expires_in: number };
    this.saToken = {
      value: json.access_token,
      expiresAt: now + json.expires_in * 1000,
    };
    return json.access_token;
  }

  private async adminFetch(
    path: string,
    init?: RequestInit & { json?: unknown },
  ): Promise<{ status: number; ok: boolean; text: string; json?: unknown }> {
    const tok = await this.serviceAccountToken();
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${tok}`);
    if (init?.json !== undefined) {
      headers.set('content-type', 'application/json');
    }
    const resp = await fetch(`${this.realmBase}${path}`, {
      ...init,
      headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
    const text = await resp.text();
    let json: unknown = undefined;
    if (text) {
      try { json = JSON.parse(text); } catch { /* ignore */ }
    }
    return { status: resp.status, ok: resp.ok, text, json };
  }

  async listUsers(opts?: { search?: string; max?: number }): Promise<KeycloakUser[]> {
    const params = new URLSearchParams();
    if (opts?.search) params.set('search', opts.search);
    params.set('max', String(opts?.max ?? 200));
    params.set('briefRepresentation', 'false');
    const resp = await this.adminFetch(`/users?${params.toString()}`);
    if (!resp.ok) throw new Error(`list users failed: ${resp.status} ${resp.text.slice(0, 200)}`);
    const users = (resp.json as KeycloakUser[]) ?? [];
    // Annotate each user with their realm role names (one extra fetch per user;
    // OK because the admin panel is low-traffic and only the admin sees it).
    const out: KeycloakUser[] = [];
    for (const u of users) {
      const rolesResp = await this.adminFetch(`/users/${u.id}/role-mappings/realm`);
      const realmRoles = rolesResp.ok && Array.isArray(rolesResp.json)
        ? (rolesResp.json as Array<{ name: string }>).map(r => r.name)
        : [];
      out.push({ ...u, realmRoles });
    }
    return out;
  }

  async createUser(input: CreateUserInput): Promise<KeycloakUser> {
    if (!SAFE_USERNAME.test(input.username)) {
      throw new Error('username must be 3-64 chars, letters/digits/._- only');
    }
    if (!input.password || input.password.length < 12) {
      throw new Error('password must be at least 12 characters');
    }
    const create = await this.adminFetch('/users', {
      method: 'POST',
      json: {
        username: input.username,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        emailVerified: !!input.email,
        enabled: input.enabled ?? true,
        credentials: [
          { type: 'password', value: input.password, temporary: !!input.temporary },
        ],
      },
    });
    if (!create.ok && create.status !== 201) {
      throw new Error(`create user failed: ${create.status} ${create.text.slice(0, 200)}`);
    }
    // Look up the created user (Keycloak only returns Location header).
    const find = await this.adminFetch(`/users?username=${encodeURIComponent(input.username)}&exact=true`);
    if (!find.ok || !Array.isArray(find.json) || find.json.length === 0) {
      throw new Error('created user but failed to look it up');
    }
    const user = (find.json as KeycloakUser[])[0]!;
    if (input.realmRoles && input.realmRoles.length > 0) {
      await this.assignRealmRoles(user.id, input.realmRoles);
    }
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    const resp = await this.adminFetch(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (!resp.ok && resp.status !== 204) {
      throw new Error(`delete user failed: ${resp.status} ${resp.text.slice(0, 200)}`);
    }
  }

  async resetPassword(userId: string, newPassword: string, temporary = false): Promise<void> {
    if (!newPassword || newPassword.length < 12) {
      throw new Error('password must be at least 12 characters');
    }
    const resp = await this.adminFetch(`/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'PUT',
      json: { type: 'password', value: newPassword, temporary },
    });
    if (!resp.ok && resp.status !== 204) {
      throw new Error(`reset password failed: ${resp.status} ${resp.text.slice(0, 200)}`);
    }
  }

  async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const all = await this.adminFetch('/roles');
    if (!all.ok || !Array.isArray(all.json)) {
      throw new Error(`list realm roles failed: ${all.status}`);
    }
    const wanted = (all.json as Array<{ name: string; id: string }>).filter(r => roleNames.includes(r.name));
    if (wanted.length === 0) return;
    const resp = await this.adminFetch(`/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
      method: 'POST',
      json: wanted,
    });
    if (!resp.ok && resp.status !== 204) {
      throw new Error(`assign roles failed: ${resp.status} ${resp.text.slice(0, 200)}`);
    }
  }

  async removeRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    if (roleNames.length === 0) return;
    const all = await this.adminFetch('/roles');
    if (!all.ok || !Array.isArray(all.json)) return;
    const wanted = (all.json as Array<{ name: string; id: string }>).filter(r => roleNames.includes(r.name));
    if (wanted.length === 0) return;
    const resp = await this.adminFetch(`/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
      method: 'DELETE',
      json: wanted,
    });
    if (!resp.ok && resp.status !== 204) {
      throw new Error(`remove roles failed: ${resp.status} ${resp.text.slice(0, 200)}`);
    }
  }

  // Decode a JWT payload without verification. We use this AFTER ROPC succeeded
  // to extract the user's own sub + roles for the session cookie. The token is
  // never trusted again (we re-verify on every request via our own signature).
  static decodeJwtPayload(token: string): {
    sub?: string;
    preferred_username?: string;
    email?: string;
    realm_access?: { roles?: string[] };
  } {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    try {
      const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      const buf = Buffer.from(padded, 'base64');
      return JSON.parse(buf.toString('utf-8'));
    } catch {
      return {};
    }
  }
}
