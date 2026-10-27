/**
 * M7 v3.0 - Insight Extractor
 * 
 * Extracts patterns, preferences, and learnings from session data.
 * Based on patterns from Emergent Learning Framework (ELF).
 */

import { 
  SessionRecord, 
  SessionAction, 
  Insight, 
  InsightType,
  DEFAULT_CONFIG
} from './types.js';

export class InsightExtractor {
  private minActionsForInsight: number;
  private initialConfidence: number;

  constructor(
    minActionsForInsight: number = DEFAULT_CONFIG.insightThreshold,
    initialConfidence: number = DEFAULT_CONFIG.initialConfidence
  ) {
    this.minActionsForInsight = minActionsForInsight;
    this.initialConfidence = initialConfidence;
  }

  /**
   * Extract all insights from a session record
   */
  extract(session: SessionRecord): Insight[] {
    const insights: Insight[] = [];
    
    // Skip if not enough actions
    if (session.actions.length < this.minActionsForInsight) {
      return insights;
    }
    
    // Extract different types of insights
    insights.push(...this.extractWorkflowInsights(session));
    insights.push(...this.extractSuccessPatterns(session));
    insights.push(...this.extractAntipatterns(session));
    insights.push(...this.extractPreferences(session));
    insights.push(...this.extractToolInsights(session));

    return insights;
  }

  /**
   * Extract workflow-related insights
   */
  private extractWorkflowInsights(session: SessionRecord): Insight[] {
    const insights: Insight[] = [];
    const { actions, outcomes } = session;

    // High success rate workflow
    if (outcomes.successRate > 0.8 && actions.length >= 5) {
      const toolSequence = actions
        .filter(a => a.tool)
        .map(a => a.tool)
        .slice(0, 5)
        .join(' → ');
      
      if (toolSequence) {
        const taskDesc = session.taskDescription ?? 'unknown task';
        insights.push(this.createInsight(
          'workflow',
          `Эффективный workflow для "${taskDesc.slice(0, 40)}": ${toolSequence}`,
          0.6,
          'workflow',
          session.id,
          actions.slice(0, 5).map(a => a.id)
        ));
      }
    }

    // Fast completion pattern
    const THIRTY_MINUTES = 30 * 60 * 1000;
    if (session.finalPhase === 'completed' && outcomes.sessionDuration < THIRTY_MINUTES) {
      const taskDesc = session.taskDescription ?? 'unknown task';
      insights.push(this.createInsight(
        'workflow',
        `Быстрое завершение ${session.route} задачи: ${taskDesc.slice(0, 50)}`,
        0.5,
        'efficiency',
        session.id,
        []
      ));
    }

    // M7 methodology compliance
    if (session.violations.length === 0 && session.completedRequirements.length > 5) {
      insights.push(this.createInsight(
        'pattern',
        `Успешное следование M7 методологии для ${session.route} route`,
        0.7,
        'methodology',
        session.id,
        []
      ));
    }

    // Detect TDD workflow
    const testActions = actions.filter(a => a.type === 'test');
    const genActions = actions.filter(a => a.type === 'generation');
    if (testActions.length > 0 && genActions.length > 0) {
      const firstTest = actions.findIndex(a => a.type === 'test');
      const firstGen = actions.findIndex(a => a.type === 'generation');
      
      if (firstTest < firstGen) {
        insights.push(this.createInsight(
          'workflow',
          'TDD подход: тесты написаны перед кодом',
          0.65,
          'testing',
          session.id,
          testActions.map(a => a.id)
        ));
      }
    }

    return insights;
  }

  /**
   * Extract success patterns from actions
   */
  private extractSuccessPatterns(session: SessionRecord): Insight[] {
    const insights: Insight[] = [];
    const { actions } = session;
    const successfulActions = actions.filter(a => a.success);

    // Group by tool and find high-success tools
    const toolStats = new Map<string, { success: number; total: number }>();
    
    for (const action of actions) {
      if (action.tool) {
        const current = toolStats.get(action.tool) || { success: 0, total: 0 };
        current.total++;
        if (action.success) current.success++;
        toolStats.set(action.tool, current);
      }
    }

    for (const [tool, stats] of toolStats) {
      const successRate = stats.success / stats.total;
      
      if (stats.total >= 3 && successRate > 0.8) {
        insights.push(this.createInsight(
          'pattern',
          `Tool "${tool}" эффективен для подобных задач (${Math.round(successRate * 100)}% успех)`,
          Math.min(0.7, 0.5 + successRate * 0.2),
          'tools',
          session.id,
          successfulActions.filter(a => a.tool === tool).map(a => a.id)
        ));
      }
    }

    // Successful fix patterns
    const fixes = actions.filter(a => a.type === 'fix');
    const successfulFixes = fixes.filter(a => a.success);
    
    if (fixes.length >= 3 && successfulFixes.length / fixes.length > 0.7) {
      // Group by file type
      const fileTypes = new Map<string, number>();
      for (const fix of successfulFixes) {
        if (fix.file) {
          const ext = fix.file.split('.').pop() || 'unknown';
          fileTypes.set(ext, (fileTypes.get(ext) || 0) + 1);
        }
      }
      
      for (const [ext, count] of fileTypes) {
        if (count >= 2) {
          insights.push(this.createInsight(
            'pattern',
            `Успешные фиксы в .${ext} файлах`,
            0.6,
            'fixes',
            session.id,
            successfulFixes.filter(f => f.file?.endsWith(`.${ext}`)).map(a => a.id)
          ));
        }
      }
    }

    return insights;
  }

  /**
   * Extract antipatterns (what NOT to do)
   */
  private extractAntipatterns(session: SessionRecord): Insight[] {
    const insights: Insight[] = [];
    const { actions, violations } = session;
    
    // Repeated failures
    const failures = actions.filter(a => !a.success);
    
    if (failures.length >= 3) {
      const failureTypes = new Map<string, number>();
      for (const f of failures) {
        const key = f.tool || f.type;
        failureTypes.set(key, (failureTypes.get(key) || 0) + 1);
      }

      for (const [type, count] of failureTypes) {
        if (count >= 2) {
          insights.push(this.createInsight(
            'antipattern',
            `Повторяющиеся ошибки при использовании "${type}" (${count}x)`,
            0.7,
            'errors',
            session.id,
            failures.filter(f => (f.tool || f.type) === type).map(f => f.id)
          ));
        }
      }
    }

    // M7 violations as antipatterns
    for (const violation of violations) {
      insights.push(this.createInsight(
        'antipattern',
        `M7 violation: ${violation.reason}`,
        0.8,
        'methodology',
        session.id,
        []
      ));
    }

    // Consecutive failures (struggle pattern)
    let consecutiveFailures = 0;
    let maxConsecutive = 0;
    
    for (const action of actions) {
      if (!action.success) {
        consecutiveFailures++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveFailures);
      } else {
        consecutiveFailures = 0;
      }
    }

    if (maxConsecutive >= 4) {
      insights.push(this.createInsight(
        'antipattern',
        `Паттерн борьбы: ${maxConsecutive} последовательных ошибок`,
        0.75,
        'workflow',
        session.id,
        []
      ));
    }

    // Long session without progress
    const HOUR = 60 * 60 * 1000;
    if (session.outcomes.sessionDuration > HOUR && session.outcomes.successRate < 0.3) {
      insights.push(this.createInsight(
        'antipattern',
        'Длительная сессия без прогресса - возможно нужен другой подход',
        0.65,
        'efficiency',
        session.id,
        []
      ));
    }

    return insights;
  }

  /**
   * Extract user preferences from feedback
   */
  private extractPreferences(session: SessionRecord): Insight[] {
    const insights: Insight[] = [];
    const { actions } = session;
    
    // Positive feedback indicates preference
    const positiveActions = actions.filter(a => a.userFeedback === 'positive');
    
    for (const action of positiveActions) {
      const output = action.output ?? '';
      const summary = output.length > 100 
        ? output.slice(0, 100) + '...' 
        : output;
      
      insights.push(this.createInsight(
        'preference',
        `Одобренный подход: ${action.type}${action.tool ? ` (${action.tool})` : ''} - "${summary}"`,
        0.9,
        'user-preference',
        session.id,
        [action.id]
      ));
    }

    // Negative feedback indicates what NOT to do
    const negativeActions = actions.filter(a => a.userFeedback === 'negative');
    
    for (const action of negativeActions) {
      const input = action.input ?? '';
      const summary = input.length > 50 
        ? input.slice(0, 50) + '...' 
        : input;
      
      insights.push(this.createInsight(
        'antipattern',
        `Отклонённый подход: ${action.type}${action.tool ? ` (${action.tool})` : ''} для "${summary}"`,
        0.85,
        'user-preference',
        session.id,
        [action.id]
      ));
    }

    return insights;
  }

  /**
   * Extract tool-specific insights
   */
  private extractToolInsights(session: SessionRecord): Insight[] {
    const insights: Insight[] = [];
    const { actions } = session;
    
    // M7 tool usage patterns
    const m7Tools = actions.filter(a => a.tool?.startsWith('mcp_m7_'));
    
    if (m7Tools.length >= 3) {
      const toolOrder = m7Tools.map(t => t.tool?.replace('mcp_m7_', '')).join(' → ');
      const successRate = m7Tools.filter(t => t.success).length / m7Tools.length;
      
      if (successRate > 0.7) {
        insights.push(this.createInsight(
          'pattern',
          `Эффективная последовательность M7 tools: ${toolOrder}`,
          0.6,
          'tools',
          session.id,
          m7Tools.map(t => t.id)
        ));
      }
    }

    // Context7 usage patterns
    const ctx7Uses = actions.filter(a => a.tool?.includes('context7'));
    if (ctx7Uses.length > 0) {
      const successRate = ctx7Uses.filter(t => t.success).length / ctx7Uses.length;
      
      if (successRate > 0.7) {
        insights.push(this.createInsight(
          'pattern',
          'Context7 использован для верификации библиотек',
          0.7,
          'research',
          session.id,
          ctx7Uses.map(t => t.id)
        ));
      }
    }

    return insights;
  }

  /**
   * Create an insight object
   */
  private createInsight(
    type: InsightType,
    content: string,
    confidence: number,
    category: string,
    sessionId: string,
    actionIds: string[]
  ): Insight {
    const now = new Date();
    
    return {
      id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type,
      content,
      confidence,
      confidenceEma: confidence, // Initial EMA = raw confidence
      category,
      source: { sessionId, actionIds },
      createdAt: now,
      lastUsedAt: now,
      usageCount: 0,
      timesValidated: 0,
      timesViolated: 0
    };
  }

  /**
   * Merge similar insights
   */
  mergeSimilarInsights(insights: Insight[]): Insight[] {
    const merged: Insight[] = [];
    const processed = new Set<string>();

    for (const insight of insights) {
      if (processed.has(insight.id)) continue;

      // Find similar insights
      const similar = insights.filter(i => 
        !processed.has(i.id) &&
        i.id !== insight.id &&
        i.type === insight.type &&
        i.category === insight.category &&
        this.calculateSimilarity(i.content, insight.content) > 0.7
      );

      if (similar.length > 0) {
        // Merge: take highest confidence, combine action IDs
        const allActionIds = [
          ...insight.source.actionIds,
          ...similar.flatMap(s => s.source.actionIds)
        ];
        
        const maxConfidence = Math.max(
          insight.confidence,
          ...similar.map(s => s.confidence)
        );

        merged.push({
          ...insight,
          confidence: Math.min(1.0, maxConfidence + similar.length * 0.05),
          confidenceEma: Math.min(1.0, maxConfidence + similar.length * 0.05),
          source: {
            ...insight.source,
            actionIds: [...new Set(allActionIds)]
          }
        });

        similar.forEach(s => processed.add(s.id));
      } else {
        merged.push(insight);
      }
      
      processed.add(insight.id);
    }

    return merged;
  }

  /**
   * Calculate similarity between two strings (Jaccard)
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

