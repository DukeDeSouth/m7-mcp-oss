/**
 * M7 v3.0 - Style Guardian MCP Tool
 * 
 * MCP interface for the Style Guardian system
 */

import { z } from 'zod';
import { StyleGuardian, getStyleGuardian } from '../../../style-guardian/index.js';

// ============================================
// SCHEMA
// ============================================

export const styleGuardianSchema = z.object({
  action: z.enum([
    'analyze',           // Analyze project/file for style patterns
    'validate',          // Validate code against learned style
    'learn',             // Record a correction for learning
    'profile',           // Get/set style profile
    'stats',             // Get learning statistics
    'check',             // Quick check for errors
    'fix',               // Auto-fix code
    'export',            // Export corrections
    'import',            // Import corrections
    'clear'              // Clear all learned data
  ]),
  
  // For analyze action
  path: z.string().optional().describe('Path to analyze (file or directory)'),
  
  // For validate/check/fix actions
  code: z.string().optional().describe('Code to validate'),
  file: z.string().optional().describe('File path for context'),
  
  // For learn action
  original: z.string().optional().describe('Original (wrong) code'),
  corrected: z.string().optional().describe('Corrected code'),
  context: z.string().optional().describe('Additional context'),
  
  // For import action
  corrections: z.string().optional().describe('JSON string of corrections to import'),
  
  // General
  format: z.enum(['json', 'text']).default('text').describe('Output format')
});

export type StyleGuardianInput = z.infer<typeof styleGuardianSchema>;

// ============================================
// HANDLER
// ============================================

let guardian: StyleGuardian | null = null;

async function getGuardian(): Promise<StyleGuardian> {
  if (!guardian) {
    guardian = getStyleGuardian();
    await guardian.initialize(process.env.CHROMA_URL);
  }
  return guardian;
}

export async function handleStyleGuardian(input: StyleGuardianInput): Promise<string> {
  const sg = await getGuardian();
  
  switch (input.action) {
    // ==========================================
    case 'analyze': {
      if (!input.path) {
        return '❌ Error: path is required for analyze action';
      }
      
      try {
        const profile = await sg.analyzeProject(input.path);
        
        if (input.format === 'json') {
          return JSON.stringify(profile, null, 2);
        }
        
        const lines: string[] = [];
        lines.push('🎨 Style Profile Analysis Complete');
        lines.push('═══════════════════════════════════════════');
        lines.push(`📁 Project: ${profile.projectPath}`);
        lines.push(`📊 Files Analyzed: ${profile.filesAnalyzed}`);
        lines.push(`🎯 Confidence: ${Math.round(profile.confidence * 100)}%`);
        lines.push('');
        
        lines.push('📝 Naming Conventions:');
        for (const np of profile.naming) {
          lines.push(`  ${np.element}: ${np.convention} (${Math.round(np.confidence * 100)}%)`);
          if (np.examples.length > 0) {
            lines.push(`    Examples: ${np.examples.slice(0, 3).join(', ')}`);
          }
        }
        lines.push('');
        
        lines.push('📦 Import Style:');
        lines.push(`  Style: ${profile.imports.style}`);
        lines.push(`  Barrel Files: ${profile.imports.barrelFiles ? 'Yes' : 'No'}`);
        if (profile.imports.pathAlias) {
          lines.push(`  Path Alias: ${profile.imports.pathAlias}`);
        }
        lines.push('');
        
        lines.push('⚡ Async Pattern:');
        lines.push(`  Style: ${profile.async.style}`);
        lines.push(`  Error Handling: ${profile.async.errorHandling}`);
        lines.push('');
        
        lines.push('🎨 Formatting:');
        lines.push(`  Indentation: ${profile.formatting.indentation} (${profile.formatting.indentSize})`);
        lines.push(`  Quotes: ${profile.formatting.quotes}`);
        lines.push(`  Semicolons: ${profile.formatting.semicolons ? 'Yes' : 'No'}`);
        lines.push('');
        
        if (profile.antiPatterns.length > 0) {
          lines.push('⚠️ Anti-Patterns Found:');
          for (const ap of profile.antiPatterns) {
            if (ap.occurrences > 0) {
              lines.push(`  ${ap.name}: ${ap.occurrences} occurrences`);
            }
          }
          lines.push('');
        }
        
        if (profile.customRules.length > 0) {
          lines.push(`📚 Custom Rules: ${profile.customRules.length}`);
        }
        
        return lines.join('\n');
      } catch (error) {
        return `❌ Error analyzing project: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    // ==========================================
    case 'validate': {
      if (!input.code) {
        return '❌ Error: code is required for validate action';
      }
      
      const result = sg.validate(input.code, input.file);
      
      if (input.format === 'json') {
        return JSON.stringify(result, null, 2);
      }
      
      return sg.formatReport(result);
    }
    
    // ==========================================
    case 'check': {
      if (!input.code) {
        return '❌ Error: code is required for check action';
      }
      
      const errors = sg.getErrors(input.code, input.file);
      
      if (errors.length === 0) {
        return '✅ No errors found';
      }
      
      const lines: string[] = [];
      lines.push(`🔴 ${errors.length} error(s) found:\n`);
      
      for (const error of errors) {
        lines.push(`Line ${error.line}: ${error.message}`);
        if (error.suggestion) {
          lines.push(`  💡 ${error.suggestion}`);
        }
      }
      
      return lines.join('\n');
    }
    
    // ==========================================
    case 'fix': {
      if (!input.code) {
        return '❌ Error: code is required for fix action';
      }
      
      const result = sg.autoFix(input.code, input.file);
      
      if (input.format === 'json') {
        return JSON.stringify({
          fixedCount: result.fixedCount,
          remainingViolations: result.remainingViolations.length,
          fixed: result.fixed
        }, null, 2);
      }
      
      const lines: string[] = [];
      lines.push(`🔧 Auto-Fixed ${result.fixedCount} issue(s)`);
      
      if (result.remainingViolations.length > 0) {
        lines.push(`⚠️ ${result.remainingViolations.length} issue(s) remain (cannot auto-fix)`);
      }
      
      lines.push('\n📝 Fixed Code:');
      lines.push('```');
      lines.push(result.fixed);
      lines.push('```');
      
      return lines.join('\n');
    }
    
    // ==========================================
    case 'learn': {
      if (!input.original || !input.corrected) {
        return '❌ Error: original and corrected are required for learn action';
      }
      
      const result = await sg.recordCorrection(
        input.original,
        input.corrected,
        input.file || 'unknown',
        input.context
      );
      
      return `✅ Correction recorded (ID: ${result.correctionId})${result.ruleCreated ? '\n📚 New rule learned!' : ''}`;
    }
    
    // ==========================================
    case 'profile': {
      const profile = sg.getProfile();
      
      if (!profile) {
        return '❌ No style profile loaded. Run analyze first.';
      }
      
      if (input.format === 'json') {
        return JSON.stringify(profile, null, 2);
      }
      
      const lines: string[] = [];
      lines.push('🎨 Current Style Profile');
      lines.push('═══════════════════════════════════════════');
      lines.push(`📁 Project: ${profile.projectId}`);
      lines.push(`📊 Files: ${profile.filesAnalyzed}`);
      lines.push(`🎯 Confidence: ${Math.round(profile.confidence * 100)}%`);
      lines.push(`📚 Custom Rules: ${profile.customRules.length}`);
      lines.push(`📈 Learning Rate: ${Math.round(profile.learningRate * 100)}%`);
      lines.push(`🕐 Updated: ${profile.updatedAt.toISOString()}`);
      
      return lines.join('\n');
    }
    
    // ==========================================
    case 'stats': {
      const stats = sg.getStatistics();
      
      if (input.format === 'json') {
        return JSON.stringify(stats, null, 2);
      }
      
      const lines: string[] = [];
      lines.push('📊 Style Guardian Statistics');
      lines.push('═══════════════════════════════════════════');
      lines.push(`📝 Total Corrections: ${stats.totalCorrections}`);
      lines.push(`📚 Rules Learned: ${stats.rulesLearned}`);
      lines.push(`🎯 Avg Confidence: ${Math.round(stats.avgConfidence * 100)}%`);
      lines.push(`📈 Learning Rate: ${Math.round(stats.learningRate * 100)}%`);
      lines.push(`✅ Profile Loaded: ${stats.profileLoaded ? 'Yes' : 'No'}`);
      lines.push(`📁 Files Analyzed: ${stats.filesAnalyzed}`);
      lines.push(`📋 Total Rules: ${stats.totalRules}`);
      lines.push(`🔧 Custom Rules: ${stats.customRules}`);
      lines.push('');
      
      if (Object.keys(stats.correctionsByType).length > 0) {
        lines.push('📂 Corrections by Type:');
        for (const [type, count] of Object.entries(stats.correctionsByType)) {
          lines.push(`  ${type}: ${count}`);
        }
      }
      
      return lines.join('\n');
    }
    
    // ==========================================
    case 'export': {
      const corrections = sg.exportCorrections();
      return JSON.stringify(corrections, null, 2);
    }
    
    // ==========================================
    case 'import': {
      if (!input.corrections) {
        return '❌ Error: corrections JSON is required for import action';
      }
      
      try {
        const corrections = JSON.parse(input.corrections);
        sg.importCorrections(corrections);
        return `✅ Imported ${corrections.length} correction(s)`;
      } catch (error) {
        return `❌ Error parsing corrections: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    
    // ==========================================
    case 'clear': {
      await sg.clear();
      return '✅ All learned data cleared';
    }
    
    default:
      return `❌ Unknown action: ${input.action}`;
  }
}

// ============================================
// TOOL DEFINITION
// ============================================

export const styleGuardianTool = {
  name: 'mcp_m7_style_guardian',
  description: `M7 v3.0 Style Guardian - Learn and enforce code style patterns.

## Actions:

### analyze
Analyze a project/directory to learn style patterns.
- path: Directory path to analyze (required)

### validate  
Validate code against learned style profile.
- code: Code to validate (required)
- file: File path for context

### check
Quick check for errors only (blocking issues).
- code: Code to check (required)
- file: File path

### fix
Auto-fix code where possible.
- code: Code to fix (required)
- file: File path

### learn
Record a user correction for learning.
- original: Original (wrong) code (required)
- corrected: Corrected code (required)
- file: Source file
- context: Additional context

### profile
Get current style profile.

### stats
Get learning statistics.

### export
Export all corrections as JSON.

### import
Import corrections from JSON.
- corrections: JSON string of corrections (required)

### clear
Clear all learned data.
`,
  inputSchema: styleGuardianSchema,
  handler: handleStyleGuardian
};

export default styleGuardianTool;

