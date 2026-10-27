import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import { z } from 'zod';
import { 
  TechPattern,
  PatternCategory,
  PatternType,
  ITSISystem
} from '../core/types.js';

/**
 * MCP Tool: Get Tech Patterns
 * Получает рекомендованные паттерны для технологии
 */

const GetPatternsRequestSchema = z.object({
  technology: z.string().min(1, 'Technology is required'),
  category: z.enum(['security', 'performance', 'architecture', 'testing', 'deployment', 'maintenance']).optional(),
  type: z.enum(['pattern', 'antipattern', 'both']).default('both'),
  limit: z.number().min(1).max(50).default(10),
  min_confidence: z.number().min(0).max(1).default(0.7),
  max_risk_score: z.number().min(0).max(100).default(100),
  tags: z.array(z.string()).optional(),
  include_examples: z.boolean().default(true),
  include_alternatives: z.boolean().default(true),
  sort_by: z.enum(['confidence', 'risk_score', 'usage_count', 'success_rate']).default('confidence')
});

export const getPatternsTool = {
  name: 'mcp_m7_get_patterns',
  description: 'Get recommended patterns and antipatterns for a specific technology',
  inputSchema: {
    type: 'object',
    properties: {
      technology: {
        type: 'string',
        description: 'Technology to get patterns for (e.g., react, nodejs, docker)'
      },
      category: {
        type: 'string',
        enum: ['security', 'performance', 'architecture', 'testing', 'deployment', 'maintenance'],
        description: 'Pattern category to filter by'
      },
      type: {
        type: 'string',
        enum: ['pattern', 'antipattern', 'both'],
        default: 'both',
        description: 'Type of patterns to return'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 50,
        default: 10,
        description: 'Maximum number of patterns to return'
      },
      min_confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.7,
        description: 'Minimum confidence level (0.0 - 1.0)'
      },
      max_risk_score: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 100,
        description: 'Maximum risk score (0-100)'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by specific tags'
      },
      include_examples: {
        type: 'boolean',
        default: true,
        description: 'Include code examples in response'
      },
      include_alternatives: {
        type: 'boolean',
        default: true,
        description: 'Include alternative solutions'
      },
      sort_by: {
        type: 'string',
        enum: ['confidence', 'risk_score', 'usage_count', 'success_rate'],
        default: 'confidence',
        description: 'Sort patterns by specified criteria'
      }
    },
    required: ['technology']
  },

  handler: async (request: any, tsiSystem: ITSISystem) => {
    try {
      const params = GetPatternsRequestSchema.parse(request);
      
      // Получаем паттерны через TSI систему
      const patterns = await tsiSystem.getPatterns(params.technology, params.category);
      
      // Фильтруем и сортируем
      let filteredPatterns = filterPatterns(patterns, params);
      filteredPatterns = sortPatterns(filteredPatterns, params.sort_by);
      
      // Ограничиваем количество
      const limitedPatterns = filteredPatterns.slice(0, params.limit);
      
      // Форматируем результат
      const response = formatPatternsResponse(limitedPatterns, params);
      
      return {
        content: [{
          type: 'text',
          text: response
        }]
      };
      
    } catch (error) {
      log.debug('TSI Tool] Get patterns failed:', error);
      
      return {
        content: [{
          type: 'text',
          text: `❌ **Pattern Retrieval Failed**

**Error:** ${error instanceof Error ? error.message : 'Unknown error'}

**Suggestion:** Please check your parameters and try again.`
        }],
        isError: true
      };
    }
  }
};

function filterPatterns(patterns: TechPattern[], params: any): TechPattern[] {
  return patterns.filter(pattern => {
    // Фильтр по типу
    if (params.type !== 'both' && pattern.type !== params.type) {
      return false;
    }
    
    // Фильтр по доверию
    if (pattern.confidence < params.min_confidence) {
      return false;
    }
    
    // Фильтр по риску
    if (pattern.riskScore > params.max_risk_score) {
      return false;
    }
    
    // Фильтр по тегам
    if (params.tags && params.tags.length > 0) {
      const hasAllTags = params.tags.every((tag: string) => pattern.tags.includes(tag));
      if (!hasAllTags) {
        return false;
      }
    }
    
    return true;
  });
}

function sortPatterns(patterns: TechPattern[], sortBy: string): TechPattern[] {
  return patterns.sort((a, b) => {
    switch (sortBy) {
      case 'confidence':
        return b.confidence - a.confidence;
      case 'risk_score':
        return a.riskScore - b.riskScore; // Меньший риск = лучше
      case 'usage_count':
        return b.usageCount - a.usageCount;
      case 'success_rate':
        return b.successRate - a.successRate;
      default:
        return b.confidence - a.confidence;
    }
  });
}

function formatPatternsResponse(patterns: TechPattern[], params: any): string {
  if (patterns.length === 0) {
    return `# 📋 Tech Patterns for ${params.technology}

## No patterns found

No patterns match your criteria:
- **Category:** ${params.category || 'All'}
- **Type:** ${params.type}
- **Min Confidence:** ${params.min_confidence}
- **Max Risk Score:** ${params.max_risk_score}

Try adjusting your filters or check if the technology name is correct.`;
  }

  const patternCount = patterns.filter(p => p.type === 'pattern').length;
  const antipatternCount = patterns.filter(p => p.type === 'antipattern').length;
  
  let response = `# 📋 Tech Patterns for ${params.technology}

## 📊 Summary
- **Total Patterns:** ${patterns.length}
- **Good Patterns:** ${patternCount} ✅
- **Antipatterns:** ${antipatternCount} ⚠️
- **Category:** ${params.category || 'All'}
- **Sorted by:** ${params.sort_by}

`;

  // Группируем по типу
  const goodPatterns = patterns.filter(p => p.type === 'pattern');
  const antipatterns = patterns.filter(p => p.type === 'antipattern');

  // Хорошие паттерны
  if (goodPatterns.length > 0) {
    response += `## ✅ Recommended Patterns (${goodPatterns.length})

`;
    
    for (const pattern of goodPatterns) {
      response += formatPattern(pattern, params);
    }
  }

  // Антипаттерны
  if (antipatterns.length > 0) {
    response += `## ⚠️ Antipatterns to Avoid (${antipatterns.length})

`;
    
    for (const pattern of antipatterns) {
      response += formatPattern(pattern, params);
    }
  }

  response += `---
*Patterns provided by M7 Tech Safety Intelligence v1.0*`;

  return response;
}

function formatPattern(pattern: TechPattern, params: any): string {
  const typeEmoji = pattern.type === 'pattern' ? '✅' : '⚠️';
  const confidencePercent = Math.round(pattern.confidence * 100);
  const successRatePercent = Math.round(pattern.successRate * 100);
  
  let patternText = `### ${typeEmoji} ${pattern.name}

**Details:**
- **Category:** ${pattern.category}
- **Confidence:** ${confidencePercent}%
- **Risk Score:** ${pattern.riskScore}/100
- **Success Rate:** ${successRatePercent}%
- **Usage Count:** ${pattern.usageCount}

**Description:** ${pattern.description}

`;

  // Теги
  if (pattern.tags.length > 0) {
    patternText += `**Tags:** ${pattern.tags.map(tag => `\`${tag}\``).join(', ')}

`;
  }

  // Примеры кода
  if (params.include_examples && pattern.implementation.length > 0) {
    patternText += `**Examples:**

`;
    
    for (const example of pattern.implementation.slice(0, 2)) {
      patternText += `*${example.description}*
\`\`\`${example.language || 'javascript'}
${example.code}
\`\`\`

`;
      
      if (example.dependencies && example.dependencies.length > 0) {
        patternText += `**Dependencies:** ${example.dependencies.join(', ')}

`;
      }
    }
  }

  // Риски
  if (pattern.risks.length > 0) {
    patternText += `**Risks:**
`;
    
    for (const risk of pattern.risks.slice(0, 3)) {
      const riskEmoji = getRiskEmoji(risk.level);
      patternText += `- ${riskEmoji} **${risk.level}:** ${risk.description}
`;
      
      if (risk.mitigation.length > 0) {
        patternText += `  *Mitigation:* ${risk.mitigation[0]}
`;
      }
    }
    
    patternText += '\n';
  }

  // Альтернативы
  if (params.include_alternatives && pattern.alternatives.length > 0) {
    patternText += `**Alternatives:**
`;
    
    for (const alt of pattern.alternatives.slice(0, 2)) {
      patternText += `- **${alt.name}** (${alt.technology}): ${alt.description}
`;
    }
    
    patternText += '\n';
  }

  // Контекст применения
  if (pattern.applicableContexts.length > 0) {
    patternText += `**When to use:** ${pattern.applicableContexts.join(', ')}

`;
  }

  // Несовместимость
  if (pattern.incompatibleWith.length > 0) {
    patternText += `**Incompatible with:** ${pattern.incompatibleWith.join(', ')}

`;
  }

  // Источники
  if (pattern.sources.length > 0) {
    patternText += `**Sources:**
`;
    
    for (const source of pattern.sources.slice(0, 2)) {
      patternText += `- [${source.title}](${source.url})`;
      if (source.author) {
        patternText += ` by ${source.author}`;
      }
      patternText += '\n';
    }
    
    patternText += '\n';
  }

  patternText += '---\n\n';
  
  return patternText;
}

function getRiskEmoji(level: string): string {
  switch (level) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}
