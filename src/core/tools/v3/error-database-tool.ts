/**
 * M7 v3.0 - Error Pattern Database MCP Tool
 * 
 * MCP interface for the Error Pattern Database system
 */

import { z } from 'zod';
import { ErrorDatabase, getErrorDatabase, ErrorCategory, ErrorSeverity } from '../../../error-database/index.js';

// ============================================
// SCHEMA
// ============================================

export const errorDatabaseSchema = z.object({
  action: z.enum([
    'capture',           // Capture an AI mistake
    'check',             // Check code for potential errors
    'search',            // Search error database
    'stats',             // Get statistics
    'patterns',          // List/manage patterns
    'correct',           // Record a correction
    'report_fp',         // Report false positive
    'clear'              // Clear all data
  ]),
  
  // For capture action
  category: z.enum([
    'syntax', 'type', 'import', 'api', 'logic', 
    'style', 'security', 'performance', 'compatibility', 'other'
  ]).optional().describe('Error category'),
  title: z.string().optional().describe('Error title'),
  description: z.string().optional().describe('Error description'),
  ai_mistake: z.string().optional().describe('What AI generated (wrong)'),
  correct_solution: z.string().optional().describe('What it should have been'),
  explanation: z.string().optional().describe('Why it was wrong'),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  project_id: z.string().optional(),
  agent_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  
  // For check action
  code: z.string().optional().describe('Code to check'),
  file: z.string().optional().describe('File path'),
  
  // For search action
  query: z.string().optional().describe('Search query'),
  limit: z.number().optional().default(20),
  
  // For correct action
  error_id: z.string().optional().describe('Error ID to correct'),
  original_code: z.string().optional(),
  corrected_code: z.string().optional(),
  
  // For patterns action
  pattern_action: z.enum(['list', 'enable', 'disable']).optional(),
  pattern_id: z.string().optional(),
  
  // General
  format: z.enum(['json', 'text']).default('text')
});

export type ErrorDatabaseInput = z.infer<typeof errorDatabaseSchema>;

// ============================================
// HANDLER
// ============================================

let errorDb: ErrorDatabase | null = null;

async function getDb(): Promise<ErrorDatabase> {
  if (!errorDb) {
    errorDb = getErrorDatabase();
    await errorDb.initialize(process.env.CHROMA_URL);
  }
  return errorDb;
}

export async function handleErrorDatabase(input: ErrorDatabaseInput): Promise<string> {
  const db = await getDb();
  
  switch (input.action) {
    // ==========================================
    case 'capture': {
      if (!input.category || !input.title || !input.ai_mistake || !input.correct_solution) {
        return '❌ Error: category, title, ai_mistake, and correct_solution are required';
      }
      
      const result = await db.capture({
        category: input.category as ErrorCategory,
        title: input.title,
        description: input.description || '',
        aiMistake: input.ai_mistake,
        correctSolution: input.correct_solution,
        explanation: input.explanation || '',
        severity: input.severity as ErrorSeverity | undefined,
        projectId: input.project_id,
        agentId: input.agent_id,
        tags: input.tags
      });
      
      if (input.format === 'json') {
        return JSON.stringify(result, null, 2);
      }
      
      return `${result.success ? '✅' : '❌'} ${result.message}\nID: ${result.entryId}`;
    }
    
    // ==========================================
    case 'check': {
      if (!input.code) {
        return '❌ Error: code is required for check action';
      }
      
      const result = await db.check(input.code, input.file);
      
      if (input.format === 'json') {
        return JSON.stringify(result, null, 2);
      }
      
      return db.formatWarnings(result.warnings);
    }
    
    // ==========================================
    case 'search': {
      const result = db.search({
        query: input.query,
        category: input.category as ErrorCategory | undefined,
        severity: input.severity as ErrorSeverity | undefined,
        projectId: input.project_id,
        limit: input.limit
      });
      
      if (input.format === 'json') {
        return JSON.stringify(result, null, 2);
      }
      
      if (result.entries.length === 0) {
        return '📭 No errors found matching criteria';
      }
      
      const lines: string[] = [];
      lines.push(`📋 Found ${result.total} error(s) (showing ${result.entries.length}):\n`);
      
      for (const entry of result.entries) {
        const icon = getSeverityIcon(entry.severity);
        lines.push(`${icon} ${entry.title}`);
        lines.push(`   ID: ${entry.id}`);
        lines.push(`   Category: ${entry.category} | Occurrences: ${entry.occurrences}`);
        lines.push(`   ${entry.resolved ? '✅ Resolved' : '⏳ Unresolved'}`);
        lines.push('');
      }
      
      if (result.hasMore) {
        lines.push(`... and ${result.total - result.entries.length} more`);
      }
      
      return lines.join('\n');
    }
    
    // ==========================================
    case 'stats': {
      const stats = db.getStatistics(input.project_id);
      
      if (input.format === 'json') {
        return JSON.stringify(stats, null, 2);
      }
      
      return db.formatStatistics(input.project_id);
    }
    
    // ==========================================
    case 'patterns': {
      const patterns = db.getPatterns();
      
      if (input.pattern_action === 'enable' && input.pattern_id) {
        await db.setPatternEnabled(input.pattern_id, true);
        return `✅ Pattern ${input.pattern_id} enabled`;
      }
      
      if (input.pattern_action === 'disable' && input.pattern_id) {
        await db.setPatternEnabled(input.pattern_id, false);
        return `✅ Pattern ${input.pattern_id} disabled`;
      }
      
      // List patterns
      if (input.format === 'json') {
        return JSON.stringify(patterns, null, 2);
      }
      
      const lines: string[] = [];
      lines.push(`📋 ${patterns.length} Error Patterns:\n`);
      
      const enabled = patterns.filter(p => p.enabled);
      const disabled = patterns.filter(p => !p.enabled);
      
      if (enabled.length > 0) {
        lines.push('✅ Enabled:');
        for (const p of enabled) {
          lines.push(`  ${p.id}: ${p.name}`);
          lines.push(`    Category: ${p.category} | Matches: ${p.matchCount} | Prevented: ${p.preventionCount}`);
        }
        lines.push('');
      }
      
      if (disabled.length > 0) {
        lines.push('❌ Disabled:');
        for (const p of disabled) {
          lines.push(`  ${p.id}: ${p.name}`);
        }
      }
      
      return lines.join('\n');
    }
    
    // ==========================================
    case 'correct': {
      if (!input.error_id || !input.original_code || !input.corrected_code) {
        return '❌ Error: error_id, original_code, and corrected_code are required';
      }
      
      const result = await db.recordCorrection({
        errorId: input.error_id,
        originalCode: input.original_code,
        correctedCode: input.corrected_code,
        correctedBy: 'user'
      });
      
      if (input.format === 'json') {
        return JSON.stringify(result, null, 2);
      }
      
      return `✅ Correction recorded (ID: ${result.correctionId})${result.patternLearned ? '\n📚 Pattern learned from this correction!' : ''}`;
    }
    
    // ==========================================
    case 'report_fp': {
      if (!input.pattern_id) {
        return '❌ Error: pattern_id is required for report_fp action';
      }
      
      await db.reportFalsePositive(input.pattern_id);
      return `✅ False positive reported for pattern ${input.pattern_id}`;
    }
    
    // ==========================================
    case 'clear': {
      await db.clear();
      return '✅ All error data cleared';
    }
    
    default:
      return `❌ Unknown action: ${input.action}`;
  }
}

function getSeverityIcon(severity: ErrorSeverity): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🔵';
    default: return '⚪';
  }
}

// ============================================
// TOOL DEFINITION
// ============================================

export const errorDatabaseTool = {
  name: 'mcp_m7_error_database',
  description: `M7 v3.0 Error Pattern Database - Track AI mistakes and provide preventive warnings.

## Actions:

### capture
Record an AI mistake.
- category: Error category (required): syntax, type, import, api, logic, style, security, performance, compatibility, other
- title: Error title (required)
- ai_mistake: What AI generated wrong (required)
- correct_solution: What it should have been (required)
- description: Detailed description
- explanation: Why it was wrong
- severity: critical, high, medium, low
- project_id: Project identifier
- tags: Array of tags

### check
Check code for potential errors.
- code: Code to check (required)
- file: File path for context

### search
Search the error database.
- query: Search text
- category: Filter by category
- severity: Filter by severity
- project_id: Filter by project
- limit: Max results (default: 20)

### stats
Get error statistics.
- project_id: Filter by project (optional)

### patterns
List or manage error patterns.
- pattern_action: list, enable, or disable
- pattern_id: Pattern ID for enable/disable

### correct
Record a correction for an error.
- error_id: Error ID to correct (required)
- original_code: Original wrong code (required)
- corrected_code: Corrected code (required)

### report_fp
Report a false positive warning.
- pattern_id: Pattern ID that gave false positive (required)

### clear
Clear all error data.
`,
  inputSchema: errorDatabaseSchema,
  handler: handleErrorDatabase
};

export default errorDatabaseTool;

