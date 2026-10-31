import { createLogger } from '../utils/logger.js';
const log = createLogger('[architecturecontextanalyzer]');
/**
 * M7 v3.6 - Architecture Context Analyzer
 * 
 * Автоматический поиск архитектурного контекста в проекте
 * перед анализом задачи. Помогает AI понять "как это уже сделано".
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { 
  ArchitectureContext, 
  SearchResult, 
  SimilarPattern,
  ArchitectureRecommendation,
  ArchitectureContextConfig,
  DEFAULT_ARCHITECTURE_CONTEXT_CONFIG 
} from './types.js';
import { KeywordExtractor, getKeywordExtractor } from './keyword-extractor.js';
import { getKnowledgeGraph } from '../../knowledge-graph/index.js';

const execFileAsync = promisify(execFile);

/**
 * ripgrep argv for one keyword (no shell). The explicit `.` path keeps rg from
 * reading stdin when the server's stdin is a pipe.
 */
export function buildRipgrepArgs(keyword: string): string[] {
  return [
    '--json',
    '-C', '1',
    '--max-count', '3',
    '--max-filesize', '100K',
    '--type', 'ts',
    '--type', 'js',
    '--fixed-strings',
    '-e', keyword,
    '--',
    '.',
  ];
}

// ============================================
// ANALYZER CLASS
// ============================================

export class ArchitectureContextAnalyzer {
  private keywordExtractor: KeywordExtractor;
  private config: ArchitectureContextConfig;

  constructor(config?: Partial<ArchitectureContextConfig>) {
    this.keywordExtractor = getKeywordExtractor();
    this.config = { ...DEFAULT_ARCHITECTURE_CONTEXT_CONFIG, ...config };
  }

  /**
   * Analyze task and find relevant architecture context
   */
  async analyze(taskDescription: string, projectPath: string): Promise<ArchitectureContext> {
    const startTime = Date.now();
    
    // Extract keywords from task
    const keywords = this.keywordExtractor.extract(taskDescription);
    
    if (keywords.length === 0) {
      return this.emptyContext(startTime);
    }
    
    log.debug(`ArchContext] Extracted keywords: ${keywords.join(', ')}`);
    
    // Try Knowledge Graph first (faster, more accurate)
    let results: SearchResult[] = [];
    
    if (this.config.preferKnowledgeGraph) {
      results = this.searchKnowledgeGraph(keywords);
    }
    
    // Fallback to ripgrep if KG not built or no results
    if (results.length === 0) {
      results = await this.searchWithRipgrep(keywords, projectPath);
    }
    
    // Generate context
    const similarPatterns = this.extractPatterns(results);
    const recommendation = this.generateRecommendation(results, keywords);
    const warnings = this.generateWarnings(results, keywords);
    
    return {
      keywords,
      existingImplementations: results.slice(0, this.config.maxResults),
      similarPatterns,
      recommendation,
      warnings,
      analysisTimeMs: Date.now() - startTime
    };
  }

  /**
   * Search using Knowledge Graph (preferred method)
   */
  private searchKnowledgeGraph(keywords: string[]): SearchResult[] {
    const results: SearchResult[] = [];
    
    try {
      const kg = getKnowledgeGraph();
      
      if (!kg.built) {
        log.debug('ArchContext] Knowledge Graph not built, will use ripgrep');
        return [];
      }
      
      for (const keyword of keywords.slice(0, this.config.maxKeywords)) {
        const nodes = kg.searchByName(keyword);
        
        for (const node of nodes.slice(0, 3)) {
          results.push({
            file: node.filePath,
            line: node.line || 1,
            snippet: `${node.type}: ${node.name}`,
            relevance: 0.8,
            keyword
          });
        }
      }
      
      log.debug(`ArchContext] Knowledge Graph: found ${results.length} results`);
      
    } catch (error: any) {
      log.debug(`ArchContext] Knowledge Graph search failed: ${error.message}`);
    }
    
    return results;
  }

  /**
   * Search using ripgrep (fallback method)
   */
  private async searchWithRipgrep(keywords: string[], projectPath: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    for (const keyword of keywords.slice(0, this.config.maxKeywords)) {
      try {
        const { stdout } = await execFileAsync(
          'rg',
          buildRipgrepArgs(keyword),
          { 
            cwd: projectPath, 
            timeout: this.config.ripgrepTimeoutMs,
            maxBuffer: 1024 * 1024 // 1MB
          }
        );
        
        // Parse ripgrep JSON output
        const lines = stdout.trim().split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'match') {
              const filePath = String(data.data.path.text).replace(/^\.\//, '');
              
              // Skip node_modules, dist, etc.
              if (filePath.includes('node_modules') || 
                  filePath.includes('/dist/') || 
                  filePath.includes('.d.ts')) {
                continue;
              }
              
              results.push({
                file: filePath,
                line: data.data.line_number,
                snippet: data.data.lines.text.trim(),
                relevance: 0.6,
                keyword
              });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      } catch (error: any) {
        // rg exits 1 when nothing matched; anything else (ENOENT, timeout) is worth a debug line
        if (error.code !== 1) {
          log.debug(`ArchContext] ripgrep error for "${keyword}": ${error.message}`);
        }
      }
    }
    
    log.debug(`ArchContext] ripgrep: found ${results.length} results`);
    
    return results;
  }

  /**
   * Extract patterns from search results
   */
  private extractPatterns(results: SearchResult[]): SimilarPattern[] {
    const patternMap = new Map<string, SearchResult[]>();
    
    // Group by keyword
    for (const result of results) {
      const existing = patternMap.get(result.keyword) || [];
      existing.push(result);
      patternMap.set(result.keyword, existing);
    }
    
    // Convert to patterns
    const patterns: SimilarPattern[] = [];
    
    patternMap.forEach((locations, keyword) => {
      if (locations.length > 0) {
        patterns.push({
          pattern: `Usage of "${keyword}"`,
          locations,
          usageCount: locations.length
        });
      }
    });
    
    return patterns.sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Generate recommendation based on findings
   */
  private generateRecommendation(results: SearchResult[], keywords: string[]): ArchitectureRecommendation {
    if (results.length === 0) {
      return {
        extendExisting: false,
        createNew: true,
        reasoning: 'Похожий код не найден в проекте. Можно создавать новое.',
        suggestedFiles: []
      };
    }
    
    // Get unique files
    const uniqueFiles = [...new Set(results.map(r => r.file))];
    
    if (results.length >= 3) {
      return {
        extendExisting: true,
        createNew: false,
        reasoning: `Найдено ${results.length} похожих реализаций в ${uniqueFiles.length} файлах. Рекомендуется изучить существующий код и следовать установленным паттернам.`,
        suggestedFiles: uniqueFiles.slice(0, 3)
      };
    }
    
    return {
      extendExisting: true,
      createNew: false,
      reasoning: `Найден похожий код. Проверьте существующую реализацию перед созданием нового.`,
      suggestedFiles: uniqueFiles
    };
  }

  /**
   * Generate warnings for AI
   */
  private generateWarnings(results: SearchResult[], keywords: string[]): string[] {
    const warnings: string[] = [];
    
    if (results.length > 0) {
      // Check for potential duplication
      const uniqueFiles = new Set(results.map(r => r.file));
      
      if (uniqueFiles.size >= 2) {
        warnings.push(
          `⚠️ Паттерн "${keywords[0]}" уже используется в ${uniqueFiles.size} файлах. ` +
          `Убедитесь что новое решение не дублирует существующее.`
        );
      }
      
      // Check for established patterns
      if (results.length >= 3) {
        warnings.push(
          `⚠️ Это устоявшийся паттерн в проекте (${results.length} использований). ` +
          `Следуйте существующему подходу вместо создания альтернативного.`
        );
      }
    }
    
    return warnings;
  }

  /**
   * Return empty context
   */
  private emptyContext(startTime: number): ArchitectureContext {
    return {
      keywords: [],
      existingImplementations: [],
      similarPatterns: [],
      recommendation: {
        extendExisting: false,
        createNew: true,
        reasoning: 'Не удалось извлечь ключевые слова из описания задачи.',
        suggestedFiles: []
      },
      warnings: [],
      analysisTimeMs: Date.now() - startTime
    };
  }
}

// ============================================
// SINGLETON
// ============================================

let analyzerInstance: ArchitectureContextAnalyzer | null = null;

export function getArchitectureContextAnalyzer(): ArchitectureContextAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new ArchitectureContextAnalyzer();
  }
  return analyzerInstance;
}

export function createArchitectureContextAnalyzer(
  config?: Partial<ArchitectureContextConfig>
): ArchitectureContextAnalyzer {
  return new ArchitectureContextAnalyzer(config);
}

export default ArchitectureContextAnalyzer;
