/**
 * M7 Quality Gate - Types and Interfaces
 * 
 * Автоматическая проверка качества кода с классификацией ошибок
 */

// ============================================
// ENUMS & BASIC TYPES
// ============================================

/** Severity уровни */
export type IssueSeverity = 'error' | 'warning' | 'info';

/** Классификация проблемы */
export type IssueCategory = 'syntax' | 'logic' | 'style' | 'unknown';

/** Источник проблемы */
export type IssueSource = 'eslint' | 'typescript' | 'style';

// ============================================
// ISSUE TYPES
// ============================================

/** Информация о fix */
export interface IssueFix {
  range: [number, number];
  text: string;
}

/** Одна проблема качества кода */
export interface QualityIssue {
  id: string;
  source: IssueSource;
  severity: IssueSeverity;
  category: IssueCategory;
  
  // Локация
  file: string;
  line: number;
  column: number;
  
  // Сообщение
  code: string;            // Правило ESLint или код TS ошибки
  message: string;
  
  // Auto-fix
  fixable: boolean;
  fix?: IssueFix;
}

// ============================================
// RESULT TYPES
// ============================================

/** Результат проверки Quality Gate */
export interface QualityCheckResult {
  /** Успешно ли выполнилась проверка */
  success: boolean;
  
  /** Прошёл ли код проверку (нет критических ошибок) */
  pass: boolean;
  
  // Статистика
  totalIssues: number;
  syntaxIssues: number;
  logicIssues: number;
  fixedIssues: number;
  
  // Детали
  issues: QualityIssue[];
  iterations: number;
  
  // Финальный код (после auto-fix)
  fixedCode?: string;
  
  // Время
  duration: number;
}

/** Классифицированные issues */
export interface ClassifiedIssues {
  syntax: QualityIssue[];
  logic: QualityIssue[];
  style: QualityIssue[];
  unknown: QualityIssue[];
}

// ============================================
// CONFIGURATION
// ============================================

/** Конфигурация Quality Gate */
export interface QualityGateConfig {
  /** Max retry attempts (default: 2) */
  maxRetries: number;
  
  /** Auto-fix syntax errors (default: true) */
  autoFixSyntax: boolean;
  
  /** Auto-fix style issues (default: true) */
  autoFixStyle: boolean;
  
  /** Stop on logic errors (default: true) */
  stopOnLogicError: boolean;
  
  /** Timeout in ms (default: 30000) */
  timeout: number;
  
  /** ESLint rules to ignore */
  ignoredRules: string[];
  
  /** TypeScript error codes to ignore */
  ignoredCodes: string[];
  
  /** Use ESLint (default: true if available) */
  useEslint: boolean;
  
  /** Use TypeScript checker (default: true) */
  useTypescript: boolean;
}

/** Default configuration */
export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  maxRetries: 2,
  autoFixSyntax: true,
  autoFixStyle: true,
  stopOnLogicError: true,
  timeout: 30000,
  ignoredRules: [],
  ignoredCodes: [],
  useEslint: true,
  useTypescript: true,
};

// ============================================
// CHECKER INTERFACES
// ============================================

/** Interface для checker-ов */
export interface ICodeChecker {
  /** Название checker-а */
  name: string;
  
  /** Доступен ли checker */
  available: boolean;
  
  /** Проверить код */
  check(code: string, filePath: string): Promise<QualityIssue[]>;
}

// ============================================
// CLASSIFICATION RULES
// ============================================

/** ESLint rules that are syntax-related (auto-fixable) */
export const ESLINT_SYNTAX_RULES = [
  'semi',
  'quotes',
  'indent',
  'no-trailing-spaces',
  'comma-dangle',
  'eol-last',
  'no-multi-spaces',
  'no-multiple-empty-lines',
  'space-before-blocks',
  'keyword-spacing',
  'object-curly-spacing',
  'array-bracket-spacing',
  '@typescript-eslint/semi',
  '@typescript-eslint/quotes',
  '@typescript-eslint/indent',
  '@typescript-eslint/no-unused-vars',
  '@typescript-eslint/member-delimiter-style',
];

/** ESLint rules that are logic-related (require human) */
export const ESLINT_LOGIC_RULES = [
  'no-constant-condition',
  'no-unreachable',
  'no-unsafe-finally',
  'no-unsafe-return',
  'no-unsafe-assignment',
  'no-unsafe-member-access',
  'no-unsafe-call',
  'no-unsafe-argument',
  '@typescript-eslint/no-unsafe-return',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-argument',
];

/** TypeScript error codes that are syntax-related (auto-fixable) */
export const TS_SYNTAX_CODES = [
  1005,  // Expected token
  1002,  // Unterminated string
  1003,  // Identifier expected
  1009,  // Trailing comma not allowed
  1109,  // Expression expected
  1128,  // Declaration or statement expected
  1160,  // Unterminated template literal
  2304,  // Cannot find name (usually missing import)
  2307,  // Cannot find module
];

/** TypeScript error codes that are logic-related (require human) */
export const TS_LOGIC_CODES = [
  2322,  // Type X is not assignable to type Y
  2339,  // Property does not exist on type
  2345,  // Argument of type X is not assignable
  2532,  // Object is possibly 'undefined'
  2531,  // Object is possibly 'null'
  2571,  // Object is of type 'unknown'
  7006,  // Parameter implicitly has 'any' type
  7031,  // Binding element implicitly has 'any' type
  7053,  // Element implicitly has 'any' type
  2554,  // Expected X arguments, but got Y
  2555,  // Expected at least X arguments
];
