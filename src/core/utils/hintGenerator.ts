// Intelligent Hints: Context-aware hint generation

interface HintContext {
  phase?: string;
  taskType?: string;
  recentErrors?: Array<{ category: string; count: number }>;
  sessionDuration?: number;
  currentTool?: string;
}

export function generateIntelligentHints(context: HintContext): string[] {
  const hints: string[] = [];
  
  // Phase-specific hints
  const phaseHints: Record<string, string[]> = {
    discovery: [
      '💡 Check existing implementations before starting new code',
      '💡 Use @m7 memory to find similar past solutions',
      '💡 Document all edge cases in DISCOVERY_REPORT.md',
      '💡 Research thoroughly - 1 hour of research saves 10 hours of rework'
    ],
    architecture: [
      '💡 Map all system dependencies before designing',
      '💡 Consider performance implications early',
      '💡 Verify all libraries with Context7 first',
      '💡 Document integration points clearly'
    ],
    implementation: [
      '💡 Write tests as you implement each function',
      '💡 Commit working code frequently',
      '💡 Check error journal for similar past issues',
      '💡 Keep functions small and focused'
    ],
    validation: [
      '💡 Test edge cases thoroughly',
      '💡 Verify performance meets requirements',
      '💡 Update documentation with findings',
      '💡 Run linter before marking complete'
    ],
    completed: [
      '💡 Document lessons learned for future',
      '💡 Update memory bank with patterns',
      '💡 Consider what could be reused'
    ]
  };
  
  // Tool-specific hints
  const toolHints: Record<string, string[]> = {
    analyze_task: [
      '📌 Break complex tasks into smaller subtasks',
      '📌 Check if similar task was done before'
    ],
    memory: [
      '📌 Store successful patterns for reuse',
      '📌 Search before implementing from scratch'
    ],
    validate: [
      '📌 Run all validation checks before proceeding',
      '📌 Fix critical issues first'
    ],
    session: [
      '📌 One task at a time for better focus',
      '📌 Complete requirements before coding'
    ]
  };
  
  // Add phase-based hint if phase is known
  if (context.phase && phaseHints[context.phase]) {
    const phaseOptions = phaseHints[context.phase];
    hints.push(phaseOptions[Math.floor(Math.random() * phaseOptions.length)]);
  }
  
  // Add tool-specific hint
  if (context.currentTool) {
    const toolKey = context.currentTool.replace('mcp_m7_', '');
    if (toolHints[toolKey]) {
      const toolOptions = toolHints[toolKey];
      hints.push(toolOptions[Math.floor(Math.random() * toolOptions.length)]);
    }
  }
  
  // Error-based hints (only if errors are trending up)
  if (context.recentErrors && context.recentErrors.length > 0) {
    const topErrorCategory = context.recentErrors[0].category;
    const errorHints: Record<string, string> = {
      compilation: '⚠️ Compilation errors detected - check syntax and imports',
      runtime: '⚠️ Runtime errors increasing - add more error handling',
      security: '🔒 Security issues found - review security best practices',
      performance: '⚡ Performance degrading - consider profiling',
      logic: '🤔 Logic errors detected - review requirements'
    };
    
    if (errorHints[topErrorCategory] && context.recentErrors[0].count > 2) {
      hints.push(errorHints[topErrorCategory]);
    }
  }
  
  // Time-based hints
  if (context.sessionDuration) {
    const hours = context.sessionDuration / (60 * 60 * 1000);
    if (hours > 3) {
      hints.push('🕐 Long session (3+ hours) - consider taking a break');
    } else if (hours > 2) {
      hints.push('⏱️ 2+ hour session - stay focused, break coming soon');
    }
  }
  
  // Task type hints
  const taskTypeHints: Record<string, string> = {
    light: '✅ Light task - good for warming up',
    medium: '⚡ Medium complexity - stay systematic',
    heavy: '🔥 Complex task - use all M7 phases carefully'
  };
  
  if (context.taskType && taskTypeHints[context.taskType] && Math.random() < 0.3) {
    hints.push(taskTypeHints[context.taskType]);
  }
  
  // Filter duplicates and limit to 2 hints
  const uniqueHints = Array.from(new Set(hints));
  return uniqueHints.slice(0, 2);
}

// Helper to add hints to response
export function addHintsToResponse(
  response: any, 
  hints: string[],
  position: 'top' | 'bottom' = 'bottom'
): any {
  if (!hints || hints.length === 0) return response;
  
  const hintText = `\n\n---\n${hints.join('\n')}`;
  
  if (response.content && response.content[0] && response.content[0].text) {
    if (position === 'bottom') {
      response.content[0].text += hintText;
    } else {
      response.content[0].text = hintText + '\n\n' + response.content[0].text;
    }
  }
  
  return response;
}

