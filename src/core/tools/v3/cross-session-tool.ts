/**
 * M7 v3.0 - Cross-Session Learning MCP Tool
 * 
 * MCP tool for cross-session learning operations.
 */

import { z } from 'zod';
import { 
  CrossSessionLearning, 
  getCrossSessionLearning,
  LearningStats,
  ProjectContext,
  RelevantKnowledge
} from '../../../cross-session/index.js';

// ============================================
// SCHEMA
// ============================================

const crossSessionSchema = z.object({
  action: z.enum([
    'status',          // Check system status
    'start',           // Start session tracking
    'record',          // Record an action
    'end',             // End session (requires orchestrator)
    'get_context',     // Get full project context
    'search',          // Search relevant knowledge
    'validate',        // Validate an insight
    'ci_result',       // Record CI/CD result
    'stats',           // Get learning statistics
    'cleanup',         // Cleanup old data
    'format_prompt'    // Format context for AI prompt
  ]),
  
  session_id: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().optional().default(5),
  insight_id: z.string().optional(),
  valid: z.boolean().optional(),
  
  action_data: z.object({
    type: z.enum(['query', 'generation', 'fix', 'review', 'test', 'tool_call']),
    tool: z.string().optional(),
    input: z.string(),
    output: z.string(),
    file: z.string().optional(),
    success: z.boolean(),
    userFeedback: z.enum(['positive', 'negative', 'neutral']).optional()
  }).optional(),
  
  ci_result: z.object({
    type: z.enum(['build', 'test', 'deploy', 'lint']),
    success: z.boolean(),
    details: z.string().optional(),
    affectedInsights: z.array(z.string()).optional()
  }).optional(),
  
  cleanup_options: z.object({
    olderThanDays: z.number().optional(),
    belowConfidence: z.number().optional()
  }).optional()
});

type CrossSessionParams = z.infer<typeof crossSessionSchema>;

// ============================================
// TOOL DEFINITION
// ============================================

let learning: CrossSessionLearning | null = null;

export const crossSessionTool = {
  name: 'mcp_m7_cross_session',
  description: `M7 v3.0 Cross-Session Learning - Learn from session patterns across time.

## Actions:

### status
Check cross-session learning system status.

### start
Start tracking a new session.
- session_id: Session ID to track (required)

### record
Record an action in current session.
- action_data: { type, tool?, input, output, file?, success, userFeedback? }

### get_context
Get full project learning context for AI prompts.

### search
Search relevant knowledge.
- query: Search query (required)
- limit: Max results (default: 5)

### validate
Validate an insight (user feedback).
- insight_id: Insight ID (required)
- valid: true/false (required)

### ci_result
Record CI/CD result for insight validation.
- ci_result: { type, success, details?, affectedInsights? }

### stats
Get learning statistics.

### cleanup
Cleanup old/low-confidence data.
- cleanup_options: { olderThanDays?, belowConfidence? }

### format_prompt
Format context for injection into AI prompt.
- query: Optional query for relevant knowledge
`,

  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'start', 'record', 'end', 'get_context', 'search', 'validate', 'ci_result', 'stats', 'cleanup', 'format_prompt'],
        description: 'Action to perform'
      },
      session_id: { type: 'string', description: 'Session ID for start action' },
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default: 5)' },
      insight_id: { type: 'string', description: 'Insight ID for validation' },
      valid: { type: 'boolean', description: 'Validation result' },
      action_data: {
        type: 'object',
        description: 'Action data for record',
        properties: {
          type: { type: 'string', enum: ['query', 'generation', 'fix', 'review', 'test', 'tool_call'] },
          tool: { type: 'string' },
          input: { type: 'string' },
          output: { type: 'string' },
          file: { type: 'string' },
          success: { type: 'boolean' },
          userFeedback: { type: 'string', enum: ['positive', 'negative', 'neutral'] }
        }
      },
      ci_result: {
        type: 'object',
        description: 'CI/CD result data',
        properties: {
          type: { type: 'string', enum: ['build', 'test', 'deploy', 'lint'] },
          success: { type: 'boolean' },
          details: { type: 'string' },
          affectedInsights: { type: 'array', items: { type: 'string' } }
        }
      },
      cleanup_options: {
        type: 'object',
        description: 'Cleanup options',
        properties: {
          olderThanDays: { type: 'number' },
          belowConfidence: { type: 'number' }
        }
      }
    },
    required: ['action']
  },

  async handler(request: any): Promise<any> {
    const params = crossSessionSchema.parse(request);
    
    // Initialize if needed
    if (!learning) {
      learning = getCrossSessionLearning();
      await learning.initialize();
    }

    try {
      let response = '';

      switch (params.action) {
        case 'status':
          response = await handleStatus(learning);
          break;

        case 'start':
          if (!params.session_id) {
            throw new Error('session_id required for start action');
          }
          learning.startSession(params.session_id);
          response = `✅ Cross-Session tracking started for: \`${params.session_id}\``;
          break;

        case 'record':
          if (!params.action_data) {
            throw new Error('action_data required for record action');
          }
          learning.recordAction(params.action_data);
          response = `✅ Action recorded: ${params.action_data.type}${params.action_data.tool ? ` (${params.action_data.tool})` : ''}`;
          break;

        case 'get_context':
          const context = await learning.getContext();
          response = formatContext(context);
          break;

        case 'search':
          if (!params.query) {
            throw new Error('query required for search action');
          }
          const knowledge = await learning.getRelevantKnowledge(params.query, params.limit);
          response = formatKnowledge(knowledge, params.query);
          break;

        case 'validate':
          if (!params.insight_id || params.valid === undefined) {
            throw new Error('insight_id and valid required for validate action');
          }
          await learning.validateInsight(params.insight_id, params.valid);
          response = `✅ Insight \`${params.insight_id}\` validated as ${params.valid ? '✓ correct' : '✗ incorrect'}`;
          break;

        case 'ci_result':
          if (!params.ci_result) {
            throw new Error('ci_result required');
          }
          await learning.recordCIResult({
            ...params.ci_result,
            timestamp: new Date()
          });
          response = `✅ CI result recorded: ${params.ci_result.type} - ${params.ci_result.success ? 'SUCCESS' : 'FAILURE'}`;
          break;

        case 'stats':
          const stats = await learning.getStats();
          response = formatStats(stats);
          break;

        case 'cleanup':
          const removed = await learning.cleanup(params.cleanup_options);
          response = `✅ Cleanup complete: ${removed} items removed`;
          break;

        case 'format_prompt':
          const prompt = await learning.formatContextForPrompt(params.query);
          response = `# Formatted Context for AI Prompt\n\n${prompt}`;
          break;

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }

      return {
        content: [{ type: 'text', text: response }]
      };

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Cross-Session Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
};

// ============================================
// FORMATTERS
// ============================================

async function handleStatus(learning: CrossSessionLearning): Promise<string> {
  const stats = await learning.getStats();
  const session = learning.getCurrentSession();
  
  return `# 🧠 Cross-Session Learning Status

## System
- **Status:** ${learning.isEnabled() ? '✅ Active' : '❌ Disabled'}
- **Initialized:** ✅ Yes

## Current Session
- **Session ID:** ${session.id || 'None'}
- **Actions Recorded:** ${session.actionsCount}

## Knowledge Base
- **Total Insights:** ${stats.totalInsights}
- **Validated Insights:** ${stats.validatedInsights}
- **Golden Rules:** ${stats.goldenRules} 🏆
- **Active Heuristics:** ${stats.activeHeuristics}

## Last Updated
${stats.lastUpdated.toLocaleString()}

---
*M7 v3.0 Cross-Session Learning*
`;
}

function formatContext(context: ProjectContext): string {
  let output = `# 🧠 Project Learning Context\n\n`;
  
  // Guidelines
  output += `## 📋 Guidelines (${context.guidelines.length})\n`;
  if (context.guidelines.length > 0) {
    for (const g of context.guidelines.slice(0, 5)) {
      output += `- **${g.category}:** ${g.rule} (${Math.round(g.confidence * 100)}%)\n`;
    }
  } else {
    output += `_No guidelines yet_\n`;
  }
  output += '\n';
  
  // Recent insights
  output += `## 💡 Recent Insights (${context.recentInsights.length})\n`;
  if (context.recentInsights.length > 0) {
    for (const i of context.recentInsights.slice(0, 5)) {
      const confidence = Math.round(i.confidenceEma * 100);
      output += `- [${i.type}] ${i.content} (${confidence}%)\n`;
    }
  } else {
    output += `_No recent insights_\n`;
  }
  output += '\n';
  
  // Golden rules
  output += `## 🏆 Golden Rules (${context.goldenRules.length})\n`;
  if (context.goldenRules.length > 0) {
    for (const r of context.goldenRules) {
      output += `- ${r.pattern}\n`;
    }
  } else {
    output += `_No golden rules yet - patterns need 90%+ confidence and 3+ validations_\n`;
  }
  output += '\n';
  
  // Common patterns
  output += `## 🔄 Common Patterns\n`;
  if (context.commonPatterns.length > 0) {
    for (const p of context.commonPatterns.slice(0, 5)) {
      output += `- ${p}\n`;
    }
  } else {
    output += `_No patterns detected yet_\n`;
  }
  output += '\n';
  
  // Known issues
  output += `## ⚠️ Known Issues\n`;
  if (context.knownIssues.length > 0) {
    for (const i of context.knownIssues.slice(0, 5)) {
      output += `- ${i}\n`;
    }
  } else {
    output += `_No known issues_\n`;
  }
  
  return output;
}

function formatKnowledge(knowledge: RelevantKnowledge, query: string): string {
  let output = `# 🔍 Relevant Knowledge\n\n`;
  output += `**Query:** "${query}"\n`;
  output += `**Relevance Score:** ${Math.round(knowledge.score * 100)}%\n\n`;
  
  // Insights
  output += `## 💡 Matching Insights (${knowledge.insights.length})\n`;
  if (knowledge.insights.length > 0) {
    for (const i of knowledge.insights) {
      const confidence = Math.round(i.confidenceEma * 100);
      output += `\n### [${i.type}] ${confidence}% confidence\n`;
      output += `${i.content}\n`;
      output += `_Used ${i.usageCount} times | Validated ${i.timesValidated}x_\n`;
    }
  } else {
    output += `_No matching insights_\n`;
  }
  output += '\n';
  
  // Guidelines
  output += `## 📋 Relevant Guidelines (${knowledge.guidelines.length})\n`;
  if (knowledge.guidelines.length > 0) {
    for (const g of knowledge.guidelines) {
      output += `- **${g.category}:** ${g.rule}\n`;
    }
  } else {
    output += `_No matching guidelines_\n`;
  }
  output += '\n';
  
  // Heuristics
  output += `## 🎯 Applicable Heuristics (${knowledge.heuristics.length})\n`;
  if (knowledge.heuristics.length > 0) {
    for (const h of knowledge.heuristics) {
      const emoji = h.status === 'golden' ? '🏆' : '✓';
      const successRate = h.triggers > 0 
        ? Math.round((h.successes / h.triggers) * 100) 
        : 0;
      output += `\n${emoji} **[${h.status.toUpperCase()}]** ${h.pattern}\n`;
      output += `Success rate: ${successRate}% (${h.successes}/${h.triggers})\n`;
    }
  } else {
    output += `_No matching heuristics_\n`;
  }
  
  return output;
}

function formatStats(stats: LearningStats): string {
  let output = `# 📊 Cross-Session Learning Statistics\n\n`;
  
  output += `## Overview\n`;
  output += `| Metric | Value |\n`;
  output += `|--------|-------|\n`;
  output += `| Total Sessions | ${stats.totalSessions} |\n`;
  output += `| Total Insights | ${stats.totalInsights} |\n`;
  output += `| Validated Insights | ${stats.validatedInsights} |\n`;
  output += `| Golden Rules | ${stats.goldenRules} 🏆 |\n`;
  output += `| Active Heuristics | ${stats.activeHeuristics} |\n`;
  output += '\n';
  
  // Top patterns
  output += `## Top Patterns\n`;
  if (stats.topPatterns.length > 0) {
    for (let i = 0; i < stats.topPatterns.length; i++) {
      const p = stats.topPatterns[i];
      const successRate = Math.round(p.successRate * 100);
      output += `${i + 1}. ${p.pattern} (${p.count}x, ${successRate}% success)\n`;
    }
  } else {
    output += `_No patterns yet_\n`;
  }
  output += '\n';
  
  // Improvement areas
  output += `## Improvement Areas\n`;
  if (stats.improvementAreas.length > 0) {
    for (const a of stats.improvementAreas) {
      output += `- ${a}\n`;
    }
  } else {
    output += `_No improvement areas identified_\n`;
  }
  output += '\n';
  
  // Accuracy trend
  output += `## Accuracy Trend\n`;
  if (stats.accuracyTrend.length > 0) {
    output += stats.accuracyTrend.map(a => `${Math.round(a * 100)}%`).join(' → ');
  } else {
    output += `_Not enough data_`;
  }
  output += '\n\n';
  
  output += `**Last Updated:** ${stats.lastUpdated.toLocaleString()}\n`;
  
  return output;
}

export default crossSessionTool;

