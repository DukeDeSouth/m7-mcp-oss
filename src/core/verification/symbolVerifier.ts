import { createLogger } from '../utils/logger.js';
const log = createLogger('[symbolVerifier]');
/**
 * M7 v3.2 - Symbol Verifier
 * 
 * NO ASSUMPTION RULE: grep перед использованием любого символа.
 * Предотвращает галлюцинации и создание дубликатов.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { getProjectPath } from '../utils/projectPath.js';

/**
 * Расположение символа в коде
 */
export interface SymbolLocation {
  file: string;
  line: number;
  column?: number;
  context: string;  // Окружающий код
}

/**
 * Похожий символ
 */
export interface SimilarSymbol {
  name: string;
  location: SymbolLocation;
  similarity: number;  // 0-1
}

/**
 * Результат проверки символа
 */
export interface SymbolVerifyResult {
  symbol: string;
  status: 'EXISTS' | 'NOT_FOUND' | 'SIMILAR_FOUND';
  location?: SymbolLocation;
  similar: SimilarSymbol[];
  recommendation: string;
}

/**
 * Результат пакетной проверки
 */
export interface BatchVerifyResult {
  total: number;
  exists: SymbolVerifyResult[];
  notFound: SymbolVerifyResult[];
  similarFound: SymbolVerifyResult[];
  allVerified: boolean;
  summary: string;
}

/**
 * Symbol Verifier - проверка существования символов перед использованием
 */
export class SymbolVerifier {
  private projectPath: string;
  
  constructor() {
    this.projectPath = getProjectPath();
  }
  
  /**
   * Проверить один символ
   */
  async verify(symbol: string, searchPath?: string): Promise<SymbolVerifyResult> {
    const targetPath = searchPath || this.projectPath;
    
    try {
      // 1. Точный поиск
      const exactResult = this.grepExact(symbol, targetPath);
      
      if (exactResult.found) {
        return {
          symbol,
          status: 'EXISTS',
          location: exactResult.location,
          similar: [],
          recommendation: `✅ Символ найден в ${exactResult.location?.file}:${exactResult.location?.line}`
        };
      }
      
      // 2. Поиск похожих
      const similar = await this.findSimilar(symbol, targetPath);
      
      if (similar.length > 0) {
        return {
          symbol,
          status: 'SIMILAR_FOUND',
          similar,
          recommendation: this.buildSimilarRecommendation(symbol, similar)
        };
      }
      
      // 3. Не найдено
      return {
        symbol,
        status: 'NOT_FOUND',
        similar: [],
        recommendation: `⚠️ Символ "${symbol}" не найден. Если нужен — создайте новый.`
      };
      
    } catch (error: any) {
      log.debug(`SymbolVerifier] Error verifying ${symbol}: ${error.message}`);
      return {
        symbol,
        status: 'NOT_FOUND',
        similar: [],
        recommendation: `❌ Ошибка проверки: ${error.message}`
      };
    }
  }
  
  /**
   * Проверить несколько символов
   */
  async verifyAll(symbols: string[]): Promise<BatchVerifyResult> {
    const results: SymbolVerifyResult[] = [];
    
    for (const symbol of symbols) {
      const result = await this.verify(symbol);
      results.push(result);
    }
    
    const exists = results.filter(r => r.status === 'EXISTS');
    const notFound = results.filter(r => r.status === 'NOT_FOUND');
    const similarFound = results.filter(r => r.status === 'SIMILAR_FOUND');
    
    return {
      total: symbols.length,
      exists,
      notFound,
      similarFound,
      allVerified: notFound.length === 0 && similarFound.length === 0,
      summary: this.buildBatchSummary(exists, notFound, similarFound)
    };
  }
  
  /**
   * Извлечь символы из текста (код, план, описание)
   */
  extractSymbols(content: string): string[] {
    const symbols = new Set<string>();
    
    // Функции: functionName(
    const funcRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1];
      // Исключить ключевые слова
      if (!this.isKeyword(name)) {
        symbols.add(name);
      }
    }
    
    // Импорты: import { X } from
    const importRegex = /import\s*\{([^}]+)\}/g;
    while ((match = importRegex.exec(content)) !== null) {
      const imports = match[1].split(',').map(s => s.trim().split(' as ')[0].trim());
      imports.forEach(i => symbols.add(i));
    }
    
    // Классы: class ClassName
    const classRegex = /class\s+([A-Z][a-zA-Z0-9_]*)/g;
    while ((match = classRegex.exec(content)) !== null) {
      symbols.add(match[1]);
    }
    
    // Интерфейсы: interface IName
    const interfaceRegex = /interface\s+([A-Z][a-zA-Z0-9_]*)/g;
    while ((match = interfaceRegex.exec(content)) !== null) {
      symbols.add(match[1]);
    }
    
    return Array.from(symbols).filter(s => s.length > 2);
  }
  
  /**
   * Точный grep поиск
   */
  private grepExact(symbol: string, searchPath: string): { found: boolean; location?: SymbolLocation } {
    try {
      // Поиск определения функции/класса/переменной
      const patterns = [
        `function ${symbol}`,
        `const ${symbol}`,
        `let ${symbol}`,
        `class ${symbol}`,
        `interface ${symbol}`,
        `export.*${symbol}`,
        `${symbol}\\s*=`,
        `${symbol}\\s*\\(`
      ];
      
      for (const pattern of patterns) {
        const cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "${pattern}" "${searchPath}" 2>/dev/null | head -1`;
        
        try {
          const result = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
          
          if (result.trim()) {
            const [fileLine, ...rest] = result.split(':');
            const [file, lineStr] = fileLine.includes(':') 
              ? [fileLine.split(':')[0], fileLine.split(':')[1]]
              : [fileLine, '1'];
            
            return {
              found: true,
              location: {
                file: file.replace(searchPath, '').replace(/^\//, ''),
                line: parseInt(lineStr) || 1,
                context: rest.join(':').trim().slice(0, 100)
              }
            };
          }
        } catch {
          // grep не нашёл — продолжаем
        }
      }
      
      return { found: false };
      
    } catch (error) {
      return { found: false };
    }
  }
  
  /**
   * Поиск похожих символов
   */
  private async findSimilar(symbol: string, searchPath: string, maxResults = 5): Promise<SimilarSymbol[]> {
    const similar: SimilarSymbol[] = [];
    
    try {
      // Разбить на части: showTradeSuccess → [show, Trade, Success]
      const parts = symbol.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) || [symbol];
      
      // Искать по каждой части
      for (const part of parts) {
        if (part.length < 3) continue;
        
        const cmd = `grep -rn --include="*.ts" --include="*.tsx" -E "(function|const|class|interface)\\s+[a-zA-Z]*${part}[a-zA-Z]*" "${searchPath}" 2>/dev/null | head -10`;
        
        try {
          const result = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
          
          for (const line of result.split('\n').filter(l => l.trim())) {
            const match = line.match(/(\w+)\s*[=(]/);
            if (match && match[1] !== symbol) {
              const name = match[1];
              const similarity = this.calculateSimilarity(symbol, name);
              
              if (similarity > 0.3) {
                const [file, lineNum] = line.split(':');
                
                similar.push({
                  name,
                  location: {
                    file: file.replace(searchPath, '').replace(/^\//, ''),
                    line: parseInt(lineNum) || 1,
                    context: line.slice(line.indexOf(lineNum) + lineNum.length + 1).trim().slice(0, 80)
                  },
                  similarity
                });
              }
            }
          }
        } catch {
          // Ничего не найдено
        }
      }
      
      // Убрать дубликаты и отсортировать по similarity
      const unique = similar.reduce((acc, curr) => {
        if (!acc.find(s => s.name === curr.name)) {
          acc.push(curr);
        }
        return acc;
      }, [] as SimilarSymbol[]);
      
      return unique
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults);
      
    } catch {
      return [];
    }
  }
  
  /**
   * Вычислить похожесть двух строк (0-1)
   */
  private calculateSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    
    // Точное совпадение
    if (aLower === bLower) return 1;
    
    // Одна содержит другую
    if (aLower.includes(bLower) || bLower.includes(aLower)) {
      return 0.8;
    }
    
    // Levenshtein-based
    const maxLen = Math.max(a.length, b.length);
    const distance = this.levenshteinDistance(aLower, bLower);
    
    return Math.max(0, 1 - distance / maxLen);
  }
  
  /**
   * Levenshtein distance
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
  
  /**
   * Проверить является ли слово ключевым
   */
  private isKeyword(word: string): boolean {
    const keywords = [
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
      'void', 'this', 'super', 'class', 'extends', 'implements', 'interface',
      'import', 'export', 'from', 'as', 'default', 'async', 'await', 'yield',
      'function', 'const', 'let', 'var', 'true', 'false', 'null', 'undefined',
      'console', 'process', 'require', 'module', 'exports'
    ];
    return keywords.includes(word.toLowerCase());
  }
  
  /**
   * Построить рекомендацию для похожих символов
   */
  private buildSimilarRecommendation(symbol: string, similar: SimilarSymbol[]): string {
    const lines = [`🔍 Символ "${symbol}" не найден, но есть похожие:`];
    
    for (const s of similar.slice(0, 3)) {
      lines.push(`  • ${s.name} (${(s.similarity * 100).toFixed(0)}% match) — ${s.location.file}:${s.location.line}`);
    }
    
    lines.push('');
    lines.push('Выберите: использовать один из них или создать новый?');
    
    return lines.join('\n');
  }
  
  /**
   * Построить summary для batch результата
   */
  private buildBatchSummary(
    exists: SymbolVerifyResult[],
    notFound: SymbolVerifyResult[],
    similarFound: SymbolVerifyResult[]
  ): string {
    const lines: string[] = ['## 🔍 Pre-Implementation Verification', ''];
    
    if (exists.length > 0) {
      lines.push(`### ✅ Найдено (${exists.length}):`);
      for (const r of exists) {
        lines.push(`- \`${r.symbol}\` → ${r.location?.file}:${r.location?.line}`);
      }
      lines.push('');
    }
    
    if (similarFound.length > 0) {
      lines.push(`### 🔍 Похожие (${similarFound.length}):`);
      for (const r of similarFound) {
        lines.push(`- \`${r.symbol}\` → ${r.similar[0]?.name} (${r.similar[0]?.location.file})`);
      }
      lines.push('');
    }
    
    if (notFound.length > 0) {
      lines.push(`### ⚠️ Не найдено (${notFound.length}):`);
      for (const r of notFound) {
        lines.push(`- \`${r.symbol}\` — нужно создать`);
      }
      lines.push('');
    }
    
    if (notFound.length === 0 && similarFound.length === 0) {
      lines.push('✅ Все символы верифицированы!');
    } else {
      lines.push('⏳ Требуется подтверждение перед реализацией.');
    }
    
    return lines.join('\n');
  }
}

// Singleton
let instance: SymbolVerifier | null = null;

export function getSymbolVerifier(): SymbolVerifier {
  if (!instance) {
    instance = new SymbolVerifier();
  }
  return instance;
}

