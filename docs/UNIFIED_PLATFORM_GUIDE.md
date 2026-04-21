# Unified Platform — User & Operator Guide

Short guide for **users** who want to sign in and use the platform, and
**operators** who run it.

## For users

1. Go to the platform URL (your operator will share it).
2. Click **Sign in with AI Agent OS** — you'll be redirected to the
   branded Keycloak page.
3. Enter your email + password. If MFA is enabled, enter the TOTP code.
4. You'll be redirected back to LibreChat and can start chatting with
   the agent immediately.

### Managing your account

- **Profile & password** → Keycloak *Account Console*
  (`https://<keycloak>/realms/ai-agent-os/account`).
- **Enable 2FA (TOTP)** → Account Console → *Signing in* → *Set up
  Authenticator application*. Scan the QR with FreeOTP, Google
  Authenticator, or Microsoft Authenticator.
- **Hardware security key (WebAuthn)** → Account Console → *Signing in*
  → *Add security key*.
- **Reset forgotten password** → on the Keycloak login page, click
  *Forgot password*.
- **Sign out everywhere** → Account Console → *Devices* → *Sign out all
  sessions*.

### What you can and can't do

| Role          | Can chat | Can call /api/agent | Can see dashboards | Can manage users |
| ------------- | :------: | :-----------------: | :----------------: | :--------------: |
| `agent-user`  | ✅       | ✅                  | ❌                 | ❌               |
| `agent-auditor` | ✅     | ❌                  | ✅ (read-only)     | ❌               |
| `agent-admin` | ✅       | ✅                  | ✅                 | ✅               |

## For operators

### Daily ops

```bash
# Tail API gateway logs
flyctl logs -a ai-agent-os-gateway

# Tail Keycloak logs
flyctl logs -a ai-agent-os-keycloak

# Health overview (unauth)
curl -sS https://ai-agent-os-gateway.fly.dev/api/health | jq .
```

### Creating a new user

Option A — Admin console UI (recommended):

1. Open `https://ai-agent-os-keycloak.fly.dev/admin`.
2. Log in as admin.
3. Switch realm to `ai-agent-os`.
4. *Users* → *Add user* → fill in `username`, `email`, `firstName`,
   `lastName`. Enable *Email verified*.
5. *Credentials* tab → set an initial password, check *Temporary* so
   the user must change it on first login.
6. *Role mapping* tab → add `agent-user` (and `agent-admin` if warranted).

Option B — CLI:

```bash
flyctl ssh console -a ai-agent-os-keycloak -C "\
  kcadm.sh config credentials --server http://localhost:8080 \
    --realm master --user $KEYCLOAK_ADMIN --password $KEYCLOAK_ADMIN_PASSWORD && \
  kcadm.sh create users -r ai-agent-os \
    -s username=alice -s email=alice@example.com -s enabled=true && \
  kcadm.sh set-password -r ai-agent-os --username alice \
    --new-password '<strong-temporary>' --temporary && \
  kcadm.sh add-roles -r ai-agent-os --uusername alice --rolename agent-user"
```

### Rotating the Keycloak admin password

```bash
NEW=$(openssl rand -base64 32)
flyctl secrets set -a ai-agent-os-keycloak KEYCLOAK_ADMIN_PASSWORD="$NEW"
# On Keycloak 26, the bootstrap password only applies on first boot;
# for subsequent rotations use the admin console (Users → admin →
# Credentials → Reset password) and keep the env var in sync.
```

### Responding to a compromised session

1. *Admin console → Sessions → Logout all* (realm-wide) OR select the
   single user under *Users → <name> → Sessions → Logout*.
2. Rotate `OPENID_CLIENT_SECRET_LIBRECHAT` per
   <ref_file file="/home/ubuntu/repos/ai-agent-os/docs/SSO_SETUP.md" />.
3. Revoke any outstanding offline tokens: *Clients → ai-agent-os-librechat
   → Advanced → Revoke refresh tokens*.

### Scaling

- Gateway is stateless — scale with `flyctl scale count 3 -a ai-agent-os-gateway`.
- Keycloak uses Infinispan embedded cache; clustered boot is supported
  but starts at 2 machines (`flyctl scale count 2 -a ai-agent-os-keycloak`).
  The realm JSON is re-imported on every machine boot, so realm changes
  made via the admin console survive deploy only if they're re-exported
  (`kcadm.sh get realms/ai-agent-os -o -c`).

### Backup

- Postgres: Fly volume snapshots (default daily). `flyctl postgres
  backup list -a ai-agent-os-keycloak-db`.
- Realm definition: committed as
  `deploy/keycloak/realm/ai-agent-os-realm.json`.
- LibreChat conversations: MongoDB Atlas backup policy (managed).
