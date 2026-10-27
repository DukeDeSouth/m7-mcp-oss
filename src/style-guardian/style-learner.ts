import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[StyleGuardian]');
/**
 * M7 v3.0 - Style Learner
 * 
 * Learn code style patterns from user corrections and code reviews
 */

import { UnifiedMemoryCore, getMemoryCore } from '../memory/auto/unified-memory-core.js';
import {
  StyleProfile,
  CustomStyleRule,
  StyleCorrection,
  LearningEvent,
  StyleGuardianConfig,
  DEFAULT_STYLE_GUARDIAN_CONFIG
} from './types.js';

// ============================================
// CORRECTION ANALYSIS
// ============================================

interface CorrectionAnalysis {
  type: 'naming' | 'formatting' | 'pattern' | 'import' | 'other';
  originalPattern: string;
  correctedPattern: string;
  context: string;
  confidence: number;
  extractedRule?: string;
}

function analyzeCorrection(original: string, corrected: string, context: string): CorrectionAnalysis {
  // Detect the type of correction
  const originalLines = original.split('\n');
  const correctedLines = corrected.split('\n');
  
  // Check for naming changes
  const namingChange = detectNamingChange(original, corrected);
  if (namingChange) {
    return {
      type: 'naming',
      originalPattern: namingChange.original,
      correctedPattern: namingChange.corrected,
      context,
      confidence: 0.8,
      extractedRule: `Use ${namingChange.convention} for ${namingChange.element}`
    };
  }
  
  // Check for import changes
  const importChange = detectImportChange(original, corrected);
  if (importChange) {
    return {
      type: 'import',
      originalPattern: importChange.original,
      correctedPattern: importChange.corrected,
      context,
      confidence: 0.85,
      extractedRule: importChange.rule
    };
  }
  
  // Check for formatting changes
  if (originalLines.length === correctedLines.length) {
    const formattingChange = detectFormattingChange(original, corrected);
    if (formattingChange) {
      return {
        type: 'formatting',
        originalPattern: formattingChange.original,
        correctedPattern: formattingChange.corrected,
        context,
        confidence: 0.7,
        extractedRule: formattingChange.rule
      };
    }
  }
  
  // General pattern change
  return {
    type: 'pattern',
    originalPattern: extractPattern(original),
    correctedPattern: extractPattern(corrected),
    context,
    confidence: 0.6
  };
}

function detectNamingChange(original: string, corrected: string): {
  original: string;
  corrected: string;
  convention: string;
  element: string;
} | null {
  // Look for identifier changes
  const identifierPattern = /(?:const|let|var|function|class|interface|type)\s+(\w+)/g;
  
  const originalIds = [...original.matchAll(identifierPattern)].map(m => m[1]);
  const correctedIds = [...corrected.matchAll(identifierPattern)].map(m => m[1]);
  
  for (let i = 0; i < Math.min(originalIds.length, correctedIds.length); i++) {
    if (originalIds[i] !== correctedIds[i]) {
      const origConv = detectConvention(originalIds[i]);
      const corrConv = detectConvention(correctedIds[i]);
      
      if (origConv !== corrConv) {
        return {
          original: originalIds[i],
          corrected: correctedIds[i],
          convention: corrConv,
          element: detectElement(original)
        };
      }
    }
  }
  
  return null;
}

function detectImportChange(original: string, corrected: string): {
  original: string;
  corrected: string;
  rule: string;
} | null {
  const importPattern = /import\s+.*\s+from\s+['"]([^'"]+)['"]/;
  
  const originalMatch = original.match(importPattern);
  const correctedMatch = corrected.match(importPattern);
  
  if (originalMatch && correctedMatch && originalMatch[1] !== correctedMatch[1]) {
    // Path alias change
    if (correctedMatch[1].startsWith('@/') && !originalMatch[1].startsWith('@/')) {
      return {
        original: originalMatch[1],
        corrected: correctedMatch[1],
        rule: 'Use @/ path alias for project imports'
      };
    }
    
    // Relative to absolute
    if (originalMatch[1].startsWith('../') && !correctedMatch[1].startsWith('../')) {
      return {
        original: originalMatch[1],
        corrected: correctedMatch[1],
        rule: 'Prefer absolute imports over relative paths'
      };
    }
    
    return {
      original: originalMatch[1],
      corrected: correctedMatch[1],
      rule: `Import from ${correctedMatch[1]} instead of ${originalMatch[1]}`
    };
  }
  
  return null;
}

function detectFormattingChange(original: string, corrected: string): {
  original: string;
  corrected: string;
  rule: string;
} | null {
  // Check semicolon changes
  if (original.endsWith(';') && !corrected.endsWith(';')) {
    return {
      original: 'with semicolon',
      corrected: 'without semicolon',
      rule: 'Omit semicolons'
    };
  }
  if (!original.endsWith(';') && corrected.endsWith(';')) {
    return {
      original: 'without semicolon',
      corrected: 'with semicolon',
      rule: 'Always use semicolons'
    };
  }
  
  // Check quote changes
  if (original.includes("'") && corrected.includes('"') && 
      !original.includes('"') && !corrected.includes("'")) {
    return {
      original: 'single quotes',
      corrected: 'double quotes',
      rule: 'Use double quotes for strings'
    };
  }
  if (original.includes('"') && corrected.includes("'") &&
      !original.includes("'") && !corrected.includes('"')) {
    return {
      original: 'double quotes',
      corrected: 'single quotes',
      rule: 'Use single quotes for strings'
    };
  }
  
  return null;
}

function detectConvention(name: string): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return 'UPPER_SNAKE_CASE';
  if (/^[a-z][a-z0-9_]*$/.test(name)) return 'snake_case';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase';
  return 'mixed';
}

function detectElement(code: string): string {
  if (code.includes('function')) return 'function';
  if (code.includes('class')) return 'class';
  if (code.includes('interface')) return 'interface';
  if (code.includes('type ')) return 'type';
  if (code.includes('const')) return 'constant';
  if (code.includes('let') || code.includes('var')) return 'variable';
  return 'identifier';
}

function extractPattern(code: string): string {
  // Create a simplified pattern from code
  return code
    .replace(/['"][^'"]*['"]/g, '""')  // Normalize strings
    .replace(/\d+/g, 'N')              // Normalize numbers
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .trim();
}

// ============================================
// STYLE LEARNER CLASS
// ============================================

export class StyleLearner {
  private memory: UnifiedMemoryCore | null = null;
  private config: StyleGuardianConfig;
  private corrections: StyleCorrection[] = [];
  private learningEvents: LearningEvent[] = [];
  
  constructor(config: Partial<StyleGuardianConfig> = {}) {
    this.config = { ...DEFAULT_STYLE_GUARDIAN_CONFIG, ...config };
  }
  
  /**
   * Initialize with unified memory for learning
   * v5.0: Uses UnifiedMemoryCore instead of PersistentMemory
   */
  async initialize(chromaUrl?: string): Promise<void> {
    try {
      this.memory = await getMemoryCore();
      await this.memory.initialize();
    } catch (error) {
      // Non-fatal - can work without persistent memory
      log.debug('StyleLearner] Failed to initialize unified memory:', error);
    }
  }
  
  /**
   * Record a style correction and learn from it
   */
  async recordCorrection(
    original: string,
    corrected: string,
    file: string,
    context: string = ''
  ): Promise<{
    correctionId: string;
    analysis: CorrectionAnalysis;
    ruleCreated: boolean;
  }> {
    const analysis = analyzeCorrection(original, corrected, context);
    
    const correction: StyleCorrection = {
      id: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      original,
      corrected,
      file,
      timestamp: new Date(),
      context,
      ruleExtracted: analysis.extractedRule,
      confidence: analysis.confidence
    };
    
    this.corrections.push(correction);
    
    // Log learning event
    this.learningEvents.push({
      type: 'correction',
      patternId: correction.id,
      confidence: analysis.confidence,
      timestamp: new Date(),
      context: file
    });
    
    // Store in unified memory for semantic matching
    // v5.0: Uses UnifiedMemoryCore.store()
    let ruleCreated = false;
    if (this.memory && analysis.extractedRule) {
      await this.memory.store(
        `${analysis.extractedRule}\n\nOriginal: ${original}\nCorrected: ${corrected}`,
        {
          level: 'L2',
          source: 'code_analysis',
          contextKeys: [analysis.type, 'learned', 'correction', file || ''],
          confidence: analysis.confidence
        }
      );
      ruleCreated = true;
    }
    
    return {
      correctionId: correction.id,
      analysis,
      ruleCreated
    };
  }
  
  /**
   * Find similar past corrections
   */
  async findSimilarCorrections(code: string, limit: number = 5): Promise<StyleCorrection[]> {
    if (!this.memory) {
      // Search in memory (in-memory fallback)
      const pattern = extractPattern(code);
      return this.corrections
        .filter(c => extractPattern(c.original).includes(pattern) || 
                     extractPattern(c.corrected).includes(pattern))
        .slice(0, limit);
    }
    
    // v5.0: Uses UnifiedMemoryCore.cascadeSearch()
    const results = await this.memory.cascadeSearch(code, { limit });
    
    // Map back to corrections
    const correctionIds = new Set(results.map(r => r.record.id));
    return this.corrections.filter(c => correctionIds.has(c.id));
  }
  
  /**
   * Get learned custom rules from corrections
   */
  getLearnedRules(minConfidence: number = 0.7): CustomStyleRule[] {
    const ruleMap = new Map<string, {
      count: number;
      totalConfidence: number;
      lastUsed: Date;
      examples: StyleCorrection[];
    }>();
    
    for (const correction of this.corrections) {
      if (!correction.ruleExtracted) continue;
      
      const rule = correction.ruleExtracted;
      const existing = ruleMap.get(rule);
      
      if (existing) {
        existing.count++;
        existing.totalConfidence += correction.confidence;
        existing.lastUsed = correction.timestamp;
        existing.examples.push(correction);
      } else {
        ruleMap.set(rule, {
          count: 1,
          totalConfidence: correction.confidence,
          lastUsed: correction.timestamp,
          examples: [correction]
        });
      }
    }
    
    const rules: CustomStyleRule[] = [];
    
    for (const [rule, data] of ruleMap) {
      const avgConfidence = data.totalConfidence / data.count;
      
      if (avgConfidence >= minConfidence) {
        rules.push({
          id: `rule_${Buffer.from(rule).toString('base64').slice(0, 12)}`,
          name: rule.slice(0, 50),
          description: rule,
          pattern: extractPattern(data.examples[0].original),
          replacement: extractPattern(data.examples[0].corrected),
          learnedFrom: 'correction',
          confidence: avgConfidence,
          occurrences: data.count,
          createdAt: data.examples[0].timestamp,
          lastUsed: data.lastUsed
        });
      }
    }
    
    return rules.sort((a, b) => b.confidence - a.confidence);
  }
  
  /**
   * Apply learning to update a StyleProfile
   */
  updateProfile(profile: StyleProfile): StyleProfile {
    const learnedRules = this.getLearnedRules(this.config.confidenceThreshold);
    
    // Merge with existing custom rules
    const existingIds = new Set(profile.customRules.map(r => r.id));
    const newRules = learnedRules.filter(r => !existingIds.has(r.id));
    
    // Limit total rules
    const allRules = [...profile.customRules, ...newRules]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxCustomRules);
    
    // Calculate learning rate
    const recentEvents = this.learningEvents.filter(
      e => Date.now() - e.timestamp.getTime() < 7 * 24 * 60 * 60 * 1000 // Last 7 days
    );
    const learningRate = recentEvents.length > 0 
      ? recentEvents.reduce((sum, e) => sum + e.confidence, 0) / recentEvents.length
      : profile.learningRate;
    
    return {
      ...profile,
      customRules: allRules,
      learningRate,
      updatedAt: new Date()
    };
  }
  
  /**
   * Get learning statistics
   */
  getStatistics(): {
    totalCorrections: number;
    rulesLearned: number;
    avgConfidence: number;
    learningRate: number;
    correctionsByType: Record<string, number>;
    recentActivity: { date: Date; count: number }[];
  } {
    const rulesLearned = this.getLearnedRules().length;
    
    const avgConfidence = this.corrections.length > 0
      ? this.corrections.reduce((sum, c) => sum + c.confidence, 0) / this.corrections.length
      : 0;
    
    // Count by type
    const byType: Record<string, number> = {};
    for (const correction of this.corrections) {
      const analysis = analyzeCorrection(correction.original, correction.corrected, correction.context);
      byType[analysis.type] = (byType[analysis.type] || 0) + 1;
    }
    
    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentCorrections = this.corrections.filter(c => c.timestamp > thirtyDaysAgo);
    
    const activityByDay = new Map<string, number>();
    for (const correction of recentCorrections) {
      const day = correction.timestamp.toISOString().split('T')[0];
      activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
    }
    
    const recentActivity = Array.from(activityByDay.entries())
      .map(([date, count]) => ({ date: new Date(date), count }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    
    // Learning rate from recent events
    const recentEvents = this.learningEvents.filter(e => e.timestamp > thirtyDaysAgo);
    const learningRate = recentEvents.length > 0
      ? recentEvents.reduce((sum, e) => sum + e.confidence, 0) / recentEvents.length
      : 0;
    
    return {
      totalCorrections: this.corrections.length,
      rulesLearned,
      avgConfidence,
      learningRate,
      correctionsByType: byType,
      recentActivity
    };
  }
  
  /**
   * Export corrections for backup
   */
  exportCorrections(): StyleCorrection[] {
    return [...this.corrections];
  }
  
  /**
   * Import corrections from backup
   */
  importCorrections(corrections: StyleCorrection[]): void {
    for (const correction of corrections) {
      if (!this.corrections.find(c => c.id === correction.id)) {
        this.corrections.push(correction);
      }
    }
  }
  
  /**
   * Clear all learned data
   */
  async clear(): Promise<void> {
    this.corrections = [];
    this.learningEvents = [];
    
    // Reinitialize memory (creates new collection)
    this.memory = null;
    await this.initialize();
  }
}

export default StyleLearner;

