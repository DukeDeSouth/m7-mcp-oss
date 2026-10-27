/**
 * DCCE Validator
 * 
 * Validates DCCE envelopes against schema and policy rules.
 * Checks Human View for AI-style patterns and length limits.
 * Checks AI View for required fields per content type.
 */

import {
  DCCEEnvelope,
  DCCEValidationResult,
  DCCEValidationError,
  DCCEValidationWarning,
} from './types.js';
import { DCCEPolicyPreset } from './types.js';
import { getPolicy } from './policies.js';

/**
 * Count sentences in text (rough heuristic)
 */
function countSentences(text: string): number {
  // Split on sentence-ending punctuation followed by space or end
  const sentences = text.split(/[.!?]+\s*/g).filter(s => s.trim().length > 0);
  return sentences.length;
}

/**
 * Validate a DCCE envelope
 */
export function validateEnvelope(
  envelope: DCCEEnvelope,
  policyName: string = 'generic-oss'
): DCCEValidationResult {
  const errors: DCCEValidationError[] = [];
  const warnings: DCCEValidationWarning[] = [];
  const policy = getPolicy(policyName);

  // --- Schema validation ---
  
  if (!envelope.dcceVersion) {
    errors.push({ field: 'dcceVersion', message: 'Missing dcceVersion', code: 'MISSING_VERSION' });
  }
  
  if (!envelope.id) {
    errors.push({ field: 'id', message: 'Missing envelope ID', code: 'MISSING_ID' });
  }
  
  if (!envelope.channels?.human) {
    errors.push({ field: 'channels.human', message: 'Missing Human View', code: 'MISSING_HUMAN' });
  }
  
  if (!envelope.channels?.ai || typeof envelope.channels.ai !== 'object') {
    errors.push({ field: 'channels.ai', message: 'Missing or invalid AI View', code: 'MISSING_AI' });
  }
  
  if (!envelope.provenance?.actor) {
    errors.push({ field: 'provenance.actor', message: 'Missing provenance actor', code: 'MISSING_PROVENANCE' });
  }

  // --- Human View validation ---
  
  if (envelope.channels?.human) {
    const human = envelope.channels.human;
    const maxLen = policy.policyHints.maxHumanLength || 500;
    const maxSentences = policy.policyHints.maxHumanSentences || 5;
    
    // Length check
    if (human.length > maxLen) {
      errors.push({
        field: 'channels.human',
        message: `Human View too long: ${human.length} chars (max ${maxLen})`,
        code: 'HUMAN_TOO_LONG',
      });
    }
    
    // Sentence count
    const sentenceCount = countSentences(human);
    if (sentenceCount > maxSentences) {
      warnings.push({
        field: 'channels.human',
        message: `Human View has ${sentenceCount} sentences (recommended max ${maxSentences})`,
        code: 'HUMAN_TOO_MANY_SENTENCES',
      });
    }
    
    // AI-style anti-pattern detection
    for (const pattern of policy.humanViewAntiPatterns) {
      if (pattern.test(human)) {
        warnings.push({
          field: 'channels.human',
          message: `AI-style pattern detected: ${pattern.source}`,
          code: 'AI_STYLE_DETECTED',
        });
      }
    }
  }

  // --- AI View validation ---
  
  if (envelope.channels?.ai && envelope.contentType) {
    const requiredFields = policy.aiViewRequirements[envelope.contentType];
    if (requiredFields) {
      for (const field of requiredFields) {
        if (!(field in envelope.channels.ai)) {
          warnings.push({
            field: `channels.ai.${field}`,
            message: `Recommended field missing in AI View: ${field}`,
            code: 'AI_MISSING_FIELD',
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Quick lint check — returns human-readable report
 */
export function lintEnvelope(
  envelope: DCCEEnvelope,
  policyName: string = 'generic-oss'
): string {
  const result = validateEnvelope(envelope, policyName);
  
  const lines: string[] = [];
  lines.push(`# DCCE Lint Report`);
  lines.push(`Policy: ${policyName}`);
  lines.push(`Status: ${result.valid ? 'PASS' : 'FAIL'}`);
  lines.push('');
  
  if (result.errors.length > 0) {
    lines.push(`## Errors (${result.errors.length})`);
    for (const err of result.errors) {
      lines.push(`- [${err.code}] ${err.field}: ${err.message}`);
    }
    lines.push('');
  }
  
  if (result.warnings.length > 0) {
    lines.push(`## Warnings (${result.warnings.length})`);
    for (const warn of result.warnings) {
      lines.push(`- [${warn.code}] ${warn.field}: ${warn.message}`);
    }
    lines.push('');
  }
  
  if (result.errors.length === 0 && result.warnings.length === 0) {
    lines.push('No issues found.');
  }
  
  return lines.join('\n');
}
