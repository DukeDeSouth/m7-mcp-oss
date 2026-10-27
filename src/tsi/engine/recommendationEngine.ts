import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import { 
  IRecommendationEngine,
  TechAnalysisContext,
  TechAnalysisResult,
  DetectedAntipattern,
  Alternative,
  TechPattern,
  Suggestion,
  Warning,
  PatternType,
  RiskLevel,
  IKnowledgeBase,
  IPatternRegistry
} from '../core/types.js';

/**
 * M7 Tech Safety Intelligence - Recommendation Engine
 * Интеллектуальный движок рекомендаций на основе контекста и паттернов
 */
export class RecommendationEngine implements IRecommendationEngine {
  private knowledgeBase: IKnowledgeBase;
  private patternRegistry: IPatternRegistry;

  constructor(knowledgeBase: IKnowledgeBase, patternRegistry: IPatternRegistry) {
    this.knowledgeBase = knowledgeBase;
    this.patternRegistry = patternRegistry;
  }

  /**
   * Получение рекомендаций на основе контекста
   */
  async getRecommendations(context: TechAnalysisContext): Promise<TechAnalysisResult> {
    const startTime = Date.now();
    
    try {
      // 1. Анализируем технологию и контекст
      const technologyAnalysis = await this.analyzeTechnology(context);
      
      // 2. Находим релевантные паттерны
      const patterns = await this.findRelevantPatterns(context);
      
      // 3. Анализируем существующий код (если есть)
      const codeAnalysis = context.existingCode 
        ? await this.analyzeCode(context.existingCode, context.technology)
        : [];
      
      // 4. Генерируем рекомендации
      const suggestions = await this.generateSuggestions(context, patterns, codeAnalysis);
      
      // 5. Находим альтернативы
      const alternatives = await this.suggestAlternatives(context.technology, context);
      
      // 6. Вычисляем общий риск
      const overallRiskScore = this.calculateOverallRisk(patterns, codeAnalysis);
      
      // 7. Генерируем предупреждения
      const warnings = this.generateWarnings(context, patterns, codeAnalysis);
      
      const analysisTime = Date.now() - startTime;
      
      return {
        success: true,
        technology: context.technology,
        overallRiskScore,
        confidence: technologyAnalysis.confidence,
        recommendedPatterns: patterns.filter(p => p.type === 'pattern'),
        detectedAntipatterns: codeAnalysis,
        suggestions,
        alternatives,
        analysisTime,
        patternsChecked: patterns.length,
        warnings,
        notes: technologyAnalysis.notes
      };
      
    } catch (error) {
      log.debug('TSI Engine] Recommendation generation failed:', error);
      
      return {
        success: false,
        technology: context.technology,
        overallRiskScore: 100,
        confidence: 0,
        recommendedPatterns: [],
        detectedAntipatterns: [],
        suggestions: [],
        alternatives: [],
        analysisTime: Date.now() - startTime,
        patternsChecked: 0,
        warnings: [{
          level: 'error',
          message: `Failed to analyze technology: ${error instanceof Error ? error.message : 'Unknown error'}`,
          suggestion: 'Please check the technology name and try again'
        }],
        notes: []
      };
    }
  }

  /**
   * Анализ кода на антипаттерны
   */
  async analyzeCode(code: string, technology: string): Promise<DetectedAntipattern[]> {
    const antipatterns: DetectedAntipattern[] = [];
    
    try {
      // Получаем все антипаттерны для технологии
      const patterns = await this.knowledgeBase.findPatterns({
        technology,
        type: 'antipattern'
      });
      
      for (const pattern of patterns) {
        const detected = await this.checkPatternInCode(code, pattern);
        if (detected) {
          antipatterns.push(detected);
        }
      }
      
      // Сортируем по серьезности
      antipatterns.sort((a, b) => {
        const severityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
        return severityOrder[b.severity] - severityOrder[a.severity];
      });
      
    } catch (error) {
      log.debug('TSI Engine] Code analysis failed:', error);
    }
    
    return antipatterns;
  }

  /**
   * Предложение альтернативных технологий
   */
  async suggestAlternatives(technology: string, context: TechAnalysisContext): Promise<Alternative[]> {
    const alternatives: Alternative[] = [];
    
    try {
      // Получаем паттерны для технологии
      const patterns = await this.knowledgeBase.findPatterns({ technology });
      
      // Собираем все альтернативы из паттернов
      const alternativeSet = new Set<string>();
      
      for (const pattern of patterns) {
        for (const alt of pattern.alternatives) {
          if (!alternativeSet.has(alt.id)) {
            alternativeSet.add(alt.id);
            
            // Оцениваем подходящность альтернативы для контекста
            const suitability = this.evaluateAlternativeSuitability(alt, context);
            
            if (suitability > 0.3) { // Порог подходящности
              alternatives.push({
                ...alt,
                migrationComplexity: this.assessMigrationComplexity(technology, alt.technology, context)
              });
            }
          }
        }
      }
      
      // Сортируем по подходящности
      alternatives.sort((a, b) => {
        const scoreA = this.calculateAlternativeScore(a, context);
        const scoreB = this.calculateAlternativeScore(b, context);
        return scoreB - scoreA;
      });
      
    } catch (error) {
      log.debug('TSI Engine] Alternative suggestion failed:', error);
    }
    
    return alternatives.slice(0, 5); // Топ 5 альтернатив
  }

  // Приватные методы

  private async analyzeTechnology(context: TechAnalysisContext): Promise<{
    confidence: number;
    notes: string[];
  }> {
    const notes: string[] = [];
    let confidence = 0.8; // Базовый уровень доверия
    
    // Проверяем популярность технологии
    const patterns = await this.knowledgeBase.findPatterns({ 
      technology: context.technology 
    });
    
    if (patterns.length === 0) {
      notes.push(`Limited knowledge about ${context.technology}. Recommendations may be incomplete.`);
      confidence = 0.3;
    } else if (patterns.length < 5) {
      notes.push(`Basic knowledge about ${context.technology}. Consider verifying recommendations.`);
      confidence = 0.6;
    } else {
      notes.push(`Good knowledge base for ${context.technology} with ${patterns.length} patterns.`);
    }
    
    // Учитываем опыт команды
    if (context.teamExperience === 'junior') {
      notes.push('Consider additional training and documentation for junior team.');
      confidence *= 0.9;
    } else if (context.teamExperience === 'senior') {
      notes.push('Senior team can handle more complex patterns and optimizations.');
      confidence *= 1.1;
    }
    
    // Учитываем временные ограничения
    if (context.timeline && context.timeline.includes('urgent')) {
      notes.push('Urgent timeline detected. Prioritizing stable, well-tested patterns.');
      confidence *= 0.8;
    }
    
    return { confidence: Math.min(confidence, 1.0), notes };
  }

  private async findRelevantPatterns(context: TechAnalysisContext): Promise<TechPattern[]> {
    const patterns: TechPattern[] = [];
    
    // Основные паттерны для технологии
    const mainPatterns = await this.knowledgeBase.findPatterns({
      technology: context.technology,
      minConfidence: 0.7
    });
    
    patterns.push(...mainPatterns);
    
    // Паттерны по контексту задачи
    if (context.task) {
      const contextPatterns = await this.findPatternsByTaskContext(context.task, context.technology);
      patterns.push(...contextPatterns);
    }
    
    // Удаляем дубликаты
    const uniquePatterns = patterns.filter((pattern, index, self) => 
      index === self.findIndex(p => p.id === pattern.id)
    );
    
    // Сортируем по релевантности
    return uniquePatterns.sort((a, b) => {
      const scoreA = this.calculatePatternRelevance(a, context);
      const scoreB = this.calculatePatternRelevance(b, context);
      return scoreB - scoreA;
    });
  }

  private async findPatternsByTaskContext(task: string, technology: string): Promise<TechPattern[]> {
    const taskLower = task.toLowerCase();
    const contextKeywords = this.extractContextKeywords(taskLower);
    
    const patterns = await this.knowledgeBase.findPatterns({ technology });
    
    return patterns.filter(pattern => {
      // Проверяем совпадения в описании, тегах и контексте применения
      const searchText = [
        pattern.description,
        ...pattern.tags,
        ...pattern.applicableContexts
      ].join(' ').toLowerCase();
      
      return contextKeywords.some(keyword => searchText.includes(keyword));
    });
  }

  private extractContextKeywords(task: string): string[] {
    const keywords: string[] = [];
    
    // Паттерны для разных типов задач
    const patterns = {
      security: ['auth', 'login', 'password', 'token', 'secure', 'encrypt', 'decrypt', 'ssl', 'https'],
      performance: ['fast', 'speed', 'optimize', 'cache', 'lazy', 'async', 'performance'],
      database: ['database', 'db', 'sql', 'query', 'orm', 'migration', 'schema'],
      api: ['api', 'rest', 'graphql', 'endpoint', 'request', 'response', 'http'],
      ui: ['ui', 'interface', 'component', 'render', 'display', 'form', 'button'],
      testing: ['test', 'spec', 'unit', 'integration', 'e2e', 'mock', 'stub'],
      deployment: ['deploy', 'build', 'ci', 'cd', 'docker', 'kubernetes', 'production']
    };
    
    for (const [category, words] of Object.entries(patterns)) {
      if (words.some(word => task.includes(word))) {
        keywords.push(category);
        keywords.push(...words.filter(word => task.includes(word)));
      }
    }
    
    return [...new Set(keywords)]; // Удаляем дубликаты
  }

  private async checkPatternInCode(code: string, pattern: TechPattern): Promise<DetectedAntipattern | null> {
    // Простая проверка на основе регулярных выражений и ключевых слов
    // В реальной реализации здесь был бы более сложный анализ AST
    
    const codeLines = code.split('\n');
    
    for (let i = 0; i < codeLines.length; i++) {
      const line = codeLines[i];
      const lineNumber = i + 1;
      
      // Проверяем каждый пример кода из паттерна
      for (const example of pattern.implementation) {
        if (this.matchesAntipattern(line, example.code)) {
          const severity = this.determineSeverity(pattern);
          
          return {
            pattern,
            location: {
              line: lineNumber,
              snippet: line.trim()
            },
            severity,
            description: `Detected antipattern: ${pattern.name}`,
            suggestedFix: this.generateFix(pattern, line),
            autoFixable: this.isAutoFixable(pattern)
          };
        }
      }
    }
    
    return null;
  }

  private matchesAntipattern(codeLine: string, patternCode: string): boolean {
    // Упрощенное сопоставление - в реальности нужен более сложный анализ
    const normalizedCode = codeLine.replace(/\s+/g, ' ').trim();
    const normalizedPattern = patternCode.replace(/\s+/g, ' ').trim();
    
    // Проверяем прямое совпадение или похожие конструкции
    if (normalizedCode.includes(normalizedPattern)) {
      return true;
    }
    
    // Проверяем ключевые слова антипаттерна
    const antipatternKeywords = this.extractAntipatternKeywords(patternCode);
    return antipatternKeywords.some(keyword => normalizedCode.includes(keyword));
  }

  private extractAntipatternKeywords(patternCode: string): string[] {
    // Извлекаем ключевые слова, которые указывают на антипаттерн
    const keywords: string[] = [];
    
    // Общие антипаттерны
    const commonAntipatterns = [
      'localStorage.getItem', // Небезопасное хранение токенов
      'eval(', // Использование eval
      'innerHTML =', // XSS уязвимость
      'document.write', // Устаревший метод
      'var ', // Использование var вместо let/const
      'catch (err) {}', // Пустой catch блок
      'setTimeout(', // Потенциальные проблемы с таймерами
      'setInterval(' // Потенциальные утечки памяти
    ];
    
    for (const antipattern of commonAntipatterns) {
      if (patternCode.includes(antipattern)) {
        keywords.push(antipattern);
      }
    }
    
    return keywords;
  }

  private determineSeverity(pattern: TechPattern): RiskLevel {
    // Определяем серьезность на основе рисков паттерна
    const maxRisk = Math.max(...pattern.risks.map(r => {
      const riskLevels = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
      return riskLevels[r.level];
    }));
    
    if (maxRisk >= 4) return 'critical';
    if (maxRisk >= 3) return 'high';
    if (maxRisk >= 2) return 'medium';
    return 'low';
  }

  private generateFix(pattern: TechPattern, codeLine: string): string {
    // Генерируем предложение по исправлению
    if (pattern.alternatives.length > 0) {
      const bestAlternative = pattern.alternatives[0];
      return `Consider using ${bestAlternative.name}: ${bestAlternative.description}`;
    }
    
    if (pattern.risks.length > 0 && pattern.risks[0].mitigation.length > 0) {
      return pattern.risks[0].mitigation[0];
    }
    
    return `Review and refactor this code according to ${pattern.technology} best practices`;
  }

  private isAutoFixable(pattern: TechPattern): boolean {
    // Определяем, можно ли автоматически исправить
    // Простые замены - да, сложная логика - нет
    const autoFixablePatterns = [
      'var-to-let-const',
      'innerHTML-to-textContent',
      'document-write-removal'
    ];
    
    return autoFixablePatterns.some(fixable => pattern.id.includes(fixable));
  }

  private async generateSuggestions(
    context: TechAnalysisContext, 
    patterns: TechPattern[], 
    antipatterns: DetectedAntipattern[]
  ): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    
    // Предложения на основе найденных антипаттернов
    for (const antipattern of antipatterns) {
      suggestions.push({
        id: `fix-${antipattern.pattern.id}`,
        type: 'security',
        priority: antipattern.severity,
        title: `Fix ${antipattern.pattern.name}`,
        description: antipattern.description,
        implementation: antipattern.suggestedFix,
        estimatedEffort: antipattern.autoFixable ? 'low' : 'medium',
        benefits: antipattern.pattern.risks.map(r => `Reduces ${r.level} risk: ${r.description}`),
        relatedPatterns: [antipattern.pattern.id]
      });
    }
    
    // Предложения на основе лучших практик
    const bestPractices = patterns
      .filter(p => p.type === 'pattern' && p.confidence > 0.8)
      .slice(0, 3);
    
    for (const pattern of bestPractices) {
      suggestions.push({
        id: `implement-${pattern.id}`,
        type: 'best_practice',
        priority: 'medium',
        title: `Implement ${pattern.name}`,
        description: pattern.description,
        implementation: pattern.implementation[0]?.description || 'See pattern documentation',
        estimatedEffort: this.estimateImplementationEffort(pattern),
        benefits: [`Improves ${pattern.category}`, `Confidence: ${Math.round(pattern.confidence * 100)}%`],
        relatedPatterns: [pattern.id]
      });
    }
    
    // Предложения на основе контекста
    if (context.teamExperience === 'junior') {
      suggestions.push({
        id: 'junior-team-guidance',
        type: 'best_practice',
        priority: 'high',
        title: 'Additional Documentation and Training',
        description: 'Provide comprehensive documentation and training for junior team members',
        implementation: 'Create detailed guides, code examples, and conduct code reviews',
        estimatedEffort: 'high',
        benefits: ['Reduces implementation errors', 'Improves code quality', 'Accelerates learning'],
        relatedPatterns: []
      });
    }
    
    return suggestions;
  }

  private estimateImplementationEffort(pattern: TechPattern): 'low' | 'medium' | 'high' {
    // Оцениваем сложность реализации паттерна
    const complexityFactors = [
      pattern.implementation.length, // Количество примеров
      pattern.risks.length, // Количество рисков
      pattern.alternatives.length // Количество альтернатив
    ];
    
    const totalComplexity = complexityFactors.reduce((sum, factor) => sum + factor, 0);
    
    if (totalComplexity <= 3) return 'low';
    if (totalComplexity <= 6) return 'medium';
    return 'high';
  }

  private calculateOverallRisk(patterns: TechPattern[], antipatterns: DetectedAntipattern[]): number {
    let totalRisk = 0;
    let riskCount = 0;
    
    // Риски от антипаттернов (высокий вес)
    for (const antipattern of antipatterns) {
      const severityWeight = { 'critical': 100, 'high': 75, 'medium': 50, 'low': 25 };
      totalRisk += severityWeight[antipattern.severity];
      riskCount++;
    }
    
    // Риски от паттернов (средний вес)
    for (const pattern of patterns) {
      totalRisk += pattern.riskScore * 0.5;
      riskCount++;
    }
    
    return riskCount > 0 ? Math.min(totalRisk / riskCount, 100) : 0;
  }

  private generateWarnings(
    context: TechAnalysisContext, 
    patterns: TechPattern[], 
    antipatterns: DetectedAntipattern[]
  ): Warning[] {
    const warnings: Warning[] = [];
    
    // Предупреждения о критических антипаттернах
    const criticalAntipatterns = antipatterns.filter(a => a.severity === 'critical');
    if (criticalAntipatterns.length > 0) {
      warnings.push({
        level: 'error',
        message: `Found ${criticalAntipatterns.length} critical security issues`,
        code: 'CRITICAL_ANTIPATTERNS',
        suggestion: 'Fix these issues before proceeding to production'
      });
    }
    
    // Предупреждения о недостатке знаний
    if (patterns.length < 3) {
      warnings.push({
        level: 'warning',
        message: `Limited pattern knowledge for ${context.technology}`,
        code: 'LIMITED_KNOWLEDGE',
        suggestion: 'Consider consulting additional resources or experts'
      });
    }
    
    // Предупреждения о временных ограничениях
    if (context.timeline && context.timeline.includes('urgent') && antipatterns.length > 0) {
      warnings.push({
        level: 'warning',
        message: 'Urgent timeline with detected issues',
        code: 'TIMELINE_RISK',
        suggestion: 'Consider extending timeline to properly address security issues'
      });
    }
    
    return warnings;
  }

  private calculatePatternRelevance(pattern: TechPattern, context: TechAnalysisContext): number {
    let relevance = pattern.confidence * 0.4; // Базовая релевантность
    
    // Бонус за соответствие контексту
    if (context.task) {
      const taskLower = context.task.toLowerCase();
      const patternText = [
        pattern.name,
        pattern.description,
        ...pattern.tags,
        ...pattern.applicableContexts
      ].join(' ').toLowerCase();
      
      const keywords = this.extractContextKeywords(taskLower);
      const matchingKeywords = keywords.filter(keyword => patternText.includes(keyword));
      
      relevance += (matchingKeywords.length / keywords.length) * 0.3;
    }
    
    // Бонус за успешность
    relevance += pattern.successRate * 0.2;
    
    // Штраф за риск
    relevance -= (pattern.riskScore / 100) * 0.1;
    
    return Math.max(0, Math.min(1, relevance));
  }

  private evaluateAlternativeSuitability(alternative: Alternative, context: TechAnalysisContext): number {
    let suitability = 0.5; // Базовая подходящность
    
    // Учитываем опыт команды
    if (context.teamExperience === 'junior' && alternative.migrationComplexity === 'low') {
      suitability += 0.3;
    } else if (context.teamExperience === 'senior' && alternative.migrationComplexity === 'high') {
      suitability += 0.2;
    }
    
    // Учитываем временные ограничения
    if (context.timeline && context.timeline.includes('urgent')) {
      if (alternative.migrationComplexity === 'low') {
        suitability += 0.2;
      } else {
        suitability -= 0.3;
      }
    }
    
    return Math.max(0, Math.min(1, suitability));
  }

  private calculateAlternativeScore(alternative: Alternative, context: TechAnalysisContext): number {
    let score = 0;
    
    // Простота миграции
    const complexityScore = { 'low': 1, 'medium': 0.6, 'high': 0.2 };
    score += complexityScore[alternative.migrationComplexity] * 0.4;
    
    // Количество преимуществ
    score += (alternative.pros.length / 10) * 0.3;
    
    // Штраф за недостатки
    score -= (alternative.cons.length / 10) * 0.2;
    
    // Подходящность для контекста
    score += this.evaluateAlternativeSuitability(alternative, context) * 0.1;
    
    return Math.max(0, score);
  }

  private assessMigrationComplexity(
    fromTech: string, 
    toTech: string, 
    context: TechAnalysisContext
  ): 'low' | 'medium' | 'high' {
    // Простая оценка сложности миграции
    // В реальности здесь была бы более сложная логика
    
    const similarTechnologies = {
      'react': ['vue', 'angular', 'svelte'],
      'nodejs': ['deno', 'bun'],
      'express': ['fastify', 'koa', 'hapi'],
      'mongodb': ['postgresql', 'mysql'],
      'docker': ['podman', 'containerd']
    };
    
    const fromSimilar = (similarTechnologies as any)[fromTech] || [];
    
    if (fromSimilar.includes(toTech)) {
      return context.teamExperience === 'junior' ? 'medium' : 'low';
    }
    
    // Если технологии из одной категории
    const categories = {
      frontend: ['react', 'vue', 'angular', 'svelte'],
      backend: ['nodejs', 'python', 'java', 'go'],
      database: ['mongodb', 'postgresql', 'mysql', 'redis']
    };
    
    for (const category of Object.values(categories)) {
      if (category.includes(fromTech) && category.includes(toTech)) {
        return 'medium';
      }
    }
    
    return 'high';
  }
}
