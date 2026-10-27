import { createLogger } from '../utils/logger.js';
const log = createLogger('[qualityGate]');
/**
 * M7 Quality Gate - Main Class
 * 
 * Автоматическая проверка качества кода с:
 * - ESLint + TypeScript checking
 * - Классификацией Syntax vs Logic
 * - Auto-fix только для syntax issues
 * - Max retry ограничением
 */

import { ESLintChecker } from './checkers/eslintChecker.js';
import { TypeScriptChecker } from './checkers/typescriptChecker.js';
import { IssueClassifier } from './classifier/issueClassifier.js';
import { AutoFixer } from './fixer/autoFixer.js';
import {
  QualityIssue,
  QualityCheckResult,
  QualityGateConfig,
  DEFAULT_QUALITY_GATE_CONFIG,
} from './types.js';

export class QualityGate {
  private eslint: ESLintChecker;
  private typescript: TypeScriptChecker;
  private classifier: IssueClassifier;
  private fixer: AutoFixer;
  private config: QualityGateConfig;
  
  constructor(config: Partial<QualityGateConfig> = {}) {
    this.eslint = new ESLintChecker();
    this.typescript = new TypeScriptChecker();
    this.classifier = new IssueClassifier();
    this.fixer = new AutoFixer();
    this.config = {
      ...DEFAULT_QUALITY_GATE_CONFIG,
      ...config,
    };
  }
  
  /**
   * Проверить код через Quality Gate
   */
  async check(code: string, filePath: string): Promise<QualityCheckResult> {
    const startTime = Date.now();
    let currentCode = code;
    let iteration = 0;
    let totalFixed = 0;
    
    log.debug(`QualityGate] Starting check for ${filePath}`);
    log.debug(`QualityGate] Config: maxRetries=${this.config.maxRetries}, autoFixSyntax=${this.config.autoFixSyntax}`);
    
    // Main loop with retry
    while (iteration <= this.config.maxRetries) {
      iteration++;
      log.debug(`QualityGate] Iteration ${iteration}/${this.config.maxRetries + 1}`);
      
      // Run all checkers in parallel
      const allIssues = await this.runCheckers(currentCode, filePath);
      
      // Filter ignored rules/codes
      const filteredIssues = this.filterIgnored(allIssues);
      
      // Get classified issues
      const classified = this.classifier.classify(filteredIssues);
      
      log.debug(`QualityGate] Found: ${filteredIssues.length} issues (syntax: ${classified.syntax.length}, logic: ${classified.logic.length})`);
      
      // Check for blocking issues (logic errors)
      const blockingIssues = this.classifier.getBlockingIssues(filteredIssues);
      
      if (blockingIssues.length > 0 && this.config.stopOnLogicError) {
        log.debug(`QualityGate] ❌ STOP: ${blockingIssues.length} blocking issues found`);
        
        return {
          success: true,
          pass: false,
          totalIssues: filteredIssues.length,
          syntaxIssues: classified.syntax.length,
          logicIssues: classified.logic.length,
          fixedIssues: totalFixed,
          issues: filteredIssues,
          iterations: iteration,
          fixedCode: currentCode,
          duration: Date.now() - startTime,
        };
      }
      
      // If no issues, we're done!
      if (filteredIssues.length === 0) {
        log.debug(`QualityGate] ✅ PASS: No issues found`);
        
        return {
          success: true,
          pass: true,
          totalIssues: 0,
          syntaxIssues: 0,
          logicIssues: 0,
          fixedIssues: totalFixed,
          issues: [],
          iterations: iteration,
          fixedCode: currentCode,
          duration: Date.now() - startTime,
        };
      }
      
      // Try to auto-fix if not last iteration
      if (this.config.autoFixSyntax && iteration <= this.config.maxRetries) {
        const canFix = this.classifier.canAutoFix(filteredIssues);
        
        if (canFix) {
          const fixResult = this.fixer.applyFixes(currentCode, filteredIssues);
          
          if (fixResult.appliedFixes > 0) {
            currentCode = fixResult.fixed;
            totalFixed += fixResult.appliedFixes;
            log.debug(`QualityGate] 🔧 Applied ${fixResult.appliedFixes} fixes, retrying...`);
            continue; // Retry with fixed code
          }
        } else {
          log.debug(`QualityGate] Cannot auto-fix: logic errors or unfixable issues present`);
        }
      }
      
      // Can't fix more, exit loop
      break;
    }
    
    // Final check
    const finalIssues = await this.runCheckers(currentCode, filePath);
    const filteredFinal = this.filterIgnored(finalIssues);
    const classifiedFinal = this.classifier.classify(filteredFinal);
    
    const hasErrors = filteredFinal.some(i => i.severity === 'error' && !i.fixable);
    
    log.debug(`QualityGate] Final result: ${filteredFinal.length} issues, pass: ${!hasErrors}`);
    
    return {
      success: true,
      pass: !hasErrors,
      totalIssues: filteredFinal.length,
      syntaxIssues: classifiedFinal.syntax.length,
      logicIssues: classifiedFinal.logic.length,
      fixedIssues: totalFixed,
      issues: filteredFinal,
      iterations: iteration,
      fixedCode: currentCode,
      duration: Date.now() - startTime,
    };
  }
  
  /**
   * Запустить все checkers параллельно
   */
  private async runCheckers(code: string, filePath: string): Promise<QualityIssue[]> {
    const checkers: Promise<QualityIssue[]>[] = [];
    
    if (this.config.useTypescript) {
      checkers.push(this.typescript.check(code, filePath));
    }
    
    if (this.config.useEslint) {
      checkers.push(this.eslint.check(code, filePath));
    }
    
    const results = await Promise.all(checkers);
    
    return results.flat();
  }
  
  /**
   * Отфильтровать игнорируемые правила/коды
   */
  private filterIgnored(issues: QualityIssue[]): QualityIssue[] {
    return issues.filter(issue => {
      // Проверяем игнорируемые ESLint правила
      if (this.config.ignoredRules.includes(issue.code)) {
        return false;
      }
      
      // Проверяем игнорируемые TS коды
      if (this.config.ignoredCodes.includes(issue.code)) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Форматировать результат для отчёта
   */
  formatResult(result: QualityCheckResult): string {
    const lines: string[] = [];
    
    lines.push(`# 🔍 Quality Gate Results\n`);
    lines.push(`**Status:** ${result.pass ? '✅ PASS' : '❌ FAIL'}`);
    lines.push(`**Duration:** ${result.duration}ms`);
    lines.push(`**Iterations:** ${result.iterations}`);
    lines.push('');
    
    // Summary
    lines.push(`## 📊 Summary\n`);
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Issues | ${result.totalIssues} |`);
    lines.push(`| Syntax Issues | ${result.syntaxIssues} |`);
    lines.push(`| Logic Issues | ${result.logicIssues} |`);
    lines.push(`| Fixed | ${result.fixedIssues} |`);
    lines.push('');
    
    // Issues
    if (result.issues.length > 0) {
      lines.push(this.classifier.formatIssues(result.issues));
    } else {
      lines.push('✅ **No issues found!**');
    }
    
    return lines.join('\n');
  }
}
