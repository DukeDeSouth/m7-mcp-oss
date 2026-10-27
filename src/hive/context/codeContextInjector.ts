import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[CodeContextInjector]');

/**
 * M7 Hive - Code Context Injector
 * 
 * Main class for injecting relevant code context into agent prompts.
 * 
 * @version 3.8.0
 */

import { CodeContextOptions, CodeContext, DEFAULT_CODE_CONTEXT_OPTIONS, EMPTY_CODE_CONTEXT } from './types.js';
import { extractKeywords } from './keywordExtractor.js';
import { searchRelevantFiles } from './fileSearcher.js';
import { buildCodeContext, buildMinimalContext } from './contextBuilder.js';

/**
 * Code Context Injector
 * 
 * Extracts relevant code from project based on task description
 * and formats it for injection into agent prompts.
 * 
 * @example
 * ```typescript
 * const injector = new CodeContextInjector('/path/to/project');
 * const context = await injector.getContext('implement email validator');
 * 
 * const prompt = `${task.description}\n\n${context.markdown}`;
 * ```
 */
export class CodeContextInjector {
  private options: CodeContextOptions;
  
  constructor(projectPath: string, options: Partial<CodeContextOptions> = {}) {
    this.options = {
      ...DEFAULT_CODE_CONTEXT_OPTIONS,
      ...options,
      projectPath
    };
  }
  
  /**
   * Get code context for a task description
   * 
   * @param taskDescription - Description of the task
   * @param minimal - If true, only return file paths (no content)
   * @returns Code context with markdown for prompt injection
   */
  async getContext(taskDescription: string, minimal: boolean = false): Promise<CodeContext> {
    const startTime = Date.now();
    
    try {
      // Step 1: Extract keywords from task
      const keywords = extractKeywords(taskDescription);
      
      if (keywords.length === 0) {
        log.debug('[CodeContext] No keywords extracted from task');
        return {
          ...EMPTY_CODE_CONTEXT,
          searchDurationMs: Date.now() - startTime
        };
      }
      
      log.debug(`[CodeContext] Extracted keywords: ${keywords.slice(0, 5).join(', ')}`);
      
      // Step 2: Search for relevant files
      const files = await searchRelevantFiles(
        this.options.projectPath,
        keywords,
        this.options
      );
      
      log.debug(`[CodeContext] Found ${files.length} relevant files`);
      
      // Step 3: Build context markdown
      const searchDurationMs = Date.now() - startTime;
      
      if (minimal) {
        return buildMinimalContext(files, keywords, searchDurationMs);
      }
      
      return buildCodeContext(
        files,
        keywords,
        searchDurationMs,
        this.options.maxTotalTokens
      );
      
    } catch (error: any) {
      log.debug(`[CodeContext] Error: ${error.message}`);
      return {
        ...EMPTY_CODE_CONTEXT,
        searchDurationMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Get context for multiple tasks at once (batch)
   */
  async getBatchContext(taskDescriptions: string[]): Promise<Map<string, CodeContext>> {
    const results = new Map<string, CodeContext>();
    
    for (const desc of taskDescriptions) {
      const context = await this.getContext(desc);
      results.set(desc, context);
    }
    
    return results;
  }
  
  /**
   * Update options
   */
  updateOptions(options: Partial<CodeContextOptions>): void {
    this.options = { ...this.options, ...options };
  }
  
  /**
   * Get current options
   */
  getOptions(): CodeContextOptions {
    return { ...this.options };
  }
}

import { BoundedMap } from '../../core/utils/boundedMap.js';

// Singleton instance cache (LRU, max 20 projects)
let instanceCache = new BoundedMap<string, CodeContextInjector>(20);

/**
 * Get or create CodeContextInjector for project
 */
export function getCodeContextInjector(projectPath: string): CodeContextInjector {
  if (!instanceCache.has(projectPath)) {
    instanceCache.set(projectPath, new CodeContextInjector(projectPath));
  }
  return instanceCache.get(projectPath)!;
}

/**
 * Clear instance cache (for testing)
 */
export function clearCodeContextCache(): void {
  instanceCache.clear();
}
