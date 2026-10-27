import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import { z } from 'zod';
import { 
  ValidationResult,
  ValidationConfig,
  ITSISystem
} from '../core/types.js';

/**
 * MCP Tool: Validate Implementation
 * Валидирует код на соответствие паттернам безопасности
 */

const ValidateImplementationRequestSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  technology: z.string().min(1, 'Technology is required'),
  strict_mode: z.boolean().default(false),
  enabled_categories: z.array(z.enum(['security', 'performance', 'architecture', 'testing', 'deployment', 'maintenance', 'defensive'])).default(['security', 'performance', 'architecture']),
  risk_threshold: z.number().min(0).max(100).default(50),
  confidence_threshold: z.number().min(0).max(1).default(0.7),
  include_fixes: z.boolean().default(true),
  include_metrics: z.boolean().default(true),
  custom_rules: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    pattern: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    message: z.string(),
    fix: z.string().optional()
  })).optional()
});

export const validateImplementationTool = {
  name: 'mcp_m7_validate_implementation',
  description: 'Validate code implementation against safety patterns and best practices',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Code to validate'
      },
      technology: {
        type: 'string',
        description: 'Technology/language of the code (e.g., javascript, typescript, python)'
      },
      strict_mode: {
        type: 'boolean',
        default: false,
        description: 'Enable strict validation mode'
      },
      enabled_categories: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['security', 'performance', 'architecture', 'testing', 'deployment', 'maintenance', 'defensive']
        },
        default: ['security', 'performance', 'architecture'],
        description: 'Categories of patterns to check'
      },
      risk_threshold: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 50,
        description: 'Minimum risk score to report issues (0-100)'
      },
      confidence_threshold: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.7,
        description: 'Minimum confidence level for patterns (0.0-1.0)'
      },
      include_fixes: {
        type: 'boolean',
        default: true,
        description: 'Include suggested fixes in response'
      },
      include_metrics: {
        type: 'boolean',
        default: true,
        description: 'Include detailed metrics in response'
      },
      custom_rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            pattern: { type: 'string' },
            severity: { 
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low']
            },
            message: { type: 'string' },
            fix: { type: 'string' }
          },
          required: ['id', 'name', 'description', 'pattern', 'severity', 'message']
        },
        description: 'Custom validation rules'
      }
    },
    required: ['code', 'technology']
  },

  handler: async (request: any, tsiSystem: ITSISystem) => {
    try {
      const params = ValidateImplementationRequestSchema.parse(request);
      
      // Создаем конфигурацию валидации
      const config: ValidationConfig = {
        strictMode: params.strict_mode,
        enabledCategories: params.enabled_categories as any[],
        riskThreshold: params.risk_threshold,
        confidenceThreshold: params.confidence_threshold,
        customRules: params.custom_rules?.map(rule => ({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          pattern: new RegExp(rule.pattern),
          severity: rule.severity as any,
          message: rule.message,
          fix: rule.fix
        }))
      };
      
      // Выполняем валидацию через TSI систему
      const result = await tsiSystem.validateImplementation(params.code, params.technology, config);
      
      // Форматируем результат
      const response = formatValidationResult(result, params);
      
      return {
        content: [{
          type: 'text',
          text: response
        }]
      };
      
    } catch (error) {
      log.debug('TSI Tool] Validate implementation failed:', error);
      
      return {
        content: [{
          type: 'text',
          text: `❌ **Code Validation Failed**

**Error:** ${error instanceof Error ? error.message : 'Unknown error'}

**Suggestion:** Please check your code and parameters, then try again.`
        }],
        isError: true
      };
    }
  }
};

function formatValidationResult(result: ValidationResult, params: any): string {
  const statusEmoji = result.valid ? '✅' : '❌';
  const scoreColor = getScoreColor(result.score);
  
  let response = `# 🔍 Code Validation Report

## 📊 Overall Assessment
- **Status:** ${statusEmoji} ${result.valid ? 'VALID' : 'ISSUES FOUND'}
- **Quality Score:** ${result.score}/100 ${scoreColor}
- **Technology:** ${params.technology}
- **Validation Mode:** ${params.strict_mode ? 'Strict' : 'Standard'}

`;

  // Краткая сводка
  if (result.issues.length > 0) {
    const criticalIssues = result.issues.filter(i => i.severity === 'critical').length;
    const highIssues = result.issues.filter(i => i.severity === 'high').length;
    const mediumIssues = result.issues.filter(i => i.severity === 'medium').length;
    const lowIssues = result.issues.filter(i => i.severity === 'low').length;
    
    response += `## 🚨 Issues Summary
- **Critical:** ${criticalIssues} 🔴
- **High:** ${highIssues} 🟠
- **Medium:** ${mediumIssues} 🟡
- **Low:** ${lowIssues} 🟢
- **Total:** ${result.issues.length}

`;
  }

  // Детали проблем
  if (result.issues.length > 0) {
    response += `## 📋 Detailed Issues

`;
    
    // Группируем по серьезности
    const issuesBySeverity = {
      critical: result.issues.filter(i => i.severity === 'critical'),
      high: result.issues.filter(i => i.severity === 'high'),
      medium: result.issues.filter(i => i.severity === 'medium'),
      low: result.issues.filter(i => i.severity === 'low')
    };
    
    for (const [severity, issues] of Object.entries(issuesBySeverity)) {
      if (issues.length === 0) continue;
      
      const severityEmoji = getSeverityEmoji(severity);
      const severityTitle = severity.charAt(0).toUpperCase() + severity.slice(1);
      
      response += `### ${severityEmoji} ${severityTitle} Issues (${issues.length})

`;
      
      for (const issue of issues) {
        response += `#### ${issue.message}
- **Category:** ${issue.category}
- **Location:** Line ${issue.location.line || 'Unknown'}
- **Rule:** ${issue.rule}

`;
        
        if (issue.location.snippet) {
          response += `**Code:**
\`\`\`${params.technology}
${issue.location.snippet}
\`\`\`

`;
        }
      }
    }
  }

  // Предложения по исправлению
  if (params.include_fixes && result.fixes.length > 0) {
    response += `## 🔧 Suggested Fixes (${result.fixes.length})

`;
    
    for (const fix of result.fixes) {
      const automatedEmoji = fix.automated ? '🤖' : '👨‍💻';
      const confidencePercent = Math.round(fix.confidence * 100);
      
      response += `### ${automatedEmoji} ${fix.description}
- **Type:** ${fix.type}
- **Confidence:** ${confidencePercent}%
- **Automated:** ${fix.automated ? 'Yes' : 'No'}

`;
      
      if (fix.oldCode && fix.newCode) {
        response += `**Before:**
\`\`\`${params.technology}
${fix.oldCode}
\`\`\`

**After:**
\`\`\`${params.technology}
${fix.newCode}
\`\`\`

`;
      }
    }
  }

  // Метрики
  if (params.include_metrics && result.metrics) {
    response += `## 📈 Validation Metrics
- **Lines Analyzed:** ${result.metrics.linesAnalyzed}
- **Patterns Checked:** ${result.metrics.patternsChecked}
- **Issues Found:** ${result.metrics.issuesFound}
- **Critical Issues:** ${result.metrics.criticalIssues}
- **Analysis Time:** ${result.metrics.analysisTime}ms

`;
  }

  // Рекомендации по действиям
  response += `## 🎯 Recommended Actions

`;
  
  if (!result.valid) {
    const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
    const highCount = result.issues.filter(i => i.severity === 'high').length;
    
    if (criticalCount > 0) {
      response += `🚨 **IMMEDIATE ACTION REQUIRED**
1. Fix all ${criticalCount} critical issues before deployment
2. Review security implications
3. Test thoroughly after fixes
4. Consider code review by senior developer

`;
    } else if (highCount > 0) {
      response += `⚠️ **HIGH PRIORITY**
1. Address ${highCount} high-priority issues
2. Plan fixes in current sprint
3. Review with team lead
4. Update documentation if needed

`;
    } else {
      response += `📝 **STANDARD IMPROVEMENTS**
1. Address remaining issues when convenient
2. Consider refactoring opportunities
3. Update coding standards if needed
4. Plan gradual improvements

`;
    }
  } else {
    response += `✅ **GOOD CODE QUALITY**
1. Code meets current standards
2. Consider implementing suggested improvements
3. Maintain current quality level
4. Share patterns with team

`;
  }

  // Категории проверки
  response += `## 🏷️ Validation Categories
**Enabled:** ${params.enabled_categories.join(', ')}
**Risk Threshold:** ${params.risk_threshold}/100
**Confidence Threshold:** ${Math.round(params.confidence_threshold * 100)}%

`;

  // Пользовательские правила
  if (params.custom_rules && params.custom_rules.length > 0) {
    response += `## ⚙️ Custom Rules Applied (${params.custom_rules.length})
${params.custom_rules.map((rule: any) => `- **${rule.name}:** ${rule.description}`).join('\n')}

`;
  }

  response += `---
*Validation powered by M7 Tech Safety Intelligence v1.0*`;

  return response;
}

function getScoreColor(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  if (score >= 50) return '🟠';
  return '🔴';
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
