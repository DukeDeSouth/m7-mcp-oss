
/**
 * M7 Tech Safety Intelligence (TSI) - Core Types
 * Базовые типы и интерфейсы для системы безопасности технологических стеков
 */

// Основные типы технологий
export type TechnologyType = 
  | 'frontend' | 'backend' | 'database' | 'devops' 
  | 'security' | 'testing' | 'mobile' | 'ai_ml';

// Категории паттернов
export type PatternCategory = 
  | 'security' | 'performance' | 'architecture' 
  | 'testing' | 'deployment' | 'maintenance'
  | 'defensive';

// Типы паттернов
export type PatternType = 'pattern' | 'antipattern';

// Уровни риска
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

// Уровни доверия
export type ConfidenceLevel = number; // 0.0 - 1.0

/**
 * Основной интерфейс технологического паттерна
 */
export interface TechPattern {
  id: string;
  name: string;
  technology: string;
  version?: string;
  category: PatternCategory;
  type: PatternType;
  description: string;
  
  // Детали реализации
  implementation: CodeExample[];
  
  // Оценка рисков
  risks: Risk[];
  riskScore: number; // 0-100
  
  // Альтернативы
  alternatives: Alternative[];
  
  // Метаданные
  confidence: ConfidenceLevel;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
  successRate: number; // 0.0 - 1.0
  
  // Контекст применения
  applicableContexts: string[];
  incompatibleWith: string[];
  
  // Источники и ссылки
  sources: Source[];
  documentation: string[];
}

/**
 * Пример кода для паттерна
 */
export interface CodeExample {
  language: string;
  code: string;
  description: string;
  filename?: string;
  isComplete: boolean;
  dependencies?: string[];
}

/**
 * Описание риска
 */
export interface Risk {
  id: string;
  level: RiskLevel;
  category: string;
  description: string;
  impact: string;
  likelihood: number; // 0.0 - 1.0
  mitigation: string[];
  examples?: string[];
}

/**
 * Альтернативное решение
 */
export interface Alternative {
  id: string;
  name: string;
  technology: string;
  description: string;
  migrationComplexity: 'low' | 'medium' | 'high';
  migrationSteps: string[];
  pros: string[];
  cons: string[];
  whenToUse: string;
}

/**
 * Источник информации
 */
export interface Source {
  type: 'documentation' | 'blog' | 'github' | 'stackoverflow' | 'expert';
  url: string;
  title: string;
  author?: string;
  date?: Date;
  reliability: ConfidenceLevel;
}

/**
 * Контекст анализа технологии
 */
export interface TechAnalysisContext {
  task: string;
  technology: string;
  existingCode?: string;
  projectType?: string;
  teamExperience?: 'junior' | 'middle' | 'senior';
  timeline?: string;
  constraints?: string[];
  preferences?: string[];
}

/**
 * Результат анализа технологии
 */
export interface TechAnalysisResult {
  success: boolean;
  technology: string;
  overallRiskScore: number;
  confidence: ConfidenceLevel;
  
  // Найденные паттерны и антипаттерны
  recommendedPatterns: TechPattern[];
  detectedAntipatterns: DetectedAntipattern[];
  
  // Рекомендации
  suggestions: Suggestion[];
  alternatives: Alternative[];
  
  // Метрики
  analysisTime: number;
  patternsChecked: number;
  
  // Дополнительная информация
  warnings: Warning[];
  notes: string[];
}

/**
 * Обнаруженный антипаттерн в коде
 */
export interface DetectedAntipattern {
  pattern: TechPattern;
  location?: CodeLocation;
  severity: RiskLevel;
  description: string;
  suggestedFix: string;
  autoFixable: boolean;
}

/**
 * Местоположение в коде
 */
export interface CodeLocation {
  file?: string;
  line?: number;
  column?: number;
  snippet: string;
}

/**
 * Рекомендация по улучшению
 */
export interface Suggestion {
  id: string;
  type: 'security' | 'performance' | 'maintainability' | 'best_practice';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  implementation: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  benefits: string[];
  relatedPatterns: string[]; // pattern IDs
}

/**
 * Предупреждение
 */
export interface Warning {
  level: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  suggestion?: string;
}

/**
 * Конфигурация валидации
 */
export interface ValidationConfig {
  strictMode: boolean;
  enabledCategories: PatternCategory[];
  riskThreshold: number; // 0-100
  confidenceThreshold: ConfidenceLevel;
  customRules?: CustomRule[];
}

/**
 * Пользовательское правило
 */
export interface CustomRule {
  id: string;
  name: string;
  description: string;
  pattern: RegExp | string;
  severity: RiskLevel;
  message: string;
  fix?: string;
}

/**
 * Результат валидации кода
 */
export interface ValidationResult {
  success: boolean;
  valid: boolean;
  score: number; // 0-100
  
  issues: ValidationIssue[];
  fixes: SuggestedFix[];
  
  metrics: {
    linesAnalyzed: number;
    patternsChecked: number;
    issuesFound: number;
    criticalIssues: number;
    analysisTime: number;
  };
}

/**
 * Проблема валидации
 */
export interface ValidationIssue {
  id: string;
  severity: RiskLevel;
  category: PatternCategory;
  message: string;
  location: CodeLocation;
  rule: string;
  pattern?: TechPattern;
}

/**
 * Предложение по исправлению
 */
export interface SuggestedFix {
  issueId: string;
  type: 'replace' | 'insert' | 'delete' | 'refactor';
  description: string;
  oldCode: string;
  newCode: string;
  confidence: ConfidenceLevel;
  automated: boolean;
}

/**
 * Статистика использования паттернов
 */
export interface PatternUsageStats {
  patternId: string;
  technology: string;
  totalUsage: number;
  successfulUsage: number;
  failedUsage: number;
  averageRating: number;
  lastUsed: Date;
  trendingScore: number;
}

/**
 * Обратная связь по паттерну
 */
export interface PatternFeedback {
  patternId: string;
  userId?: string;
  rating: number; // 1-5
  success: boolean;
  context: {
    project?: string;
    technology?: string;
    teamSize?: number;
    timeline?: string;
  };
  comments?: string;
  suggestions?: string;
  timestamp: Date;
}

/**
 * Конфигурация базы знаний
 */
export interface KnowledgeBaseConfig {
  dataPath: string;
  cacheSize: number;
  autoUpdate: boolean;
  updateInterval: number; // minutes
  sources: {
    github?: GitHubSourceConfig;
    documentation?: DocumentationSourceConfig;
    community?: CommunitySourceConfig;
  };
}

/**
 * Конфигурация источника GitHub
 */
export interface GitHubSourceConfig {
  enabled: boolean;
  repositories: string[];
  accessToken?: string;
  updateFrequency: number; // hours
}

/**
 * Конфигурация источника документации
 */
export interface DocumentationSourceConfig {
  enabled: boolean;
  sources: {
    url: string;
    technology: string;
    parser: string;
  }[];
}

/**
 * Конфигурация сообщества
 */
export interface CommunitySourceConfig {
  enabled: boolean;
  platforms: ('stackoverflow' | 'reddit' | 'discord')[];
  minScore: number;
}

/**
 * Событие системы TSI
 */
export interface TSIEvent {
  type: 'pattern_used' | 'validation_performed' | 'feedback_received' | 'pattern_updated';
  timestamp: Date;
  data: any;
  userId?: string;
  sessionId?: string;
}

/**
 * Метрики производительности TSI
 */
export interface TSIMetrics {
  totalPatterns: number;
  technologiesCovered: number;
  dailyChecks: number;
  antipatternsDetected: number;
  successRate: number;
  averageResponseTime: number;
  cacheHitRate: number;
  errorRate: number;
}

/**
 * Интерфейс для работы с базой знаний
 */
export interface IKnowledgeBase {
  // Инициализация
  initialize(): Promise<void>;
  
  // Поиск паттернов
  findPatterns(criteria: PatternSearchCriteria): Promise<TechPattern[]>;
  getPattern(id: string): Promise<TechPattern | null>;
  
  // Управление паттернами
  addPattern(pattern: TechPattern): Promise<void>;
  updatePattern(id: string, updates: Partial<TechPattern>): Promise<void>;
  deletePattern(id: string): Promise<void>;
  
  // Статистика
  getUsageStats(patternId: string): Promise<PatternUsageStats>;
  recordUsage(patternId: string, success: boolean): Promise<void>;
  
  // Обратная связь
  addFeedback(feedback: PatternFeedback): Promise<void>;
  getFeedback(patternId: string): Promise<PatternFeedback[]>;
}

/**
 * Критерии поиска паттернов
 */
export interface PatternSearchCriteria {
  technology?: string;
  category?: PatternCategory;
  type?: PatternType;
  riskLevel?: RiskLevel;
  tags?: string[];
  minConfidence?: ConfidenceLevel;
  maxRiskScore?: number;
  limit?: number;
  offset?: number;
}

/**
 * Интерфейс рекомендательного движка
 */
export interface IRecommendationEngine {
  getRecommendations(context: TechAnalysisContext): Promise<TechAnalysisResult>;
  analyzeCode(code: string, technology: string): Promise<DetectedAntipattern[]>;
  suggestAlternatives(technology: string, context: TechAnalysisContext): Promise<Alternative[]>;
}

/**
 * Интерфейс валидатора безопасности
 */
export interface ISafetyValidator {
  validate(code: string, technology: string, config?: ValidationConfig): Promise<ValidationResult>;
  checkPattern(code: string, pattern: TechPattern): Promise<boolean>;
  generateFixes(issues: ValidationIssue[]): Promise<SuggestedFix[]>;
}

/**
 * Интерфейс реестра паттернов
 */
export interface IPatternRegistry {
  // Инициализация
  initialize(): Promise<void>;
  
  register(pattern: TechPattern): Promise<void>;
  unregister(id: string): Promise<void>;
  list(criteria?: PatternSearchCriteria): Promise<TechPattern[]>;
  get(id: string): Promise<TechPattern | null>;
  update(id: string, updates: Partial<TechPattern>): Promise<void>;
  
  // Версионирование
  createVersion(id: string, version: string): Promise<void>;
  getVersions(id: string): Promise<string[]>;
  getVersion(id: string, version: string): Promise<TechPattern | null>;
}

/**
 * Основной интерфейс TSI системы
 */
export interface ITSISystem {
  knowledgeBase: IKnowledgeBase;
  recommendationEngine: IRecommendationEngine;
  safetyValidator: ISafetyValidator;
  patternRegistry: IPatternRegistry;
  
  // Основные методы
  checkTechStack(context: TechAnalysisContext): Promise<TechAnalysisResult>;
  getPatterns(technology: string, category?: PatternCategory): Promise<TechPattern[]>;
  validateImplementation(code: string, technology: string, config?: ValidationConfig): Promise<ValidationResult>;
  
  // Управление
  initialize(config: KnowledgeBaseConfig): Promise<void>;
  updateKnowledge(): Promise<void>;
  getMetrics(): Promise<TSIMetrics>;
  
  // События
  on(event: string, callback: (data: TSIEvent) => void): void;
  emit(event: string, data: TSIEvent): void;
}

// Экспорт всех типов для удобства
export * from './types.js';
