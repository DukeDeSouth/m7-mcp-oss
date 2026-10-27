/**
 * M7 v3.0 - Style Validator
 * 
 * Validate generated code against learned style patterns
 */

import {
  StyleProfile,
  StyleViolation,
  ValidationResult,
  AntiPattern,
  NamingPattern,
  CustomStyleRule,
  StyleGuardianConfig,
  DEFAULT_STYLE_GUARDIAN_CONFIG
} from './types.js';

// ============================================
// NAMING VALIDATION
// ============================================

function validateNaming(
  content: string,
  patterns: NamingPattern[],
  filePath: string
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  
  for (const pattern of patterns) {
    if (pattern.confidence < 0.7) continue; // Skip low-confidence patterns
    
    const regex = getElementRegex(pattern.element);
    const matches = content.matchAll(regex);
    
    for (const match of matches) {
      const name = match[1];
      const convention = detectConvention(name);
      
      if (convention !== pattern.convention && !pattern.exceptions.includes(name)) {
        const lineNumber = getLineNumber(content, match.index || 0);
        
        violations.push({
          id: `naming_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: `naming_${pattern.element}`,
          ruleName: `${pattern.element} naming convention`,
          severity: 'warning',
          message: `${pattern.element} "${name}" should use ${pattern.convention} (found ${convention})`,
          file: filePath,
          line: lineNumber,
          column: 0,
          code: match[0],
          suggestion: `Rename to ${convertName(name, pattern.convention)}`,
          autoFixable: true,
          fix: {
            range: [match.index || 0, (match.index || 0) + match[0].length],
            text: match[0].replace(name, convertName(name, pattern.convention))
          }
        });
      }
    }
  }
  
  return violations;
}

function getElementRegex(element: string): RegExp {
  switch (element) {
    case 'function':
      return /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    case 'class':
      return /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    case 'interface':
      return /interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    case 'type':
      return /type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
    case 'constant':
      return /const\s+([A-Z][A-Z0-9_]*)\s*=/g;
    case 'variable':
      return /(?:let|var|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
    case 'enum':
      return /enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    default:
      return /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  }
}

function detectConvention(name: string): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return 'UPPER_SNAKE_CASE';
  if (/^[a-z][a-z0-9_]*$/.test(name)) return 'snake_case';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase';
  if (name.startsWith('_')) return '_prefixed';
  return 'mixed';
}

function convertName(name: string, toConvention: string): string {
  // Split name into words
  const words = name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);
  
  switch (toConvention) {
    case 'camelCase':
      return words
        .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    
    case 'PascalCase':
      return words
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    
    case 'snake_case':
      return words.map(w => w.toLowerCase()).join('_');
    
    case 'UPPER_SNAKE_CASE':
      return words.map(w => w.toUpperCase()).join('_');
    
    case 'kebab-case':
      return words.map(w => w.toLowerCase()).join('-');
    
    case '_prefixed':
      const base = convertName(name.replace(/^_/, ''), 'camelCase');
      return '_' + base;
    
    default:
      return name;
  }
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

// ============================================
// ANTI-PATTERN VALIDATION
// ============================================

function validateAntiPatterns(
  content: string,
  patterns: AntiPattern[],
  filePath: string
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  
  for (const pattern of patterns) {
    if (!pattern.enabled) continue;
    
    try {
      const regex = new RegExp(pattern.pattern, 'g');
      let match;
      
      while ((match = regex.exec(content)) !== null) {
        const lineNumber = getLineNumber(content, match.index);
        
        violations.push({
          id: `anti_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: pattern.id,
          ruleName: pattern.name,
          severity: pattern.severity,
          message: pattern.description,
          file: filePath,
          line: lineNumber,
          column: 0,
          code: match[0],
          suggestion: pattern.suggestion,
          autoFixable: false
        });
      }
    } catch {
      // Invalid regex, skip
    }
  }
  
  return violations;
}

// ============================================
// CUSTOM RULE VALIDATION
// ============================================

function validateCustomRules(
  content: string,
  rules: CustomStyleRule[],
  filePath: string
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  
  for (const rule of rules) {
    if (rule.confidence < 0.7) continue;
    
    try {
      const regex = new RegExp(rule.pattern, 'g');
      let match;
      
      while ((match = regex.exec(content)) !== null) {
        const lineNumber = getLineNumber(content, match.index);
        
        violations.push({
          id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'warning',
          message: rule.description,
          file: filePath,
          line: lineNumber,
          column: 0,
          code: match[0],
          suggestion: rule.replacement ? `Replace with: ${rule.replacement}` : undefined,
          autoFixable: !!rule.replacement,
          fix: rule.replacement ? {
            range: [match.index, match.index + match[0].length],
            text: rule.replacement
          } : undefined
        });
      }
    } catch {
      // Invalid pattern, skip
    }
  }
  
  return violations;
}

// ============================================
// IMPORT VALIDATION
// ============================================

function validateImports(
  content: string,
  profile: StyleProfile,
  filePath: string
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const importPattern = profile.imports;
  
  if (importPattern.confidence < 0.7) return violations;
  
  const importRegex = /import\s+(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+))?\s*(?:,\s*(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+)))?\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    const [fullMatch, named1, namespace1, default1, named2, namespace2, default2, importPath] = match;
    const lineNumber = getLineNumber(content, match.index);
    
    // Check path alias
    if (importPattern.pathAlias && !importPath.startsWith(importPattern.pathAlias) && 
        !importPath.startsWith('.') && !importPath.includes('node_modules')) {
      // Check if this should use the alias
      if (importPath.startsWith('../') && importPath.split('/').length > 3) {
        violations.push({
          id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: 'import_path_alias',
          ruleName: 'Import Path Alias',
          severity: 'info',
          message: `Consider using path alias ${importPattern.pathAlias} instead of relative import`,
          file: filePath,
          line: lineNumber,
          column: 0,
          code: fullMatch,
          suggestion: `Use ${importPattern.pathAlias} alias`,
          autoFixable: false
        });
      }
    }
    
    // Check import style
    if (importPattern.style === 'named' && (default1 || default2)) {
      violations.push({
        id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ruleId: 'import_style',
        ruleName: 'Import Style',
        severity: 'info',
        message: 'Project prefers named imports over default imports',
        file: filePath,
        line: lineNumber,
        column: 0,
        code: fullMatch,
        suggestion: 'Use named import syntax: import { name } from "module"',
        autoFixable: false
      });
    }
  }
  
  return violations;
}

// ============================================
// FORMATTING VALIDATION
// ============================================

function validateFormatting(
  content: string,
  profile: StyleProfile,
  filePath: string
): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const formatting = profile.formatting;
  
  if (formatting.confidence < 0.7) return violations;
  
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    
    // Check indentation
    const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
    if (leadingWhitespace.length > 0) {
      const hasTabs = leadingWhitespace.includes('\t');
      const hasSpaces = leadingWhitespace.includes(' ') && !leadingWhitespace.includes('\t');
      
      if (formatting.indentation === 'spaces' && hasTabs) {
        violations.push({
          id: `format_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: 'indentation',
          ruleName: 'Indentation',
          severity: 'warning',
          message: 'Use spaces for indentation, not tabs',
          file: filePath,
          line: lineNumber,
          column: 0,
          code: line.slice(0, 20) + (line.length > 20 ? '...' : ''),
          suggestion: `Use ${formatting.indentSize} spaces for indentation`,
          autoFixable: true
        });
      } else if (formatting.indentation === 'tabs' && hasSpaces) {
        violations.push({
          id: `format_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ruleId: 'indentation',
          ruleName: 'Indentation',
          severity: 'warning',
          message: 'Use tabs for indentation, not spaces',
          file: filePath,
          line: lineNumber,
          column: 0,
          code: line.slice(0, 20) + (line.length > 20 ? '...' : ''),
          suggestion: 'Use tabs for indentation',
          autoFixable: true
        });
      }
    }
    
    // Check line width
    if (line.length > formatting.lineWidth) {
      violations.push({
        id: `format_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ruleId: 'line_width',
        ruleName: 'Line Width',
        severity: 'info',
        message: `Line exceeds ${formatting.lineWidth} characters (${line.length})`,
        file: filePath,
        line: lineNumber,
        column: formatting.lineWidth,
        code: line.slice(0, 50) + '...',
        suggestion: 'Break long lines for better readability',
        autoFixable: false
      });
    }
  }
  
  // Check quotes (simplified - just count)
  const singleQuotes = (content.match(/'/g) || []).length;
  const doubleQuotes = (content.match(/"/g) || []).length;
  
  if (formatting.quotes === 'single' && doubleQuotes > singleQuotes * 2) {
    violations.push({
      id: `format_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ruleId: 'quotes',
      ruleName: 'Quote Style',
      severity: 'info',
      message: 'Project prefers single quotes for strings',
      file: filePath,
      line: 1,
      column: 0,
      code: '',
      suggestion: 'Use single quotes instead of double quotes',
      autoFixable: true
    });
  } else if (formatting.quotes === 'double' && singleQuotes > doubleQuotes * 2) {
    violations.push({
      id: `format_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ruleId: 'quotes',
      ruleName: 'Quote Style',
      severity: 'info',
      message: 'Project prefers double quotes for strings',
      file: filePath,
      line: 1,
      column: 0,
      code: '',
      suggestion: 'Use double quotes instead of single quotes',
      autoFixable: true
    });
  }
  
  return violations;
}

// ============================================
// STYLE VALIDATOR CLASS
// ============================================

export class StyleValidator {
  private profile: StyleProfile | null = null;
  private config: StyleGuardianConfig;
  
  constructor(config: Partial<StyleGuardianConfig> = {}) {
    this.config = { ...DEFAULT_STYLE_GUARDIAN_CONFIG, ...config };
  }
  
  /**
   * Set the style profile to validate against
   */
  setProfile(profile: StyleProfile): void {
    this.profile = profile;
  }
  
  /**
   * Validate code against the style profile
   */
  validate(content: string, filePath: string = 'unknown'): ValidationResult {
    const startTime = Date.now();
    
    if (!this.profile) {
      return {
        file: filePath,
        violations: [],
        score: 100,
        passedRules: 0,
        failedRules: 0,
        processingTime: Date.now() - startTime
      };
    }
    
    const violations: StyleViolation[] = [];
    
    // Run all validations
    violations.push(...validateNaming(content, this.profile.naming, filePath));
    violations.push(...validateAntiPatterns(content, this.profile.antiPatterns, filePath));
    violations.push(...validateCustomRules(content, this.profile.customRules, filePath));
    violations.push(...validateImports(content, this.profile, filePath));
    violations.push(...validateFormatting(content, this.profile, filePath));
    
    // Filter by severity in strict mode
    const filteredViolations = this.config.strictMode
      ? violations
      : violations.filter(v => v.severity !== 'info');
    
    // Calculate score
    const errorWeight = 10;
    const warningWeight = 3;
    const infoWeight = 1;
    
    let totalPenalty = 0;
    for (const v of violations) {
      switch (v.severity) {
        case 'error': totalPenalty += errorWeight; break;
        case 'warning': totalPenalty += warningWeight; break;
        case 'info': totalPenalty += infoWeight; break;
      }
    }
    
    // Score is based on violations vs content size
    const contentLines = content.split('\n').length;
    const maxPenalty = contentLines * 2; // 2 points per line max
    const score = Math.max(0, Math.round(100 - (totalPenalty / maxPenalty) * 100));
    
    // Count rules
    const ruleIds = new Set(violations.map(v => v.ruleId));
    const allRules = new Set([
      ...this.profile.naming.map(n => `naming_${n.element}`),
      ...this.profile.antiPatterns.map(a => a.id),
      ...this.profile.customRules.map(c => c.id),
      'import_path_alias',
      'import_style',
      'indentation',
      'line_width',
      'quotes'
    ]);
    
    return {
      file: filePath,
      violations: filteredViolations,
      score,
      passedRules: allRules.size - ruleIds.size,
      failedRules: ruleIds.size,
      processingTime: Date.now() - startTime
    };
  }
  
  /**
   * Quick check if code has any errors (blocking issues)
   */
  hasErrors(content: string, filePath: string = 'unknown'): boolean {
    const result = this.validate(content, filePath);
    return result.violations.some(v => v.severity === 'error');
  }
  
  /**
   * Get only error-level violations
   */
  getErrors(content: string, filePath: string = 'unknown'): StyleViolation[] {
    const result = this.validate(content, filePath);
    return result.violations.filter(v => v.severity === 'error');
  }
  
  /**
   * Auto-fix code where possible
   */
  autoFix(content: string, filePath: string = 'unknown'): {
    fixed: string;
    fixedCount: number;
    remainingViolations: StyleViolation[];
  } {
    const result = this.validate(content, filePath);
    
    // Sort fixes by position (reverse order to apply from end to start)
    const fixableViolations = result.violations
      .filter(v => v.autoFixable && v.fix)
      .sort((a, b) => (b.fix?.range[0] || 0) - (a.fix?.range[0] || 0));
    
    let fixed = content;
    let fixedCount = 0;
    
    for (const violation of fixableViolations) {
      if (violation.fix) {
        const [start, end] = violation.fix.range;
        fixed = fixed.slice(0, start) + violation.fix.text + fixed.slice(end);
        fixedCount++;
      }
    }
    
    // Re-validate to get remaining violations
    const remaining = this.validate(fixed, filePath);
    
    return {
      fixed,
      fixedCount,
      remainingViolations: remaining.violations
    };
  }
  
  /**
   * Format validation result as a report
   */
  formatReport(result: ValidationResult): string {
    const lines: string[] = [];
    
    lines.push(`📋 Style Validation Report: ${result.file}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Score: ${result.score}/100`);
    lines.push(`Rules: ${result.passedRules} passed, ${result.failedRules} failed`);
    lines.push(`Time: ${result.processingTime}ms`);
    lines.push('');
    
    if (result.violations.length === 0) {
      lines.push('✅ No violations found!');
    } else {
      const errors = result.violations.filter(v => v.severity === 'error');
      const warnings = result.violations.filter(v => v.severity === 'warning');
      const infos = result.violations.filter(v => v.severity === 'info');
      
      if (errors.length > 0) {
        lines.push(`🔴 Errors (${errors.length}):`);
        for (const v of errors) {
          lines.push(`  Line ${v.line}: ${v.message}`);
          if (v.suggestion) lines.push(`    💡 ${v.suggestion}`);
        }
        lines.push('');
      }
      
      if (warnings.length > 0) {
        lines.push(`🟡 Warnings (${warnings.length}):`);
        for (const v of warnings) {
          lines.push(`  Line ${v.line}: ${v.message}`);
          if (v.suggestion) lines.push(`    💡 ${v.suggestion}`);
        }
        lines.push('');
      }
      
      if (infos.length > 0) {
        lines.push(`🔵 Info (${infos.length}):`);
        for (const v of infos) {
          lines.push(`  Line ${v.line}: ${v.message}`);
        }
      }
    }
    
    return lines.join('\n');
  }
}

export default StyleValidator;

