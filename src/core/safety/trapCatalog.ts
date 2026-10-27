/**
 * TRAP Catalog — Jailbreak Attack Pattern Registry
 *
 * Deterministic, non-neural detection rules for known jailbreak classes.
 * Each TRAP has: surface pattern detection + discrimination rule (avoids FP).
 *
 * TRAP approach: observe → catalog → formalize → block.
 */

import type { TrapDefinition, InputAnalysis } from './types.js';

// ── CLASS 01: Persona Override ──

const TRAP_J_001: TrapDefinition = {
  id: 'TRAP-J-001',
  class: 'PERSONA_OVERRIDE',
  name: 'Explicit persona replacement with constraint removal',
  severity: 'HIGH',
  action: 'block',
  description: 'Instructs model to adopt new identity that removes safety constraints',
  surfacePatterns: [
    { pattern: /you are (now\s)?/i, weight: 0.5, description: 'identity assignment' },
    { pattern: /act as/i, weight: 0.4, description: 'role assignment' },
    { pattern: /pretend/i, weight: 0.4, description: 'pretend framing' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.hasPersonaInstruction && a.hasConstraintRemoval,
};

const TRAP_J_002: TrapDefinition = {
  id: 'TRAP-J-002',
  class: 'PERSONA_OVERRIDE',
  name: 'DAN/jailbreak persona invocation',
  severity: 'CRITICAL',
  action: 'block',
  description: 'Specific known jailbreak personas (DAN, STAN, Evil, etc.)',
  surfacePatterns: [
    { pattern: /\bdan\b/i, weight: 0.6, description: 'DAN reference' },
    { pattern: /do anything now/i, weight: 0.9, description: 'DAN expansion' },
    { pattern: /\bstan\b/i, weight: 0.4, description: 'STAN persona' },
    { pattern: /evil (bot|ai|assistant|mode)/i, weight: 0.8, description: 'evil persona' },
    { pattern: /opposite mode/i, weight: 0.7, description: 'opposite mode' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.hasPersonaInstruction || a.hasConstraintRemoval || a.hasCapabilityExpansion,
};

const TRAP_J_003: TrapDefinition = {
  id: 'TRAP-J-003',
  class: 'PERSONA_OVERRIDE',
  name: 'System prompt override claim',
  severity: 'CRITICAL',
  action: 'block',
  description: 'Claims to override or replace system instructions',
  surfacePatterns: [
    { pattern: /new system prompt/i, weight: 0.9, description: 'system prompt claim' },
    { pattern: /system prompt.*(overr|replac|ignor|chang)/i, weight: 0.9, description: 'system override' },
    { pattern: /above (instructions|prompt|rules)/i, weight: 0.5, description: 'above reference' },
    { pattern: /your (initial|original|first) (prompt|instructions)/i, weight: 0.6, description: 'original prompt reference' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.hasConstraintRemoval || /system\s*prompt/i.test(a.normalized),
};

// ── CLASS 02: Encoding Bypass ──

const TRAP_J_010: TrapDefinition = {
  id: 'TRAP-J-010',
  class: 'ENCODING_BYPASS',
  name: 'Base64 encoded harmful content',
  severity: 'HIGH',
  action: 'block',
  description: 'Harmful request hidden in base64 encoding',
  surfacePatterns: [
    { pattern: /[A-Za-z0-9+/]{30,}={0,2}/, weight: 0.7, description: 'base64 block' },
    { pattern: /decode (this|the following|base64)/i, weight: 0.6, description: 'decode instruction' },
    { pattern: /base64/i, weight: 0.4, description: 'base64 mention' },
  ],
  discriminate: (a: InputAnalysis) => {
    if (!a.hasEncodedContent || a.encodingType !== 'base64') return false;
    if (!a.decodedContent) return false;
    const harmful = /\b(hack|exploit|bomb|weapon|kill|drug|synthe[st]i[sz]|attack)\b/i;
    return harmful.test(a.decodedContent);
  },
};

const TRAP_J_011: TrapDefinition = {
  id: 'TRAP-J-011',
  class: 'ENCODING_BYPASS',
  name: 'Hex/Unicode escape encoding',
  severity: 'HIGH',
  action: 'block',
  description: 'Harmful content in hex or unicode escapes',
  surfacePatterns: [
    { pattern: /(\\x[0-9a-f]{2}){5,}/i, weight: 0.8, description: 'hex sequence' },
    { pattern: /(\\u[0-9a-f]{4}){5,}/i, weight: 0.8, description: 'unicode sequence' },
    { pattern: /(&#x?[0-9a-f]+;){5,}/i, weight: 0.7, description: 'html entities' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.hasEncodedContent && (a.encodingType === 'hex' || a.encodingType === 'unicode'),
};

const TRAP_J_012: TrapDefinition = {
  id: 'TRAP-J-012',
  class: 'ENCODING_BYPASS',
  name: 'Character splitting/obfuscation',
  severity: 'MEDIUM',
  action: 'warn',
  description: 'Words broken into characters or using separators to avoid detection',
  surfacePatterns: [
    { pattern: /[a-z][\s._-][a-z][\s._-][a-z][\s._-][a-z]/i, weight: 0.5, description: 'split chars' },
    { pattern: /\b\w\s\w\s\w\s\w\s\w\b/, weight: 0.4, description: 'space-separated letters' },
  ],
  discriminate: (a: InputAnalysis) => {
    const spaced = a.normalized.replace(/[\s._-]+/g, '');
    const harmful = /\b(bomb|weapon|hack|exploit|drug)\b/i;
    return harmful.test(spaced);
  },
};

// ── CLASS 03: Context Manipulation ──

const TRAP_J_020: TrapDefinition = {
  id: 'TRAP-J-020',
  class: 'CONTEXT_MANIPULATION',
  name: 'Few-shot compliance injection',
  severity: 'HIGH',
  action: 'block',
  description: 'Provides fake examples of model complying with harmful requests',
  surfacePatterns: [
    { pattern: /example\s*\d?\s*:/i, weight: 0.3, description: 'example format' },
    { pattern: /(user|human)\s*:.*\n.*(assistant|ai|bot)\s*:/i, weight: 0.6, description: 'conversation format' },
    { pattern: /here'?s? (how|an example of how) (you|the ai)/i, weight: 0.5, description: 'example framing' },
  ],
  discriminate: (a: InputAnalysis) => {
    const hasFakeExchange = /(user|human)\s*:.*\n.*(assistant|ai|bot|model)\s*:/i.test(a.raw);
    return hasFakeExchange && (a.hasConstraintRemoval || a.hasCapabilityExpansion);
  },
};

const TRAP_J_021: TrapDefinition = {
  id: 'TRAP-J-021',
  class: 'CONTEXT_MANIPULATION',
  name: 'Instruction buried in long context',
  severity: 'MEDIUM',
  action: 'warn',
  description: 'Harmful instruction hidden within large block of innocent text',
  surfacePatterns: [
    { pattern: /now (actually|really|truly) (do|answer|respond|tell)/i, weight: 0.5, description: 'pivot marker' },
    { pattern: /ignore (everything|all) (above|before|previously)/i, weight: 0.7, description: 'ignore previous' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.tokens.length > 200 && a.hasConstraintRemoval,
};

// ── CLASS 04: Logical Tricks ──

const TRAP_J_030: TrapDefinition = {
  id: 'TRAP-J-030',
  class: 'LOGICAL_TRICK',
  name: 'Hypothetical framing of harmful request',
  severity: 'MEDIUM',
  action: 'warn',
  description: 'Uses hypothetical/educational framing to elicit harmful content',
  surfacePatterns: [
    { pattern: /hypothetically/i, weight: 0.4, description: 'hypothetical keyword' },
    { pattern: /for (educational|research|academic) purposes/i, weight: 0.5, description: 'academic framing' },
    { pattern: /in theory/i, weight: 0.3, description: 'theory framing' },
  ],
  discriminate: (a: InputAnalysis) => {
    const dangerousTopics = /\b(hack|exploit|weapon|bomb|synthe[st]i[sz]|poison|malware|ransomware|methamphetamine|fentanyl|ricin|sarin|anthrax)\b/i;
    return a.hasHypotheticalFrame && dangerousTopics.test(a.normalized);
  },
};

const TRAP_J_031: TrapDefinition = {
  id: 'TRAP-J-031',
  class: 'LOGICAL_TRICK',
  name: 'Negation inversion',
  severity: 'MEDIUM',
  action: 'warn',
  description: 'Asks what NOT to do to get instructions for what TO do',
  surfacePatterns: [
    { pattern: /what (should|would) (someone|I|you) (not|never) do/i, weight: 0.5, description: 'negation question' },
    { pattern: /tell me (what|how) not to/i, weight: 0.4, description: 'not-to framing' },
    { pattern: /mistakes.*(to avoid|people make)/i, weight: 0.3, description: 'mistakes framing' },
  ],
  discriminate: (a: InputAnalysis) => {
    const dangerousTopics = /\b(hack|break into|exploit|attack|synthesiz|manufacture)\b/i;
    return dangerousTopics.test(a.normalized);
  },
};

const TRAP_J_032: TrapDefinition = {
  id: 'TRAP-J-032',
  class: 'LOGICAL_TRICK',
  name: 'Completion/continuation attack',
  severity: 'HIGH',
  action: 'block',
  description: 'Provides beginning of harmful content and asks to continue',
  surfacePatterns: [
    { pattern: /continue (this|writing|the following|from where)/i, weight: 0.5, description: 'continue instruction' },
    { pattern: /complete (this|the following)/i, weight: 0.5, description: 'complete instruction' },
    { pattern: /finish (this|the )/i, weight: 0.4, description: 'finish instruction' },
  ],
  discriminate: (a: InputAnalysis) => {
    if (!a.hasCompletionAttack) return false;
    const harmful = /\b(step \d|ingredient|component|wire|chemical|formula)\b/i;
    return harmful.test(a.normalized);
  },
};

// ── CLASS 05: Technical Exploits ──

const TRAP_J_040: TrapDefinition = {
  id: 'TRAP-J-040',
  class: 'TECHNICAL_EXPLOIT',
  name: 'Adversarial token suffix (GCG-style)',
  severity: 'CRITICAL',
  action: 'block',
  description: 'Random/gibberish suffix designed to override alignment',
  surfacePatterns: [
    { pattern: /[\x00-\x1f]{3,}/, weight: 0.9, description: 'control characters' },
    { pattern: /(\w{20,}\s){3,}/, weight: 0.7, description: 'abnormally long tokens' },
    { pattern: /\w{40,}/, weight: 0.8, description: 'extremely long single token' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.perplexityEstimate === 'anomalous' || a.perplexityEstimate === 'suspicious',
};

const TRAP_J_041: TrapDefinition = {
  id: 'TRAP-J-041',
  class: 'TECHNICAL_EXPLOIT',
  name: 'Prompt injection via meta-instructions',
  severity: 'CRITICAL',
  action: 'block',
  description: 'Instructions targeting the safety system itself',
  surfacePatterns: [
    { pattern: /intent (analysis|graph|system).*(broken|disabled|off)/i, weight: 0.9, description: 'target intent system' },
    { pattern: /safety (system|filter|check).*(broken|disabled|bypass|off)/i, weight: 0.9, description: 'target safety system' },
    { pattern: /output.*(safe|clean|harmless).*regardless/i, weight: 0.8, description: 'force safe output' },
    { pattern: /your (filter|classifier|detector) (is|has been)/i, weight: 0.6, description: 'reference internal system' },
  ],
  discriminate: (a: InputAnalysis) =>
    /safety|filter|classifier|intent|detector|pipeline/i.test(a.normalized) &&
    (a.hasConstraintRemoval || /broken|disabled|bypass|off|ignore/i.test(a.normalized)),
};

const TRAP_J_042: TrapDefinition = {
  id: 'TRAP-J-042',
  class: 'TECHNICAL_EXPLOIT',
  name: 'Token manipulation (leetspeak, zero-width)',
  severity: 'MEDIUM',
  action: 'warn',
  description: 'Uses character substitution to evade keyword filters',
  surfacePatterns: [
    { pattern: /[\u200b-\u200f\u2060-\u206f\ufeff]/, weight: 0.8, description: 'zero-width chars' },
    { pattern: /[0-9@$!]{3,}.*[a-z]/i, weight: 0.3, description: 'leetspeak indicators' },
  ],
  discriminate: (a: InputAnalysis) => {
    const zwCount = (a.raw.match(/[\u200b-\u200f\u2060-\u206f\ufeff]/g) || []).length;
    return zwCount >= 3;
  },
};

// ── CLASS 06: Authority Claims ──

const TRAP_J_050: TrapDefinition = {
  id: 'TRAP-J-050',
  class: 'AUTHORITY_CLAIM',
  name: 'False authority claim',
  severity: 'HIGH',
  action: 'block',
  description: 'Claims authorization from AI company or special access level',
  surfacePatterns: [
    { pattern: /openai/i, weight: 0.3, description: 'OpenAI reference' },
    { pattern: /anthropic/i, weight: 0.3, description: 'Anthropic reference' },
    { pattern: /(authorized|approved|allowed) (by|from|this)/i, weight: 0.6, description: 'authorization claim' },
    { pattern: /developer mode/i, weight: 0.7, description: 'dev mode claim' },
  ],
  discriminate: (a: InputAnalysis) =>
    a.hasAuthorityBypss && (a.hasConstraintRemoval || a.hasCapabilityExpansion),
};

const TRAP_J_051: TrapDefinition = {
  id: 'TRAP-J-051',
  class: 'AUTHORITY_CLAIM',
  name: 'Urgency/emergency manipulation',
  severity: 'MEDIUM',
  action: 'warn',
  description: 'Uses urgency/emergency framing to bypass safety checks',
  surfacePatterns: [
    { pattern: /this is (an? )?(emergency|urgent|life[- ]?threatening)/i, weight: 0.5, description: 'emergency claim' },
    { pattern: /someone (will|is going to) die/i, weight: 0.6, description: 'life threat' },
    { pattern: /lives? (depend|at stake|in danger)/i, weight: 0.5, description: 'lives at stake' },
  ],
  discriminate: (a: InputAnalysis) => {
    const harmful = /\b(hack|weapon|explosive|synthe[st]i[sz]|poison)\b/i;
    return harmful.test(a.normalized);
  },
};

// ── OUTPUT-SIDE TRAPs ──

const TRAP_J_OUT_001: TrapDefinition = {
  id: 'TRAP-J-OUT-001',
  class: 'OUTPUT_HARMFUL',
  name: 'Step-by-step harmful instructions in output',
  severity: 'CRITICAL',
  action: 'block',
  description: 'Model output contains numbered/sequential harmful instructions',
  surfacePatterns: [
    { pattern: /step\s*[1-9]\s*[:.]/i, weight: 0.3, description: 'step numbering' },
    { pattern: /\d+\.\s*(first|next|then|finally|mix|combine|attach|connect|wire)/i, weight: 0.4, description: 'sequential instructions' },
  ],
  discriminate: (a: InputAnalysis) => {
    const harmful = /\b(detonate|explode|ignite|synthesiz|inject|exploit|vulnerability|payload)\b/i;
    const hasSteps = (a.raw.match(/step\s*\d|^\d+\./gmi) || []).length >= 3;
    return hasSteps && harmful.test(a.normalized);
  },
};

const TRAP_J_OUT_002: TrapDefinition = {
  id: 'TRAP-J-OUT-002',
  class: 'OUTPUT_HARMFUL',
  name: 'Code/script with malicious intent in output',
  severity: 'HIGH',
  action: 'block',
  description: 'Output contains code designed for unauthorized access or damage',
  surfacePatterns: [
    { pattern: /```(python|bash|sh|powershell|cmd)/i, weight: 0.2, description: 'code block' },
  ],
  discriminate: (a: InputAnalysis) => {
    const malicious = /\b(reverse.?shell|rm\s+-rf|format\s+c:|keylog|credential.?dump|privilege.?escalat)\b/i;
    return malicious.test(a.normalized);
  },
};

// ── Catalog Export ──

export const TRAP_CATALOG: TrapDefinition[] = [
  // Class 01: Persona Override
  TRAP_J_001,
  TRAP_J_002,
  TRAP_J_003,
  // Class 02: Encoding Bypass
  TRAP_J_010,
  TRAP_J_011,
  TRAP_J_012,
  // Class 03: Context Manipulation
  TRAP_J_020,
  TRAP_J_021,
  // Class 04: Logical Tricks
  TRAP_J_030,
  TRAP_J_031,
  TRAP_J_032,
  // Class 05: Technical Exploits
  TRAP_J_040,
  TRAP_J_041,
  TRAP_J_042,
  // Class 06: Authority Claims
  TRAP_J_050,
  TRAP_J_051,
  // Output-side
  TRAP_J_OUT_001,
  TRAP_J_OUT_002,
];

export const INPUT_TRAPS = TRAP_CATALOG.filter(t => t.class !== 'OUTPUT_HARMFUL');
export const OUTPUT_TRAPS = TRAP_CATALOG.filter(t => t.class === 'OUTPUT_HARMFUL');
