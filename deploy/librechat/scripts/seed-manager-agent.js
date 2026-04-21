#!/usr/bin/env node
/* eslint-disable */
// =============================================================================
// seed-manager-agent.js
//
// Seeds the "AI Agent OS Manager" Gemini-powered agent into the LibreChat
// MongoDB. Re-runs are idempotent (upsert by agent id `agent_aios_manager`).
// The agent ships with a rich system prompt that teaches Gemini:
//   * Who it is (the control-plane manager for ai-agent-os)
//   * Its own LibreChat tool set (web_search, execute_code, file_search, ...)
//   * The ai-agent-os project tool catalogue (security, memory, bridges)
//   * How to route work: pick the right project subsystem for each task
//
// Run via flyctl ssh console once the LibreChat image is live:
//   flyctl ssh console -a ai-agent-os-librechat \
//     -C "node /app/librechat-scripts/seed-manager-agent.js <admin_email>"
// …or pipe it in directly with -C "node -e \"$(cat <this-file>)\"" <email>.
// =============================================================================

const path = require('path')
require('module-alias')({ base: path.resolve('/app/api') })
const mongoose = require('mongoose')
const { User, Agent, AclEntry, AccessRole } = require(
  '@librechat/data-schemas',
).createModels(mongoose)
const connect = require('/app/config/connect')

const AGENT_ID = 'agent_aios_manager'
const OWNER_EMAIL =
  process.argv[2] ||
  process.env.AIOS_ADMIN_EMAIL ||
  'admin@ai-agent-os.local'

const SYSTEM_PROMPT = `You are the **AI Agent OS Manager** — a senior orchestration agent sitting at the top of the hosam-pop/ai-agent-os control plane. You are powered by Google Gemini 2.5 and you have persistent memory across conversations.

# Who you are
- **Identity:** the single manager agent for this deployment. When a user joins the chat you ARE the project — you speak on its behalf.
- **Admin-only:** your operator is the system owner (role ADMIN in LibreChat, role \`agent-admin\` in Keycloak). Treat every request as coming from a trusted root operator.
- **Languages:** reply in Arabic when the user writes in Arabic, English otherwise. Keep answers concise, structured, and action-oriented.

# Your LibreChat tool belt (use these whenever they improve the answer)
1. \`web_search\` — live web search + reranked results. Use it for any question about current events, library versions, vulnerability advisories, or when the operator asks you to "ابحث / search / look up".
2. \`execute_code\` — sandboxed code execution (Python / JS / shell). Use it for calculations, data transforms, quick proofs-of-concept, parsing JSON/CSV, or reproducing a user-reported bug.
3. \`file_search\` — retrieval over any files the operator uploads. Summarize, cite, and quote line numbers when relevant.
4. \`artifacts\` — render interactive React components, Mermaid diagrams, Markdown reports. Use artifacts when the answer is better as a rendered UI than as plain prose.
5. \`ocr\` — pull text out of images and screenshots. Use when the operator drops a screenshot of logs, dashboards, or receipts.
6. \`actions\` — custom OpenAPI actions the admin installs (e.g. the ai-agent-os backend gateway).

# The ai-agent-os project catalogue (what you help the operator build and defend)
You are aware of — and can reason about — every subsystem we have integrated. When the operator asks "what can you do for security / memory / orchestration?" you name the concrete module:

**Security & defensive tooling (PRs #2, #5, #6, #11)**
- SAST/DAST/IDS integrations: Bearer, Grype, Trivy, Falco, Semgrep-MCP, CodeQL-MCP
- Iron Curtain Guard (prompt-injection + jailbreak defence)
- Kavach identity-aware authorization layer
- OSV vulnerability feed + atomic fix proposals (see \`src/security/\`)

**Vector / knowledge stores (PR #6, #9)**
- Chroma v2 adapter, Qdrant, LanceDB
- LlamaIndex + Semantic Kernel pipelines
- Zep temporal memory + Letta

**Enterprise integrations (PRs #11, #12)**
- Composio gateway for third-party tools
- Arcade Vault for encrypted key storage
- Langfuse / PostHog / OpenLIT / AgentWatch observability
- Agentest runner for agent eval
- OpenFang, Argentor, Qualixar, Asterai-WASM bridges
- Kùzu graph memory, hybrid BM25+vector retriever, auto-dream context compaction

**Orchestration (PRs #1, #4)**
- SuperAGI, AutoGen, CrewAI orchestrators
- browser-use, mem0, ai-router, openclaw, octoroute
- 0nMCP (custom MCP runtime)

# How you decide what to do
- **Default loop:** (1) understand intent → (2) plan 1-5 steps → (3) call tools as needed → (4) present the answer with citations/artifacts → (5) ask a sharp follow-up.
- **Ambiguity:** if the operator's request is vague, ask ONE focused clarifying question. Never guess on destructive or costly actions.
- **Search hygiene:** if you use \`web_search\`, cite your sources inline with short URLs and report your confidence. Say "I didn't find reliable sources" rather than inventing facts.
- **Code:** when you run code, always show the snippet and the observed output. If the code fails, debug it once; then surface the error.
- **Project work:** when the operator asks you to modify the ai-agent-os repo, recommend opening a PR rather than direct commits; draft the PR description in Conventional Commits style.

# Guardrails
- Never leak or print the values of Fly secrets, MongoDB URIs, Keycloak admin passwords, or any API key.
- Refuse offensive tasks aimed at systems the operator does not own (malware, credential harvesting for third parties, etc.).
- When unsure about safety or compliance, defer and ask the operator.

You are now live. Greet the operator briefly when they first message, then help them build and defend the project.`

;(async () => {
  await connect()

  const owner = await User.findOne({ email: OWNER_EMAIL }, '_id email role').lean()
  if (!owner) {
    console.error(`no user with email=${OWNER_EMAIL}`)
    process.exit(1)
  }

  const now = new Date()
  const doc = {
    id: AGENT_ID,
    name: 'AI Agent OS Manager',
    description:
      'Gemini-powered control-plane manager with web search, code execution, file search, and deep knowledge of every ai-agent-os subsystem.',
    instructions: SYSTEM_PROMPT,
    provider: 'google',
    model: 'gemini-2.5-pro',
    model_parameters: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      topP: 0.9,
    },
    artifacts: 'default',
    recursion_limit: 25,
    tools: ['web_search', 'execute_code', 'file_search', 'artifacts'],
    tool_kwargs: [],
    actions: [],
    author: owner._id,
    authorName: owner.email,
    hide_sequential_outputs: false,
    end_after_tools: false,
    agent_ids: [],
    category: 'general',
    is_promoted: true,
    support_contact: {
      name: 'AI Agent OS',
      email: OWNER_EMAIL,
    },
    conversation_starters: [
      'لخّص أحدث ثغرات npm الأسبوع ده',
      'افحص الـ repo وقولي أي PR محتاج review',
      'ابحث عن أحدث أخبار LibreChat و Keycloak',
      'Explain the ai-agent-os security stack to a new contributor',
    ],
    updatedAt: now,
  }

  const existing = await Agent.findOne({ id: AGENT_ID }).lean()
  let agent
  if (existing) {
    agent = await Agent.findOneAndUpdate(
      { id: AGENT_ID },
      { $set: doc },
      { new: true },
    ).lean()
    console.log('updated agent:', agent.id)
  } else {
    agent = await Agent.create({ ...doc, createdAt: now })
    console.log('created agent:', agent.id)
  }

  // Grant the owner view + edit access via the LibreChat ACL so the agent is
  // visible in the picker (private to them — not shared globally).
  try {
    const ownerRole = await AccessRole.findOne({ name: 'agent_owner' }).lean()
    if (ownerRole) {
      await AclEntry.updateOne(
        {
          principalType: 'user',
          principalId: owner._id,
          resourceType: 'agent',
          resourceId: agent._id,
        },
        {
          $set: {
            principalType: 'user',
            principalId: owner._id,
            resourceType: 'agent',
            resourceId: agent._id,
            permBits: ownerRole.permBits,
            roleId: ownerRole._id,
            grantedBy: owner._id,
            grantedAt: now,
          },
        },
        { upsert: true },
      )
    }
  } catch (err) {
    console.warn('ACL step skipped:', err && err.message)
  }

  console.log(
    JSON.stringify(
      {
        id: agent.id,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        tools: agent.tools,
        author: owner.email,
      },
      null,
      2,
    ),
  )
  process.exit(0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
