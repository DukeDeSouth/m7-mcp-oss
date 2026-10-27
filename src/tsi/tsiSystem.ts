import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[TSI]');

import { 
  ITSISystem,
  IKnowledgeBase,
  IRecommendationEngine,
  ISafetyValidator,
  IPatternRegistry,
  TechAnalysisContext,
  TechAnalysisResult,
  ValidationResult,
  ValidationConfig,
  TechPattern,
  PatternCategory,
  KnowledgeBaseConfig,
  TSIMetrics,
  TSIEvent
} from './core/types.js';

import { KnowledgeBase } from './core/knowledgeBase.js';
import { silentLogger as logger } from '../core/utils/logger.js';
import { PatternRegistry } from './core/patternRegistry.js';
import { RecommendationEngine } from './engine/recommendationEngine.js';
import { ContextAnalyzer } from './engine/contextAnalyzer.js';
import { SafetyValidator } from './validator/safetyValidator.js';
import { PatternMatcher } from './validator/patternMatcher.js';

/**
 * M7 Tech Safety Intelligence - Main System
 * Главная система TSI, объединяющая все компоненты
 */
export class TSISystem implements ITSISystem {
  public knowledgeBase: IKnowledgeBase;
  public recommendationEngine: IRecommendationEngine;
  public safetyValidator: ISafetyValidator;
  public patternRegistry: IPatternRegistry;
  
  private contextAnalyzer: ContextAnalyzer;
  private patternMatcher: PatternMatcher;
  private eventListeners: Map<string, ((data: TSIEvent) => void)[]> = new Map();
  private metrics: TSIMetrics;
  private initialized: boolean = false;

  constructor(config?: KnowledgeBaseConfig) {
    // Инициализируем компоненты
    this.knowledgeBase = new KnowledgeBase(config || this.getDefaultConfig());
    this.patternRegistry = new PatternRegistry(config?.dataPath);
    this.recommendationEngine = new RecommendationEngine(this.knowledgeBase, this.patternRegistry);
    this.safetyValidator = new SafetyValidator(this.knowledgeBase);
    this.contextAnalyzer = new ContextAnalyzer();
    this.patternMatcher = new PatternMatcher();
    
    // Инициализируем метрики
    this.metrics = {
      totalPatterns: 0,
      technologiesCovered: 0,
      dailyChecks: 0,
      antipatternsDetected: 0,
      successRate: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      errorRate: 0
    };
  }

  /**
   * Инициализация системы TSI
   */
  async initialize(config?: KnowledgeBaseConfig): Promise<void> {
    try {
      logger.info('[TSI System] Initializing Tech Safety Intelligence...');
      
      // Инициализируем компоненты
      await this.knowledgeBase.initialize();
      await this.patternRegistry.initialize();
      
      // Загружаем начальные паттерны если база пуста
      await this.loadInitialPatternsIfNeeded();
      
      // Обновляем метрики
      await this.updateMetrics();
      
      this.initialized = true;
      
      logger.info('[TSI System] ✅ Tech Safety Intelligence initialized successfully');
      
      // Эмитим событие инициализации
      this.emit('system_initialized', {
        type: 'pattern_used',
        timestamp: new Date(),
        data: { component: 'TSISystem', status: 'initialized' }
      });
      
    } catch (error) {
      log.debug('TSI System] ❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Проверка технологического стека
   */
  async checkTechStack(context: TechAnalysisContext): Promise<TechAnalysisResult> {
    this.ensureInitialized();
    
    const startTime = Date.now();
    
    try {
      // Анализируем контекст
      const contextAnalysis = this.contextAnalyzer.analyzeTaskContext(context);
      
      // Получаем рекомендации
      const result = await this.recommendationEngine.getRecommendations(context);
      
      // Записываем использование
      this.recordUsage('tech_stack_check', true, Date.now() - startTime);
      
      // Эмитим событие
      this.emit('tech_stack_checked', {
        type: 'pattern_used',
        timestamp: new Date(),
        data: { 
          technology: context.technology, 
          riskScore: result.overallRiskScore,
          issuesFound: result.detectedAntipatterns.length
        }
      });
      
      return result;
      
    } catch (error) {
      this.recordUsage('tech_stack_check', false, Date.now() - startTime);
      log.debug('TSI System] Tech stack check failed:', error);
      throw error;
    }
  }

  /**
   * Получение паттернов для технологии
   */
  async getPatterns(technology: string, category?: PatternCategory): Promise<TechPattern[]> {
    this.ensureInitialized();
    
    try {
      const patterns = await this.knowledgeBase.findPatterns({
        technology,
        category,
        minConfidence: 0.5
      });
      
      // Записываем использование
      this.recordUsage('get_patterns', true, 0);
      
      return patterns;
      
    } catch (error) {
      this.recordUsage('get_patterns', false, 0);
      log.debug('TSI System] Get patterns failed:', error);
      throw error;
    }
  }

  /**
   * Валидация реализации
   */
  async validateImplementation(
    code: string, 
    technology: string, 
    config?: ValidationConfig
  ): Promise<ValidationResult> {
    this.ensureInitialized();
    
    const startTime = Date.now();
    
    try {
      const result = await this.safetyValidator.validate(code, technology, config);
      
      // Записываем использование
      this.recordUsage('validate_implementation', result.success, Date.now() - startTime);
      
      // Эмитим событие
      this.emit('validation_performed', {
        type: 'validation_performed',
        timestamp: new Date(),
        data: { 
          technology, 
          score: result.score,
          issuesFound: result.issues.length,
          criticalIssues: result.metrics.criticalIssues
        }
      });
      
      return result;
      
    } catch (error) {
      this.recordUsage('validate_implementation', false, Date.now() - startTime);
      log.debug('TSI System] Validation failed:', error);
      throw error;
    }
  }

  /**
   * Обновление базы знаний
   */
  async updateKnowledge(): Promise<void> {
    this.ensureInitialized();
    
    try {
      logger.info('[TSI System] Updating knowledge base...');
      
      // Здесь можно добавить логику обновления из внешних источников
      // Например, загрузка новых паттернов из GitHub, документации и т.д.
      
      await this.updateMetrics();
      
      logger.info('[TSI System] ✅ Knowledge base updated');
      
    } catch (error) {
      log.debug('TSI System] Knowledge update failed:', error);
      throw error;
    }
  }

  /**
   * Получение метрик системы
   */
  async getMetrics(): Promise<TSIMetrics> {
    await this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Подписка на события
   */
  on(event: string, callback: (data: TSIEvent) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Эмиссия событий
   */
  emit(event: string, data: TSIEvent): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const listener of listeners) {
      try {
        listener(data);
      } catch (error) {
        log.debug(`TSI System] Event listener error for ${event}:`, error);
      }
    }
  }

  /**
   * Добавление нового паттерна
   */
  async addPattern(pattern: TechPattern): Promise<void> {
    // Не проверяем инициализацию при загрузке начальных паттернов
    if (this.initialized) {
      this.ensureInitialized();
    }
    
    try {
      await this.patternRegistry.register(pattern);
      await this.knowledgeBase.addPattern(pattern);
      
      logger.info(`[TSI System] Added pattern: ${pattern.id}`);
      
      // Эмитим событие
      this.emit('pattern_added', {
        type: 'pattern_updated',
        timestamp: new Date(),
        data: { patternId: pattern.id, technology: pattern.technology }
      });
      
    } catch (error) {
      log.debug('TSI System] Add pattern failed:', error);
      throw error;
    }
  }

  /**
   * Поиск похожих паттернов
   */
  async findSimilarPatterns(code: string, technology: string, threshold: number = 0.3): Promise<TechPattern[]> {
    this.ensureInitialized();
    
    try {
      const patterns = await this.getPatterns(technology);
      const similar = this.patternMatcher.findSimilarPatterns(code, patterns, threshold);
      
      return similar.map(s => s.pattern);
      
    } catch (error) {
      log.debug('TSI System] Find similar patterns failed:', error);
      throw error;
    }
  }

  /**
   * Анализ качества кода
   */
  async analyzeCodeQuality(code: string, technology: string): Promise<{
    score: number;
    issues: number;
    suggestions: string[];
    patterns: TechPattern[];
  }> {
    this.ensureInitialized();
    
    try {
      const validation = await this.validateImplementation(code, technology);
      const patterns = await this.findSimilarPatterns(code, technology);
      
      const suggestions = validation.fixes.map(fix => fix.description);
      
      return {
        score: validation.score,
        issues: validation.issues.length,
        suggestions,
        patterns
      };
      
    } catch (error) {
      log.debug('TSI System] Code quality analysis failed:', error);
      throw error;
    }
  }

  /**
   * Экспорт конфигурации системы
   */
  async exportConfiguration(): Promise<string> {
    const config = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      metrics: this.metrics,
      patterns_count: (await this.patternRegistry.list()).length,
      technologies: await this.getSupportedTechnologies()
    };
    
    return JSON.stringify(config, null, 2);
  }

  /**
   * Получение поддерживаемых технологий
   */
  async getSupportedTechnologies(): Promise<string[]> {
    const patterns = await this.patternRegistry.list();
    const technologies = new Set(patterns.map(p => p.technology));
    return Array.from(technologies).sort();
  }

  // Приватные методы

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('TSI System not initialized. Call initialize() first.');
    }
  }

  private getDefaultConfig(): KnowledgeBaseConfig {
    return {
      dataPath: '.m7/tsi',
      cacheSize: 1000,
      autoUpdate: false,
      updateInterval: 60,
      sources: {
        github: {
          enabled: false,
          repositories: [],
          updateFrequency: 24
        },
        documentation: {
          enabled: false,
          sources: []
        },
        community: {
          enabled: false,
          platforms: [],
          minScore: 5
        }
      }
    };
  }

  private async loadInitialPatternsIfNeeded(): Promise<void> {
    const existingPatterns = await this.patternRegistry.list();
    
    if (existingPatterns.length === 0) {
      logger.info('[TSI System] Loading initial patterns...');
      
      // Загружаем базовые паттерны
      const initialPatterns = await this.createInitialPatterns();
      
      for (const pattern of initialPatterns) {
        try {
          await this.addPattern(pattern);
        } catch (error) {
          log.warn(`TSI System] Failed to add initial pattern ${pattern.id}:`, error);
        }
      }
      
      logger.info(`[TSI System] Loaded ${initialPatterns.length} initial patterns`);
    }
  }

  private async createInitialPatterns(): Promise<TechPattern[]> {
    // Создаем базовые паттерны для популярных технологий
    const patterns: TechPattern[] = [];
    
    // JavaScript/TypeScript паттерны безопасности
    patterns.push({
      id: 'js-avoid-eval',
      name: 'Avoid eval() function',
      technology: 'javascript',
      category: 'security',
      type: 'antipattern',
      description: 'Using eval() can lead to code injection vulnerabilities',
      implementation: [{
        language: 'javascript',
        code: 'eval(userInput); // Dangerous!',
        description: 'Direct eval usage',
        isComplete: true
      }],
      risks: [{
        id: 'eval-injection',
        level: 'critical',
        category: 'security',
        description: 'Code injection vulnerability',
        impact: 'Arbitrary code execution',
        likelihood: 0.8,
        mitigation: ['Use JSON.parse() for data', 'Use Function constructor with validation', 'Avoid dynamic code execution']
      }],
      riskScore: 90,
      alternatives: [{
        id: 'json-parse',
        name: 'JSON.parse()',
        technology: 'javascript',
        description: 'Use JSON.parse() for parsing JSON data safely',
        migrationComplexity: 'low',
        migrationSteps: ['Replace eval() with JSON.parse()', 'Add error handling', 'Validate input format'],
        pros: ['Safe', 'Fast', 'Standard'],
        cons: ['Only works with JSON'],
        whenToUse: 'When parsing JSON data'
      }],
      confidence: 0.95,
      tags: ['security', 'javascript', 'eval', 'injection'],
      createdAt: new Date(),
      updatedAt: new Date(),
      usageCount: 0,
      successRate: 0,
      applicableContexts: ['web-development', 'node.js', 'frontend'],
      incompatibleWith: [],
      sources: [{
        type: 'documentation',
        url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval',
        title: 'MDN: eval()',
        reliability: 0.9
      }],
      documentation: []
    });

    // React паттерн безопасности
    patterns.push({
      id: 'react-avoid-dangerously-set-innerHTML',
      name: 'Avoid dangerouslySetInnerHTML',
      technology: 'react',
      category: 'security',
      type: 'antipattern',
      description: 'Using dangerouslySetInnerHTML without sanitization can lead to XSS attacks',
      implementation: [{
        language: 'jsx',
        code: '<div dangerouslySetInnerHTML={{__html: userInput}} />',
        description: 'Unsafe HTML injection',
        isComplete: true
      }],
      risks: [{
        id: 'xss-vulnerability',
        level: 'high',
        category: 'security',
        description: 'Cross-site scripting vulnerability',
        impact: 'Script injection and data theft',
        likelihood: 0.7,
        mitigation: ['Sanitize HTML with DOMPurify', 'Use textContent instead', 'Validate and escape user input']
      }],
      riskScore: 75,
      alternatives: [{
        id: 'dom-purify',
        name: 'DOMPurify',
        technology: 'react',
        description: 'Use DOMPurify to sanitize HTML before rendering',
        migrationComplexity: 'medium',
        migrationSteps: ['Install DOMPurify', 'Sanitize HTML content', 'Replace dangerouslySetInnerHTML'],
        pros: ['Safe', 'Flexible', 'Well-maintained'],
        cons: ['Additional dependency', 'Performance overhead'],
        whenToUse: 'When you need to render HTML content'
      }],
      confidence: 0.9,
      tags: ['security', 'react', 'xss', 'html'],
      createdAt: new Date(),
      updatedAt: new Date(),
      usageCount: 0,
      successRate: 0,
      applicableContexts: ['react', 'frontend', 'web-development'],
      incompatibleWith: [],
      sources: [{
        type: 'documentation',
        url: 'https://reactjs.org/docs/dom-elements.html#dangerouslysetinnerhtml',
        title: 'React: dangerouslySetInnerHTML',
        reliability: 0.95
      }],
      documentation: []
    });

    // Node.js паттерн безопасности
    patterns.push({
      id: 'nodejs-secure-headers',
      name: 'Use Security Headers',
      technology: 'nodejs',
      category: 'security',
      type: 'pattern',
      description: 'Always set security headers to protect against common attacks',
      implementation: [{
        language: 'javascript',
        code: `const helmet = require('helmet');
app.use(helmet());`,
        description: 'Using helmet middleware for security headers',
        isComplete: true,
        dependencies: ['helmet']
      }],
      risks: [{
        id: 'missing-headers',
        level: 'medium',
        category: 'security',
        description: 'Missing security headers',
        impact: 'Vulnerability to various attacks',
        likelihood: 0.6,
        mitigation: ['Use helmet middleware', 'Set headers manually', 'Configure reverse proxy headers']
      }],
      riskScore: 30,
      alternatives: [{
        id: 'manual-headers',
        name: 'Manual Headers',
        technology: 'nodejs',
        description: 'Set security headers manually',
        migrationComplexity: 'low',
        migrationSteps: ['Remove helmet', 'Add manual header middleware', 'Test all headers'],
        pros: ['Full control', 'No dependencies'],
        cons: ['More code', 'Easy to miss headers'],
        whenToUse: 'When you need fine-grained control'
      }],
      confidence: 0.85,
      tags: ['security', 'nodejs', 'headers', 'helmet'],
      createdAt: new Date(),
      updatedAt: new Date(),
      usageCount: 0,
      successRate: 0,
      applicableContexts: ['nodejs', 'express', 'web-server'],
      incompatibleWith: [],
      sources: [{
        type: 'github',
        url: 'https://github.com/helmetjs/helmet',
        title: 'Helmet.js',
        reliability: 0.9
      }],
      documentation: []
    });

    return patterns;
  }

  private async updateMetrics(): Promise<void> {
    try {
      const patterns = await this.patternRegistry.list();
      const technologies = new Set(patterns.map(p => p.technology));
      
      this.metrics.totalPatterns = patterns.length;
      this.metrics.technologiesCovered = technologies.size;
      
      // Другие метрики обновляются в процессе работы
      
    } catch (error) {
      log.debug('TSI System] Metrics update failed:', error);
    }
  }

  private recordUsage(operation: string, success: boolean, responseTime: number): void {
    // Обновляем метрики использования
    this.metrics.dailyChecks++;
    
    if (success) {
      // Обновляем средний response time
      const currentAvg = this.metrics.averageResponseTime;
      const count = this.metrics.dailyChecks;
      this.metrics.averageResponseTime = (currentAvg * (count - 1) + responseTime) / count;
      
      // Обновляем success rate
      const successCount = Math.round(this.metrics.successRate * (count - 1) / 100) + 1;
      this.metrics.successRate = (successCount / count) * 100;
    } else {
      // Обновляем error rate
      const errorCount = Math.round(this.metrics.errorRate * (this.metrics.dailyChecks - 1) / 100) + 1;
      this.metrics.errorRate = (errorCount / this.metrics.dailyChecks) * 100;
    }
  }
}
