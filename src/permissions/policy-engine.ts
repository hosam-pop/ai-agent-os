import { logger } from '../utils/logger.js';
import { rulesForMode, type PermissionRule, type PolicyAction, type PermissionMode } from './config-rules.js';

export interface PolicyDecision {
  action: PolicyAction;
  rule?: PermissionRule;
  reason?: string;
}

export interface ToolCallDescriptor {
  toolName: string;
  /** A canonical representation of the arguments for pattern matching. */
  argsSignature: string;
  rawArgs: Record<string, unknown>;
}

export class PolicyEngine {
  private rules: PermissionRule[];

  constructor(mode?: PermissionMode, extraRules: PermissionRule[] = []) {
    this.rules = [...rulesForMode(mode), ...extraRules];
  }

  evaluate(call: ToolCallDescriptor): PolicyDecision {
    for (const rule of this.rules) {
      if (rule.tool !== '*' && rule.tool !== call.toolName) continue;
      if (rule.pattern) {
        let re: RegExp;
        try {
          re = new RegExp(rule.pattern, 'i');
        } catch {
          continue;
        }
        if (!re.test(call.argsSignature)) continue;
      }
      logger.debug('policy.match', { tool: call.toolName, action: rule.action, reason: rule.reason });
      return { action: rule.action, rule, reason: rule.reason };
    }
    return { action: 'allow' };
  }

  addRule(rule: PermissionRule): void {
    this.rules.unshift(rule);
  }

  listRules(): PermissionRule[] {
    return [...this.rules];
  }
}
