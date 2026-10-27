import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[TSI]');

import { 
  ISafetyValidator,
  ValidationResult,
  ValidationConfig,
  ValidationIssue,
  SuggestedFix,
  TechPattern,
  RiskLevel,
  PatternCategory,
  IKnowledgeBase,
  CodeLocation
} from '../core/types.js';

/**
 * M7 Tech Safety Intelligence - Safety Validator
 * Валидатор безопасности кода на основе паттернов и антипаттернов
 */
export class SafetyValidator implements ISafetyValidator {
  private knowledgeBase: IKnowledgeBase;
  private defaultConfig: ValidationConfig = {
    strictMode: false,
    enabledCategories: ['security', 'performance', 'architecture', 'testing'],
    riskThreshold: 50,
    confidenceThreshold: 0.7,
    customRules: []
  };

  constructor(knowledgeBase: IKnowledgeBase) {
    this.knowledgeBase = knowledgeBase;
  }

  /**
   * Валидация кода
   */
  async validate(
    code: string, 
    technology: string, 
    config?: ValidationConfig
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const validationConfig = { ...this.defaultConfig, ...config };
    
    try {
      // 1. Получаем релевантные паттерны
      const patterns = await this.getRelevantPatterns(technology, validationConfig);
      
      // 2. Анализируем код
      const codeAnalysis = this.analyzeCodeStructure(code);
      
      // 3. Проверяем на антипаттерны
      const issues = await this.detectIssues(code, patterns, validationConfig, codeAnalysis);
      
      // 4. Генерируем исправления
      const fixes = await this.generateFixes(issues);
      
      // 5. Вычисляем общий балл
      const score = this.calculateScore(issues, codeAnalysis.linesAnalyzed);
      
      const analysisTime = Date.now() - startTime;
      
      return {
        success: true,
        valid: issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
        score,
        issues,
        fixes,
        metrics: {
          linesAnalyzed: codeAnalysis.linesAnalyzed,
          patternsChecked: patterns.length,
          issuesFound: issues.length,
          criticalIssues: issues.filter(i => i.severity === 'critical').length,
          analysisTime
        }
      };
      
    } catch (error) {
      log.debug('TSI Validator] Validation failed:', error);
      
      return {
        success: false,
        valid: false,
        score: 0,
        issues: [{
          id: 'validation-error',
          severity: 'critical',
          category: 'security',
          message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          location: { snippet: 'N/A' },
          rule: 'system-error'
        }],
        fixes: [],
        metrics: {
          linesAnalyzed: 0,
          patternsChecked: 0,
          issuesFound: 1,
          criticalIssues: 1,
          analysisTime: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Проверка конкретного паттерна в коде
   */
  async checkPattern(code: string, pattern: TechPattern): Promise<boolean> {
    try {
      const codeAnalysis = this.analyzeCodeStructure(code);
      const matches = await this.findPatternMatches(code, pattern, codeAnalysis);
      return matches.length > 0;
    } catch (error) {
      log.debug('TSI Validator] Pattern check failed:', error);
      return false;
    }
  }

  /**
   * Генерация исправлений для проблем
   */
  async generateFixes(issues: ValidationIssue[]): Promise<SuggestedFix[]> {
    const fixes: SuggestedFix[] = [];
    
    for (const issue of issues) {
      const fix = await this.generateFixForIssue(issue);
      if (fix) {
        fixes.push(fix);
      }
    }
    
    return fixes;
  }

  // Приватные методы

  private async getRelevantPatterns(
    technology: string, 
    config: ValidationConfig
  ): Promise<TechPattern[]> {
    const patterns: TechPattern[] = [];
    
    // Получаем паттерны для технологии
    for (const category of config.enabledCategories) {
      const categoryPatterns = await this.knowledgeBase.findPatterns({
        technology,
        category,
        minConfidence: config.confidenceThreshold
      });
      
      patterns.push(...categoryPatterns);
    }
    
    // Добавляем общие паттерны безопасности
    const securityPatterns = await this.knowledgeBase.findPatterns({
      category: 'security',
      minConfidence: config.confidenceThreshold
    });
    
    patterns.push(...securityPatterns);
    
    // Удаляем дубликаты
    const uniquePatterns = patterns.filter((pattern, index, self) => 
      index === self.findIndex(p => p.id === pattern.id)
    );
    
    return uniquePatterns;
  }

  private analyzeCodeStructure(code: string): CodeAnalysis {
    const lines = code.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    
    return {
      linesAnalyzed: lines.length,
      nonEmptyLines: nonEmptyLines.length,
      functions: this.extractFunctions(code),
      imports: this.extractImports(code),
      variables: this.extractVariables(code),
      comments: this.extractComments(code),
      complexity: this.calculateComplexity(code)
    };
  }

  private extractFunctions(code: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const lines = code.split('\n');
    
    // Простое извлечение функций (можно улучшить с помощью AST)
    const functionPatterns = [
      /function\s+(\w+)\s*\(/g,
      /const\s+(\w+)\s*=\s*\(/g,
      /(\w+)\s*:\s*\(/g, // Методы объектов
      /(\w+)\s*\([^)]*\)\s*=>/g // Стрелочные функции
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of functionPatterns) {
        const matches = line.matchAll(pattern);
        for (const match of matches) {
          functions.push({
            name: match[1] || 'anonymous',
            line: i + 1,
            complexity: this.calculateFunctionComplexity(line)
          });
        }
      }
    }
    
    return functions;
  }

  private extractImports(code: string): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const lines = code.split('\n');
    
    const importPatterns = [
      /import\s+(.+)\s+from\s+['"](.+)['"]/g,
      /const\s+(.+)\s+=\s+require\(['"](.+)['"]\)/g
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of importPatterns) {
        const matches = line.matchAll(pattern);
        for (const match of matches) {
          imports.push({
            what: match[1].trim(),
            from: match[2].trim(),
            line: i + 1
          });
        }
      }
    }
    
    return imports;
  }

  private extractVariables(code: string): VariableInfo[] {
    const variables: VariableInfo[] = [];
    const lines = code.split('\n');
    
    const variablePatterns = [
      /(?:var|let|const)\s+(\w+)/g
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of variablePatterns) {
        const matches = line.matchAll(pattern);
        for (const match of matches) {
          variables.push({
            name: match[1],
            line: i + 1,
            type: this.inferVariableType(line)
          });
        }
      }
    }
    
    return variables;
  }

  private extractComments(code: string): CommentInfo[] {
    const comments: CommentInfo[] = [];
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Однострочные комментарии
      if (line.trim().startsWith('//')) {
        comments.push({
          type: 'single',
          line: i + 1,
          content: line.trim().substring(2).trim()
        });
      }
      
      // Многострочные комментарии (упрощенно)
      if (line.trim().startsWith('/*')) {
        comments.push({
          type: 'multi',
          line: i + 1,
          content: line.trim()
        });
      }
    }
    
    return comments;
  }

  private calculateComplexity(code: string): number {
    // Упрощенная цикломатическая сложность
    // v5.0: Split keywords and operators to fix regex bug
    const complexityKeywords = [
      'if', 'else', 'while', 'for', 'switch', 'case', 'catch', 'try'
    ];
    const complexityOperators = ['&&', '||'];
    
    let complexity = 1; // Базовая сложность
    
    // Match keywords with word boundaries
    for (const keyword of complexityKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = code.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    // Match operators without word boundaries (they're not words)
    for (const op of complexityOperators) {
      const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      const matches = code.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    // Count ternary operators separately (? used as ternary, not regex)
    const ternaryMatches = code.match(/\?[^?]/g);
    if (ternaryMatches) {
      complexity += ternaryMatches.length;
    }
    
    return complexity;
  }

  private calculateFunctionComplexity(functionCode: string): number {
    // Упрощенная сложность функции
    const complexityIndicators = [
      'if', 'else', 'while', 'for', 'switch', 'try', 'catch'
    ];
    
    let complexity = 1;
    
    for (const indicator of complexityIndicators) {
      const regex = new RegExp(`\\b${indicator}\\b`, 'g');
      const matches = functionCode.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return complexity;
  }

  private inferVariableType(line: string): string {
    if (line.includes('function') || line.includes('=>')) {
      return 'function';
    }
    if (line.includes('[') || line.includes('Array')) {
      return 'array';
    }
    if (line.includes('{') || line.includes('Object')) {
      return 'object';
    }
    if (line.includes('"') || line.includes("'") || line.includes('`')) {
      return 'string';
    }
    if (/\d/.test(line)) {
      return 'number';
    }
    if (line.includes('true') || line.includes('false')) {
      return 'boolean';
    }
    
    return 'unknown';
  }

  private async detectIssues(
    code: string, 
    patterns: TechPattern[], 
    config: ValidationConfig,
    codeAnalysis: CodeAnalysis
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    // 1. Проверяем антипаттерны
    const antipatterns = patterns.filter(p => p.type === 'antipattern');
    for (const antipattern of antipatterns) {
      const matches = await this.findPatternMatches(code, antipattern, codeAnalysis);
      for (const match of matches) {
        issues.push({
          id: `antipattern-${antipattern.id}-${match.line}`,
          severity: this.mapRiskToSeverity(antipattern.riskScore),
          category: antipattern.category,
          message: `Antipattern detected: ${antipattern.name} - ${antipattern.description}`,
          location: match,
          rule: antipattern.id,
          pattern: antipattern
        });
      }
    }
    
    // 2. Проверяем пользовательские правила
    if (config.customRules) {
      for (const rule of config.customRules) {
        const ruleIssues = this.checkCustomRule(code, rule);
        issues.push(...ruleIssues);
      }
    }
    
    // 3. Проверяем общие проблемы безопасности
    const securityIssues = this.checkSecurityIssues(code, codeAnalysis);
    issues.push(...securityIssues);
    
    // 4. Проверяем проблемы производительности
    const performanceIssues = this.checkPerformanceIssues(code, codeAnalysis);
    issues.push(...performanceIssues);
    
    // 5. Проверяем defensive programming issues (OSIL)
    if (config.enabledCategories.includes('defensive')) {
      const defensiveIssues = this.checkDefensiveIssues(code, codeAnalysis);
      issues.push(...defensiveIssues);
    }
    
    // Фильтруем по порогу риска
    return issues.filter(issue => {
      const riskScore = this.mapSeverityToRisk(issue.severity);
      return riskScore >= config.riskThreshold;
    });
  }

  private async findPatternMatches(
    code: string, 
    pattern: TechPattern, 
    codeAnalysis: CodeAnalysis
  ): Promise<CodeLocation[]> {
    const matches: CodeLocation[] = [];
    const lines = code.split('\n');
    
    // Проверяем каждый пример кода из паттерна
    for (const example of pattern.implementation) {
      const patternCode = example.code;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (this.matchesPattern(line, patternCode)) {
          matches.push({
            line: i + 1,
            snippet: line.trim(),
            file: undefined,
            column: undefined
          });
        }
      }
    }
    
    return matches;
  }

  private matchesPattern(codeLine: string, patternCode: string): boolean {
    // Упрощенное сопоставление паттернов
    const normalizedCode = codeLine.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedPattern = patternCode.replace(/\s+/g, ' ').trim().toLowerCase();
    
    // Прямое совпадение
    if (normalizedCode.includes(normalizedPattern)) {
      return true;
    }
    
    // Проверяем ключевые слова
    const patternKeywords = this.extractPatternKeywords(patternCode);
    return patternKeywords.some(keyword => normalizedCode.includes(keyword.toLowerCase()));
  }

  private extractPatternKeywords(patternCode: string): string[] {
    // Извлекаем ключевые слова из паттерна
    const keywords: string[] = [];
    
    // Общие антипаттерны JavaScript/TypeScript
    const jsAntipatterns = [
      'eval(', 'innerHTML', 'document.write', 'localStorage.getItem',
      'sessionStorage.getItem', 'dangerouslySetInnerHTML', 'var ',
      'catch (e) {}', 'catch (err) {}', 'setTimeout(', 'setInterval('
    ];
    
    // Антипаттерны безопасности
    const securityAntipatterns = [
      'md5(', 'sha1(', 'btoa(', 'atob(', 'escape(', 'unescape(',
      'document.cookie', 'window.location', 'location.href'
    ];
    
    // Антипаттерны производительности
    const performanceAntipatterns = [
      'for (var i', 'for (let i', 'while (true)', 'setInterval(',
      'setTimeout(', 'document.getElementById', 'querySelector'
    ];
    
    const allAntipatterns = [...jsAntipatterns, ...securityAntipatterns, ...performanceAntipatterns];
    
    for (const antipattern of allAntipatterns) {
      if (patternCode.includes(antipattern)) {
        keywords.push(antipattern);
      }
    }
    
    return keywords;
  }

  private checkCustomRule(code: string, rule: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matches = false;
      
      if (rule.pattern instanceof RegExp) {
        matches = rule.pattern.test(line);
      } else if (typeof rule.pattern === 'string') {
        matches = line.includes(rule.pattern);
      }
      
      if (matches) {
        issues.push({
          id: `custom-${rule.id}-${i + 1}`,
          severity: rule.severity,
          category: 'security', // По умолчанию
          message: rule.message,
          location: {
            line: i + 1,
            snippet: line.trim()
          },
          rule: rule.id
        });
      }
    }
    
    return issues;
  }

  private checkSecurityIssues(code: string, codeAnalysis: CodeAnalysis): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = code.split('\n');
    
    // Проверяем на общие проблемы безопасности
    const securityChecks = [
      {
        pattern: /eval\s*\(/g,
        message: 'Use of eval() is dangerous and should be avoided',
        severity: 'critical' as RiskLevel
      },
      {
        pattern: /innerHTML\s*=/g,
        message: 'Direct innerHTML assignment can lead to XSS vulnerabilities',
        severity: 'high' as RiskLevel
      },
      {
        pattern: /document\.write\s*\(/g,
        message: 'document.write() is deprecated and can cause security issues',
        severity: 'medium' as RiskLevel
      },
      {
        pattern: /localStorage\.getItem\s*\(\s*['"](token|jwt|auth)/g,
        message: 'Storing sensitive tokens in localStorage is insecure',
        severity: 'high' as RiskLevel
      },
      {
        pattern: /console\.log\s*\(/g,
        message: 'Console.log statements should be removed in production',
        severity: 'low' as RiskLevel
      }
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const check of securityChecks) {
        if (check.pattern.test(line)) {
          issues.push({
            id: `security-${i + 1}-${check.pattern.source}`,
            severity: check.severity,
            category: 'security',
            message: check.message,
            location: {
              line: i + 1,
              snippet: line.trim()
            },
            rule: 'security-check'
          });
        }
      }
    }
    
    return issues;
  }

  private checkPerformanceIssues(code: string, codeAnalysis: CodeAnalysis): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = code.split('\n');
    
    // Проверяем на проблемы производительности
    const performanceChecks = [
      {
        pattern: /for\s*\(\s*var\s+/g,
        message: 'Use let or const instead of var in loops',
        severity: 'low' as RiskLevel
      },
      {
        pattern: /while\s*\(\s*true\s*\)/g,
        message: 'Infinite loops can cause performance issues',
        severity: 'medium' as RiskLevel
      },
      {
        pattern: /setInterval\s*\(/g,
        message: 'setInterval can cause memory leaks if not properly cleared',
        severity: 'medium' as RiskLevel
      },
      {
        pattern: /document\.getElementById\s*\(/g,
        message: 'Consider caching DOM queries for better performance',
        severity: 'low' as RiskLevel
      }
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const check of performanceChecks) {
        if (check.pattern.test(line)) {
          issues.push({
            id: `performance-${i + 1}-${check.pattern.source}`,
            severity: check.severity,
            category: 'performance',
            message: check.message,
            location: {
              line: i + 1,
              snippet: line.trim()
            },
            rule: 'performance-check'
          });
        }
      }
    }
    
    return issues;
  }

  /**
   * Check for defensive programming issues (OSIL categories)
   * O = Ordering: logic sequence issues
   * S = State: shared mutable state issues  
   * I = Identity: canonical representation issues
   * L = Lifecycle: precondition/postcondition issues
   */
  private checkDefensiveIssues(code: string, _codeAnalysis: CodeAnalysis): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = code.split('\n');

    // Defensive checks — intentionally NO /g flag on patterns to avoid
    // the very lastIndex leak we detect (dogfooding our own rule)
    const defensiveChecks: Array<{
      id: string;
      pattern: RegExp;
      message: string;
      severity: RiskLevel;
      subcategory: string;
      fix: string;
    }> = [
      // STATE: Regex lastIndex leak
      {
        id: 'state-regex-lastindex',
        pattern: /(?:const|let|var)\s+\w+\s*=\s*(?:new\s+RegExp\([^)]*['"][^'"]*[gy]|\/[^/]+\/[gimsuy]*[gy])/,
        message: 'Global/sticky regex stored in variable may leak lastIndex state between calls. Reset .lastIndex = 0 before each use or use inline regex literals.',
        severity: 'medium' as RiskLevel,
        subcategory: 'State',
        fix: 'Reset .lastIndex = 0 before each use, or create a new RegExp per call'
      },
      // IDENTITY: JSON.stringify for hashing
      {
        id: 'identity-json-stringify-hash',
        pattern: /JSON\.stringify\([^)]*\)[^;\n]*\.(?:digest|hash|update)|(?:createHash|\.hash|\.digest|\.update)\([^)]*JSON\.stringify/,
        message: 'JSON.stringify produces non-canonical output (key order is implementation-defined). Use deterministic serialization for hashing.',
        severity: 'high' as RiskLevel,
        subcategory: 'Identity',
        fix: 'Use a canonical JSON library (e.g., fast-json-stable-stringify) or explicitly sort keys before serializing'
      },
      // ORDERING: Sort without tie-breaker
      {
        id: 'ordering-sort-no-tiebreaker',
        pattern: /\.sort\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\w+\.\w+\s*-\s*\w+\.\w+\s*\)/,
        message: 'Sort comparator uses a single numeric key without tie-breaker. Equal values produce unstable ordering across engines.',
        severity: 'low' as RiskLevel,
        subcategory: 'Ordering',
        fix: 'Add a secondary sort key: .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))'
      },
      // LIFECYCLE: NaN defeats bounds checks
      {
        id: 'lifecycle-nan-bounds',
        pattern: /Math\.(?:max|min)\(/,
        message: 'Math.max/min returns NaN if any argument is NaN — consider guarding inputs with Number.isFinite().',
        severity: 'low' as RiskLevel,
        subcategory: 'Lifecycle',
        fix: 'Filter inputs: Math.max(...values.filter(Number.isFinite))'
      }
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const check of defensiveChecks) {
        if (check.pattern.test(line)) {
          issues.push({
            id: `defensive-${check.id}-${i + 1}`,
            severity: check.severity,
            category: 'defensive',
            message: `[${check.subcategory}] ${check.message}`,
            location: {
              line: i + 1,
              snippet: line.trim()
            },
            rule: check.id
          });
        }
      }
    }

    return issues;
  }

  private async generateFixForIssue(issue: ValidationIssue): Promise<SuggestedFix | null> {
    // Генерируем исправления на основе типа проблемы
    const fixes: { [key: string]: (issue: ValidationIssue) => SuggestedFix } = {
      'eval(': (issue) => ({
        issueId: issue.id,
        type: 'replace',
        description: 'Replace eval() with safer alternative',
        oldCode: issue.location.snippet,
        newCode: '// TODO: Replace eval() with JSON.parse() or Function constructor',
        confidence: 0.8,
        automated: false
      }),
      
      'innerHTML =': (issue) => ({
        issueId: issue.id,
        type: 'replace',
        description: 'Replace innerHTML with textContent or use DOMPurify',
        oldCode: issue.location.snippet,
        newCode: issue.location.snippet.replace('innerHTML', 'textContent'),
        confidence: 0.9,
        automated: true
      }),
      
      'var ': (issue) => ({
        issueId: issue.id,
        type: 'replace',
        description: 'Replace var with let or const',
        oldCode: issue.location.snippet,
        newCode: issue.location.snippet.replace(/\bvar\b/, 'let'),
        confidence: 0.95,
        automated: true
      }),
      
      'console.log': (issue) => ({
        issueId: issue.id,
        type: 'delete',
        description: 'Remove console.log statement',
        oldCode: issue.location.snippet,
        newCode: '',
        confidence: 1.0,
        automated: true
      })
    };
    
    // Ищем подходящее исправление
    for (const [pattern, fixGenerator] of Object.entries(fixes)) {
      if (issue.location.snippet.includes(pattern)) {
        return fixGenerator(issue);
      }
    }
    
    // Defensive programming fixes
    const defensiveFixes: { [key: string]: string } = {
      'state-regex-lastindex': 'Reset .lastIndex = 0 before each use, or create a new RegExp per call instead of reusing a global one',
      'identity-json-stringify-hash': 'Replace JSON.stringify with canonical serialization (e.g., fast-json-stable-stringify or sort keys explicitly)',
      'ordering-sort-no-tiebreaker': 'Add a secondary sort key for stable ordering: .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))',
      'lifecycle-nan-bounds': 'Guard Math.max/min inputs: Math.max(...values.filter(Number.isFinite))'
    };
    
    if (issue.rule && defensiveFixes[issue.rule]) {
      return {
        issueId: issue.id,
        type: 'refactor',
        description: defensiveFixes[issue.rule],
        oldCode: issue.location.snippet,
        newCode: `// TODO: ${defensiveFixes[issue.rule]}`,
        confidence: 0.7,
        automated: false
      };
    }

    // Если конкретного исправления нет, генерируем общее
    if (issue.pattern) {
      return {
        issueId: issue.id,
        type: 'refactor',
        description: `Refactor to avoid ${issue.pattern.name}`,
        oldCode: issue.location.snippet,
        newCode: '// TODO: Refactor according to best practices',
        confidence: 0.5,
        automated: false
      };
    }
    
    return null;
  }

  private calculateScore(issues: ValidationIssue[], linesAnalyzed: number): number {
    if (linesAnalyzed === 0) return 100;
    
    let totalDeduction = 0;
    
    // Штрафы по серьезности
    const severityPenalties = {
      'critical': 20,
      'high': 10,
      'medium': 5,
      'low': 1
    };
    
    for (const issue of issues) {
      totalDeduction += severityPenalties[issue.severity];
    }
    
    // Нормализуем по количеству строк
    const normalizedDeduction = (totalDeduction / linesAnalyzed) * 100;
    
    return Math.max(0, 100 - normalizedDeduction);
  }

  private mapRiskToSeverity(riskScore: number): RiskLevel {
    if (riskScore >= 80) return 'critical';
    if (riskScore >= 60) return 'high';
    if (riskScore >= 30) return 'medium';
    return 'low';
  }

  private mapSeverityToRisk(severity: RiskLevel): number {
    const severityMap = {
      'critical': 100,
      'high': 75,
      'medium': 50,
      'low': 25
    };
    
    return severityMap[severity];
  }
}

// Вспомогательные типы

interface CodeAnalysis {
  linesAnalyzed: number;
  nonEmptyLines: number;
  functions: FunctionInfo[];
  imports: ImportInfo[];
  variables: VariableInfo[];
  comments: CommentInfo[];
  complexity: number;
}

interface FunctionInfo {
  name: string;
  line: number;
  complexity: number;
}

interface ImportInfo {
  what: string;
  from: string;
  line: number;
}

interface VariableInfo {
  name: string;
  line: number;
  type: string;
}

interface CommentInfo {
  type: 'single' | 'multi';
  line: number;
  content: string;
}
