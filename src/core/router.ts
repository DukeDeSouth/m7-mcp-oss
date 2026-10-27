import { createLogger } from './utils/logger.js';
const log = createLogger('[router]');
import { ComplexityFactor, Certainty, Risk, TaskRoute, ComplexityLevel } from '../core/types.js';
import { ChaosGuard } from '../guards/chaosGuard.js';
import { BaselineAuditor } from '../auditors/baselineAuditor.js';
import { ScopeBudget } from '../core/guards/scopeGuard.js';
import { detectIntent, DetectedIntent, formatIntentHeader } from './intelligence/intentClassifier.js';
import { ScopeContext } from './scope/types.js';
import { isFeatureEnabled } from './config/featureFlags.js';
export class ChaosDetectedError extends Error {
  constructor(
    message: string,
    public readonly suggestions: string[],
    public readonly overrideEligible: boolean = false
  ) {
    super(message);
    this.name = 'ChaosDetectedError';
  }
}

export class CriticalRiskError extends Error {
  constructor(
    message: string,
    public readonly risks: Array<{description: string, severity: 'critical', mitigation?: string}>
  ) {
    super(message);
    this.name = 'CriticalRiskError';
  }
}

export interface TaskAnalysis {
  route: TaskRoute;
  confidence: number;
  reasoning: string;
  suggestedApproach: string;
  estimatedFiles: number;
  estimatedComplexity: ComplexityLevel;
  risks: Risk[];
  canProceed: boolean;
  nextSteps?: string[];
  scopeBudget?: ScopeBudget; // NEW: Add scope budget
  intent?: DetectedIntent; // v3.2: Detected user intent
  intentHeader?: string; // v3.2: Formatted intent info
  // v3.5: Scope Scanner
  scopeContext?: ScopeContext;
  routeAdjusted?: boolean;
  originalRoute?: TaskRoute;
}

export class TaskRouter {
  private chaosGuard: ChaosGuard;
  private baselineAuditor: BaselineAuditor;

  constructor() {
    this.chaosGuard = new ChaosGuard();
    this.baselineAuditor = new BaselineAuditor();
  }

  // NEW: Get scope budget based on route
  private getScopeBudget(route: TaskRoute): ScopeBudget {
    const budgets: Record<TaskRoute, ScopeBudget> = {
      light: { 
        maxFiles: 3, 
        maxLines: 50, 
        maxBreaking: 0, 
        maxMinutes: 120 
      },
      medium: { 
        maxFiles: 8, 
        maxLines: 200, 
        maxBreaking: 2, 
        maxMinutes: 360 
      },
      heavy: { 
        maxFiles: 15, 
        maxLines: 500, 
        maxBreaking: 5, 
        maxMinutes: 480 
      },
      decompose: { 
        maxFiles: 0, 
        maxLines: 0, 
        maxBreaking: 0, 
        maxMinutes: 60 
      }
    };
    
    return budgets[route];
  }

  async analyzeTask(description: string, context?: any, overrideToken?: string): Promise<TaskAnalysis> {
    // Step 0 (v3.3): LLM Intent Classification
    const intent = await detectIntent(description);
    log.debug(`M7 v3.3] Intent: ${intent.intent}, phase: ${intent.phase}, allowCode: ${intent.allowCode}, confidence: ${(intent.confidence * 100).toFixed(0)}%`);
    
    // Step 1: Chaos detection
    const chaosDetection = await this.chaosGuard.detectChaos(description, context, overrideToken);
    
    if (chaosDetection.isChaotic && !chaosDetection.overrideUsed) {
      const suggestions = chaosDetection.suggestion ? [chaosDetection.suggestion] : ['Follow M7 methodology'];
      throw new ChaosDetectedError(
        chaosDetection.reason || 'Chaotic request detected',
        suggestions,
        chaosDetection.canRequestOverride || false
      );
    }

    // Step 2: Baseline audit
    const auditResult = await this.baselineAuditor.performFullAudit(context);
    
    // Check for critical health
    const hasCriticalIssues = auditResult.issues.some(issue => issue.severity === 'high');
    
    if (hasCriticalIssues) {
      throw new Error(`Project has critical issues. Fix these first:\n${
        auditResult.issues.filter(i => i.severity === 'high').map(i => `- ${i.description}`).join('\n')
      }`);
    }

    // Step 3: Route determination with risk analysis (v3.2: use intent, v3.5: use scope)
    const scopeContext = context?.scopeContext as ScopeContext | undefined;
    const analysis = this.determineRoute(description, context, intent, scopeContext);
    
    // Step 4: CRITICAL - Check for unmitigated critical risks (IDEAL_METHODOLOGY requirement)
    const unmitigatedCriticalRisks = analysis.risks.filter(
      r => r.severity === 'critical' && !r.mitigation
    );
    
    if (unmitigatedCriticalRisks.length > 0) {
      throw new CriticalRiskError(
        `${unmitigatedCriticalRisks.length} unmitigated critical risks detected. Resolving them now protects against compounding failures during implementation.`,
        unmitigatedCriticalRisks as Array<{description: string, severity: 'critical', mitigation?: string}>
      );
    }

    // Step 5: Update canProceed based on all checks
    analysis.canProceed = 
      !hasCriticalIssues &&
      unmitigatedCriticalRisks.length === 0 &&
      (!chaosDetection.isChaotic || chaosDetection.overrideUsed === true);

    // Step 6: Generate next steps based on route and analysis
    analysis.nextSteps = this.generateNextSteps(analysis);

    // NEW: Assign scope budget
    const scopeBudget = this.getScopeBudget(analysis.route);
    analysis.scopeBudget = scopeBudget;
    
    // v3.2: Attach intent info
    analysis.intent = intent;
    analysis.intentHeader = formatIntentHeader(intent);

    return analysis;
  }

  private determineRoute(description: string, context?: any, intent?: DetectedIntent, scopeContext?: ScopeContext): TaskAnalysis {
    const desc = description.toLowerCase();
    const risks: TaskAnalysis['risks'] = [];
    
    // v4.0: HEAVY-first routing - проверяем feature flag
    const heavyFirstEnabled = isFeatureEnabled('heavyFirstRouting');
    
    // v3.2: Intent-based routing override
    // If intent is detected with high confidence, use it to influence route selection
    const intentRouteOverride = intent && intent.confidence > 0.7 
      ? intent.recommendedRoute 
      : null;
    
    // Analyze complexity indicators
    const complexityIndicators = {
      hasStateManagement: /state|redux|context|store/i.test(desc),
      hasAsync: /async|await|promise|fetch|api/i.test(desc),
      hasUI: /component|render|display|show|ui/i.test(desc),
      hasData: /database|data|model|schema/i.test(desc),
      hasIntegration: /integrate|connect|api|service/i.test(desc),
      hasPerformance: /performance|optimize|slow|fast/i.test(desc),
      hasRefactor: /refactor|restructure|rewrite/i.test(desc)
    };

    // Risk assessment based on complexity
    if (complexityIndicators.hasStateManagement && complexityIndicators.hasAsync) {
      risks.push({
        description: 'Async state management can cause race conditions',
        severity: 'major',
        mitigation: 'Use proper state machines or Redux-Saga for complex async flows'
      });
    }

    if (complexityIndicators.hasRefactor && complexityIndicators.hasData) {
      risks.push({
        description: 'Data model refactoring can break existing functionality',
        severity: 'critical',
        mitigation: 'Create comprehensive migration plan and backup strategy'
      });
    }

    if (complexityIndicators.hasPerformance && !context?.performanceBaseline) {
      risks.push({
        description: 'No performance baseline to measure improvements',
        severity: 'major',
        mitigation: 'Establish performance metrics before optimization'
      });
    }

    // Count complexity factors
    const complexityCount = Object.values(complexityIndicators).filter(v => v).length;
    
    // Determine route based on complexity
    let route: TaskAnalysis['route'];
    let estimatedFiles: number;
    let confidence: number;
    let reasoning: string;
    let suggestedApproach: string;

    // v4.0: HEAVY-first routing - всегда HEAVY если включён feature flag
    if (heavyFirstEnabled) {
      route = 'heavy';
      estimatedFiles = scopeContext?.fileStats.matchingPattern || 5;
      confidence = intent?.confidence || 0.8;
      reasoning = 'M7 v4.0 HEAVY-first: полный цикл анализа для каждой задачи';
      suggestedApproach = intent?.allowCode === false
        ? 'Анализ и планирование (без кода)'
        : 'Полный цикл M7: Discovery → Architecture → Planning → Implementation';
      
      log.debug(`M7 v4.0] HEAVY-first routing enabled, all tasks go through HEAVY route`);
      
      // Добавляем риски на основе complexity indicators (для информации)
      if (complexityCount >= 5) {
        risks.push({
          description: 'High complexity detected - multiple system interactions',
          severity: 'major',
          mitigation: 'Consider breaking into subtasks if scope grows'
        });
      }
    }
    // Legacy routing (если HEAVY-first выключен)
    else if (intentRouteOverride && intentRouteOverride !== 'light') {
      // Intent explicitly requests medium/heavy
      route = intentRouteOverride;
      estimatedFiles = intentRouteOverride === 'heavy' ? 8 : 5;
      confidence = intent!.confidence;
      reasoning = `Route based on detected intent: ${intent!.intent}`;
      suggestedApproach = intent!.allowCode 
        ? 'Full implementation with safety checks'
        : 'Analysis and planning only (no code)';
    } else if (complexityCount <= 1) {
      // v3.2: Even for simple tasks, default to medium for full cycle
      route = 'medium';  // Changed from 'light' - fullCycle always
      estimatedFiles = 1 + Math.floor(Math.random() * 2);
      confidence = 0.9;
      reasoning = 'Simple task but using medium route for full M7 cycle';
      suggestedApproach = 'Direct implementation with basic testing';
    } else if (complexityCount <= 3) {
      route = 'medium';
      estimatedFiles = 3 + Math.floor(Math.random() * 3);
      confidence = 0.8;
      reasoning = 'Moderate complexity with some cross-cutting concerns';
      suggestedApproach = 'Careful planning with impact analysis';
    } else if (complexityCount <= 5) {
      route = 'heavy';
      estimatedFiles = 6 + Math.floor(Math.random() * 5);
      confidence = 0.7;
      reasoning = 'High complexity with multiple system interactions';
      suggestedApproach = 'Detailed architecture review and simulation required';
      
      // Heavy tasks often have critical risks
      if (!risks.some(r => r.severity === 'critical')) {
        risks.push({
          description: 'High complexity increases risk of unforeseen interactions',
          severity: 'major'
        });
      }
    } else {
      route = 'decompose';
      estimatedFiles = 10;
      confidence = 0.6;
      reasoning = 'Too complex for single task - requires decomposition';
      suggestedApproach = 'Break down into smaller, manageable subtasks';
      
      // Decompose tasks always have critical risk if not broken down
      risks.push({
        description: 'Task too complex to implement safely as single unit',
        severity: 'critical',
        mitigation: 'Decompose into subtasks and implement incrementally'
      });
    }

    // Add general risks based on missing context
    if (!context?.tests) {
      risks.push({
        description: 'No test coverage information available',
        severity: 'minor',
        mitigation: 'Ensure comprehensive test coverage for changes'
      });
    }

    // v3.5: Scope Scanner - adjust route based on real project scan
    let finalRoute: TaskRoute = route;
    let finalEstimatedFiles = estimatedFiles;
    let routeAdjusted = false;
    let originalRoute: TaskRoute | undefined = undefined;
    
    if (scopeContext && scopeContext.fileStats.matchingPattern > 0) {
      const scanRecommendation = scopeContext.recommendation;
      const routePriority: Record<TaskRoute, number> = { light: 1, medium: 2, heavy: 3, decompose: 4 };
      
      // If scanner suggests higher route, upgrade
      if (routePriority[scanRecommendation.suggestedRoute] > routePriority[route]) {
        log.debug(`M7 v3.5] Route upgraded: ${route} → ${scanRecommendation.suggestedRoute} (scope scan: ${scopeContext.fileStats.matchingPattern} files)`);
        
        originalRoute = route;
        finalRoute = scanRecommendation.suggestedRoute;
        finalEstimatedFiles = scanRecommendation.suggestedFiles;
        routeAdjusted = true;
        reasoning = `${reasoning}. Scope scan adjusted: found ${scopeContext.fileStats.matchingPattern} matching files.`;
        
        // Add risk for large scope
        if (scanRecommendation.suggestedRoute === 'decompose') {
          risks.push({
            description: `Scope too large: ${scopeContext.fileStats.matchingPattern} files detected by scanner`,
            severity: 'critical',
            mitigation: 'Decompose into smaller subtasks by module or feature'
          });
        } else if (scanRecommendation.suggestedRoute === 'heavy') {
          risks.push({
            description: `Large scope detected: ${scopeContext.fileStats.matchingPattern} files may need changes`,
            severity: 'major',
            mitigation: 'Prioritize files and implement incrementally'
          });
        }
      }
    }

    return {
      route: finalRoute,
      confidence,
      reasoning,
      estimatedFiles: finalEstimatedFiles,
      estimatedComplexity: this.getComplexityLevel(finalRoute),
      suggestedApproach,
      risks,
      canProceed: true, // Will be updated in analyzeTask
      nextSteps: [], // Placeholder, will be populated in analyzeTask
      scopeContext,
      routeAdjusted,
      originalRoute
    };
  }

  private getComplexityLevel(route: TaskRoute): ComplexityLevel {
    switch (route) {
      case 'light':
        return 'simple';
      case 'medium':
        return 'moderate';
      case 'heavy':
        return 'complex';
      case 'decompose':
        return 'very-complex';
      default:
        return 'moderate';
    }
  }

  private generateNextSteps(analysis: TaskAnalysis): string[] {
    const steps: string[] = [];

    if (analysis.canProceed) {
      steps.push(`Create M7 structure: @m7 create structure for task route: ${analysis.route}`);
      steps.push('Start with DISCOVERY_REPORT.md');
      steps.push('Follow M7 iterative cycle');
    } else {
      steps.push('Resolve critical risks before proceeding');
      if (analysis.risks.filter(r => r.severity === 'critical').length > 0) {
        steps.push('Review and mitigate critical risks listed above');
      }
      steps.push('Re-analyze task after risk mitigation');
    }

    // Add route-specific steps
    switch (analysis.route) {
      case 'light':
        steps.push('Use Context7 MCP for library verification');
        steps.push('Document minimum 3 alternative approaches');
        break;
      case 'medium':
        steps.push('Create prototype before full implementation');
        steps.push('Use Playwright MCP for UI validation');
        steps.push('Perform integration testing');
        break;
      case 'heavy':
        steps.push('Complete comprehensive architecture analysis');
        steps.push('Create detailed implementation simulation');
        steps.push('Perform load testing and security review');
        break;
      case 'decompose':
        steps.push('Break down task into smaller subtasks');
        steps.push('Analyze each subtask separately');
        break;
    }

    return steps;
  }
} 