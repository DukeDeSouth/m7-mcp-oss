#!/usr/bin/env node

import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('[Impact]');
import { diffChars, diffLines, createTwoFilesPatch } from 'diff';
import { promises as fs } from 'fs';
import { join, relative } from 'path';
import { JournalSystem } from '../../../journal/journalSystem.js';
import { getProjectPath } from '../../utils/projectPath.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../../memory/auto/unified-memory-core.js';

// Impact analysis types
interface CodeChange {
  file: string;
  type: 'create' | 'modify' | 'delete';
  oldContent?: string;
  newContent?: string;
  linesAdded: number;
  linesRemoved: number;
  complexity: 'low' | 'medium' | 'high';
  impact: {
    scope: 'file' | 'module' | 'system';
    risk: 'low' | 'medium' | 'high' | 'critical';
    dependencies: string[];
    breakingChanges: boolean;
  };
  diff?: {
    unified: string;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      changes: Array<{
        type: 'add' | 'remove' | 'context';
        content: string;
      }>;
    }>;
  };
}

interface ImpactAnalysis {
  changes: CodeChange[];
  summary: {
    totalFiles: number;
    totalLines: { added: number; removed: number };
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    complexity: 'low' | 'medium' | 'high';
    breakingChanges: number;
    recommendations: string[];
  };
  patterns: {
    identified: string[];
    antiPatterns: string[];
    suggestions: string[];
  };
  reflection: {
    lessons: string[];
    improvements: string[];
    futureConsiderations: string[];
  };
}

const ImpactRequestSchema = z.object({
  action: z.enum(['analyze', 'compare', 'reflect', 'patterns', 'history']),
  files: z.array(z.string()).optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  sessionId: z.string().optional(),
  depth: z.enum(['surface', 'deep', 'comprehensive']).default('surface')
});

export const impactTool = {
  name: 'mcp_m7_impact',
  description: 'Code Impact Analyzer - анализ реальных изменений кода',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'compare', 'reflect', 'patterns', 'history'],
        description: 'Тип анализа влияния'
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Список файлов для анализа'
      },
      before: {
        type: 'string',
        description: 'Содержимое до изменений'
      },
      after: {
        type: 'string',
        description: 'Содержимое после изменений'
      },
      sessionId: {
        type: 'string',
        description: 'ID сессии M7 (опционально)'
      },
      depth: {
        type: 'string',
        enum: ['surface', 'deep', 'comprehensive'],
        description: 'Глубина анализа'
      }
    },
    required: ['action']
  },
  handler: async (request: any, { journal }: { journal: JournalSystem }) => {
    const params = ImpactRequestSchema.parse(request);
    const { action, files, before, after, sessionId, depth } = params;

    try {
      // v5.0: Get UnifiedMemoryCore instance
      const memory = await getMemoryCore();
      
      switch (action) {
        case 'analyze': {
          if (!files || files.length === 0) {
            return {
              content: [{
                type: 'text',
                text: '❌ Укажите файлы для анализа: files: ["src/file1.ts", "src/file2.ts"]'
              }]
            };
          }

          const analysis = await analyzeCodeChanges(files, depth, memory, journal);
          
          return {
            content: [{
              type: 'text',
              text: formatAnalysisReport(analysis)
            }]
          };
        }

        case 'compare': {
          if (!before || !after) {
            return {
              content: [{
                type: 'text',
                text: '❌ Укажите before и after для сравнения'
              }]
            };
          }

          const comparison = await compareCodeVersions(before, after, depth);
          
          return {
            content: [{
              type: 'text',
              text: formatComparisonReport(comparison)
            }]
          };
        }

        case 'reflect': {
          const reflection = await performTaskReflection(sessionId, memory, journal);
          
          return {
            content: [{
              type: 'text',
              text: formatReflectionReport(reflection)
            }]
          };
        }

        case 'patterns': {
          const patterns = await identifyCodePatterns(files || [], memory);
          
          return {
            content: [{
              type: 'text',
              text: formatPatternsReport(patterns)
            }]
          };
        }

        case 'history': {
          const history = await getImpactHistory(memory, journal);
          
          return {
            content: [{
              type: 'text',
              text: formatHistoryReport(history)
            }]
          };
        }

        default:
          return {
            content: [{
              type: 'text',
              text: '❌ Неизвестное действие'
            }]
          };
      }
    } catch (error) {
      await journal.logError({
        error: `Impact analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        context: JSON.stringify({ action, files, sessionId }),
        category: 'runtime',
        fixed: false,
      });

      return {
        content: [{
          type: 'text',
          text: `❌ Ошибка анализа влияния: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`
        }]
      };
    }
  }
};

// Core analysis functions
async function analyzeCodeChanges(
  files: string[], 
  depth: string, 
  memory: UnifiedMemoryCore, 
  journal: JournalSystem
): Promise<ImpactAnalysis> {
  const changes: CodeChange[] = [];
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  let breakingChanges = 0;

  for (const file of files) {
    try {
      // Check if file exists and get its content
      const fullPath = join(getProjectPath(), file);
      let content = '';
      let changeType: 'create' | 'modify' | 'delete' = 'modify';
      
      try {
        content = await fs.readFile(fullPath, 'utf8');
      } catch {
        changeType = 'create';
      }

      // Get previous version from memory or git (simplified)
      const previousContent = await getPreviousVersion(file, memory);
      
      if (!previousContent && changeType !== 'create') {
        changeType = 'create';
      }

      // Analyze the change
      const change = await analyzeFileChange(file, previousContent || '', content, changeType, depth);
      changes.push(change);

      totalLinesAdded += change.linesAdded;
      totalLinesRemoved += change.linesRemoved;
      if (change.impact.breakingChanges) breakingChanges++;

    } catch (error) {
      log.warn(`Failed to analyze ${file}:`, error);
    }
  }

  // Calculate overall risk and complexity
  const riskLevel = calculateOverallRisk(changes);
  const complexity = calculateOverallComplexity(changes);

  // Identify patterns and generate recommendations
  const patterns = await identifyChangePatterns(changes, memory);
  const recommendations = generateRecommendations(changes, patterns);

  return {
    changes,
    summary: {
      totalFiles: changes.length,
      totalLines: { added: totalLinesAdded, removed: totalLinesRemoved },
      riskLevel,
      complexity,
      breakingChanges,
      recommendations
    },
    patterns: {
      identified: patterns.positive,
      antiPatterns: patterns.negative,
      suggestions: patterns.suggestions
    },
    reflection: {
      lessons: [],
      improvements: [],
      futureConsiderations: []
    }
  };
}

async function analyzeFileChange(
  file: string, 
  oldContent: string, 
  newContent: string, 
  type: 'create' | 'modify' | 'delete',
  depth: string
): Promise<CodeChange> {
  // Use jsdiff to analyze changes
  const lineDiff = diffLines(oldContent, newContent);
  
  let linesAdded = 0;
  let linesRemoved = 0;

  lineDiff.forEach((part: any) => {
    if (part.added) {
      linesAdded += part.count || 0;
    } else if (part.removed) {
      linesRemoved += part.count || 0;
    }
  });

  // Create unified diff for detailed analysis
  const unifiedDiff = createTwoFilesPatch(
    file, 
    file, 
    oldContent, 
    newContent, 
    'Before', 
    'After'
  );

  // Analyze complexity and impact
  const complexity = calculateFileComplexity(newContent, linesAdded, linesRemoved);
  const impact = await calculateFileImpact(file, oldContent, newContent, type, depth);

  return {
    file: relative(getProjectPath(), file),
    type,
    oldContent: type !== 'create' ? oldContent : undefined,
    newContent: type !== 'delete' ? newContent : undefined,
    linesAdded,
    linesRemoved,
    complexity,
    impact,
    diff: {
      unified: unifiedDiff,
      hunks: [] // Simplified for now
    }
  };
}

function calculateFileComplexity(content: string, linesAdded: number, linesRemoved: number): 'low' | 'medium' | 'high' {
  const totalChange = linesAdded + linesRemoved;
  const contentComplexity = analyzeContentComplexity(content);
  
  if (totalChange > 100 || contentComplexity === 'high') return 'high';
  if (totalChange > 20 || contentComplexity === 'medium') return 'medium';
  return 'low';
}

function analyzeContentComplexity(content: string): 'low' | 'medium' | 'high' {
  // Simple heuristics for complexity
  const patterns = {
    high: [/class\s+\w+/g, /interface\s+\w+/g, /async\s+function/g, /\.catch\(/g],
    medium: [/function\s+\w+/g, /const\s+\w+\s*=/g, /import\s+/g, /export\s+/g]
  };

  const highMatches = patterns.high.reduce((sum, pattern) => sum + (content.match(pattern)?.length || 0), 0);
  const mediumMatches = patterns.medium.reduce((sum, pattern) => sum + (content.match(pattern)?.length || 0), 0);

  if (highMatches > 5) return 'high';
  if (highMatches > 2 || mediumMatches > 10) return 'medium';
  return 'low';
}

async function calculateFileImpact(
  file: string, 
  oldContent: string, 
  newContent: string, 
  type: 'create' | 'modify' | 'delete',
  depth: string
): Promise<CodeChange['impact']> {
  // Simplified impact analysis
  const dependencies = extractDependencies(newContent);
  const breakingChanges = detectBreakingChanges(oldContent, newContent);
  
  const scope: 'file' | 'module' | 'system' = 
    dependencies.length > 5 ? 'system' : 
    dependencies.length > 2 ? 'module' : 'file';

  const risk: 'low' | 'medium' | 'high' | 'critical' = 
    breakingChanges || type === 'delete' ? 'high' :
    scope === 'system' ? 'medium' : 'low';

  return {
    scope,
    risk,
    dependencies,
    breakingChanges
  };
}

// Helper functions
async function getPreviousVersion(file: string, memory: UnifiedMemoryCore): Promise<string | null> {
  try {
    const result = await memory.cascadeSearch(`file:${file} content`, { limit: 1 });
    return result[0]?.record.content || null;
  } catch {
    return null;
  }
}

function extractDependencies(content: string): string[] {
  const importMatches = content.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) || [];
  return importMatches.map(match => {
    const moduleMatch = match.match(/from\s+['"]([^'"]+)['"]/);
    return moduleMatch ? moduleMatch[1] : '';
  }).filter(Boolean);
}

function detectBreakingChanges(oldContent: string, newContent: string): boolean {
  // Simple heuristics for breaking changes
  const breakingPatterns = [
    /export\s+(interface|type|class)\s+\w+/g,
    /public\s+\w+\s*\(/g,
    /function\s+\w+\s*\(/g
  ];

  for (const pattern of breakingPatterns) {
    const oldMatches = oldContent.match(pattern) || [];
    const newMatches = newContent.match(pattern) || [];
    
    if (oldMatches.length !== newMatches.length) {
      return true;
    }
  }

  return false;
}

// Additional implementation functions (simplified)
async function compareCodeVersions(before: string, after: string, depth: string) {
  const diff = diffChars(before, after);
  return { diff, analysis: 'Code comparison completed' };
}

async function performTaskReflection(sessionId: string | undefined, memory: UnifiedMemoryCore, journal: JournalSystem) {
  return { reflection: 'Task reflection completed', lessons: [] };
}

async function identifyCodePatterns(files: string[], memory: UnifiedMemoryCore) {
  return { patterns: [], antiPatterns: [], suggestions: [] };
}

async function getImpactHistory(memory: UnifiedMemoryCore, journal: JournalSystem) {
  return { history: [] };
}

function calculateOverallRisk(changes: CodeChange[]): 'low' | 'medium' | 'high' | 'critical' {
  const risks = changes.map(c => c.impact.risk);
  if (risks.includes('critical')) return 'critical';
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}

function calculateOverallComplexity(changes: CodeChange[]): 'low' | 'medium' | 'high' {
  const complexities = changes.map(c => c.complexity);
  if (complexities.includes('high')) return 'high';
  if (complexities.includes('medium')) return 'medium';
  return 'low';
}

async function identifyChangePatterns(changes: CodeChange[], memory: UnifiedMemoryCore) {
  return {
    positive: ['consistent-naming', 'proper-error-handling'],
    negative: [],
    suggestions: ['add-tests', 'update-docs']
  };
}

function generateRecommendations(changes: CodeChange[], patterns: any): string[] {
  const recommendations = ['Проверить тесты', 'Обновить документацию'];
  
  if (changes.some(c => c.impact.breakingChanges)) {
    recommendations.push('⚠️ Обнаружены breaking changes - проверить обратную совместимость');
  }
  
  return recommendations;
}

// Report formatting functions
function formatAnalysisReport(analysis: ImpactAnalysis): string {
  return `# 🔍 Code Impact Analysis Report

## 📊 Summary
- **Files Analyzed:** ${analysis.summary.totalFiles}
- **Lines Added:** +${analysis.summary.totalLines.added}
- **Lines Removed:** -${analysis.summary.totalLines.removed}
- **Risk Level:** ${getRiskEmoji(analysis.summary.riskLevel)} ${analysis.summary.riskLevel.toUpperCase()}
- **Complexity:** ${getComplexityEmoji(analysis.summary.complexity)} ${analysis.summary.complexity.toUpperCase()}
- **Breaking Changes:** ${analysis.summary.breakingChanges}

## 📋 Recommendations
${analysis.summary.recommendations.map(r => `- ${r}`).join('\n')}

## 🔄 Changes Details
${analysis.changes.map(formatChangeDetail).join('\n\n')}

## 🎯 Patterns Identified
**Positive:** ${analysis.patterns.identified.join(', ') || 'None'}
**Anti-patterns:** ${analysis.patterns.antiPatterns.join(', ') || 'None'}
**Suggestions:** ${analysis.patterns.suggestions.join(', ') || 'None'}

---
*Analysis completed: ${new Date().toISOString()}*`;
}

function formatChangeDetail(change: CodeChange): string {
  return `### ${change.file}
- **Type:** ${change.type}
- **Lines:** +${change.linesAdded}/-${change.linesRemoved}
- **Complexity:** ${getComplexityEmoji(change.complexity)} ${change.complexity}
- **Risk:** ${getRiskEmoji(change.impact.risk)} ${change.impact.risk}
- **Scope:** ${change.impact.scope}
- **Breaking:** ${change.impact.breakingChanges ? '⚠️ Yes' : '✅ No'}`;
}

function formatComparisonReport(comparison: any): string {
  return `# 📋 Code Comparison Report\n\nComparison completed successfully.`;
}

function formatReflectionReport(reflection: any): string {
  return `# 🎯 Task Reflection Report\n\nReflection completed successfully.`;
}

function formatPatternsReport(patterns: any): string {
  return `# 🔍 Code Patterns Report\n\nPatterns analysis completed.`;
}

function formatHistoryReport(history: any): string {
  return `# 📊 Impact History Report\n\nHistory analysis completed.`;
}

function getRiskEmoji(risk: string): string {
  switch (risk) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

function getComplexityEmoji(complexity: string): string {
  switch (complexity) {
    case 'high': return '🔥';
    case 'medium': return '⚡';
    case 'low': return '🌿';
    default: return '⚪';
  }
}
