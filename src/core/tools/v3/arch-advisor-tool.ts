/**
 * M7 v3.0 - Architectural Advisor MCP Tool
 * 
 * MCP tool for architecture analysis, antipattern detection,
 * C4 diagrams, and refactoring suggestions.
 */

import { z } from 'zod';
import { 
  getArchitecturalAdvisor,
  ArchitectureScore,
  DetectedAntipattern,
  RefactoringSuggestion,
  C4Diagram,
  C4Level,
  AntipatternSeverity
} from '../../../arch-advisor/index.js';
import { getKnowledgeGraph } from '../../../knowledge-graph/index.js';
import { getProjectPath } from '../../utils/projectPath.js';

// ============================================
// SCHEMA
// ============================================

const archAdvisorSchema = z.object({
  action: z.enum([
    'analyze',              // Full analysis with score
    'detect_antipatterns',  // Only detect antipatterns
    'suggest_refactoring',  // Generate refactoring suggestions
    'generate_c4',          // Generate C4 diagram
    'score',                // Get score only
    'critical_issues',      // Get critical issues only
    'top_suggestions'       // Get top suggestions
  ]).describe('Action to perform'),
  
  c4_level: z.enum(['context', 'container', 'component', 'code'])
    .optional()
    .describe('C4 diagram level (for generate_c4 action)'),
  
  severity_filter: z.enum(['critical', 'major', 'minor'])
    .optional()
    .describe('Filter antipatterns by severity'),
  
  limit: z.number()
    .optional()
    .default(10)
    .describe('Limit number of results'),
  
  project_path: z.string()
    .optional()
    .describe('Project path (defaults to current directory)'),
    
  disabled_rules: z.array(z.string())
    .optional()
    .describe('Rule IDs to disable'),
    
  enabled_rules: z.array(z.string())
    .optional()
    .describe('Rule IDs to enable (if specified, only these run)')
});

export type ArchAdvisorParams = z.infer<typeof archAdvisorSchema>;

// ============================================
// TOOL DEFINITION
// ============================================

export const archAdvisorTool = {
  name: 'mcp_m7_arch_advisor',
  description: `Architectural Advisor - analyze architecture, detect antipatterns, generate C4 diagrams, suggest refactoring.

Actions:
- analyze: Full analysis with score (A-F grade)
- detect_antipatterns: Find architecture problems
- suggest_refactoring: Get actionable improvement steps
- generate_c4: Generate C4 architecture diagrams
- score: Quick score summary
- critical_issues: Only critical problems
- top_suggestions: Best improvement opportunities`,
  
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'detect_antipatterns', 'suggest_refactoring', 'generate_c4', 'score', 'critical_issues', 'top_suggestions'],
        description: 'Action to perform'
      },
      c4_level: {
        type: 'string',
        enum: ['context', 'container', 'component', 'code'],
        description: 'C4 diagram level (for generate_c4 action)'
      },
      severity_filter: {
        type: 'string',
        enum: ['critical', 'major', 'minor'],
        description: 'Filter antipatterns by severity'
      },
      limit: {
        type: 'number',
        description: 'Limit number of results',
        default: 10
      },
      project_path: {
        type: 'string',
        description: 'Project path (defaults to current directory)'
      },
      disabled_rules: {
        type: 'array',
        items: { type: 'string' },
        description: 'Rule IDs to disable'
      },
      enabled_rules: {
        type: 'array',
        items: { type: 'string' },
        description: 'Rule IDs to enable (if specified, only these run)'
      }
    },
    required: ['action']
  },
  
  async handler(request: any): Promise<any> {
    const params = archAdvisorSchema.parse(request) as ArchAdvisorParams;
    const projectPath = params.project_path || getProjectPath();
    
    try {
      const advisor = getArchitecturalAdvisor(projectPath);
      const graph = getKnowledgeGraph();
      
      // Ensure graph is built
      if (!graph.built) {
        await graph.build({ rootPath: projectPath });
      }
      
      let result: string;
      
      switch (params.action) {
        case 'analyze':
          result = await handleAnalyze(advisor, params);
          break;
          
        case 'detect_antipatterns':
          result = handleDetectAntipatterns(advisor, params);
          break;
          
        case 'suggest_refactoring':
          result = handleSuggestRefactoring(advisor, params);
          break;
          
        case 'generate_c4':
          result = handleGenerateC4(advisor, params);
          break;
          
        case 'score':
          result = await handleScore(advisor);
          break;
          
        case 'critical_issues':
          result = handleCriticalIssues(advisor);
          break;
          
        case 'top_suggestions':
          result = handleTopSuggestions(advisor, params.limit);
          break;
          
        default:
          result = `Unknown action: ${params.action}`;
      }
      
      return {
        content: [{ type: 'text', text: result }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `# ❌ Error\n\n${error.message}` }],
        isError: true
      };
    }
  }
};

// ============================================
// ACTION HANDLERS
// ============================================

async function handleAnalyze(
  advisor: ReturnType<typeof getArchitecturalAdvisor>,
  params: ArchAdvisorParams
): Promise<string> {
  const score = await advisor.analyze({
    enabledRules: params.enabled_rules,
    disabledRules: params.disabled_rules
  });
  
  return formatAnalysisResult(score, params.limit);
}

function handleDetectAntipatterns(
  advisor: ReturnType<typeof getArchitecturalAdvisor>,
  params: ArchAdvisorParams
): string {
  let antipatterns = advisor.detectAntipatterns({
    enabledRules: params.enabled_rules,
    disabledRules: params.disabled_rules
  });
  
  // Filter by severity if specified
  if (params.severity_filter) {
    antipatterns = antipatterns.filter(a => a.severity === params.severity_filter);
  }
  
  // Limit results
  antipatterns = antipatterns.slice(0, params.limit);
  
  return formatAntipatterns(antipatterns);
}

function handleSuggestRefactoring(
  advisor: ReturnType<typeof getArchitecturalAdvisor>,
  params: ArchAdvisorParams
): string {
  const antipatterns = advisor.detectAntipatterns({
    enabledRules: params.enabled_rules,
    disabledRules: params.disabled_rules
  });
  
  let suggestions = advisor.generateSuggestions(antipatterns);
  suggestions = suggestions.slice(0, params.limit);
  
  return formatSuggestions(suggestions);
}

function handleGenerateC4(
  advisor: ReturnType<typeof getArchitecturalAdvisor>,
  params: ArchAdvisorParams
): string {
  const level = (params.c4_level || 'component') as C4Level;
  const diagram = advisor.generateC4Diagram(level);
  
  return formatC4Diagram(diagram);
}

async function handleScore(
  advisor: ReturnType<typeof getArchitecturalAdvisor>
): Promise<string> {
  const score = await advisor.getScore();
  return formatScoreSummary(score);
}

function handleCriticalIssues(
  advisor: ReturnType<typeof getArchitecturalAdvisor>
): string {
  const issues = advisor.getCriticalIssues();
  
  if (issues.length === 0) {
    return '# ✅ No Critical Issues\n\nNo critical architecture problems detected.';
  }
  
  return formatAntipatterns(issues);
}

function handleTopSuggestions(
  advisor: ReturnType<typeof getArchitecturalAdvisor>,
  limit: number
): string {
  const suggestions = advisor.getTopSuggestions(limit);
  
  if (suggestions.length === 0) {
    return '# ✅ No Suggestions\n\nNo improvement suggestions at this time.';
  }
  
  return formatSuggestions(suggestions);
}

// ============================================
// FORMATTERS
// ============================================

function formatAnalysisResult(score: ArchitectureScore, limit: number): string {
  const gradeEmoji: Record<string, string> = {
    'A': '🏆',
    'B': '✅',
    'C': '⚠️',
    'D': '🔶',
    'F': '🚨'
  };
  
  let output = `# ${gradeEmoji[score.grade]} Architecture Analysis\n\n`;
  output += `## Score: ${score.grade} (${score.score}/100)\n\n`;
  
  // Breakdown
  output += `### Score Breakdown\n\n`;
  output += `| Category | Score | Max |\n`;
  output += `|----------|-------|-----|\n`;
  output += `| Antipatterns | ${score.breakdown.antipatterns} | 25 |\n`;
  output += `| Complexity | ${score.breakdown.complexity} | 25 |\n`;
  output += `| Coupling | ${score.breakdown.coupling} | 25 |\n`;
  output += `| Testability | ${score.breakdown.testability} | 25 |\n`;
  output += `| **Total** | **${score.score}** | **100** |\n\n`;
  
  // Trend
  if (score.trend) {
    const trendEmoji = {
      improving: '📈',
      stable: '➡️',
      declining: '📉'
    };
    output += `**Trend:** ${trendEmoji[score.trend]} ${score.trend}\n\n`;
  }
  
  // Antipatterns summary
  const critical = score.antipatterns.filter(a => a.severity === 'critical').length;
  const major = score.antipatterns.filter(a => a.severity === 'major').length;
  const minor = score.antipatterns.filter(a => a.severity === 'minor').length;
  
  output += `### Antipatterns Found\n\n`;
  output += `- 🔴 Critical: ${critical}\n`;
  output += `- 🟡 Major: ${major}\n`;
  output += `- 🟢 Minor: ${minor}\n\n`;
  
  // Top antipatterns
  if (score.antipatterns.length > 0) {
    output += `### Top Issues\n\n`;
    for (const ap of score.antipatterns.slice(0, Math.min(5, limit))) {
      const emoji = ap.severity === 'critical' ? '🔴' : ap.severity === 'major' ? '🟡' : '🟢';
      output += `${emoji} **${ap.name}**: ${ap.target.name}\n`;
      output += `   ${ap.description}\n\n`;
    }
  }
  
  // Top suggestions
  if (score.suggestions.length > 0) {
    output += `### Top Suggestions\n\n`;
    for (const s of score.suggestions.slice(0, Math.min(3, limit))) {
      output += `💡 **${s.title}**\n`;
      output += `   Effort: ${s.effort} | Impact: ${s.impact}\n\n`;
    }
  }
  
  // Explanation
  if (score.explanation) {
    output += `---\n\n${score.explanation}`;
  }
  
  return output;
}

function formatAntipatterns(antipatterns: DetectedAntipattern[]): string {
  if (antipatterns.length === 0) {
    return '# ✅ No Antipatterns Detected\n\nYour architecture looks clean!';
  }
  
  let output = `# 🔍 Detected Antipatterns (${antipatterns.length})\n\n`;
  
  for (const ap of antipatterns) {
    const emoji = ap.severity === 'critical' ? '🔴' : ap.severity === 'major' ? '🟡' : '🟢';
    
    output += `## ${emoji} ${ap.name}\n\n`;
    output += `**Severity:** ${ap.severity.toUpperCase()}\n`;
    output += `**Target:** \`${ap.target.name}\` in \`${ap.target.filePath}\`\n`;
    output += `**Confidence:** ${Math.round(ap.confidence * 100)}%\n\n`;
    output += `${ap.description}\n\n`;
    
    if (ap.evidence.length > 0) {
      output += `**Evidence:**\n`;
      for (const e of ap.evidence) {
        output += `- ${e}\n`;
      }
      output += '\n';
    }
    
    output += `---\n\n`;
  }
  
  return output;
}

function formatSuggestions(suggestions: RefactoringSuggestion[]): string {
  if (suggestions.length === 0) {
    return '# ✅ No Suggestions\n\nNo improvements needed at this time.';
  }
  
  let output = `# 💡 Refactoring Suggestions (${suggestions.length})\n\n`;
  
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    const priorityEmoji = s.priority === 'critical' ? '🔴' : s.priority === 'major' ? '🟡' : '🟢';
    
    output += `## ${i + 1}. ${s.title}\n\n`;
    output += `${priorityEmoji} **Priority:** ${s.priority.toUpperCase()}\n`;
    output += `📁 **Target:** \`${s.target.name}\` in \`${s.target.filePath}\`\n`;
    output += `⏱️ **Effort:** ${s.effort} | 📈 **Impact:** ${s.impact}\n\n`;
    output += `${s.description}\n\n`;
    
    output += `### Steps:\n`;
    for (const step of s.steps) {
      output += `${step}\n`;
    }
    output += '\n';
    
    if (s.beforeCode && s.afterCode) {
      output += `### Before:\n\`\`\`typescript\n${s.beforeCode}\n\`\`\`\n\n`;
      output += `### After:\n\`\`\`typescript\n${s.afterCode}\n\`\`\`\n\n`;
    }
    
    output += `---\n\n`;
  }
  
  return output;
}

function formatC4Diagram(diagram: C4Diagram): string {
  let output = `# 📊 C4 ${diagram.level.charAt(0).toUpperCase() + diagram.level.slice(1)} Diagram\n\n`;
  output += `**Title:** ${diagram.title}\n`;
  output += `**Elements:** ${diagram.elements.length}\n`;
  output += `**Relationships:** ${diagram.relationships.length}\n\n`;
  
  output += `## Mermaid Diagram\n\n`;
  output += `\`\`\`mermaid\n${diagram.mermaid}\`\`\`\n\n`;
  
  output += `## Elements\n\n`;
  for (const el of diagram.elements) {
    output += `- **${el.name}** (${el.type}): ${el.description}\n`;
  }
  
  return output;
}

function formatScoreSummary(score: ArchitectureScore): string {
  const gradeEmoji: Record<string, string> = {
    'A': '🏆',
    'B': '✅',
    'C': '⚠️',
    'D': '🔶',
    'F': '🚨'
  };
  
  let output = `# ${gradeEmoji[score.grade]} Architecture Score: ${score.grade}\n\n`;
  output += `**Score:** ${score.score}/100\n\n`;
  
  output += `| Category | Score |\n`;
  output += `|----------|-------|\n`;
  output += `| Antipatterns | ${score.breakdown.antipatterns}/25 |\n`;
  output += `| Complexity | ${score.breakdown.complexity}/25 |\n`;
  output += `| Coupling | ${score.breakdown.coupling}/25 |\n`;
  output += `| Testability | ${score.breakdown.testability}/25 |\n`;
  
  return output;
}

export default archAdvisorTool;

