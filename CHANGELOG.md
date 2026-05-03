# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Comprehensive CI/CD Pipeline (GitHub Actions)
- Security scanning workflow (Semgrep, CodeQL, GitLeaks)
- Performance benchmarks workflow
- Unit tests for core modules
- Vitest configuration with coverage reporting
- Projects comparison documentation

### Changed
- Updated package.json scripts for testing
- Enhanced test coverage

---

## [1.0.0] - 2026-04-27

### Added

#### Features
- **Auto-Healing Agent System** - Automatic error recovery with circuit breaker
- **Token Optimization Stack** - Comprehensive token optimization:
  - Semantic Cache (70-90% savings on repeated queries)
  - Prompt Compression
  - Smart Model Router
  - Anthropic Prompt Caching (90% discount)
  - Token Budget Manager
- **Code Sandbox MCP Worker** - Secure code execution
- **Runtime Tool-Gating** - Dynamic tool enable/disable
- **Unified Admin Console** - Keycloak SSO + user management
- **Admin API Keys Panel** - Manage API keys with UI
- **Keycloak Login Theme** - Arabic locale support
- **Web Search Integration** - Self-hosted SearXNG
- **LibreChat Phase A** - Agent tools + admin role
- **Enterprise Architecture v1**:
  - Rust/WASM bridges
  - Graph/Temporal/Hybrid memory
  - Auto-Dream feature
- **Composio/Arcade/Kavach Integration**
- **Langfuse/PostHog/OpenLIT Observability**
- **AgentWatch/Agentest Testing**
- **ToolDiscoveryNode**
- **End-to-End Security Demo**

#### Security
- **SAST Tools**: Semgrep, CodeQL, Bearer
- **DAST Tools**: Nuclei, OWASP ZAP
- **Container Scanning**: Grype, Trivy
- **Log Analysis**: Elasticsearch, Wazuh
- **IDS**: Suricata eve.json reader
- **LLM Guard**: Prompt injection scanner

#### Orchestration
- **Crew** - CrewAI-style multi-agent coordination
- **GroupChat** - AutoGen-style group conversations
- **StateGraph** - LangGraph-style state machines
- **TaskQueue** - SuperAGI-style task management

### Fixed
- MCP mount path for Fly.io deployment
- DNS-rebinding protection for Fly hosts
- CSP allow inline scripts + Google Fonts
- Vector store adapters (Chroma v1→v2 migration)

### Security Fixes
- API critical issues resolved
- Keycloak login theme polish

---

## [0.1.0] - 2026-04-18

### Added
- Initial project setup
- Claude-Code integration (BUDDY, KAIROS, ULTRAPLAN, COORDINATOR, BRIDGE)
- doge-code integration (path layout, custom provider)
- Agent loop implementation
- Tool registry with bash, file, web tools
- Short and long-term memory
- Feature flags system
- CLI with Ink TUI
- Docker configuration
- Basic API Gateway

---

## Migration Guides

### v0.1.0 to v1.0.0

**Breaking Changes:**
- Environment variables now use `DOGE_` prefix consistently
- Feature flags renamed: `ENABLE_*` → `DOGE_FEATURE_*`
- Some config paths moved to `~/.doge/`

**New Dependencies:**
- `vitest` for testing
- `fastify` for API gateway
- `@fastify/rate-limit` for rate limiting

---

## Deprecation Notices

### Planned Deprecations
- `DOGE_FEATURE_IRON_CURTAIN` - Will be replaced by `DOGE_FEATURE_KAVACH` in v1.1.0
- Legacy `~/.doge/` structure - Will migrate to `~/.ai-agent-os/` in v1.2.0

---

## Links

- [Repository](https://github.com/hosam-pop/ai-agent-os)
- [Issues](https://github.com/hosam-pop/ai-agent-os/issues)
- [Pull Requests](https://github.com/hosam-pop/ai-agent-os/pulls)