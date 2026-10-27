import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[ErrorMatcher]');
/**
 * M7 v3.0 - Error Matcher
 * 
 * Match code against known error patterns and provide preventive warnings
 */

import { UnifiedMemoryCore, getMemoryCore } from '../memory/auto/unified-memory-core.js';
import { ErrorStore } from './error-store.js';
import {
  ErrorEntry,
  ErrorPattern,
  PreventiveWarning,
  MatchResult,
  ErrorCategory,
  ErrorSeverity,
  ErrorDatabaseConfig,
  DEFAULT_ERROR_DATABASE_CONFIG
} from './types.js';

// ============================================
// BUILT-IN PATTERNS
// ============================================

export const BUILT_IN_PATTERNS: Omit<ErrorPattern, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Wrong Import Path',
    description: 'Common mistake of using wrong import path format',
    category: 'import',
    matchType: 'regex',
    pattern: 'from\\s+[\'"]\\.\\.\\.\\/\\.\\.\\/\\.\\.\\/[^\'\"]+[\'"]',
    preventiveWarning: 'Deep relative imports (../../../) are error-prone. Consider using path aliases.',
    suggestedFix: 'Use @/ or similar path alias',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.9,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Any Type Usage',
    description: 'Using "any" type defeats TypeScript type checking',
    category: 'type',
    matchType: 'regex',
    pattern: ':\\s*any(?:\\s|\\)|\\]|,|;|$)',
    preventiveWarning: 'Using "any" type removes type safety. Consider using "unknown" or a specific type.',
    suggestedFix: 'Replace with "unknown" and add type guards',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.85,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Console Log in Production',
    description: 'console.log statements left in production code',
    category: 'style',
    matchType: 'regex',
    pattern: 'console\\.log\\(',
    preventiveWarning: 'console.log should not be in production code. Use a proper logger.',
    suggestedFix: 'Remove or replace with logger.debug()',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.7,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Empty Catch Block',
    description: 'Catch block without error handling',
    category: 'logic',
    matchType: 'regex',
    pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
    preventiveWarning: 'Empty catch blocks silently swallow errors. Always handle or log errors.',
    suggestedFix: 'Add error logging or proper error handling',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.95,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Hardcoded Credentials',
    description: 'Potential hardcoded API keys or passwords',
    category: 'security',
    matchType: 'regex',
    pattern: '(?:password|api_key|apiKey|secret|token)\\s*[=:]\\s*[\'"][^\'"]{8,}[\'"]',
    preventiveWarning: 'Hardcoded credentials detected. Use environment variables instead.',
    suggestedFix: 'Move to .env file and use process.env',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.8,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Synchronous File Operations',
    description: 'Using synchronous fs operations that block event loop',
    category: 'performance',
    matchType: 'regex',
    pattern: 'fs\\.(readFileSync|writeFileSync|appendFileSync|existsSync)',
    preventiveWarning: 'Synchronous file operations block the event loop. Use async versions.',
    suggestedFix: 'Use fs.promises.readFile() instead',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.75,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Missing Await',
    description: 'Async function called without await',
    category: 'logic',
    matchType: 'regex',
    pattern: '(?<!await\\s)(?:fetch|axios|Promise\\.all)\\s*\\(',
    preventiveWarning: 'Async operation without await may cause unexpected behavior.',
    suggestedFix: 'Add await before the async call',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.6,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Eval Usage',
    description: 'Using eval() is a security risk',
    category: 'security',
    matchType: 'regex',
    pattern: '\\beval\\s*\\(',
    preventiveWarning: 'eval() is a security vulnerability. Never use it with user input.',
    suggestedFix: 'Use safer alternatives like JSON.parse() or Function constructor',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.95,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'innerHTML Assignment',
    description: 'Setting innerHTML can lead to XSS attacks',
    category: 'security',
    matchType: 'regex',
    pattern: '\\.innerHTML\\s*=',
    preventiveWarning: 'innerHTML can cause XSS vulnerabilities. Use textContent or sanitize input.',
    suggestedFix: 'Use textContent for plain text or sanitize with DOMPurify',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.8,
    enabled: true,
    source: 'manual'
  },
  {
    name: 'Magic Numbers',
    description: 'Unexplained numeric literals in code',
    category: 'style',
    matchType: 'regex',
    pattern: '(?<![\\w.])\\b(?:[3-9]\\d{2,}|\\d{4,})\\b(?![\\w.])',
    preventiveWarning: 'Magic numbers make code hard to understand. Use named constants.',
    suggestedFix: 'Extract to a named constant with meaningful name',
    matchCount: 0,
    preventionCount: 0,
    falsePositiveCount: 0,
    confidence: 0.5,
    enabled: false, // Too many false positives
    source: 'manual'
  }
];

// ============================================
// ERROR MATCHER CLASS
// ============================================

export class ErrorMatcher {
  private store: ErrorStore;
  private memory: UnifiedMemoryCore | null = null;
  private config: ErrorDatabaseConfig;
  private patterns: ErrorPattern[] = [];
  
  constructor(store: ErrorStore, config: Partial<ErrorDatabaseConfig> = {}) {
    this.store = store;
    this.config = { ...DEFAULT_ERROR_DATABASE_CONFIG, ...config };
  }
  
  /**
   * Initialize with unified memory for semantic matching
   * v5.0: Uses UnifiedMemoryCore instead of PersistentMemory
   */
  async initialize(chromaUrl?: string): Promise<void> {
    try {
      this.memory = await getMemoryCore();
      await this.memory.initialize();
    } catch (error) {
      // Non-fatal - can work without semantic matching
      log.debug('ErrorMatcher] Failed to initialize unified memory:', error);
    }
    
    // Load patterns from store
    this.patterns = this.store.getAllPatterns();
    
    // Add built-in patterns if not already added
    await this.ensureBuiltInPatterns();
  }
  
  /**
   * Ensure built-in patterns exist
   */
  private async ensureBuiltInPatterns(): Promise<void> {
    const existingIds = new Set(this.patterns.map(p => p.id));
    
    for (const builtIn of BUILT_IN_PATTERNS) {
      const id = `builtin_${builtIn.name.toLowerCase().replace(/\s+/g, '_')}`;
      
      if (!existingIds.has(id)) {
        const pattern: ErrorPattern = {
          ...builtIn,
          id,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        await this.store.addPattern(pattern);
        this.patterns.push(pattern);
      }
    }
  }
  
  /**
   * Match code against patterns
   */
  async matchCode(code: string, filePath: string = 'unknown'): Promise<MatchResult> {
    const matchedPatterns: ErrorPattern[] = [];
    const warnings: PreventiveWarning[] = [];
    let maxConfidence = 0;
    
    // Regex-based matching
    for (const pattern of this.patterns) {
      if (!pattern.enabled) continue;
      
      if (pattern.matchType === 'regex' || pattern.matchType === 'exact') {
        const matches = this.matchPattern(code, pattern);
        
        if (matches.length > 0) {
          matchedPatterns.push(pattern);
          maxConfidence = Math.max(maxConfidence, pattern.confidence);
          
          // Create warnings for each match
          for (const match of matches) {
            if (warnings.length >= this.config.maxWarningsPerFile) break;
            
            warnings.push({
              id: `warn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              patternId: pattern.id,
              title: pattern.name,
              message: pattern.preventiveWarning,
              severity: this.categorySeverity(pattern.category),
              matchedCode: match.text,
              location: {
                file: filePath,
                line: match.line,
                column: match.column
              },
              similarErrors: [],
              suggestedFix: pattern.suggestedFix,
              confidence: pattern.confidence,
              dismissed: false
            });
          }
          
          // Update pattern stats
          await this.store.incrementPatternMatch(pattern.id, true);
        }
      }
    }
    
    // Semantic matching against past errors
    if (this.memory && matchedPatterns.length === 0) {
      const semanticMatches = await this.semanticMatch(code);
      
      for (const match of semanticMatches) {
        if (match.confidence >= this.config.warningThreshold) {
          warnings.push({
            id: `warn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            patternId: match.errorId,
            title: 'Similar Error Detected',
            message: `Similar to previous error: ${match.title}`,
            severity: match.severity,
            matchedCode: code.slice(0, 100),
            location: {
              file: filePath,
              line: 1,
              column: 0
            },
            similarErrors: [match.errorId],
            suggestedFix: match.correctSolution,
            confidence: match.confidence,
            dismissed: false
          });
          
          maxConfidence = Math.max(maxConfidence, match.confidence);
        }
      }
    }
    
    return {
      matched: matchedPatterns.length > 0 || warnings.length > 0,
      patterns: matchedPatterns,
      warnings,
      confidence: maxConfidence
    };
  }
  
  /**
   * Match a single pattern against code
   */
  private matchPattern(code: string, pattern: ErrorPattern): Array<{
    text: string;
    line: number;
    column: number;
  }> {
    const matches: Array<{ text: string; line: number; column: number }> = [];
    
    try {
      const regex = pattern.matchType === 'exact'
        ? new RegExp(pattern.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        : new RegExp(pattern.pattern, 'g');
      
      let match;
      while ((match = regex.exec(code)) !== null) {
        const beforeMatch = code.substring(0, match.index);
        const lines = beforeMatch.split('\n');
        const line = lines.length;
        const column = lines[lines.length - 1].length;
        
        matches.push({
          text: match[0],
          line,
          column
        });
        
        // Prevent infinite loops with zero-width matches
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    } catch {
      // Invalid regex
    }
    
    return matches;
  }
  
  /**
   * Semantic matching against past errors
   */
  /**
   * Semantic matching against past errors
   * v5.0: Uses UnifiedMemoryCore.cascadeSearch()
   */
  private async semanticMatch(code: string): Promise<Array<{
    errorId: string;
    title: string;
    severity: ErrorSeverity;
    correctSolution: string;
    confidence: number;
  }>> {
    if (!this.memory) return [];
    
    const results = await this.memory.cascadeSearch(code, { limit: 5 });
    
    return results
      .filter(r => r.score >= this.config.warningThreshold)
      .map(r => {
        const error = this.store.getError(r.record.id);
        return {
          errorId: r.record.id,
          title: error?.title || 'Unknown Error',
          severity: error?.severity || 'medium',
          correctSolution: error?.correctSolution || '',
          confidence: r.score
        };
      });
  }
  
  /**
   * Map category to severity
   */
  private categorySeverity(category: ErrorCategory): ErrorSeverity {
    switch (category) {
      case 'security':
        return 'critical';
      case 'syntax':
      case 'type':
        return 'high';
      case 'logic':
      case 'api':
        return 'medium';
      default:
        return 'low';
    }
  }
  
  /**
   * Add a new pattern
   */
  async addPattern(pattern: Omit<ErrorPattern, 'id' | 'createdAt' | 'updatedAt'>): Promise<ErrorPattern> {
    const newPattern: ErrorPattern = {
      ...pattern,
      id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await this.store.addPattern(newPattern);
    this.patterns.push(newPattern);
    
    return newPattern;
  }
  
  /**
   * Learn pattern from error
   */
  async learnFromError(error: ErrorEntry): Promise<ErrorPattern | null> {
    // Check if we have enough occurrences
    if (error.occurrences < this.config.minOccurrencesForPattern) {
      return null;
    }
    
    // Try to extract a pattern from the mistake
    const pattern = this.extractPattern(error);
    if (!pattern) return null;
    
    // Check if pattern is useful (not too generic)
    if (pattern.length < 10) return null;
    
    // Create new pattern
    const newPattern = await this.addPattern({
      name: `Learned: ${error.title.slice(0, 30)}`,
      description: error.description,
      category: error.category,
      matchType: 'regex',
      pattern,
      preventiveWarning: error.explanation,
      suggestedFix: error.correctSolution.slice(0, 200),
      matchCount: 0,
      preventionCount: 0,
      falsePositiveCount: 0,
      confidence: 0.7, // Start with moderate confidence
      enabled: true,
      source: 'learned'
    });
    
    // Store in unified memory for semantic matching
    // v5.0: Uses UnifiedMemoryCore.store()
    if (this.memory) {
      await this.memory.store(
        `${error.title}\n${error.description}\n${error.aiMistake}`,
        {
          level: 'L2',
          source: 'code_analysis',
          contextKeys: [error.category, 'learned', error.projectId || ''],
          confidence: Math.min(1, error.occurrences / 10)
        }
      );
    }
    
    return newPattern;
  }
  
  /**
   * Extract regex pattern from error
   */
  private extractPattern(error: ErrorEntry): string | null {
    const mistake = error.aiMistake;
    
    // Try to find a common pattern
    // This is a simplified approach - could be enhanced with ML
    
    // Look for import patterns
    const importMatch = mistake.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const path = importMatch[1];
      // Escape special chars and make generic
      return `import\\s+.*\\s+from\\s+['"]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`;
    }
    
    // Look for function calls
    const funcMatch = mistake.match(/(\w+)\s*\(/);
    if (funcMatch && mistake.length < 100) {
      return mistake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    return null;
  }
  
  /**
   * Get all patterns
   */
  getPatterns(): ErrorPattern[] {
    return this.patterns;
  }
  
  /**
   * Enable/disable pattern
   */
  async setPatternEnabled(id: string, enabled: boolean): Promise<void> {
    await this.store.updatePattern(id, { enabled });
    
    const pattern = this.patterns.find(p => p.id === id);
    if (pattern) {
      pattern.enabled = enabled;
    }
  }
  
  /**
   * Report false positive
   */
  async reportFalsePositive(patternId: string): Promise<void> {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (pattern) {
      pattern.falsePositiveCount++;
      pattern.confidence *= 0.95; // Reduce confidence
      
      // Disable if too many false positives
      if (pattern.falsePositiveCount > pattern.matchCount * 0.3) {
        pattern.enabled = false;
      }
      
      await this.store.updatePattern(patternId, {
        falsePositiveCount: pattern.falsePositiveCount,
        confidence: pattern.confidence,
        enabled: pattern.enabled
      });
    }
  }
}

export default ErrorMatcher;

