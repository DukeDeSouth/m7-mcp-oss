import { z } from 'zod';
import { JournalSystem } from '../../journal/journalSystem.js';

const CheckErrorsRequestSchema = z.object({
  error_type: z.string().optional(),
});

export const checkErrorsTool = {
  name: 'mcp_m7_check_errors',
  description: 'Check error journal to avoid repeating past mistakes',
  inputSchema: {
    type: 'object',
    properties: {
      error_type: {
        type: 'string',
        description: 'Type of error to check (optional)'
      }
    }
  },
  handler: async (request: any, journal: JournalSystem) => {
    const params = CheckErrorsRequestSchema.parse(request);
    const { error_type } = params;

    try {
      const analysis = await analyzeErrors(journal, error_type);
      
      return {
        content: [{
          type: 'text',
          text: `# Error Journal Analysis

## 📊 Error Summary:
- **Total Errors:** ${analysis.total}
- **Recent Errors (7 days):** ${analysis.recent}
- **Critical Errors:** ${analysis.critical}
- **Recurring Patterns:** ${analysis.patterns.length}

${error_type ? `## 🔍 Filtered by: "${error_type}"
Found ${analysis.filtered.length} matching errors.

` : ''}## 🚨 Most Common Patterns:
${analysis.patterns.slice(0, 5).map((pattern, i) => 
  `${i + 1}. **${pattern.type}** (${pattern.count} occurrences)
   - *${pattern.description}*
   - **Prevention:** ${pattern.prevention}`
).join('\n\n')}

## 📈 Trends:
- **Error Rate:** ${analysis.errorRate} errors/day (last 30 days)
- **Resolution Time:** Average ${analysis.avgResolutionTime} minutes
- **Recurring Issues:** ${analysis.recurringIssues}%

## 🛡️ Prevention Strategies:
${getPreventionStrategies(analysis).map(strategy => `- ${strategy}`).join('\n')}

## 🔗 Recommendations:
- Review and update .cursorrules with these patterns
- Consider adding automated checks for common errors
- Update M7 methodology based on recurring issues
- Store successful error resolutions as patterns

**Last Updated:** ${new Date().toLocaleString()}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ **Error analysis failed:** ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
};

async function analyzeErrors(journal: JournalSystem, errorType?: string) {
  const errors = await journal.getErrors();
  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  // Filter by type if specified
  const filteredErrors = errorType 
    ? errors.filter((e: any) => e.type?.toLowerCase().includes(errorType.toLowerCase()))
    : errors;

  // Recent errors
  const recentErrors = filteredErrors.filter((e: any) => 
    new Date(e.timestamp).getTime() > sevenDaysAgo
  );

  // Critical errors
  const criticalErrors = filteredErrors.filter((e: any) => 
    e.severity === 'critical' || e.message?.toLowerCase().includes('critical')
  );

  // Pattern detection
  const patterns = findCommonPatterns(filteredErrors);

  // Calculate metrics
  const recentErrorsForRate = errors.filter((e: any) => 
    new Date(e.timestamp).getTime() > thirtyDaysAgo
  );
  const errorRate = (recentErrorsForRate.length / 30).toFixed(1);

  // Calculate average resolution time (mock for now)
  const avgResolutionTime = Math.round(
    filteredErrors.reduce((sum: number, e: any) => sum + (e.context?.resolutionTime || 30), 0) / 
    Math.max(filteredErrors.length, 1)
  );

  // Recurring issues percentage
  const recurringIssues = Math.round(
    (patterns.filter(p => p.count > 1).length / Math.max(patterns.length, 1)) * 100
  );

  return {
    total: filteredErrors.length,
    recent: recentErrors.length,
    critical: criticalErrors.length,
    patterns,
    filtered: errorType ? filteredErrors : [],
    errorRate: parseFloat(errorRate),
    avgResolutionTime,
    recurringIssues
  };
}

function findCommonPatterns(errors: any[]) {
  const patternMap = new Map<string, {
    count: number;
    type: string;
    description: string;
    prevention: string;
    examples: string[];
  }>();

  errors.forEach((error: any) => {
    const key = error.type || 'unknown';
    const existing = patternMap.get(key);
    
    if (existing) {
      existing.count++;
      existing.examples.push(error.message?.slice(0, 100) || 'No message');
    } else {
      patternMap.set(key, {
        count: 1,
        type: key,
        description: error.message?.slice(0, 150) || 'No description',
        prevention: generatePrevention(error),
        examples: [error.message?.slice(0, 100) || 'No message']
      });
    }
  });

  return Array.from(patternMap.values())
    .sort((a, b) => b.count - a.count);
}

function generatePrevention(error: any): string {
  const message = error.message?.toLowerCase() || '';
  
  if (message.includes('type') || message.includes('ts')) {
    return 'Use stricter TypeScript configuration and type checking';
  }
  if (message.includes('undefined') || message.includes('null')) {
    return 'Add null checks and proper initialization';
  }
  if (message.includes('import') || message.includes('module')) {
    return 'Verify import paths and module dependencies';
  }
  if (message.includes('build') || message.includes('compile')) {
    return 'Check build configuration and dependencies';
  }
  if (message.includes('test') || message.includes('spec')) {
    return 'Improve test coverage and validation';
  }
  
  return 'Follow M7 methodology for systematic problem solving';
}

function getPreventionStrategies(analysis: any): string[] {
  const strategies: string[] = [
    'Follow M7 Discovery phase to research solutions before implementation',
    'Use Context7 MCP to verify library documentation and compatibility',
    'Implement comprehensive error handling and validation',
  ];

  if (analysis.patterns.some((p: any) => p.type.includes('type'))) {
    strategies.push('Strengthen TypeScript configuration and type safety');
  }

  if (analysis.patterns.some((p: any) => p.type.includes('import'))) {
    strategies.push('Create and maintain dependency map and import standards');
  }

  if (analysis.recurringIssues > 30) {
    strategies.push('Implement automated detection for recurring error patterns');
  }

  if (analysis.avgResolutionTime > 60) {
    strategies.push('Create error resolution playbooks for common issues');
  }

  strategies.push('Update .cursorrules with learned patterns and preventions');

  return strategies;
} 