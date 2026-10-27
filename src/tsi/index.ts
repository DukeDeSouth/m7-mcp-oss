import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[TSI]');

/**
 * M7 Tech Safety Intelligence (TSI) - Main Export
 * Экспорт всех компонентов TSI системы
 */

// Основная система
export { TSISystem } from './tsiSystem.js';

// Основные типы и интерфейсы
export * from './core/types.js';

// Основные компоненты
export { KnowledgeBase } from './core/knowledgeBase.js';
export { PatternRegistry } from './core/patternRegistry.js';

// Движки
export { RecommendationEngine } from './engine/recommendationEngine.js';
export { ContextAnalyzer } from './engine/contextAnalyzer.js';

// Валидаторы
export { SafetyValidator } from './validator/safetyValidator.js';
export { PatternMatcher } from './validator/patternMatcher.js';

// MCP Tools
export { checkTechStackTool } from './tools/checkTechStack.js';
export { getPatternsTool } from './tools/getPatterns.js';
export { validateImplementationTool } from './tools/validateImplementation.js';

// Утилиты для создания TSI системы
export function createTSISystem(config?: any): any {
  const { TSISystem } = require('./tsiSystem.js');
  return new TSISystem(config);
}

// Версия TSI
export const TSI_VERSION = '1.0.0';

// Поддерживаемые технологии (базовый набор)
export const SUPPORTED_TECHNOLOGIES = [
  'javascript',
  'typescript',
  'react',
  'vue',
  'angular',
  'nodejs',
  'express',
  'python',
  'django',
  'flask',
  'java',
  'spring',
  'go',
  'rust',
  'docker',
  'kubernetes',
  'postgresql',
  'mongodb',
  'redis',
  'aws',
  'azure',
  'gcp'
];

// Поддерживаемые категории паттернов
export const PATTERN_CATEGORIES = [
  'security',
  'performance', 
  'architecture',
  'testing',
  'deployment',
  'maintenance',
  'defensive'
];

// Уровни риска
export const RISK_LEVELS = [
  'low',
  'medium', 
  'high',
  'critical'
];

// Конфигурация по умолчанию
export const DEFAULT_TSI_CONFIG = {
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

// Валидационная конфигурация по умолчанию
export const DEFAULT_VALIDATION_CONFIG = {
  strictMode: false,
  enabledCategories: ['security', 'performance', 'architecture'],
  riskThreshold: 50,
  confidenceThreshold: 0.7,
  customRules: []
};

// Утилитарные функции
export function isTechnologySupported(technology: string): boolean {
  return SUPPORTED_TECHNOLOGIES.includes(technology.toLowerCase());
}

export function isValidPatternCategory(category: string): boolean {
  return PATTERN_CATEGORIES.includes(category as any);
}

export function isValidRiskLevel(level: string): boolean {
  return RISK_LEVELS.includes(level as any);
}

export function validateTSIConfig(config: any): boolean {
  try {
    // Базовая валидация конфигурации
    if (!config || typeof config !== 'object') {
      return false;
    }
    
    if (config.dataPath && typeof config.dataPath !== 'string') {
      return false;
    }
    
    if (config.cacheSize && (typeof config.cacheSize !== 'number' || config.cacheSize < 1)) {
      return false;
    }
    
    if (config.updateInterval && (typeof config.updateInterval !== 'number' || config.updateInterval < 1)) {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

// Хелперы для работы с паттернами
export function createPattern(data: Partial<any>): any {
  const now = new Date();
  
  return {
    id: data.id || `pattern-${Date.now()}`,
    name: data.name || 'Unnamed Pattern',
    technology: data.technology || 'unknown',
    category: data.category || 'architecture',
    type: data.type || 'pattern',
    description: data.description || '',
    implementation: data.implementation || [],
    risks: data.risks || [],
    riskScore: data.riskScore || 0,
    alternatives: data.alternatives || [],
    confidence: data.confidence || 0.5,
    tags: data.tags || [],
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    successRate: 0,
    applicableContexts: data.applicableContexts || [],
    incompatibleWith: data.incompatibleWith || [],
    sources: data.sources || [],
    documentation: data.documentation || []
  };
}

export function createValidationConfig(overrides: Partial<any> = {}): any {
  return {
    ...DEFAULT_VALIDATION_CONFIG,
    ...overrides
  };
}

export function createTSIConfig(overrides: Partial<any> = {}): any {
  return {
    ...DEFAULT_TSI_CONFIG,
    ...overrides
  };
}

// Константы для MCP tools
export const TSI_TOOL_NAMES = {
  CHECK_TECH_STACK: 'mcp_m7_check_tech_stack',
  GET_PATTERNS: 'mcp_m7_get_patterns', 
  VALIDATE_IMPLEMENTATION: 'mcp_m7_validate_implementation'
};

// Импортируем tools для экспорта
import { checkTechStackTool } from './tools/checkTechStack.js';
import { getPatternsTool } from './tools/getPatterns.js';
import { validateImplementationTool } from './tools/validateImplementation.js';

// Экспорт всех MCP tools как массив
export const TSI_MCP_TOOLS = [
  checkTechStackTool,
  getPatternsTool,
  validateImplementationTool
];

// Информация о TSI системе
export const TSI_INFO = {
  name: 'M7 Tech Safety Intelligence',
  version: TSI_VERSION,
  description: 'AI-powered technology safety and pattern analysis system',
  author: 'M7 Development Team',
  license: 'MIT',
  repository: 'https://github.com/m7-mcp/tech-safety-intelligence',
  documentation: 'https://docs.m7.dev/tsi',
  supportedTechnologies: SUPPORTED_TECHNOLOGIES.length,
  patternCategories: PATTERN_CATEGORIES.length,
  features: [
    'Technology stack safety analysis',
    'Pattern and antipattern detection',
    'Code validation and suggestions',
    'Risk assessment and mitigation',
    'Alternative technology recommendations',
    'Context-aware analysis',
    'Extensible pattern database',
    'MCP integration'
  ]
};

// Логирование при импорте модуля (используем stderr чтобы не ломать MCP протокол)
log.debug(`TSI] 🛡️ M7 Tech Safety Intelligence v${TSI_VERSION} loaded`);
log.debug(`TSI] 📊 Supporting ${SUPPORTED_TECHNOLOGIES.length} technologies`);
log.debug(`TSI] 🏷️ ${PATTERN_CATEGORIES.length} pattern categories available`);
log.debug(`TSI] 🔧 ${TSI_MCP_TOOLS.length} MCP tools registered`);

// Импортируем TSISystem для default export
import { TSISystem as TSISystemClass } from './tsiSystem.js';
export default TSISystemClass;
