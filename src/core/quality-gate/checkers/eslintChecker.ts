import { createLogger } from '../../utils/logger.js';
const log = createLogger('[eslintChecker]');
/**
 * M7 Quality Gate - ESLint Checker
 * 
 * Использует ESLint Node.js API для линтинга кода
 * ESLint — опциональная зависимость
 */

import {
  QualityIssue,
  ICodeChecker,
  IssueCategory,
  ESLINT_SYNTAX_RULES,
  ESLINT_LOGIC_RULES,
} from '../types.js';

// ESLint types — использовать any для опциональной зависимости
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ESLintInstance = any;

interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  fix?: {
    range: [number, number];
    text: string;
  };
}

export class ESLintChecker implements ICodeChecker {
  name = 'ESLint';
  available = false;
  
  private eslint: ESLintInstance | null = null;
  private initPromise: Promise<void> | null = null;
  
  constructor() {
    // Ленивая инициализация при первом использовании
  }
  
  private async init(): Promise<void> {
    if (this.eslint) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      try {
        // Динамический импорт ESLint (опциональная зависимость)
        // @ts-expect-error - ESLint is optional dependency
        const eslintModule = await import('eslint');
        const ESLint = eslintModule.ESLint;
        
        this.eslint = new ESLint({
          overrideConfigFile: true,
          overrideConfig: {
            languageOptions: {
              ecmaVersion: 2022,
              sourceType: 'module',
            },
            rules: {
              // Базовые правила для проверки
              'semi': 'error',
              'quotes': ['error', 'single'],
              'no-unused-vars': 'warn',
              'no-trailing-spaces': 'error',
              'eol-last': 'error',
              'no-constant-condition': 'warn',
            },
          },
          fix: true,
        });
        
        this.available = true;
        log.debug('ESLintChecker] Initialized successfully');
      } catch (error) {
        log.warn('ESLintChecker] ESLint not available:', error instanceof Error ? error.message : String(error));
        this.available = false;
      }
    })();
    
    return this.initPromise;
  }
  
  async check(code: string, filePath: string): Promise<QualityIssue[]> {
    await this.init();
    
    if (!this.eslint || !this.available) {
      log.warn('ESLintChecker] Skipping - ESLint not available');
      return [];
    }
    
    try {
      const results = await this.eslint.lintText(code, { filePath });
      
      if (results.length === 0) {
        return [];
      }
      
      const [result] = results;
      
      return result.messages.map((msg: LintMessage) => this.convertMessage(msg, filePath, result.output));
    } catch (error) {
      log.debug('ESLintChecker] Error:', error);
      return [{
        id: 'eslint_checker_error',
        source: 'eslint',
        severity: 'warning',
        category: 'unknown',
        file: filePath,
        line: 1,
        column: 1,
        code: 'ESLINT_CHECKER_ERROR',
        message: `ESLint checker failed: ${error instanceof Error ? error.message : String(error)}`,
        fixable: false,
      }];
    }
  }
  
  private convertMessage(msg: LintMessage, filePath: string, _fixedOutput?: string): QualityIssue {
    const ruleId = msg.ruleId || 'unknown';
    
    return {
      id: `eslint_${ruleId}_${msg.line}_${msg.column}`,
      source: 'eslint',
      severity: msg.severity === 2 ? 'error' : 'warning',
      category: this.classifyRule(ruleId),
      file: filePath,
      line: msg.line,
      column: msg.column,
      code: ruleId,
      message: msg.message,
      fixable: !!msg.fix,
      fix: msg.fix ? {
        range: msg.fix.range as [number, number],
        text: msg.fix.text,
      } : undefined,
    };
  }
  
  private classifyRule(ruleId: string): IssueCategory {
    // Проверяем точное совпадение или совпадение с namespace
    for (const rule of ESLINT_SYNTAX_RULES) {
      if (ruleId === rule || ruleId.endsWith(`/${rule}`)) {
        return 'syntax';
      }
    }
    
    for (const rule of ESLINT_LOGIC_RULES) {
      if (ruleId === rule || ruleId.endsWith(`/${rule}`)) {
        return 'logic';
      }
    }
    
    // По умолчанию считаем style
    return 'style';
  }
}
