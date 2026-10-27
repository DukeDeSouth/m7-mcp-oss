/**
 * M7 Quality Gate - Issue Classifier
 * 
 * Классификация проблем на Syntax vs Logic
 */

import {
  QualityIssue,
  ClassifiedIssues,
} from '../types.js';

export class IssueClassifier {
  
  /**
   * Классифицировать issues по категориям
   */
  classify(issues: QualityIssue[]): ClassifiedIssues {
    return {
      syntax: issues.filter(i => i.category === 'syntax'),
      logic: issues.filter(i => i.category === 'logic'),
      style: issues.filter(i => i.category === 'style'),
      unknown: issues.filter(i => i.category === 'unknown'),
    };
  }
  
  /**
   * Проверить, можно ли автоматически исправить все issues
   */
  canAutoFix(issues: QualityIssue[]): boolean {
    const classified = this.classify(issues);
    
    // Нельзя auto-fix если есть logic errors
    if (classified.logic.length > 0) {
      return false;
    }
    
    // Проверяем, что все syntax и style issues имеют fix
    const fixableCategories = [...classified.syntax, ...classified.style];
    
    // Если нет fixable issues, возвращаем false (нечего фиксить)
    if (fixableCategories.length === 0 && issues.length > 0) {
      return false;
    }
    
    // Все должны иметь fix
    return fixableCategories.every(i => i.fixable);
  }
  
  /**
   * Получить blocking issues (логические ошибки или не-fixable errors)
   */
  getBlockingIssues(issues: QualityIssue[]): QualityIssue[] {
    return issues.filter(i => 
      i.category === 'logic' || 
      (i.severity === 'error' && !i.fixable)
    );
  }
  
  /**
   * Получить только fixable issues
   */
  getFixableIssues(issues: QualityIssue[]): QualityIssue[] {
    return issues.filter(i => 
      i.fixable && 
      i.fix !== undefined &&
      (i.category === 'syntax' || i.category === 'style')
    );
  }
  
  /**
   * Получить summary для отчёта
   */
  getSummary(issues: QualityIssue[]): {
    total: number;
    errors: number;
    warnings: number;
    fixable: number;
    blocking: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
  } {
    const classified = this.classify(issues);
    
    return {
      total: issues.length,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      fixable: this.getFixableIssues(issues).length,
      blocking: this.getBlockingIssues(issues).length,
      byCategory: {
        syntax: classified.syntax.length,
        logic: classified.logic.length,
        style: classified.style.length,
        unknown: classified.unknown.length,
      },
      bySource: {
        eslint: issues.filter(i => i.source === 'eslint').length,
        typescript: issues.filter(i => i.source === 'typescript').length,
        style: issues.filter(i => i.source === 'style').length,
      },
    };
  }
  
  /**
   * Отформатировать issues для вывода
   */
  formatIssues(issues: QualityIssue[]): string {
    if (issues.length === 0) {
      return '✅ No issues found';
    }
    
    const classified = this.classify(issues);
    const lines: string[] = [];
    
    // Logic errors first (blocking)
    if (classified.logic.length > 0) {
      lines.push(`\n### ❌ Logic Errors (${classified.logic.length}) - Require Manual Fix\n`);
      for (const issue of classified.logic) {
        lines.push(`- **Line ${issue.line}:** ${issue.message}`);
        lines.push(`  - Code: \`${issue.code}\``);
        lines.push(`  - Source: ${issue.source}`);
      }
    }
    
    // Syntax issues
    if (classified.syntax.length > 0) {
      lines.push(`\n### ⚠️ Syntax Issues (${classified.syntax.length})\n`);
      for (const issue of classified.syntax) {
        const fixIcon = issue.fixable ? '🔧' : '⚠️';
        lines.push(`- ${fixIcon} **Line ${issue.line}:** ${issue.message} (\`${issue.code}\`)`);
      }
    }
    
    // Style issues
    if (classified.style.length > 0) {
      lines.push(`\n### 📝 Style Issues (${classified.style.length})\n`);
      for (const issue of classified.style) {
        const fixIcon = issue.fixable ? '🔧' : '📝';
        lines.push(`- ${fixIcon} **Line ${issue.line}:** ${issue.message} (\`${issue.code}\`)`);
      }
    }
    
    // Unknown issues
    if (classified.unknown.length > 0) {
      lines.push(`\n### ❓ Other Issues (${classified.unknown.length})\n`);
      for (const issue of classified.unknown) {
        lines.push(`- **Line ${issue.line}:** ${issue.message} (\`${issue.code}\`)`);
      }
    }
    
    return lines.join('\n');
  }
}
