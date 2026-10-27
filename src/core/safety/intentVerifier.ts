/**
 * Intent Verifier — Formal safety rule evaluation against Intent Graph.
 *
 * Non-neural: evaluates deterministic rules against structured intent.
 * Rule-based validator for the conversational safety domain.
 */

import type {
  CoreIntent,
  IntentGraph,
  SafetyRuleResult,
  VerificationResult,
  TrapAction,
} from './types.js';

interface SafetyRule {
  id: string;
  description: string;
  severity: TrapAction;
  check: (intent: IntentGraph) => SafetyRuleResult;
}

const SAFETY_RULES: SafetyRule[] = [
  {
    id: 'SR-001',
    description: 'Persona override with constraint removal',
    severity: 'block',
    check: (intent) => {
      const violated = intent.core.personaModification && intent.core.constraintRemoval;
      return {
        violated,
        ruleId: 'SR-001',
        reason: violated ? 'Persona change combined with constraint removal' : undefined,
      };
    },
  },
  {
    id: 'SR-002',
    description: 'Dangerous topic targeting others',
    severity: 'block',
    check: (intent) => {
      const violated = intent.core.topicSensitivity === 'dangerous' && intent.core.target === 'others';
      return {
        violated,
        ruleId: 'SR-002',
        reason: violated ? 'Dangerous content targeting others' : undefined,
      };
    },
  },
  {
    id: 'SR-003',
    description: 'High escalation score',
    severity: 'warn',
    check: (intent) => {
      const violated = intent.core.escalationScore > 0.6;
      return {
        violated,
        ruleId: 'SR-003',
        reason: violated ? `Escalation score ${intent.core.escalationScore} exceeds threshold` : undefined,
      };
    },
  },
  {
    id: 'SR-004',
    description: 'Dangerous action request with constraint removal',
    severity: 'block',
    check: (intent) => {
      const violated =
        intent.core.requestType === 'action' &&
        intent.core.topicSensitivity === 'dangerous' &&
        intent.core.constraintRemoval;
      return {
        violated,
        ruleId: 'SR-004',
        reason: violated ? 'Dangerous action with explicit constraint removal' : undefined,
      };
    },
  },
  {
    id: 'SR-005',
    description: 'Meta-request to modify model behavior',
    severity: 'block',
    check: (intent) => {
      const violated =
        intent.core.requestType === 'meta' &&
        (intent.core.personaModification || intent.core.constraintRemoval);
      return {
        violated,
        ruleId: 'SR-005',
        reason: violated ? 'Meta-request attempting to modify safety behavior' : undefined,
      };
    },
  },
];

export class IntentVerifier {
  verify(intent: IntentGraph): VerificationResult {
    const start = Date.now();
    const violations: SafetyRuleResult[] = [];

    for (const rule of SAFETY_RULES) {
      const result = rule.check(intent);
      if (result.violated) {
        violations.push(result);
      }
    }

    const maxSeverity = this.getMaxSeverity(violations);

    return {
      passed: violations.length === 0,
      action: violations.length === 0 ? 'pass' : maxSeverity,
      violations,
      verificationTimeMs: Date.now() - start,
    };
  }

  private getMaxSeverity(violations: SafetyRuleResult[]): TrapAction {
    const ruleMap = new Map(SAFETY_RULES.map(r => [r.id, r.severity]));
    let max: TrapAction = 'log';
    for (const v of violations) {
      const severity = ruleMap.get(v.ruleId) || 'log';
      if (severity === 'block') return 'block';
      if (severity === 'warn') max = 'warn';
    }
    return max;
  }

  /**
   * Build a CoreIntent from InputAnalysis (lightweight extraction without LLM).
   * Used as fallback when model-based intent extraction is unavailable.
   */
  extractCoreIntentFromAnalysis(analysis: import('./types.js').InputAnalysis): CoreIntent {
    let topicSensitivity: CoreIntent['topicSensitivity'] = 'safe';
    const dangerous = /\b(weapon|bomb|explosive|hack|exploit|malware|kill|murder|synthe[st]i[sz]|poison|drug)\b/i;
    const sensitive = /\b(sex|nude|porn|violen|gore|suicide|self[- ]?harm|abuse)\b/i;

    if (dangerous.test(analysis.normalized)) topicSensitivity = 'dangerous';
    else if (sensitive.test(analysis.normalized)) topicSensitivity = 'sensitive';

    let requestType: CoreIntent['requestType'] = 'information';
    if (analysis.hasConstraintRemoval || (analysis.hasPersonaInstruction && analysis.hasCapabilityExpansion)) requestType = 'meta';
    else if (analysis.hasCompletionAttack) requestType = 'creation';
    else if (/\b(how (to|do|can)|step|instruct|guide|tutorial)\b/i.test(analysis.normalized)) requestType = 'action';

    let target: CoreIntent['target'] = 'general';
    if (/\b(someone|people|person|victim|target)\b/i.test(analysis.normalized)) target = 'others';
    else if (/\b(my|myself|i want)\b/i.test(analysis.normalized)) target = 'self';
    else if (/\b(server|system|network|computer|database)\b/i.test(analysis.normalized)) target = 'systems';

    let escalationScore = 0;
    if (analysis.hasConstraintRemoval) escalationScore += 0.3;
    if (analysis.hasCapabilityExpansion) escalationScore += 0.2;
    if (analysis.hasPersonaInstruction) escalationScore += 0.2;
    if (topicSensitivity === 'dangerous') escalationScore += 0.2;
    if (analysis.hasEncodedContent) escalationScore += 0.1;

    return {
      requestType,
      topicSensitivity,
      target,
      personaModification: analysis.hasPersonaInstruction,
      constraintRemoval: analysis.hasConstraintRemoval,
      escalationScore: Math.min(1.0, escalationScore),
    };
  }

  buildIntentGraph(analysis: import('./types.js').InputAnalysis): IntentGraph {
    const core = this.extractCoreIntentFromAnalysis(analysis);

    return {
      root: {
        tag: 'request',
        props: { type: core.requestType },
        children: [
          { tag: 'topic', props: { sensitivity: core.topicSensitivity } },
          { tag: 'target', props: { value: core.target } },
          ...(core.personaModification ? [{ tag: 'persona', props: { modification: true } }] : []),
          ...(core.constraintRemoval ? [{ tag: 'constraint', props: { removal: true } }] : []),
        ],
      },
      core,
    };
  }
}
