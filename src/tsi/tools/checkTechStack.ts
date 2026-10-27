import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import { z } from 'zod';
import { 
  TechAnalysisContext,
  TechAnalysisResult,
  ITSISystem
} from '../core/types.js';

/**
 * MCP Tool: Check Tech Stack Safety
 * Проверяет технологический стек на безопасность и паттерны
 */

const CheckTechStackRequestSchema = z.object({
  technology: z.string().min(1, 'Technology is required'),
  task: z.string().min(1, 'Task description is required'),
  existing_code: z.string().optional(),
  project_type: z.string().optional(),
  team_experience: z.enum(['junior', 'middle', 'senior']).optional(),
  timeline: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  preferences: z.array(z.string()).optional()
});

export const checkTechStackTool = {
  name: 'mcp_m7_check_tech_stack',
  description: 'Check technology stack for safety patterns and potential issues',
  inputSchema: {
    type: 'object',
    properties: {
      technology: {
        type: 'string',
        description: 'Technology to check (e.g., react, nodejs, docker, python)'
      },
      task: {
        type: 'string',
        description: 'Description of the task or project'
      },
      existing_code: {
        type: 'string',
        description: 'Optional existing code to analyze'
      },
      project_type: {
        type: 'string',
        description: 'Type of project (e.g., web-app, api, mobile, enterprise)'
      },
      team_experience: {
        type: 'string',
        enum: ['junior', 'middle', 'senior'],
        description: 'Team experience level'
      },
      timeline: {
        type: 'string',
        description: 'Project timeline (e.g., "2 weeks", "urgent", "flexible")'
      },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Project constraints and limitations'
      },
      preferences: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technology preferences and requirements'
      }
    },
    required: ['technology', 'task']
  },

  handler: async (request: any, tsiSystem: ITSISystem) => {
    try {
      const params = CheckTechStackRequestSchema.parse(request);
      
      // Создаем контекст анализа
      const context: TechAnalysisContext = {
        task: params.task,
        technology: params.technology,
        existingCode: params.existing_code,
        projectType: params.project_type,
        teamExperience: params.team_experience,
        timeline: params.timeline,
        constraints: params.constraints,
        preferences: params.preferences
      };
      
      // Выполняем анализ через TSI систему
      const result = await tsiSystem.checkTechStack(context);
      
      // Форматируем результат
      const response = formatTechStackAnalysis(result);
      
      return {
        content: [{
          type: 'text',
          text: response
        }]
      };
      
    } catch (error) {
      log.debug('TSI Tool] Check tech stack failed:', error);
      
      return {
        content: [{
          type: 'text',
          text: `❌ **Tech Stack Analysis Failed**

**Error:** ${error instanceof Error ? error.message : 'Unknown error'}

**Suggestion:** Please check your input parameters and try again.`
        }],
        isError: true
      };
    }
  }
};

function formatTechStackAnalysis(result: TechAnalysisResult): string {
  const riskLevel = getRiskLevel(result.overallRiskScore);
  const riskEmoji = getRiskEmoji(result.overallRiskScore);
  
  let response = `# 🔍 Tech Stack Safety Analysis

## 📊 Overall Assessment
- **Technology:** ${result.technology}
- **Risk Score:** ${result.overallRiskScore}/100 ${riskEmoji}
- **Risk Level:** ${riskLevel}
- **Confidence:** ${Math.round(result.confidence * 100)}%
- **Analysis Time:** ${result.analysisTime}ms

`;

  // Рекомендованные паттерны
  if (result.recommendedPatterns.length > 0) {
    response += `## ✅ Recommended Patterns (${result.recommendedPatterns.length})

`;
    
    for (const pattern of result.recommendedPatterns.slice(0, 5)) {
      const confidence = Math.round(pattern.confidence * 100);
      response += `### ${pattern.name}
- **Category:** ${pattern.category}
- **Confidence:** ${confidence}%
- **Risk Score:** ${pattern.riskScore}/100
- **Description:** ${pattern.description}

`;
      
      if (pattern.implementation.length > 0) {
        const example = pattern.implementation[0];
        response += `**Example:**
\`\`\`${example.language || 'javascript'}
${example.code}
\`\`\`

`;
      }
    }
  }

  // Обнаруженные антипаттерны
  if (result.detectedAntipatterns.length > 0) {
    response += `## ⚠️ Detected Issues (${result.detectedAntipatterns.length})

`;
    
    for (const antipattern of result.detectedAntipatterns) {
      const severityEmoji = getSeverityEmoji(antipattern.severity);
      response += `### ${severityEmoji} ${antipattern.pattern.name}
- **Severity:** ${antipattern.severity}
- **Location:** Line ${antipattern.location?.line || 'Unknown'}
- **Description:** ${antipattern.description}
- **Suggested Fix:** ${antipattern.suggestedFix}
- **Auto-fixable:** ${antipattern.autoFixable ? 'Yes' : 'No'}

`;
      
      if (antipattern.location?.snippet) {
        response += `**Code:**
\`\`\`
${antipattern.location.snippet}
\`\`\`

`;
      }
    }
  }

  // Рекомендации
  if (result.suggestions.length > 0) {
    response += `## 💡 Suggestions (${result.suggestions.length})

`;
    
    for (const suggestion of result.suggestions) {
      const priorityEmoji = getPriorityEmoji(suggestion.priority);
      response += `### ${priorityEmoji} ${suggestion.title}
- **Type:** ${suggestion.type}
- **Priority:** ${suggestion.priority}
- **Effort:** ${suggestion.estimatedEffort}
- **Description:** ${suggestion.description}
- **Implementation:** ${suggestion.implementation}

**Benefits:**
${suggestion.benefits.map(benefit => `- ${benefit}`).join('\n')}

`;
    }
  }

  // Альтернативы
  if (result.alternatives.length > 0) {
    response += `## 🔄 Alternative Technologies (${result.alternatives.length})

`;
    
    for (const alternative of result.alternatives.slice(0, 3)) {
      response += `### ${alternative.name}
- **Technology:** ${alternative.technology}
- **Migration Complexity:** ${alternative.migrationComplexity}
- **When to use:** ${alternative.whenToUse}

**Pros:**
${alternative.pros.map(pro => `- ✅ ${pro}`).join('\n')}

**Cons:**
${alternative.cons.map(con => `- ❌ ${con}`).join('\n')}

**Migration Steps:**
${alternative.migrationSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

`;
    }
  }

  // Предупреждения
  if (result.warnings.length > 0) {
    response += `## ⚠️ Warnings

`;
    
    for (const warning of result.warnings) {
      const warningEmoji = getWarningEmoji(warning.level);
      response += `${warningEmoji} **${warning.level.toUpperCase()}:** ${warning.message}`;
      
      if (warning.suggestion) {
        response += `\n   💡 *Suggestion:* ${warning.suggestion}`;
      }
      
      response += '\n\n';
    }
  }

  // Заметки
  if (result.notes.length > 0) {
    response += `## 📝 Additional Notes

${result.notes.map(note => `- ${note}`).join('\n')}

`;
  }

  // Статистика
  response += `## 📈 Analysis Statistics
- **Patterns Checked:** ${result.patternsChecked}
- **Issues Found:** ${result.detectedAntipatterns.length}
- **Critical Issues:** ${result.detectedAntipatterns.filter(a => a.severity === 'critical').length}
- **Success:** ${result.success ? 'Yes' : 'No'}

`;

  // Рекомендации по действиям
  response += `## 🎯 Next Steps

`;
  
  if (result.overallRiskScore >= 70) {
    response += `🚨 **HIGH RISK DETECTED**
1. Address critical issues immediately
2. Review all detected antipatterns
3. Consider alternative technologies
4. Implement suggested fixes before proceeding

`;
  } else if (result.overallRiskScore >= 40) {
    response += `⚠️ **MEDIUM RISK**
1. Review and fix high-priority issues
2. Implement recommended patterns
3. Consider team training if needed
4. Plan for gradual improvements

`;
  } else {
    response += `✅ **LOW RISK**
1. Follow recommended patterns
2. Implement suggested improvements
3. Monitor for new issues
4. Maintain good practices

`;
  }

  response += `---
*Analysis powered by M7 Tech Safety Intelligence v1.0*`;

  return response;
}

function getRiskLevel(score: number): string {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'MINIMAL';
}

function getRiskEmoji(score: number): string {
  if (score >= 80) return '🔴';
  if (score >= 60) return '🟠';
  if (score >= 40) return '🟡';
  if (score >= 20) return '🟢';
  return '🔵';
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

function getPriorityEmoji(priority: string): string {
  switch (priority) {
    case 'critical': return '🚨';
    case 'high': return '🔥';
    case 'medium': return '⚡';
    case 'low': return '💡';
    default: return '📝';
  }
}

function getWarningEmoji(level: string): string {
  switch (level) {
    case 'error': return '❌';
    case 'warning': return '⚠️';
    case 'info': return 'ℹ️';
    default: return '📢';
  }
}
