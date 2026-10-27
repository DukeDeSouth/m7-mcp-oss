/**
 * M7 v3.0 - Style Guardian Agent Types
 * 
 * AST-based code style analysis, learning, and validation
 */

// ============================================
// STYLE PATTERN TYPES
// ============================================

export type NamingConvention = 
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'UPPER_SNAKE_CASE'
  | 'kebab-case'
  | '_prefixed'
  | 'mixed';

export type CodeElement =
  | 'variable'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'constant'
  | 'parameter'
  | 'property'
  | 'method'
  | 'enum'
  | 'enumMember';

export interface NamingPattern {
  element: CodeElement;
  convention: NamingConvention;
  confidence: number;
  examples: string[];
  exceptions: string[];
}

export interface ImportPattern {
  style: 'named' | 'default' | 'namespace' | 'mixed';
  barrelFiles: boolean;
  pathAlias: string | null; // e.g., '@/', '~/'
  grouping: 'none' | 'type' | 'source';
  confidence: number;
}

export interface AsyncPattern {
  style: 'async-await' | 'promises' | 'callbacks' | 'mixed';
  errorHandling: 'try-catch' | 'catch-chain' | 'none';
  confidence: number;
}

export interface ErrorHandlingPattern {
  style: 'custom-errors' | 'native-errors' | 'error-codes' | 'mixed';
  customErrorClasses: string[];
  loggingStyle: 'console' | 'logger' | 'none';
  confidence: number;
}

export interface FormattingPattern {
  indentation: 'tabs' | 'spaces';
  indentSize: number;
  quotes: 'single' | 'double';
  semicolons: boolean;
  trailingComma: 'none' | 'es5' | 'all';
  lineWidth: number;
  confidence: number;
}

export interface DocumentationPattern {
  style: 'jsdoc' | 'tsdoc' | 'inline' | 'none';
  requiredFor: CodeElement[];
  paramDescriptions: boolean;
  returnDescriptions: boolean;
  confidence: number;
}

// ============================================
// ANTI-PATTERNS
// ============================================

export interface AntiPattern {
  id: string;
  name: string;
  description: string;
  pattern: string; // regex or AST pattern
  severity: 'error' | 'warning' | 'info';
  suggestion: string;
  examples: {
    bad: string;
    good: string;
  };
  enabled: boolean;
  occurrences: number;
}

export const DEFAULT_ANTI_PATTERNS: AntiPattern[] = [
  {
    id: 'any-type',
    name: 'Any Type Usage',
    description: 'Avoid using "any" type in TypeScript',
    pattern: ': any',
    severity: 'warning',
    suggestion: 'Use specific types or "unknown" instead',
    examples: {
      bad: 'function process(data: any) {}',
      good: 'function process(data: unknown) {}'
    },
    enabled: true,
    occurrences: 0
  },
  {
    id: 'console-log',
    name: 'Console Log in Production',
    description: 'Avoid console.log in production code',
    pattern: 'console\\.log\\(',
    severity: 'warning',
    suggestion: 'Use a proper logging library or remove debug logs',
    examples: {
      bad: 'log.debug("debug:", data);',
      good: 'logger.debug("Processing data", { data });'
    },
    enabled: true,
    occurrences: 0
  },
  {
    id: 'nested-ternary',
    name: 'Nested Ternary Operators',
    description: 'Avoid nested ternary operators (>2 levels)',
    pattern: '\\?[^:]+\\?[^:]+\\?',
    severity: 'error',
    suggestion: 'Use if-else statements or switch for complex logic',
    examples: {
      bad: 'const x = a ? b ? c : d : e;',
      good: 'if (a) { return b ? c : d; } return e;'
    },
    enabled: true,
    occurrences: 0
  },
  {
    id: 'default-export',
    name: 'Default Export',
    description: 'Prefer named exports over default exports',
    pattern: 'export default',
    severity: 'info',
    suggestion: 'Use named exports for better refactoring support',
    examples: {
      bad: 'export default function handler() {}',
      good: 'export function handler() {}'
    },
    enabled: false, // Often project-specific
    occurrences: 0
  },
  {
    id: 'magic-number',
    name: 'Magic Numbers',
    description: 'Avoid magic numbers without explanation',
    pattern: '(?<!\\w)(\\d{2,})(?!\\d)',
    severity: 'info',
    suggestion: 'Extract to named constants with meaningful names',
    examples: {
      bad: 'if (items.length > 100) {}',
      good: 'const MAX_ITEMS = 100; if (items.length > MAX_ITEMS) {}'
    },
    enabled: true,
    occurrences: 0
  },
  {
    id: 'empty-catch',
    name: 'Empty Catch Block',
    description: 'Catch blocks should not be empty',
    pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
    severity: 'error',
    suggestion: 'Log the error or handle it appropriately',
    examples: {
      bad: 'try { x() } catch (e) {}',
      good: 'try { x() } catch (e) { logger.error(e); }'
    },
    enabled: true,
    occurrences: 0
  }
];

// ============================================
// STYLE PROFILE
// ============================================

export interface StyleProfile {
  projectId: string;
  projectPath: string;
  createdAt: Date;
  updatedAt: Date;
  filesAnalyzed: number;
  
  // Naming conventions
  naming: NamingPattern[];
  
  // Code patterns
  imports: ImportPattern;
  async: AsyncPattern;
  errorHandling: ErrorHandlingPattern;
  formatting: FormattingPattern;
  documentation: DocumentationPattern;
  
  // Anti-patterns
  antiPatterns: AntiPattern[];
  
  // Custom rules (learned from corrections)
  customRules: CustomStyleRule[];
  
  // Statistics
  confidence: number; // Overall confidence in learned patterns
  learningRate: number; // How fast patterns are being learned
}

export interface CustomStyleRule {
  id: string;
  name: string;
  description: string;
  pattern: string;
  replacement?: string;
  learnedFrom: 'correction' | 'codeReview' | 'manual';
  confidence: number;
  occurrences: number;
  createdAt: Date;
  lastUsed: Date;
}

// ============================================
// STYLE VIOLATION
// ============================================

export interface StyleViolation {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  code: string;
  suggestion?: string;
  autoFixable: boolean;
  fix?: {
    range: [number, number];
    text: string;
  };
}

export interface ValidationResult {
  file: string;
  violations: StyleViolation[];
  score: number; // 0-100, compliance score
  passedRules: number;
  failedRules: number;
  processingTime: number;
}

// ============================================
// LEARNING TYPES
// ============================================

export interface StyleCorrection {
  id: string;
  original: string;
  corrected: string;
  file: string;
  timestamp: Date;
  context: string;
  ruleExtracted?: string;
  confidence: number;
}

export interface LearningEvent {
  type: 'correction' | 'approval' | 'rejection';
  patternId: string;
  confidence: number;
  timestamp: Date;
  context: string;
}

// ============================================
// CONFIGURATION
// ============================================

export interface StyleGuardianConfig {
  enabled: boolean;
  strictMode: boolean;
  autoLearn: boolean;
  
  // Analysis settings
  minFilesForPattern: number;
  confidenceThreshold: number;
  
  // Validation settings
  validateOnGeneration: boolean;
  blockOnError: boolean;
  
  // Learning settings
  learningRate: number;
  maxCustomRules: number;
  
  // Collections
  chromaCollection: string;
  
  // Ignore patterns
  ignorePatterns: string[];
  ignoreFiles: string[];
}

export const DEFAULT_STYLE_GUARDIAN_CONFIG: StyleGuardianConfig = {
  enabled: true,
  strictMode: false,
  autoLearn: true,
  
  minFilesForPattern: 5,
  confidenceThreshold: 0.7,
  
  validateOnGeneration: true,
  blockOnError: false,
  
  learningRate: 0.1,
  maxCustomRules: 100,
  
  chromaCollection: 'm7_style_patterns',
  
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '**/*.min.js',
    '**/*.d.ts'
  ],
  ignoreFiles: [
    'package-lock.json',
    'yarn.lock'
  ]
};

// ============================================
// AST NODE TYPES (simplified)
// ============================================

export interface ASTNode {
  type: string;
  name?: string;
  start: number;
  end: number;
  children?: ASTNode[];
  parent?: ASTNode;
}

export interface AnalysisContext {
  filePath: string;
  content: string;
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx';
  ast?: ASTNode;
}

