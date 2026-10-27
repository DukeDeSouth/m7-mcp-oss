import { createLogger } from '../../utils/logger.js';
const log = createLogger('[autoFixer]');
/**
 * M7 Quality Gate - Auto Fixer
 * 
 * Применяет auto-fix только для syntax и style issues
 */

import { QualityIssue } from '../types.js';

export interface FixResult {
  fixed: string;
  appliedFixes: number;
  failedFixes: string[];
  changes: Array<{
    issueId: string;
    code: string;
    line: number;
    description: string;
  }>;
}

export class AutoFixer {
  
  /**
   * Применить все возможные fixes к коду
   */
  applyFixes(code: string, issues: QualityIssue[]): FixResult {
    // Фильтруем только fixable syntax и style issues
    const fixableIssues = issues
      .filter(i => 
        i.fixable && 
        i.fix !== undefined && 
        (i.category === 'syntax' || i.category === 'style')
      )
      // Сортируем по позиции в обратном порядке (от конца к началу)
      // чтобы не сбивать позиции при применении fixes
      .sort((a, b) => (b.fix!.range[0]) - (a.fix!.range[0]));
    
    let fixed = code;
    let appliedFixes = 0;
    const failedFixes: string[] = [];
    const changes: FixResult['changes'] = [];
    
    for (const issue of fixableIssues) {
      try {
        const [start, end] = issue.fix!.range;
        
        // Проверяем валидность range
        if (start < 0 || end > fixed.length || start > end) {
          log.debug(`AutoFixer] Invalid range for ${issue.id}: [${start}, ${end}]`);
          failedFixes.push(issue.id);
          continue;
        }
        
        // Применяем fix
        const before = fixed.slice(0, start);
        const after = fixed.slice(end);
        fixed = before + issue.fix!.text + after;
        
        appliedFixes++;
        changes.push({
          issueId: issue.id,
          code: issue.code,
          line: issue.line,
          description: issue.message,
        });
        
        log.debug(`AutoFixer] ✅ Fixed: ${issue.code} at line ${issue.line}`);
      } catch (error) {
        log.debug(`AutoFixer] ❌ Failed to fix ${issue.id}:`, error);
        failedFixes.push(issue.id);
      }
    }
    
    return {
      fixed,
      appliedFixes,
      failedFixes,
      changes,
    };
  }
  
  /**
   * Применить один fix
   */
  applySingleFix(code: string, issue: QualityIssue): string | null {
    if (!issue.fix) {
      return null;
    }
    
    try {
      const [start, end] = issue.fix.range;
      
      if (start < 0 || end > code.length || start > end) {
        return null;
      }
      
      return code.slice(0, start) + issue.fix.text + code.slice(end);
    } catch {
      return null;
    }
  }
  
  /**
   * Проверить, безопасно ли применять fix
   */
  isFixSafe(issue: QualityIssue, codeLength: number): boolean {
    if (!issue.fix) return false;
    if (!issue.fixable) return false;
    if (issue.category === 'logic') return false;
    
    const [start, end] = issue.fix.range;
    
    // Проверяем валидность range
    if (start < 0 || end > codeLength || start > end) {
      return false;
    }
    
    // Проверяем что fix не слишком большой (подозрительно)
    const changeSize = Math.abs(issue.fix.text.length - (end - start));
    if (changeSize > 1000) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Форматировать отчёт об изменениях
   */
  formatChangesReport(result: FixResult): string {
    const lines: string[] = [];
    
    if (result.appliedFixes === 0) {
      lines.push('No fixes applied');
      return lines.join('\n');
    }
    
    lines.push(`## 🔧 Auto-Fixed Issues (${result.appliedFixes})\n`);
    
    for (const change of result.changes) {
      lines.push(`- **Line ${change.line}:** ${change.description} (\`${change.code}\`)`);
    }
    
    if (result.failedFixes.length > 0) {
      lines.push(`\n### ⚠️ Failed Fixes (${result.failedFixes.length})\n`);
      for (const id of result.failedFixes) {
        lines.push(`- ${id}`);
      }
    }
    
    return lines.join('\n');
  }
}
