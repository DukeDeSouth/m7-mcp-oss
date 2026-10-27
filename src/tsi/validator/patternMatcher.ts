
import { 
  TechPattern,
  CodeExample,
  DetectedAntipattern,
  CodeLocation,
  RiskLevel
} from '../core/types.js';

/**
 * M7 Tech Safety Intelligence - Pattern Matcher
 * Сопоставитель паттернов для поиска соответствий в коде
 */
export class PatternMatcher {
  
  /**
   * Поиск паттерна в коде
   */
  findPatternInCode(code: string, pattern: TechPattern): PatternMatch[] {
    const matches: PatternMatch[] = [];
    
    // Анализируем каждый пример кода из паттерна
    for (const example of pattern.implementation) {
      const exampleMatches = this.findExampleMatches(code, example, pattern);
      matches.push(...exampleMatches);
    }
    
    // Удаляем дубликаты
    return this.removeDuplicateMatches(matches);
  }

  /**
   * Поиск антипаттернов в коде
   */
  findAntipatterns(code: string, antipatterns: TechPattern[]): DetectedAntipattern[] {
    const detected: DetectedAntipattern[] = [];
    
    for (const antipattern of antipatterns.filter(p => p.type === 'antipattern')) {
      const matches = this.findPatternInCode(code, antipattern);
      
      for (const match of matches) {
        detected.push({
          pattern: antipattern,
          location: match.location,
          severity: this.calculateSeverity(antipattern, match),
          description: this.generateDescription(antipattern, match),
          suggestedFix: this.generateFix(antipattern, match),
          autoFixable: this.isAutoFixable(antipattern, match)
        });
      }
    }
    
    // Сортируем по серьезности
    return detected.sort((a, b) => {
      const severityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * Оценка качества соответствия
   */
  calculateMatchQuality(code: string, pattern: TechPattern): MatchQuality {
    const matches = this.findPatternInCode(code, pattern);
    
    if (matches.length === 0) {
      return {
        score: 0,
        confidence: 0,
        coverage: 0,
        exactMatches: 0,
        partialMatches: 0,
        details: 'No matches found'
      };
    }
    
    const exactMatches = matches.filter(m => m.matchType === 'exact').length;
    const partialMatches = matches.filter(m => m.matchType === 'partial').length;
    const structuralMatches = matches.filter(m => m.matchType === 'structural').length;
    
    // Вычисляем общий балл
    const score = (exactMatches * 1.0 + partialMatches * 0.7 + structuralMatches * 0.4) / matches.length;
    
    // Вычисляем покрытие
    const totalExamples = pattern.implementation.length;
    const matchedExamples = new Set(matches.map(m => m.exampleIndex)).size;
    const coverage = matchedExamples / totalExamples;
    
    // Вычисляем доверие
    const confidence = Math.min(score * coverage * pattern.confidence, 1.0);
    
    return {
      score,
      confidence,
      coverage,
      exactMatches,
      partialMatches,
      details: `Found ${matches.length} matches (${exactMatches} exact, ${partialMatches} partial)`
    };
  }

  /**
   * Поиск похожих паттернов
   */
  findSimilarPatterns(code: string, patterns: TechPattern[], threshold: number = 0.3): SimilarPattern[] {
    const similar: SimilarPattern[] = [];
    
    for (const pattern of patterns) {
      const quality = this.calculateMatchQuality(code, pattern);
      
      if (quality.confidence >= threshold) {
        similar.push({
          pattern,
          similarity: quality.confidence,
          matchQuality: quality,
          reason: this.explainSimilarity(code, pattern, quality)
        });
      }
    }
    
    // Сортируем по схожести
    return similar.sort((a, b) => b.similarity - a.similarity);
  }

  // Приватные методы

  private findExampleMatches(code: string, example: CodeExample, pattern: TechPattern): PatternMatch[] {
    const matches: PatternMatch[] = [];
    const lines = code.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = this.matchLine(line, example, i + 1);
      
      if (match) {
        matches.push({
          pattern,
          exampleIndex: pattern.implementation.indexOf(example),
          matchType: match.matchType || 'structural',
          confidence: match.confidence || 0.5,
          location: match.location || { snippet: '' }
        });
      }
    }
    
    // Также ищем многострочные соответствия
    const multilineMatches = this.findMultilineMatches(code, example, pattern);
    matches.push(...multilineMatches);
    
    return matches;
  }

  private matchLine(line: string, example: CodeExample, lineNumber: number): Partial<PatternMatch> | null {
    const normalizedLine = this.normalizeLine(line);
    const normalizedExample = this.normalizeLine(example.code);
    
    // Точное соответствие
    if (normalizedLine === normalizedExample) {
      return {
        matchType: 'exact',
        confidence: 1.0,
        location: {
          line: lineNumber,
          snippet: line.trim()
        }
      };
    }
    
    // Частичное соответствие
    const partialMatch = this.findPartialMatch(normalizedLine, normalizedExample);
    if (partialMatch && partialMatch.confidence > 0.7) {
      return {
        matchType: 'partial',
        confidence: partialMatch.confidence,
        location: {
          line: lineNumber,
          snippet: line.trim()
        }
      };
    }
    
    // Структурное соответствие
    const structuralMatch = this.findStructuralMatch(line, example.code);
    if (structuralMatch && structuralMatch.confidence > 0.5) {
      return {
        matchType: 'structural',
        confidence: structuralMatch.confidence,
        location: {
          line: lineNumber,
          snippet: line.trim()
        }
      };
    }
    
    return null;
  }

  private findMultilineMatches(code: string, example: CodeExample, pattern: TechPattern): PatternMatch[] {
    const matches: PatternMatch[] = [];
    
    // Разбиваем пример на строки
    const exampleLines = example.code.split('\n').filter(line => line.trim().length > 0);
    
    if (exampleLines.length <= 1) {
      return matches; // Не многострочный пример
    }
    
    const codeLines = code.split('\n');
    
    // Ищем последовательности строк
    for (let i = 0; i <= codeLines.length - exampleLines.length; i++) {
      const codeSequence = codeLines.slice(i, i + exampleLines.length);
      const matchQuality = this.matchSequence(codeSequence, exampleLines);
      
      if (matchQuality.confidence > 0.6) {
        matches.push({
          pattern,
          exampleIndex: pattern.implementation.indexOf(example),
          matchType: matchQuality.confidence > 0.9 ? 'exact' : 'partial',
          confidence: matchQuality.confidence,
          location: {
            line: i + 1,
            snippet: codeSequence.join('\n').trim()
          }
        });
      }
    }
    
    return matches;
  }

  private matchSequence(codeLines: string[], exampleLines: string[]): { confidence: number } {
    if (codeLines.length !== exampleLines.length) {
      return { confidence: 0 };
    }
    
    let totalConfidence = 0;
    
    for (let i = 0; i < codeLines.length; i++) {
      const lineMatch = this.matchLine(codeLines[i], { code: exampleLines[i] } as CodeExample, i + 1);
      
      if (lineMatch) {
        totalConfidence += lineMatch.confidence || 0;
      }
    }
    
    return { confidence: totalConfidence / codeLines.length };
  }

  private normalizeLine(line: string): string {
    return line
      .trim()
      .replace(/\s+/g, ' ') // Нормализуем пробелы
      .replace(/;$/, '') // Убираем точку с запятой в конце
      .toLowerCase();
  }

  private findPartialMatch(line: string, example: string): { confidence: number } | null {
    // Извлекаем ключевые слова
    const lineKeywords = this.extractKeywords(line);
    const exampleKeywords = this.extractKeywords(example);
    
    if (lineKeywords.length === 0 || exampleKeywords.length === 0) {
      return null;
    }
    
    // Вычисляем пересечение
    const intersection = lineKeywords.filter(keyword => exampleKeywords.includes(keyword));
    const union = [...new Set([...lineKeywords, ...exampleKeywords])];
    
    const confidence = intersection.length / union.length;
    
    return confidence > 0.3 ? { confidence } : null;
  }

  private findStructuralMatch(line: string, example: string): { confidence: number } | null {
    // Анализируем структуру кода
    const lineStructure = this.analyzeStructure(line);
    const exampleStructure = this.analyzeStructure(example);
    
    const structuralSimilarity = this.compareStructures(lineStructure, exampleStructure);
    
    return structuralSimilarity > 0.5 ? { confidence: structuralSimilarity } : null;
  }

  private extractKeywords(code: string): string[] {
    // Извлекаем ключевые слова из кода
    const keywords: string[] = [];
    
    // JavaScript/TypeScript ключевые слова
    const jsKeywords = [
      'function', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
      'return', 'import', 'export', 'class', 'interface', 'type',
      'async', 'await', 'try', 'catch', 'throw', 'new'
    ];
    
    // Операторы и символы
    const operators = ['=', '==', '===', '!=', '!==', '>', '<', '>=', '<=', '&&', '||'];
    
    // Методы и функции
    const methods = code.match(/\w+\(/g) || [];
    keywords.push(...methods.map(m => m.replace('(', '')));
    
    // Переменные и свойства
    const variables = code.match(/\b\w+\b/g) || [];
    keywords.push(...variables.filter(v => jsKeywords.includes(v)));
    
    // Операторы
    for (const op of operators) {
      if (code.includes(op)) {
        keywords.push(op);
      }
    }
    
    return [...new Set(keywords)]; // Удаляем дубликаты
  }

  private analyzeStructure(code: string): CodeStructure {
    return {
      hasFunctionCall: /\w+\s*\(/.test(code),
      hasAssignment: /\w+\s*=/.test(code),
      hasComparison: /(==|===|!=|!==|>|<|>=|<=)/.test(code),
      hasLogicalOperator: /(\|\||&&)/.test(code),
      hasConditional: /\b(if|else|switch|case)\b/.test(code),
      hasLoop: /\b(for|while|do)\b/.test(code),
      hasReturn: /\breturn\b/.test(code),
      hasImport: /\b(import|require)\b/.test(code),
      hasExport: /\bexport\b/.test(code),
      hasAsync: /\b(async|await)\b/.test(code),
      hasClass: /\bclass\b/.test(code),
      hasInterface: /\binterface\b/.test(code),
      hasType: /\btype\b/.test(code),
      hasTryCatch: /\b(try|catch|finally)\b/.test(code),
      bracketDepth: this.calculateBracketDepth(code),
      complexity: this.calculateLineComplexity(code)
    };
  }

  private compareStructures(struct1: CodeStructure, struct2: CodeStructure): number {
    const booleanFields = [
      'hasFunctionCall', 'hasAssignment', 'hasComparison', 'hasLogicalOperator',
      'hasConditional', 'hasLoop', 'hasReturn', 'hasImport', 'hasExport',
      'hasAsync', 'hasClass', 'hasInterface', 'hasType', 'hasTryCatch'
    ];
    
    let matches = 0;
    let total = booleanFields.length;
    
    // Сравниваем булевые поля
    for (const field of booleanFields) {
      if (struct1[field as keyof CodeStructure] === struct2[field as keyof CodeStructure]) {
        matches++;
      }
    }
    
    // Сравниваем числовые поля (с допуском)
    const bracketDiff = Math.abs(struct1.bracketDepth - struct2.bracketDepth);
    if (bracketDiff <= 1) matches += 0.5;
    
    const complexityDiff = Math.abs(struct1.complexity - struct2.complexity);
    if (complexityDiff <= 2) matches += 0.5;
    
    total += 1; // Добавляем за числовые поля
    
    return matches / total;
  }

  private calculateBracketDepth(code: string): number {
    let depth = 0;
    let maxDepth = 0;
    
    for (const char of code) {
      if (char === '(' || char === '[' || char === '{') {
        depth++;
        maxDepth = Math.max(maxDepth, depth);
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      }
    }
    
    return maxDepth;
  }

  private calculateLineComplexity(code: string): number {
    // v5.0: Split keywords and operators to fix regex bug
    const keywordIndicators = [
      'if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch', 'async', 'await'
    ];
    const operatorIndicators = ['&&', '||'];
    
    let complexity = 0;
    
    // Match keywords with word boundaries
    for (const indicator of keywordIndicators) {
      const regex = new RegExp(`\\b${indicator}\\b`, 'g');
      const matches = code.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    // Match operators without word boundaries
    for (const op of operatorIndicators) {
      const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      const matches = code.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    // Count ternary (?:) separately
    const ternaryMatches = code.match(/\?[^?]/g);
    if (ternaryMatches) {
      complexity += ternaryMatches.length;
    }
    
    // Count colons in ternary/object context
    const colonMatches = code.match(/:[^:]/g);
    if (colonMatches) {
      complexity += colonMatches.length;
    }
    
    return complexity;
  }

  private removeDuplicateMatches(matches: PatternMatch[]): PatternMatch[] {
    const unique: PatternMatch[] = [];
    const seen = new Set<string>();
    
    for (const match of matches) {
      const key = `${match.location.line}-${match.location.snippet}-${match.matchType}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(match);
      }
    }
    
    return unique;
  }

  private calculateSeverity(antipattern: TechPattern, match: PatternMatch): RiskLevel {
    // Базовая серьезность из паттерна
    let severity: RiskLevel = 'medium';
    
    if (antipattern.riskScore >= 80) severity = 'critical';
    else if (antipattern.riskScore >= 60) severity = 'high';
    else if (antipattern.riskScore >= 30) severity = 'medium';
    else severity = 'low';
    
    // Корректируем на основе качества соответствия
    if (match.confidence >= 0.9 && match.matchType === 'exact') {
      // Точное соответствие - повышаем серьезность
      const severityLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
      const currentIndex = severityLevels.indexOf(severity);
      if (currentIndex < severityLevels.length - 1) {
        severity = severityLevels[currentIndex + 1];
      }
    }
    
    return severity;
  }

  private generateDescription(antipattern: TechPattern, match: PatternMatch): string {
    const baseDescription = `${antipattern.name}: ${antipattern.description}`;
    
    const matchDetails = match.matchType === 'exact' 
      ? 'Exact match detected'
      : `${match.matchType} match (${Math.round(match.confidence * 100)}% confidence)`;
    
    return `${baseDescription}. ${matchDetails}.`;
  }

  private generateFix(antipattern: TechPattern, match: PatternMatch): string {
    // Ищем подходящую альтернативу
    if (antipattern.alternatives.length > 0) {
      const bestAlternative = antipattern.alternatives[0];
      return `Consider using ${bestAlternative.name}: ${bestAlternative.description}`;
    }
    
    // Ищем стратегии митигации
    if (antipattern.risks.length > 0) {
      const mainRisk = antipattern.risks[0];
      if (mainRisk.mitigation.length > 0) {
        return mainRisk.mitigation[0];
      }
    }
    
    // Общее предложение
    return `Refactor this code to follow ${antipattern.technology} best practices and avoid ${antipattern.name}`;
  }

  private isAutoFixable(antipattern: TechPattern, match: PatternMatch): boolean {
    // Простые замены можно автоматизировать
    const autoFixablePatterns = [
      'var-to-let-const',
      'console-log-removal',
      'innerHTML-to-textContent',
      'double-equals-to-triple'
    ];
    
    // Проверяем по ID паттерна
    const isSimplePattern = autoFixablePatterns.some(pattern => 
      antipattern.id.includes(pattern)
    );
    
    // Точные соответствия легче исправить автоматически
    const isExactMatch = match.matchType === 'exact' && match.confidence > 0.9;
    
    return isSimplePattern && isExactMatch;
  }

  private explainSimilarity(code: string, pattern: TechPattern, quality: MatchQuality): string {
    const reasons: string[] = [];
    
    if (quality.exactMatches > 0) {
      reasons.push(`${quality.exactMatches} exact matches`);
    }
    
    if (quality.partialMatches > 0) {
      reasons.push(`${quality.partialMatches} partial matches`);
    }
    
    if (quality.coverage > 0.5) {
      reasons.push(`${Math.round(quality.coverage * 100)}% pattern coverage`);
    }
    
    if (pattern.confidence > 0.8) {
      reasons.push('high pattern confidence');
    }
    
    return reasons.join(', ') || 'structural similarity';
  }
}

// Типы для сопоставления паттернов

export interface PatternMatch {
  pattern: TechPattern;
  exampleIndex: number;
  matchType: 'exact' | 'partial' | 'structural';
  confidence: number;
  location: CodeLocation;
}

export interface MatchQuality {
  score: number;
  confidence: number;
  coverage: number;
  exactMatches: number;
  partialMatches: number;
  details: string;
}

export interface SimilarPattern {
  pattern: TechPattern;
  similarity: number;
  matchQuality: MatchQuality;
  reason: string;
}

interface CodeStructure {
  hasFunctionCall: boolean;
  hasAssignment: boolean;
  hasComparison: boolean;
  hasLogicalOperator: boolean;
  hasConditional: boolean;
  hasLoop: boolean;
  hasReturn: boolean;
  hasImport: boolean;
  hasExport: boolean;
  hasAsync: boolean;
  hasClass: boolean;
  hasInterface: boolean;
  hasType: boolean;
  hasTryCatch: boolean;
  bracketDepth: number;
  complexity: number;
}
