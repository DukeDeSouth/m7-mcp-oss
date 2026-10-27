/**
 * DCCE Module — Dual-Channel Content Envelope
 * 
 * Protocol for delivering AI-generated content through two channels:
 * - Human View: 3-5 sentences, casual tone, no structure
 * - AI stays AI. No identity masking.
 * 
 * @module dcce
 * @version 0.1.0
 */

export { dcceTool } from './dcceTool.js';
export { validateEnvelope, lintEnvelope } from './validator.js';
export { renderEnvelope, extractAiView, hasDCCE } from './renderer.js';
export { getPolicy, listPolicies, POLICY_PRESETS } from './policies.js';
export type {
  DCCEEnvelope,
  DCCEContentType,
  DCCEProvenance,
  DCCEPolicyHints,
  DCCEMode,
  DCCEValidationResult,
  DCCERenderFormat,
  DCCERenderOptions,
  DCCEPolicyPreset,
} from './types.js';
