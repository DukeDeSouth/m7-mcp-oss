import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[StyleGuardian]');
/**
 * M7 v3.0 - Style Guardian
 * 
 * Main entry point for the Style Guardian system
 * Combines analysis, learning, and validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { StyleAnalyzer } from './style-analyzer.js';
import { StyleLearner } from './style-learner.js';
import { StyleValidator } from './style-validator.js';
import {
  StyleProfile,
  StyleGuardianConfig,
  DEFAULT_STYLE_GUARDIAN_CONFIG,
  ValidationResult,
  StyleCorrection,
  StyleViolation
} from './types.js';

// Re-export types
export * from './types.js';
export { StyleAnalyzer } from './style-analyzer.js';
export { StyleLearner } from './style-learner.js';
export { StyleValidator } from './style-validator.js';

// ============================================
// STYLE GUARDIAN CLASS
// ============================================

export class StyleGuardian {
  private analyzer: StyleAnalyzer;
  private learner: StyleLearner;
  private validator: StyleValidator;
  private config: StyleGuardianConfig;
  private profile: StyleProfile | null = null;
  private profilePath: string;
  private initialized: boolean = false;
  
  constructor(config: Partial<StyleGuardianConfig> = {}) {
    this.config = { ...DEFAULT_STYLE_GUARDIAN_CONFIG, ...config };
    this.analyzer = new StyleAnalyzer(this.config);
    this.learner = new StyleLearner(this.config);
    this.validator = new StyleValidator(this.config);
    this.profilePath = path.join(process.env.HOME || '~', '.m7', 'style-profile.json');
  }
  
  /**
   * Initialize the Style Guardian system
   */
  async initialize(chromaUrl?: string): Promise<void> {
    if (this.initialized) return;
    
    // Initialize learner with ChromaDB
    await this.learner.initialize(chromaUrl);
    
    // Load saved profile if exists
    await this.loadProfile();
    
    this.initialized = true;
  }
  
  /**
   * Analyze a project and create/update style profile
   */
  async analyzeProject(projectPath: string): Promise<StyleProfile> {
    const profile = await this.analyzer.analyzeProject(projectPath);
    
    // Merge with existing profile if any
    if (this.profile) {
      profile.customRules = [...this.profile.customRules, ...profile.customRules];
    }
    
    // Update with learned rules
    this.profile = this.learner.updateProfile(profile);
    this.validator.setProfile(this.profile);
    
    // Save profile
    await this.saveProfile();
    
    return this.profile;
  }
  
  /**
   * Analyze a single file
   */
  analyzeFile(filePath: string, content?: string): ReturnType<StyleAnalyzer['analyzeFile']> {
    return this.analyzer.analyzeFile(filePath, content);
  }
  
  /**
   * Validate code against current profile
   */
  validate(content: string, filePath: string = 'unknown'): ValidationResult {
    if (!this.profile) {
      return {
        file: filePath,
        violations: [],
        score: 100,
        passedRules: 0,
        failedRules: 0,
        processingTime: 0
      };
    }
    
    return this.validator.validate(content, filePath);
  }
  
  /**
   * Check if code has blocking errors
   */
  hasErrors(content: string, filePath?: string): boolean {
    return this.validator.hasErrors(content, filePath);
  }
  
  /**
   * Get errors only
   */
  getErrors(content: string, filePath?: string): StyleViolation[] {
    return this.validator.getErrors(content, filePath);
  }
  
  /**
   * Auto-fix code where possible
   */
  autoFix(content: string, filePath?: string): {
    fixed: string;
    fixedCount: number;
    remainingViolations: StyleViolation[];
  } {
    return this.validator.autoFix(content, filePath);
  }
  
  /**
   * Record a user correction for learning
   */
  async recordCorrection(
    original: string,
    corrected: string,
    file: string,
    context?: string
  ): Promise<{
    correctionId: string;
    ruleCreated: boolean;
  }> {
    const result = await this.learner.recordCorrection(original, corrected, file, context);
    
    // Update profile with new learning
    if (this.profile) {
      this.profile = this.learner.updateProfile(this.profile);
      this.validator.setProfile(this.profile);
      await this.saveProfile();
    }
    
    return {
      correctionId: result.correctionId,
      ruleCreated: result.ruleCreated
    };
  }
  
  /**
   * Find similar past corrections
   */
  async findSimilarCorrections(code: string, limit?: number): Promise<StyleCorrection[]> {
    return this.learner.findSimilarCorrections(code, limit);
  }
  
  /**
   * Get current profile
   */
  getProfile(): StyleProfile | null {
    return this.profile;
  }
  
  /**
   * Set profile directly
   */
  setProfile(profile: StyleProfile): void {
    this.profile = profile;
    this.validator.setProfile(profile);
  }
  
  /**
   * Get learning statistics
   */
  getStatistics(): ReturnType<StyleLearner['getStatistics']> & {
    profileLoaded: boolean;
    filesAnalyzed: number;
    totalRules: number;
    customRules: number;
  } {
    const learnerStats = this.learner.getStatistics();
    
    return {
      ...learnerStats,
      profileLoaded: !!this.profile,
      filesAnalyzed: this.profile?.filesAnalyzed || 0,
      totalRules: this.profile ? (
        this.profile.naming.length +
        this.profile.antiPatterns.length +
        this.profile.customRules.length
      ) : 0,
      customRules: this.profile?.customRules.length || 0
    };
  }
  
  /**
   * Format validation result as report
   */
  formatReport(result: ValidationResult): string {
    return this.validator.formatReport(result);
  }
  
  /**
   * Export corrections for backup
   */
  exportCorrections(): StyleCorrection[] {
    return this.learner.exportCorrections();
  }
  
  /**
   * Import corrections
   */
  importCorrections(corrections: StyleCorrection[]): void {
    this.learner.importCorrections(corrections);
  }
  
  /**
   * Clear all learned data
   */
  async clear(): Promise<void> {
    await this.learner.clear();
    this.profile = null;
    
    // Delete saved profile
    try {
      await fs.promises.unlink(this.profilePath);
    } catch {
      // Ignore if doesn't exist
    }
  }
  
  // ============================================
  // v3.6: QUICK CHECK (for File Watcher)
  // ============================================

  /**
   * v3.6: Quick style check for a single file
   * Lightweight check suitable for file watcher (doesn't block)
   * Returns warnings array, doesn't throw
   */
  async quickCheck(filePath: string): Promise<string[]> {
    const warnings: string[] = [];
    
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const fileName = path.basename(filePath);
      
      // 1. Line length check (> 120 chars)
      let longLineCount = 0;
      lines.forEach((line, i) => {
        if (line.length > 120) {
          longLineCount++;
          if (longLineCount <= 3) { // Report max 3
            warnings.push(`Line ${i + 1}: exceeds 120 chars (${line.length})`);
          }
        }
      });
      if (longLineCount > 3) {
        warnings.push(`... and ${longLineCount - 3} more long lines`);
      }
      
      // 2. Console statements (not in test files)
      if (!filePath.includes('.test.') && !filePath.includes('.spec.') && !filePath.includes('__tests__')) {
        const consoleMatches = content.match(/console\.(log|warn|error|debug|info)\s*\(/g);
        if (consoleMatches && consoleMatches.length > 0) {
          warnings.push(`Found ${consoleMatches.length} console.* statement(s)`);
        }
      }
      
      // 3. TODO/FIXME comments (threshold: > 3)
      const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
      if (todoMatches && todoMatches.length > 3) {
        warnings.push(`Found ${todoMatches.length} TODO/FIXME comments`);
      }
      
      // 4. 'any' type usage (threshold: > 2)
      const anyMatches = content.match(/:\s*any\b/g);
      if (anyMatches && anyMatches.length > 2) {
        warnings.push(`Found ${anyMatches.length} 'any' type usage(s)`);
      }
      
      // 5. Empty catch blocks
      const emptyCatch = content.match(/catch\s*\([^)]*\)\s*\{\s*\}/g);
      if (emptyCatch && emptyCatch.length > 0) {
        warnings.push(`Found ${emptyCatch.length} empty catch block(s)`);
      }
      
      // 6. Very long functions (> 100 lines between braces)
      // Simplified check - just count function declarations
      const functionDecls = content.match(/(?:function|async function|const\s+\w+\s*=\s*(?:async\s*)?\()/g);
      if (functionDecls && functionDecls.length > 20) {
        warnings.push(`File has ${functionDecls.length} functions - consider splitting`);
      }
      
    } catch (error: any) {
      // File might be deleted or unreadable - silently ignore
      if (error.code !== 'ENOENT') {
        log.debug(`StyleGuardian] quickCheck error: ${error.message}`);
      }
    }
    
    return warnings;
  }
  
  // ============================================
  // PERSISTENCE
  // ============================================
  
  private async loadProfile(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.profilePath, 'utf-8');
      this.profile = JSON.parse(data);
      
      // Convert date strings back to Date objects
      if (this.profile) {
        this.profile.createdAt = new Date(this.profile.createdAt);
        this.profile.updatedAt = new Date(this.profile.updatedAt);
        
        for (const rule of this.profile.customRules) {
          rule.createdAt = new Date(rule.createdAt);
          rule.lastUsed = new Date(rule.lastUsed);
        }
        
        this.validator.setProfile(this.profile);
      }
    } catch {
      // No profile saved yet
    }
  }
  
  private async saveProfile(): Promise<void> {
    if (!this.profile) return;
    
    // Ensure directory exists
    const dir = path.dirname(this.profilePath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    // Save profile
    await fs.promises.writeFile(
      this.profilePath,
      JSON.stringify(this.profile, null, 2)
    );
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: StyleGuardian | null = null;

export function getStyleGuardian(config?: Partial<StyleGuardianConfig>): StyleGuardian {
  if (!instance) {
    instance = new StyleGuardian(config);
  }
  return instance;
}

export default StyleGuardian;

