/**
 * DCCE MCP Tool
 * 
 * MCP tool for generating, validating, rendering and linting
 * Dual-Channel Content Envelopes.
 * 
 * @tool mcp_m7_dcce
 * @version 0.1.0
 */

import { randomUUID } from 'crypto';
import { DCCEEnvelope, DCCEContentType, DCCERenderFormat } from './types.js';
import { validateEnvelope, lintEnvelope } from './validator.js';
import { renderEnvelope, extractAiView, hasDCCE } from './renderer.js';
import { getPolicy, listPolicies } from './policies.js';

export const dcceTool = {
  name: 'mcp_m7_dcce',
  description: 'DCCE (Dual-Channel Content Envelope) — generate, validate, render and lint dual-channel content. Two channels: Human View (3-5 sentences for humans) and AI View (structured JSON for machines). AI stays AI, no mimicry.',
  
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'validate', 'render', 'lint', 'extract', 'check', 'policies'],
        description: 'Action: generate (create envelope), validate (check envelope), render (format for platform), lint (human-readable report), extract (get AI View from text), check (detect DCCE in text), policies (list presets)',
      },
      // For generate
      human: {
        type: 'string',
        description: 'Human View text (3-5 sentences, casual tone)',
      },
      ai: {
        description: 'AI View structured data (object)',
      },
      content_type: {
        type: 'string',
        enum: ['pr_description', 'issue_description', 'changelog', 'rfc', 'review_comment', 'documentation', 'generic'],
        description: 'Content type',
      },
      actor: {
        type: 'string',
        enum: ['human', 'ai', 'hybrid'],
        description: 'Content origin (default: ai)',
      },
      tool_name: {
        type: 'string',
        description: 'Tool that generated the content (e.g. "M7 MCP")',
      },
      model_name: {
        type: 'string',
        description: 'Model used (e.g. "claude-opus-4-6")',
      },
      // For validate/lint
      envelope: {
        description: 'DCCE envelope object to validate/lint/render',
      },
      // For render
      format: {
        type: 'string',
        enum: ['github', 'markdown', 'json', 'plain'],
        description: 'Render format (default: github)',
      },
      show_ai_view: {
        type: 'boolean',
        description: 'Include AI View in render (default: true)',
      },
      show_provenance: {
        type: 'boolean',
        description: 'Include provenance info (default: false)',
      },
      // For extract/check
      text: {
        type: 'string',
        description: 'Text to extract DCCE from or check for DCCE presence',
      },
      // Policy
      policy: {
        type: 'string',
        description: 'Policy preset name (default: generic-oss)',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  
  handler: async (request: any): Promise<{ content: Array<{ type: string; text: string }> }> => {
    const {
      action,
      human,
      ai,
      content_type,
      actor,
      tool_name,
      model_name,
      envelope: envelopeInput,
      format,
      show_ai_view,
      show_provenance,
      text,
      policy = 'generic-oss',
    } = request;
    
    try {
      switch (action) {
        // ============================================
        // GENERATE — create a new DCCE envelope
        // ============================================
        case 'generate': {
          if (!human) {
            return respond('Error: "human" field is required for generate action');
          }
          
          const envelope: DCCEEnvelope = {
            dcceVersion: '0.1',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            contentType: (content_type as DCCEContentType) || 'generic',
            channels: {
              human: human,
              ai: (typeof ai === 'object' && ai !== null) ? ai : { raw: ai || '' },
            },
            provenance: {
              actor: actor || 'ai',
              tool: tool_name || 'M7 MCP',
              model: model_name,
              generatedAt: new Date().toISOString(),
            },
          };
          
          // Auto-validate
          const validation = validateEnvelope(envelope, policy);
          
          // Auto-render to GitHub format
          const rendered = renderEnvelope(envelope, { format: 'github' });
          
          const result = [
            '# DCCE Envelope Generated',
            '',
            `**ID:** ${envelope.id}`,
            `**Content Type:** ${envelope.contentType}`,
            `**Valid:** ${validation.valid ? 'YES' : 'NO'}`,
            validation.warnings.length > 0
              ? `**Warnings:** ${validation.warnings.length}`
              : '',
            '',
            '## GitHub Render',
            '```',
            rendered,
            '```',
            '',
            '## Raw Envelope',
            '```json',
            JSON.stringify(envelope, null, 2),
            '```',
          ].filter(Boolean).join('\n');
          
          return respond(result);
        }
        
        // ============================================
        // VALIDATE — check envelope against policy
        // ============================================
        case 'validate': {
          if (!envelopeInput) {
            return respond('Error: "envelope" field is required for validate action');
          }
          
          const env = parseEnvelope(envelopeInput);
          if (!env) {
            return respond('Error: Invalid envelope format');
          }
          
          const validation = validateEnvelope(env, policy);
          
          const result = [
            `# DCCE Validation`,
            `**Status:** ${validation.valid ? 'PASS' : 'FAIL'}`,
            `**Policy:** ${policy}`,
            `**Errors:** ${validation.errors.length}`,
            `**Warnings:** ${validation.warnings.length}`,
          ];
          
          if (validation.errors.length > 0) {
            result.push('', '## Errors');
            for (const err of validation.errors) {
              result.push(`- **${err.code}** (${err.field}): ${err.message}`);
            }
          }
          
          if (validation.warnings.length > 0) {
            result.push('', '## Warnings');
            for (const warn of validation.warnings) {
              result.push(`- **${warn.code}** (${warn.field}): ${warn.message}`);
            }
          }
          
          return respond(result.join('\n'));
        }
        
        // ============================================
        // RENDER — format envelope for a platform
        // ============================================
        case 'render': {
          if (!envelopeInput) {
            return respond('Error: "envelope" field is required for render action');
          }
          
          const env = parseEnvelope(envelopeInput);
          if (!env) {
            return respond('Error: Invalid envelope format');
          }
          
          const rendered = renderEnvelope(env, {
            format: (format as DCCERenderFormat) || 'github',
            showAiView: show_ai_view !== false,
            showProvenance: show_provenance === true,
          });
          
          return respond(rendered);
        }
        
        // ============================================
        // LINT — human-readable validation report
        // ============================================
        case 'lint': {
          if (!envelopeInput) {
            return respond('Error: "envelope" field is required for lint action');
          }
          
          const env = parseEnvelope(envelopeInput);
          if (!env) {
            return respond('Error: Invalid envelope format');
          }
          
          const report = lintEnvelope(env, policy);
          return respond(report);
        }
        
        // ============================================
        // EXTRACT — get AI View from rendered text
        // ============================================
        case 'extract': {
          if (!text) {
            return respond('Error: "text" field is required for extract action');
          }
          
          const aiView = extractAiView(text);
          if (aiView) {
            return respond(JSON.stringify(aiView, null, 2));
          } else {
            return respond('No DCCE AI View found in text.');
          }
        }
        
        // ============================================
        // CHECK — detect DCCE presence in text
        // ============================================
        case 'check': {
          if (!text) {
            return respond('Error: "text" field is required for check action');
          }
          
          const found = hasDCCE(text);
          return respond(found 
            ? 'DCCE envelope detected in text.'
            : 'No DCCE envelope found in text.');
        }
        
        // ============================================
        // POLICIES — list available policy presets
        // ============================================
        case 'policies': {
          const names = listPolicies();
          const result: string[] = ['# DCCE Policy Presets', ''];
          
          for (const name of names) {
            const p = getPolicy(name);
            result.push(`## ${name}`);
            result.push(p.description);
            result.push(`- Max Human Length: ${p.policyHints.maxHumanLength || 'none'}`);
            result.push(`- Max Human Sentences: ${p.policyHints.maxHumanSentences || 'none'}`);
            result.push(`- Anti-patterns: ${p.humanViewAntiPatterns.length}`);
            result.push('');
          }
          
          return respond(result.join('\n'));
        }
        
        default:
          return respond(`Unknown action: ${action}. Available: generate, validate, render, lint, extract, check, policies`);
      }
    } catch (error: any) {
      return respond(`DCCE Error: ${error.message}`);
    }
  },
};

// ============================================
// HELPERS
// ============================================

function respond(text: string) {
  return { content: [{ type: 'text', text }] };
}

function parseEnvelope(input: unknown): DCCEEnvelope | null {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as DCCEEnvelope;
    } catch {
      return null;
    }
  }
  if (typeof input === 'object' && input !== null) {
    return input as DCCEEnvelope;
  }
  return null;
}
