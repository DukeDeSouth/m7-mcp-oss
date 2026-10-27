
import { 
  TechAnalysisContext,
  TechPattern,
  PatternCategory,
  RiskLevel
} from '../core/types.js';

/**
 * M7 Tech Safety Intelligence - Context Analyzer
 * Анализатор контекста для понимания требований и ограничений проекта
 */
export class ContextAnalyzer {
  
  /**
   * Анализ контекста задачи
   */
  analyzeTaskContext(context: TechAnalysisContext): TaskContextAnalysis {
    const analysis: TaskContextAnalysis = {
      taskType: this.identifyTaskType(context.task),
      complexity: this.assessComplexity(context),
      riskFactors: this.identifyRiskFactors(context),
      recommendations: this.generateContextRecommendations(context),
      requiredCategories: this.determineRequiredCategories(context),
      teamReadiness: this.assessTeamReadiness(context),
      timelineConstraints: this.analyzeTimelineConstraints(context),
      technicalConstraints: this.analyzeTechnicalConstraints(context)
    };
    
    return analysis;
  }

  /**
   * Анализ совместимости паттерна с контекстом
   */
  analyzePatternCompatibility(pattern: TechPattern, context: TechAnalysisContext): PatternCompatibility {
    return {
      compatibilityScore: this.calculateCompatibilityScore(pattern, context),
      compatibilityFactors: this.getCompatibilityFactors(pattern, context),
      blockers: this.identifyBlockers(pattern, context),
      adaptations: this.suggestAdaptations(pattern, context),
      riskAssessment: this.assessPatternRisk(pattern, context)
    };
  }

  /**
   * Извлечение ключевых слов из задачи
   */
  extractKeywords(task: string): KeywordAnalysis {
    const taskLower = task.toLowerCase();
    
    return {
      technologies: this.extractTechnologies(taskLower),
      domains: this.extractDomains(taskLower),
      actions: this.extractActions(taskLower),
      qualifiers: this.extractQualifiers(taskLower),
      priorities: this.extractPriorities(taskLower)
    };
  }

  /**
   * Анализ требований к безопасности
   */
  analyzeSecurityRequirements(context: TechAnalysisContext): SecurityRequirements {
    const keywords = this.extractKeywords(context.task);
    
    return {
      level: this.determineSecurityLevel(keywords, context),
      requirements: this.identifySecurityRequirements(keywords, context),
      complianceNeeds: this.identifyComplianceNeeds(keywords, context),
      threatModel: this.buildThreatModel(keywords, context)
    };
  }

  /**
   * Анализ требований к производительности
   */
  analyzePerformanceRequirements(context: TechAnalysisContext): PerformanceRequirements {
    const keywords = this.extractKeywords(context.task);
    
    return {
      level: this.determinePerformanceLevel(keywords, context),
      metrics: this.identifyPerformanceMetrics(keywords, context),
      constraints: this.identifyPerformanceConstraints(keywords, context),
      optimizationTargets: this.identifyOptimizationTargets(keywords, context)
    };
  }

  // Приватные методы

  private identifyTaskType(task: string): TaskType {
    const taskLower = task.toLowerCase();
    
    const patterns = {
      'new_project': ['create', 'build', 'develop', 'new', 'start', 'initialize'],
      'feature_addition': ['add', 'implement', 'feature', 'functionality', 'extend'],
      'bug_fix': ['fix', 'bug', 'issue', 'problem', 'error', 'debug'],
      'refactoring': ['refactor', 'improve', 'optimize', 'restructure', 'clean'],
      'migration': ['migrate', 'upgrade', 'move', 'transition', 'convert'],
      'security_audit': ['security', 'audit', 'vulnerability', 'secure', 'protect'],
      'performance_optimization': ['performance', 'optimize', 'speed', 'fast', 'efficient'],
      'maintenance': ['maintain', 'update', 'patch', 'support', 'monitor']
    };
    
    for (const [type, keywords] of Object.entries(patterns)) {
      if (keywords.some(keyword => taskLower.includes(keyword))) {
        return type as TaskType;
      }
    }
    
    return 'general';
  }

  private assessComplexity(context: TechAnalysisContext): ComplexityLevel {
    let complexityScore = 0;
    
    // Факторы сложности
    const complexityFactors = [
      // Размер задачи
      context.task.length > 100 ? 1 : 0,
      
      // Количество ограничений
      (context.constraints?.length || 0) > 3 ? 1 : 0,
      
      // Опыт команды
      context.teamExperience === 'junior' ? 2 : 
      context.teamExperience === 'middle' ? 1 : 0,
      
      // Временные ограничения
      context.timeline?.includes('urgent') ? 1 : 0,
      
      // Наличие существующего кода
      context.existingCode ? 1 : 0
    ];
    
    complexityScore = complexityFactors.reduce((sum, factor) => sum + factor, 0);
    
    if (complexityScore <= 2) return 'low';
    if (complexityScore <= 4) return 'medium';
    return 'high';
  }

  private identifyRiskFactors(context: TechAnalysisContext): RiskFactor[] {
    const risks: RiskFactor[] = [];
    const taskLower = context.task.toLowerCase();
    
    // Технологические риски
    const riskyTechnologies = ['new', 'experimental', 'beta', 'alpha', 'bleeding-edge'];
    if (riskyTechnologies.some(tech => taskLower.includes(tech))) {
      risks.push({
        type: 'technology',
        level: 'high',
        description: 'Using experimental or new technology',
        mitigation: 'Thorough testing and fallback plans required'
      });
    }
    
    // Временные риски
    if (context.timeline?.includes('urgent') || taskLower.includes('asap')) {
      risks.push({
        type: 'timeline',
        level: 'medium',
        description: 'Tight timeline may lead to shortcuts',
        mitigation: 'Focus on proven patterns and avoid complex solutions'
      });
    }
    
    // Команда
    if (context.teamExperience === 'junior') {
      risks.push({
        type: 'team',
        level: 'medium',
        description: 'Junior team may need additional guidance',
        mitigation: 'Provide detailed documentation and code reviews'
      });
    }
    
    // Безопасность
    const securityKeywords = ['auth', 'login', 'password', 'token', 'payment', 'personal'];
    if (securityKeywords.some(keyword => taskLower.includes(keyword))) {
      risks.push({
        type: 'security',
        level: 'high',
        description: 'Security-sensitive functionality detected',
        mitigation: 'Follow security best practices and conduct security review'
      });
    }
    
    // Производительность
    const performanceKeywords = ['scale', 'performance', 'load', 'concurrent', 'realtime'];
    if (performanceKeywords.some(keyword => taskLower.includes(keyword))) {
      risks.push({
        type: 'performance',
        level: 'medium',
        description: 'Performance-critical functionality detected',
        mitigation: 'Include performance testing and monitoring'
      });
    }
    
    return risks;
  }

  private generateContextRecommendations(context: TechAnalysisContext): string[] {
    const recommendations: string[] = [];
    const taskType = this.identifyTaskType(context.task);
    const complexity = this.assessComplexity(context);
    
    // Рекомендации по типу задачи
    switch (taskType) {
      case 'new_project':
        recommendations.push('Start with proven, stable patterns');
        recommendations.push('Set up proper project structure and tooling');
        break;
      case 'security_audit':
        recommendations.push('Focus on security patterns and vulnerability prevention');
        recommendations.push('Include security testing in the implementation');
        break;
      case 'performance_optimization':
        recommendations.push('Prioritize performance patterns and monitoring');
        recommendations.push('Establish performance benchmarks');
        break;
    }
    
    // Рекомендации по сложности
    if (complexity === 'high') {
      recommendations.push('Break down into smaller, manageable tasks');
      recommendations.push('Use incremental development approach');
    }
    
    // Рекомендации по команде
    if (context.teamExperience === 'junior') {
      recommendations.push('Provide comprehensive documentation');
      recommendations.push('Use well-established patterns with good community support');
    }
    
    return recommendations;
  }

  private determineRequiredCategories(context: TechAnalysisContext): PatternCategory[] {
    const categories: PatternCategory[] = [];
    const keywords = this.extractKeywords(context.task);
    
    // Всегда включаем архитектуру
    categories.push('architecture');
    
    // Безопасность
    if (keywords.domains.includes('security') || 
        keywords.actions.some(action => ['authenticate', 'authorize', 'encrypt'].includes(action))) {
      categories.push('security');
    }
    
    // Производительность
    if (keywords.qualifiers.includes('fast') || 
        keywords.priorities.includes('performance')) {
      categories.push('performance');
    }
    
    // Тестирование
    if (keywords.actions.includes('test') || 
        context.projectType?.includes('enterprise')) {
      categories.push('testing');
    }
    
    // Развертывание
    if (keywords.actions.includes('deploy') || 
        keywords.domains.includes('devops')) {
      categories.push('deployment');
    }
    
    // Обслуживание
    if (keywords.actions.includes('maintain') || 
        context.projectType?.includes('production')) {
      categories.push('maintenance');
    }
    
    return categories;
  }

  private assessTeamReadiness(context: TechAnalysisContext): TeamReadiness {
    const experience = context.teamExperience || 'middle';
    
    return {
      level: experience,
      canHandleComplexPatterns: experience === 'senior',
      needsAdditionalGuidance: experience === 'junior',
      recommendedApproach: this.getRecommendedApproach(experience),
      trainingNeeds: this.identifyTrainingNeeds(context)
    };
  }

  private getRecommendedApproach(experience: string): string {
    switch (experience) {
      case 'junior':
        return 'Step-by-step guidance with detailed examples';
      case 'middle':
        return 'Balanced approach with good documentation';
      case 'senior':
        return 'Flexible implementation with best practices';
      default:
        return 'Standard approach with moderate guidance';
    }
  }

  private identifyTrainingNeeds(context: TechAnalysisContext): string[] {
    const needs: string[] = [];
    
    if (context.teamExperience === 'junior') {
      needs.push(`${context.technology} fundamentals`);
      needs.push('Security best practices');
      needs.push('Testing methodologies');
    }
    
    const securityKeywords = ['auth', 'security', 'encrypt', 'token'];
    if (securityKeywords.some(keyword => context.task.toLowerCase().includes(keyword))) {
      needs.push('Security implementation patterns');
    }
    
    return needs;
  }

  private analyzeTimelineConstraints(context: TechAnalysisContext): TimelineConstraints {
    const timeline = context.timeline || '';
    const isUrgent = timeline.includes('urgent') || timeline.includes('asap');
    
    return {
      isUrgent,
      allowsExperimentation: !isUrgent,
      recommendedPatternTypes: isUrgent ? ['proven', 'stable'] : ['proven', 'stable', 'innovative'],
      riskTolerance: isUrgent ? 'low' : 'medium'
    };
  }

  private analyzeTechnicalConstraints(context: TechAnalysisContext): TechnicalConstraints {
    const constraints = context.constraints || [];
    
    return {
      hasLegacyCode: !!context.existingCode,
      hasPerformanceRequirements: constraints.some(c => c.includes('performance')),
      hasSecurityRequirements: constraints.some(c => c.includes('security')),
      hasCompatibilityRequirements: constraints.some(c => c.includes('compatible')),
      allowedTechnologies: this.extractAllowedTechnologies(constraints),
      forbiddenTechnologies: this.extractForbiddenTechnologies(constraints)
    };
  }

  private extractAllowedTechnologies(constraints: string[]): string[] {
    const allowed: string[] = [];
    
    for (const constraint of constraints) {
      const match = constraint.match(/(?:use|allow|only)\s+([a-zA-Z0-9,\s]+)/i);
      if (match) {
        allowed.push(...match[1].split(',').map(tech => tech.trim()));
      }
    }
    
    return allowed;
  }

  private extractForbiddenTechnologies(constraints: string[]): string[] {
    const forbidden: string[] = [];
    
    for (const constraint of constraints) {
      const match = constraint.match(/(?:no|avoid|forbid|ban)\s+([a-zA-Z0-9,\s]+)/i);
      if (match) {
        forbidden.push(...match[1].split(',').map(tech => tech.trim()));
      }
    }
    
    return forbidden;
  }

  private calculateCompatibilityScore(pattern: TechPattern, context: TechAnalysisContext): number {
    let score = 0.5; // Базовый балл
    
    // Соответствие технологии
    if (pattern.technology === context.technology) {
      score += 0.3;
    }
    
    // Соответствие контексту применения
    const taskKeywords = this.extractKeywords(context.task);
    const patternContexts = pattern.applicableContexts.map(ctx => ctx.toLowerCase());
    
    const matchingContexts = taskKeywords.domains.filter(domain => 
      patternContexts.some(ctx => ctx.includes(domain))
    );
    
    score += (matchingContexts.length / Math.max(taskKeywords.domains.length, 1)) * 0.2;
    
    // Учет ограничений
    const constraints = context.constraints || [];
    const hasConflicts = constraints.some(constraint => 
      pattern.incompatibleWith.some(incompatible => 
        constraint.toLowerCase().includes(incompatible.toLowerCase())
      )
    );
    
    if (hasConflicts) {
      score -= 0.3;
    }
    
    return Math.max(0, Math.min(1, score));
  }

  private getCompatibilityFactors(pattern: TechPattern, context: TechAnalysisContext): CompatibilityFactor[] {
    const factors: CompatibilityFactor[] = [];
    
    // Технология
    if (pattern.technology === context.technology) {
      factors.push({
        type: 'technology_match',
        impact: 'positive',
        description: 'Pattern matches target technology'
      });
    }
    
    // Опыт команды
    const teamReadiness = this.assessTeamReadiness(context);
    if (!teamReadiness.canHandleComplexPatterns && pattern.riskScore > 50) {
      factors.push({
        type: 'team_experience',
        impact: 'negative',
        description: 'Pattern may be too complex for junior team'
      });
    }
    
    // Временные ограничения
    const timelineConstraints = this.analyzeTimelineConstraints(context);
    if (timelineConstraints.isUrgent && pattern.riskScore > 30) {
      factors.push({
        type: 'timeline',
        impact: 'negative',
        description: 'Pattern may be risky for urgent timeline'
      });
    }
    
    return factors;
  }

  private identifyBlockers(pattern: TechPattern, context: TechAnalysisContext): Blocker[] {
    const blockers: Blocker[] = [];
    
    // Технические ограничения
    const techConstraints = this.analyzeTechnicalConstraints(context);
    
    if (techConstraints.forbiddenTechnologies.includes(pattern.technology)) {
      blockers.push({
        type: 'forbidden_technology',
        severity: 'critical',
        description: `Technology ${pattern.technology} is forbidden by constraints`,
        canBeOverridden: false
      });
    }
    
    // Несовместимость
    const constraints = context.constraints || [];
    for (const incompatible of pattern.incompatibleWith) {
      if (constraints.some(c => c.toLowerCase().includes(incompatible.toLowerCase()))) {
        blockers.push({
          type: 'incompatibility',
          severity: 'high',
          description: `Pattern incompatible with constraint: ${incompatible}`,
          canBeOverridden: true
        });
      }
    }
    
    return blockers;
  }

  private suggestAdaptations(pattern: TechPattern, context: TechAnalysisContext): Adaptation[] {
    const adaptations: Adaptation[] = [];
    
    // Адаптация для младшей команды
    const teamReadiness = this.assessTeamReadiness(context);
    if (teamReadiness.needsAdditionalGuidance) {
      adaptations.push({
        type: 'documentation',
        description: 'Add detailed documentation and examples',
        effort: 'medium',
        benefit: 'Reduces implementation errors'
      });
    }
    
    // Адаптация для срочных проектов
    const timelineConstraints = this.analyzeTimelineConstraints(context);
    if (timelineConstraints.isUrgent) {
      adaptations.push({
        type: 'simplification',
        description: 'Use simplified version of the pattern',
        effort: 'low',
        benefit: 'Faster implementation'
      });
    }
    
    return adaptations;
  }

  private assessPatternRisk(pattern: TechPattern, context: TechAnalysisContext): PatternRiskAssessment {
    const baseRisk = pattern.riskScore;
    let adjustedRisk = baseRisk;
    
    // Корректировка на основе контекста
    const teamReadiness = this.assessTeamReadiness(context);
    if (!teamReadiness.canHandleComplexPatterns) {
      adjustedRisk += 20;
    }
    
    const timelineConstraints = this.analyzeTimelineConstraints(context);
    if (timelineConstraints.isUrgent) {
      adjustedRisk += 15;
    }
    
    return {
      baseRisk,
      adjustedRisk: Math.min(100, adjustedRisk),
      riskFactors: this.identifyPatternRiskFactors(pattern, context),
      mitigationStrategies: this.generateMitigationStrategies(pattern, context)
    };
  }

  private identifyPatternRiskFactors(pattern: TechPattern, context: TechAnalysisContext): string[] {
    const factors: string[] = [];
    
    if (pattern.riskScore > 70) {
      factors.push('High inherent risk pattern');
    }
    
    if (context.teamExperience === 'junior' && pattern.riskScore > 30) {
      factors.push('Complex pattern for junior team');
    }
    
    if (context.timeline?.includes('urgent') && pattern.riskScore > 40) {
      factors.push('Risky pattern for urgent timeline');
    }
    
    return factors;
  }

  private generateMitigationStrategies(pattern: TechPattern, context: TechAnalysisContext): string[] {
    const strategies: string[] = [];
    
    // Стратегии из самого паттерна
    for (const risk of pattern.risks) {
      strategies.push(...risk.mitigation);
    }
    
    // Контекстные стратегии
    if (context.teamExperience === 'junior') {
      strategies.push('Provide comprehensive training');
      strategies.push('Implement pair programming');
    }
    
    if (context.timeline?.includes('urgent')) {
      strategies.push('Focus on core functionality first');
      strategies.push('Plan for post-release improvements');
    }
    
    return [...new Set(strategies)]; // Удаляем дубликаты
  }

  // Методы извлечения ключевых слов

  private extractTechnologies(task: string): string[] {
    const techPatterns = [
      'react', 'vue', 'angular', 'svelte',
      'nodejs', 'python', 'java', 'go', 'rust',
      'mongodb', 'postgresql', 'mysql', 'redis',
      'docker', 'kubernetes', 'aws', 'azure',
      'typescript', 'javascript', 'html', 'css'
    ];
    
    return techPatterns.filter(tech => task.includes(tech));
  }

  private extractDomains(task: string): string[] {
    const domainPatterns = {
      'security': ['security', 'auth', 'login', 'encrypt', 'secure'],
      'performance': ['performance', 'speed', 'fast', 'optimize'],
      'ui': ['ui', 'interface', 'frontend', 'design'],
      'api': ['api', 'backend', 'server', 'endpoint'],
      'database': ['database', 'db', 'data', 'storage'],
      'devops': ['deploy', 'ci', 'cd', 'infrastructure'],
      'testing': ['test', 'spec', 'unit', 'integration']
    };
    
    const domains: string[] = [];
    
    for (const [domain, keywords] of Object.entries(domainPatterns)) {
      if (keywords.some(keyword => task.includes(keyword))) {
        domains.push(domain);
      }
    }
    
    return domains;
  }

  private extractActions(task: string): string[] {
    const actionPatterns = [
      'create', 'build', 'develop', 'implement',
      'fix', 'debug', 'resolve', 'solve',
      'optimize', 'improve', 'enhance',
      'deploy', 'release', 'publish',
      'test', 'validate', 'verify',
      'migrate', 'upgrade', 'update'
    ];
    
    return actionPatterns.filter(action => task.includes(action));
  }

  private extractQualifiers(task: string): string[] {
    const qualifierPatterns = [
      'fast', 'slow', 'secure', 'simple', 'complex',
      'scalable', 'maintainable', 'reliable',
      'efficient', 'robust', 'flexible'
    ];
    
    return qualifierPatterns.filter(qualifier => task.includes(qualifier));
  }

  private extractPriorities(task: string): string[] {
    const priorityPatterns = {
      'performance': ['fast', 'speed', 'performance', 'efficient'],
      'security': ['secure', 'safety', 'protection'],
      'maintainability': ['maintainable', 'clean', 'readable'],
      'scalability': ['scalable', 'scale', 'growth'],
      'reliability': ['reliable', 'stable', 'robust']
    };
    
    const priorities: string[] = [];
    
    for (const [priority, keywords] of Object.entries(priorityPatterns)) {
      if (keywords.some(keyword => task.includes(keyword))) {
        priorities.push(priority);
      }
    }
    
    return priorities;
  }

  // Методы анализа требований

  private determineSecurityLevel(keywords: KeywordAnalysis, context: TechAnalysisContext): SecurityLevel {
    const securityIndicators = [
      keywords.domains.includes('security'),
      keywords.actions.some(action => ['authenticate', 'authorize', 'encrypt'].includes(action)),
      context.task.toLowerCase().includes('payment'),
      context.task.toLowerCase().includes('personal'),
      context.task.toLowerCase().includes('sensitive')
    ];
    
    const securityScore = securityIndicators.filter(Boolean).length;
    
    if (securityScore >= 3) return 'critical';
    if (securityScore >= 2) return 'high';
    if (securityScore >= 1) return 'medium';
    return 'low';
  }

  private identifySecurityRequirements(keywords: KeywordAnalysis, context: TechAnalysisContext): string[] {
    const requirements: string[] = [];
    
    if (keywords.domains.includes('security')) {
      requirements.push('Implement security best practices');
    }
    
    if (context.task.toLowerCase().includes('auth')) {
      requirements.push('Secure authentication mechanism');
      requirements.push('Session management');
    }
    
    if (context.task.toLowerCase().includes('payment')) {
      requirements.push('PCI DSS compliance');
      requirements.push('Encrypted data transmission');
    }
    
    return requirements;
  }

  private identifyComplianceNeeds(keywords: KeywordAnalysis, context: TechAnalysisContext): string[] {
    const needs: string[] = [];
    
    if (context.task.toLowerCase().includes('gdpr') || 
        context.task.toLowerCase().includes('privacy')) {
      needs.push('GDPR compliance');
    }
    
    if (context.task.toLowerCase().includes('hipaa') || 
        context.task.toLowerCase().includes('medical')) {
      needs.push('HIPAA compliance');
    }
    
    if (context.task.toLowerCase().includes('payment') || 
        context.task.toLowerCase().includes('financial')) {
      needs.push('PCI DSS compliance');
    }
    
    return needs;
  }

  private buildThreatModel(keywords: KeywordAnalysis, context: TechAnalysisContext): ThreatModel {
    const threats: string[] = [];
    
    if (keywords.domains.includes('security')) {
      threats.push('Unauthorized access');
      threats.push('Data breaches');
    }
    
    if (context.task.toLowerCase().includes('web')) {
      threats.push('XSS attacks');
      threats.push('CSRF attacks');
      threats.push('SQL injection');
    }
    
    if (context.task.toLowerCase().includes('api')) {
      threats.push('API abuse');
      threats.push('Rate limiting bypass');
    }
    
    return {
      threats,
      riskLevel: this.determineSecurityLevel(keywords, context),
      mitigations: this.generateSecurityMitigations(threats)
    };
  }

  private generateSecurityMitigations(threats: string[]): string[] {
    const mitigations: string[] = [];
    
    if (threats.includes('XSS attacks')) {
      mitigations.push('Input sanitization');
      mitigations.push('Content Security Policy');
    }
    
    if (threats.includes('SQL injection')) {
      mitigations.push('Parameterized queries');
      mitigations.push('Input validation');
    }
    
    if (threats.includes('Unauthorized access')) {
      mitigations.push('Strong authentication');
      mitigations.push('Access control');
    }
    
    return mitigations;
  }

  private determinePerformanceLevel(keywords: KeywordAnalysis, context: TechAnalysisContext): PerformanceLevel {
    const performanceIndicators = [
      keywords.priorities.includes('performance'),
      keywords.qualifiers.includes('fast'),
      context.task.toLowerCase().includes('realtime'),
      context.task.toLowerCase().includes('scale'),
      context.task.toLowerCase().includes('concurrent')
    ];
    
    const performanceScore = performanceIndicators.filter(Boolean).length;
    
    if (performanceScore >= 3) return 'critical';
    if (performanceScore >= 2) return 'high';
    if (performanceScore >= 1) return 'medium';
    return 'low';
  }

  private identifyPerformanceMetrics(keywords: KeywordAnalysis, context: TechAnalysisContext): string[] {
    const metrics: string[] = [];
    
    if (keywords.priorities.includes('performance')) {
      metrics.push('Response time');
      metrics.push('Throughput');
    }
    
    if (context.task.toLowerCase().includes('realtime')) {
      metrics.push('Latency');
      metrics.push('Real-time processing speed');
    }
    
    if (context.task.toLowerCase().includes('scale')) {
      metrics.push('Concurrent users');
      metrics.push('Resource utilization');
    }
    
    return metrics;
  }

  private identifyPerformanceConstraints(keywords: KeywordAnalysis, context: TechAnalysisContext): string[] {
    const constraints: string[] = [];
    
    if (context.constraints) {
      for (const constraint of context.constraints) {
        if (constraint.toLowerCase().includes('memory')) {
          constraints.push('Memory usage limits');
        }
        if (constraint.toLowerCase().includes('cpu')) {
          constraints.push('CPU usage limits');
        }
        if (constraint.toLowerCase().includes('bandwidth')) {
          constraints.push('Bandwidth limitations');
        }
      }
    }
    
    return constraints;
  }

  private identifyOptimizationTargets(keywords: KeywordAnalysis, context: TechAnalysisContext): string[] {
    const targets: string[] = [];
    
    if (keywords.qualifiers.includes('fast')) {
      targets.push('Execution speed');
    }
    
    if (context.task.toLowerCase().includes('memory')) {
      targets.push('Memory efficiency');
    }
    
    if (context.task.toLowerCase().includes('network')) {
      targets.push('Network optimization');
    }
    
    return targets;
  }
}

// Типы для анализа контекста

export type TaskType = 
  | 'new_project' | 'feature_addition' | 'bug_fix' | 'refactoring' 
  | 'migration' | 'security_audit' | 'performance_optimization' 
  | 'maintenance' | 'general';

export type ComplexityLevel = 'low' | 'medium' | 'high';

export type SecurityLevel = 'low' | 'medium' | 'high' | 'critical';

export type PerformanceLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TaskContextAnalysis {
  taskType: TaskType;
  complexity: ComplexityLevel;
  riskFactors: RiskFactor[];
  recommendations: string[];
  requiredCategories: PatternCategory[];
  teamReadiness: TeamReadiness;
  timelineConstraints: TimelineConstraints;
  technicalConstraints: TechnicalConstraints;
}

export interface RiskFactor {
  type: 'technology' | 'timeline' | 'team' | 'security' | 'performance';
  level: RiskLevel;
  description: string;
  mitigation: string;
}

export interface TeamReadiness {
  level: string;
  canHandleComplexPatterns: boolean;
  needsAdditionalGuidance: boolean;
  recommendedApproach: string;
  trainingNeeds: string[];
}

export interface TimelineConstraints {
  isUrgent: boolean;
  allowsExperimentation: boolean;
  recommendedPatternTypes: string[];
  riskTolerance: 'low' | 'medium' | 'high';
}

export interface TechnicalConstraints {
  hasLegacyCode: boolean;
  hasPerformanceRequirements: boolean;
  hasSecurityRequirements: boolean;
  hasCompatibilityRequirements: boolean;
  allowedTechnologies: string[];
  forbiddenTechnologies: string[];
}

export interface PatternCompatibility {
  compatibilityScore: number;
  compatibilityFactors: CompatibilityFactor[];
  blockers: Blocker[];
  adaptations: Adaptation[];
  riskAssessment: PatternRiskAssessment;
}

export interface CompatibilityFactor {
  type: string;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
}

export interface Blocker {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  canBeOverridden: boolean;
}

export interface Adaptation {
  type: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  benefit: string;
}

export interface PatternRiskAssessment {
  baseRisk: number;
  adjustedRisk: number;
  riskFactors: string[];
  mitigationStrategies: string[];
}

export interface KeywordAnalysis {
  technologies: string[];
  domains: string[];
  actions: string[];
  qualifiers: string[];
  priorities: string[];
}

export interface SecurityRequirements {
  level: SecurityLevel;
  requirements: string[];
  complianceNeeds: string[];
  threatModel: ThreatModel;
}

export interface ThreatModel {
  threats: string[];
  riskLevel: SecurityLevel;
  mitigations: string[];
}

export interface PerformanceRequirements {
  level: PerformanceLevel;
  metrics: string[];
  constraints: string[];
  optimizationTargets: string[];
}
