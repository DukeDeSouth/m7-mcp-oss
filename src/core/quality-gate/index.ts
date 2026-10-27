/**
 * M7 Quality Gate - Main Export
 * 
 * Автоматическая проверка качества кода после генерации
 */

// Main class
export { QualityGate } from './qualityGate.js';

// Types
export {
  // Basic types
  IssueSeverity,
  IssueCategory,
  IssueSource,
  IssueFix,
  QualityIssue,
  
  // Result types
  QualityCheckResult,
  ClassifiedIssues,
  
  // Config
  QualityGateConfig,
  DEFAULT_QUALITY_GATE_CONFIG,
  
  // Checker interface
  ICodeChecker,
  
  // Classification rules
  ESLINT_SYNTAX_RULES,
  ESLINT_LOGIC_RULES,
  TS_SYNTAX_CODES,
  TS_LOGIC_CODES,
} from './types.js';

// Checkers
export { ESLintChecker } from './checkers/eslintChecker.js';
export { TypeScriptChecker } from './checkers/typescriptChecker.js';

// Classifier
export { IssueClassifier } from './classifier/issueClassifier.js';

// Fixer
export { AutoFixer, type FixResult } from './fixer/autoFixer.js';
