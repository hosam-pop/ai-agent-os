# GitHub Secrets Setup Guide

This guide helps you configure the required GitHub Secrets for the AI Agent OS CI/CD pipeline.

## Required Secrets

### For CI/CD Pipeline (`.github/workflows/ci-cd.yml`)

| Secret Name | Description | Required |
|------------|-------------|----------|
| `FLY_API_TOKEN` | Fly.io API token for deployment | ✅ (deployment) |
| `DOGE_HOME` | Home directory path | ✅ |

### For Security Workflow (`.github/workflows/security.yml`)

| Secret Name | Description | Required |
|------------|-------------|----------|
| `SNYK_TOKEN` | Snyk security scanner token | Optional |
| `TRIVY_DB.Repository` | Trivy database repository | Optional |

## How to Add Secrets

### Option 1: GitHub Web Interface

1. Go to your repository: `https://github.com/hosam-pop/ai-agent-os`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the secret name and value

### Option 2: GitHub CLI

```bash
gh secret set FLY_API_TOKEN --body "your-fly-token"
gh secret set DOGE_HOME --body "/home/runner/.doge"
```

## Getting Your Fly.io Token

1. Install Fly CLI: `npm install -g flyctl`
2. Login: `fly auth login`
3. Create token: `fly tokens create`
4. Copy the token and add it as `FLY_API_TOKEN`

## Optional: Additional Secrets

For enhanced monitoring, add:

```bash
gh secret set LANGFUSE_PUBLIC_KEY --body "your-langfuse-key"
gh secret set LANGFUSE_SECRET_KEY --body "your-langfuse-secret"
gh secret set POSTHOG_API_KEY --body "your-posthog-key"
```

## Verification

After adding secrets, the workflows will use them automatically:

- CI/CD: Builds, tests, and deploys on push
- Security: Scans code for vulnerabilities
- Benchmarks: Runs performance tests