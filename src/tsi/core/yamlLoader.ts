/**
 * M7 TSI - YAML Pattern Loader
 * 
 * Loads patterns from YAML files for easier editing and version control.
 * Supports both bundled patterns and user-defined patterns.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { TechPattern, CodeExample, Risk, Alternative, Source } from './types.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('[TSI-YAML]');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Simplified YAML format for patterns
 * More human-readable than full TechPattern
 */
export interface YamlPattern {
  id: string;
  name: string;
  technology: string;
  version?: string;
  category: 'security' | 'performance' | 'architecture' | 'testing' | 'deployment' | 'maintenance';
  type: 'pattern' | 'antipattern';
  description: string;
  
  // Simplified detection
  detection?: {
    patterns?: string[];           // Regex patterns to detect
    excludePatterns?: string[];    // Patterns to exclude (e.g., sanitized versions)
    fileTypes?: string[];          // File extensions to check
  };
  
  // Code examples (simplified)
  examples?: {
    bad?: string;                  // Bad code example (for antipatterns)
    good?: string;                 // Good code example
    language?: string;
  }[];
  
  // Risks (simplified)
  risks?: {
    level: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    mitigation?: string;
  }[];
  
  // Alternatives
  alternatives?: {
    name: string;
    description: string;
  }[];
  
  // Metadata
  tags?: string[];
  confidence?: number;             // 0-1, default 0.8
  riskScore?: number;              // 0-100
  
  // Sources
  sources?: {
    name: string;
    url?: string;
  }[];
}

/**
 * Result of loading patterns
 */
export interface LoadResult {
  patterns: TechPattern[];
  errors: { file: string; error: string }[];
  stats: {
    filesScanned: number;
    patternsLoaded: number;
    byCategory: Record<string, number>;
    byTechnology: Record<string, number>;
  };
}

// ============================================================================
// LOADER CLASS
// ============================================================================

export class YamlPatternLoader {
  private bundledPath: string;
  
  constructor(bundledPath?: string) {
    if (bundledPath) {
      this.bundledPath = bundledPath;
    } else {
      // Find patterns relative to the module location
      // Works both in development (src) and production (dist)
      const moduleDir = path.dirname(new URL(import.meta.url).pathname);
      
      // Check if we're in dist or src
      if (moduleDir.includes('/dist/')) {
        // In dist - patterns are in src/tsi/patterns
        this.bundledPath = moduleDir.replace('/dist/', '/src/').replace('/core', '/patterns');
      } else {
        // In src - patterns are siblings to core
        this.bundledPath = path.join(moduleDir, '..', 'patterns');
      }
    }
  }
  
  /**
   * Load all patterns from bundled YAML files
   */
  async loadBundled(): Promise<LoadResult> {
    return this.loadFromDirectory(this.bundledPath);
  }
  
  /**
   * Load patterns from a specific directory
   */
  async loadFromDirectory(dirPath: string): Promise<LoadResult> {
    const result: LoadResult = {
      patterns: [],
      errors: [],
      stats: {
        filesScanned: 0,
        patternsLoaded: 0,
        byCategory: {},
        byTechnology: {}
      }
    };
    
    try {
      const files = await this.findYamlFiles(dirPath);
      result.stats.filesScanned = files.length;
      
      for (const file of files) {
        try {
          const patterns = await this.loadFile(file);
          for (const pattern of patterns) {
            result.patterns.push(pattern);
            result.stats.patternsLoaded++;
            result.stats.byCategory[pattern.category] = 
              (result.stats.byCategory[pattern.category] || 0) + 1;
            result.stats.byTechnology[pattern.technology] = 
              (result.stats.byTechnology[pattern.technology] || 0) + 1;
          }
        } catch (error) {
          result.errors.push({
            file,
            error: (error as Error).message
          });
        }
      }
    } catch (error) {
      log.debug(`Failed to load patterns from ${dirPath}: ${(error as Error).message}`);
    }
    
    return result;
  }
  
  /**
   * Load patterns from a single YAML file
   */
  async loadFile(filePath: string): Promise<TechPattern[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = parseYaml(content);
    
    // Handle both single pattern and array of patterns
    const yamlPatterns: YamlPattern[] = Array.isArray(data) ? data : [data];
    
    return yamlPatterns.map(yp => this.convertToTechPattern(yp, filePath));
  }
  
  /**
   * Convert simplified YAML format to full TechPattern
   */
  private convertToTechPattern(yaml: YamlPattern, sourceFile: string): TechPattern {
    const now = new Date();
    
    // Convert examples to CodeExample[]
    const implementation: CodeExample[] = [];
    if (yaml.examples) {
      for (const ex of yaml.examples) {
        if (ex.bad) {
          implementation.push({
            language: ex.language || yaml.technology,
            code: ex.bad,
            description: 'Anti-pattern example (avoid this)',
            isComplete: false
          });
        }
        if (ex.good) {
          implementation.push({
            language: ex.language || yaml.technology,
            code: ex.good,
            description: 'Recommended approach',
            isComplete: false
          });
        }
      }
    }
    
    // Convert risks
    const risks: Risk[] = (yaml.risks || []).map((r, idx) => ({
      id: `${yaml.id}-risk-${idx}`,
      level: r.level,
      category: yaml.category,
      description: r.description,
      impact: r.description,
      likelihood: r.level === 'critical' ? 0.9 : r.level === 'high' ? 0.7 : r.level === 'medium' ? 0.5 : 0.3,
      mitigation: r.mitigation ? [r.mitigation] : [],
      examples: []
    }));
    
    // Convert alternatives
    const alternatives: Alternative[] = (yaml.alternatives || []).map((a, idx) => ({
      id: `${yaml.id}-alt-${idx}`,
      name: a.name,
      technology: yaml.technology,
      description: a.description,
      migrationComplexity: 'medium' as const,
      migrationSteps: [],
      pros: [],
      cons: [],
      whenToUse: a.description
    }));
    
    // Convert sources
    const sources: Source[] = (yaml.sources || []).map(s => ({
      title: s.name,
      url: s.url || '',
      type: 'documentation' as const,
      reliability: 0.8
    }));
    
    // Calculate risk score if not provided
    let riskScore = yaml.riskScore;
    if (riskScore === undefined) {
      // Auto-calculate based on risks
      if (risks.length === 0) {
        riskScore = yaml.type === 'antipattern' ? 50 : 10;
      } else {
        const maxRisk = risks.reduce((max, r) => {
          const score = r.level === 'critical' ? 90 : r.level === 'high' ? 70 : r.level === 'medium' ? 50 : 30;
          return Math.max(max, score);
        }, 0);
        riskScore = maxRisk;
      }
    }
    
    // Build detection patterns for metadata
    const detectionPatterns = yaml.detection?.patterns || [];
    
    return {
      id: yaml.id,
      name: yaml.name,
      technology: yaml.technology,
      version: yaml.version,
      category: yaml.category,
      type: yaml.type,
      description: yaml.description,
      implementation,
      risks,
      riskScore,
      alternatives,
      confidence: yaml.confidence ?? 0.8,
      tags: [
        ...(yaml.tags || []),
        yaml.technology,
        yaml.category,
        yaml.type,
        ...detectionPatterns.slice(0, 3) // Add first few detection patterns as tags
      ],
      createdAt: now,
      updatedAt: now,
      usageCount: 0,
      successRate: 0,
      applicableContexts: yaml.detection?.fileTypes?.map(ft => `*.${ft}`) || [],
      incompatibleWith: [],
      sources,
      documentation: sources.filter(s => s.url).map(s => s.url!)
    };
  }
  
  /**
   * Find all YAML files in a directory (recursive)
   */
  private async findYamlFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.findYamlFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or not readable
    }
    
    return files;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Load bundled patterns (singleton)
 */
let cachedPatterns: TechPattern[] | null = null;

export async function loadBundledPatterns(): Promise<TechPattern[]> {
  if (cachedPatterns) {
    return cachedPatterns;
  }
  
  const loader = new YamlPatternLoader();
  const result = await loader.loadBundled();
  
  if (result.errors.length > 0) {
    log.debug(`Pattern loading had ${result.errors.length} errors`);
  }
  
  cachedPatterns = result.patterns;
  return result.patterns;
}

/**
 * Clear cached patterns (for testing)
 */
export function clearPatternCache(): void {
  cachedPatterns = null;
}
