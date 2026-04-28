/**
 * Identity-layer re-export of KavachAuth.
 *
 * PR #11 shipped `src/security/kavach-auth.ts`. The enterprise brief
 * asks for KavachOS to live under `src/identity/` alongside other
 * identity primitives. Rather than duplicate the code (and its tests),
 * we just re-export — any future consumer can depend on either path.
 */

export {
  KavachAuth,
  type KavachAuthOptions,
  type AgentIdentity,
  type AuthorizeDecision,
  type AuditEvent,
} from '../security/kavach-auth.js';
