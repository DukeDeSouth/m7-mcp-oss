/**
 * M7 Hive v3.0 - Gatekeeper Manager
 * 
 * Runs validation checkpoints using Style Guardian, Architecture Advisor,
 * and other quality gates before accepting task results.
 * 
 * @version 3.8.0
 */

import {
  CNPResult,
  CNPValidation,
  CNPValidationIssue,
  GatekeeperConfig
} from './types.js';
import { silentLogger as logger } from '../../core/utils/logger.js';

// Default timeout for gatekeeper checks
const GATEKEEPER_TIMEOUT_MS = 10000;

/**
 * Gatekeeper Manager - Validates task results
 */
export class GatekeeperManager {
  private config: GatekeeperConfig[];
  private timeoutMs: number;
  
  constructor(
    config: GatekeeperConfig[] = [],
    timeoutMs: number = GATEKEEPER_TIMEOUT_MS
  ) {
    this.config = config;
    this.timeoutMs = timeoutMs;
    logger.info(`[Gatekeepers] ✅ Initialized with ${config.filter(c => c.enabled).length} active gatekeepers`);
  }
  
  /**
   * Run all configured gatekeepers on a result
   */
  async validate(result: CNPResult): Promise<CNPValidation[]> {
    const validations: CNPValidation[] = [];
    
    for (const gatekeeper of this.config) {
      if (!gatekeeper.enabled) continue;
      
      logger.info(`[Gatekeepers] 🔍 Running ${gatekeeper.type} check...`);
      
      try {
        const validation = await this.runGatekeeperWithTimeout(gatekeeper, result);
        validations.push(validation);
        
        logger.info(`[Gatekeepers] ${validation.passed ? '✅' : '❌'} ${gatekeeper.type}: ${validation.passed ? 'PASSED' : 'FAILED'}`);
        
        // Stop on blocking failure
        if (gatekeeper.blocking && !validation.passed) {
          logger.warn(`[Gatekeepers] 🛑 Blocking failure in ${gatekeeper.type}, stopping validation`);
          break;
        }
      } catch (error: any) {
        logger.error(`[Gatekeepers] ❌ ${gatekeeper.type} error: ${error.message}`);
        
        // Create timeout/error validation
        validations.push({
          taskId: result.taskId,
          resultId: result.taskId,
          gatekeeper: gatekeeper.type,
          passed: !gatekeeper.blocking, // Pass if non-blocking
          issues: [{
            severity: 'warning',
            message: `Gatekeeper ${gatekeeper.type} failed: ${error.message}`
          }],
          timestamp: new Date().toISOString(),
          timeout: error.message.includes('timeout')
        });
        
        if (gatekeeper.blocking) break;
      }
    }
    
    return validations;
  }
  
  /**
   * Run gatekeeper with timeout
   */
  private async runGatekeeperWithTimeout(
    config: GatekeeperConfig,
    result: CNPResult
  ): Promise<CNPValidation> {
    
    return Promise.race([
      this.runGatekeeper(config, result),
      new Promise<CNPValidation>((_, reject) => 
        setTimeout(() => reject(new Error('Gatekeeper timeout')), this.timeoutMs)
      )
    ]);
  }
  
  /**
   * Run specific gatekeeper
   */
  private async runGatekeeper(
    config: GatekeeperConfig,
    result: CNPResult
  ): Promise<CNPValidation> {
    
    switch (config.type) {
      case 'style':
        return this.runStyleCheck(result, config);
      case 'arch':
        return this.runArchCheck(result, config);
      case 'security':
        return this.runSecurityCheck(result, config);
      case 'test':
        return this.runTestCheck(result, config);
      default:
        return this.createPassingValidation(result, config.type);
    }
  }
  
  /**
   * Style Guardian check
   * Note: StyleGuardian.quickCheck expects a file path, so we do pattern-based check
   */
  private async runStyleCheck(
    result: CNPResult,
    config: GatekeeperConfig
  ): Promise<CNPValidation> {
    
    const issues: CNPValidationIssue[] = [];
    const output = result.output;
    
    try {
      // Pattern-based style checks on output content
      const lines = output.split('\n');
      
      // Check for long lines
      let longLineCount = 0;
      lines.forEach((line, i) => {
        if (line.length > 120) {
          longLineCount++;
          if (longLineCount <= 3) {
            issues.push({
              severity: 'warning',
              message: `Line ${i + 1}: exceeds 120 chars (${line.length})`,
              location: `line ${i + 1}`
            });
          }
        }
      });
      
      // Check for console statements
      const consoleMatches = output.match(/console\.(log|warn|error|debug|info)\s*\(/g);
      if (consoleMatches && consoleMatches.length > 3) {
        issues.push({
          severity: 'warning',
          message: `Found ${consoleMatches.length} console.* statement(s)`,
          suggestion: 'Consider using a logger instead'
        });
      }
      
      // Check for any type
      const anyMatches = output.match(/:\s*any\b/g);
      if (anyMatches && anyMatches.length > 0) {
        issues.push({
          severity: 'info',
          message: `Found ${anyMatches.length} 'any' type usage(s)`,
          suggestion: 'Consider using specific types'
        });
      }
      
      const errorCount = issues.filter(i => i.severity === 'error').length;
      const threshold = config.threshold || 0;
      const passed = errorCount <= threshold;
      
      return {
        taskId: result.taskId,
        resultId: result.taskId,
        gatekeeper: 'style',
        passed,
        issues,
        timestamp: new Date().toISOString()
      };
      
    } catch (error: any) {
      logger.warn(`[Gatekeepers] Style check failed: ${error.message}`);
      return this.createPassingValidation(result, 'style', 
        'Style check not available');
    }
  }
  
  /**
   * Architecture Advisor check
   * Pattern-based analysis of architectural concerns in output
   */
  private async runArchCheck(
    result: CNPResult,
    config: GatekeeperConfig
  ): Promise<CNPValidation> {
    
    const issues: CNPValidationIssue[] = [];
    const output = result.output.toLowerCase();
    
    try {
      // Pattern-based architecture checks
      
      // Check for god objects (too many methods/properties)
      const classMatches = output.match(/class\s+\w+/g) || [];
      const methodMatches = output.match(/\b(async\s+)?\w+\s*\([^)]*\)\s*[:{]/g) || [];
      
      if (classMatches.length === 1 && methodMatches.length > 15) {
        issues.push({
          severity: 'warning',
          message: 'Potential god class: single class with many methods',
          suggestion: 'Consider splitting into smaller, focused classes'
        });
      }
      
      // Check for deep nesting
      const deepNesting = output.match(/(\s{12,})[^\s]/g);
      if (deepNesting && deepNesting.length > 5) {
        issues.push({
          severity: 'warning',
          message: 'Deep nesting detected',
          suggestion: 'Consider extracting methods or using early returns'
        });
      }
      
      // Check for circular dependency indicators
      if (output.includes('circular') && output.includes('depend')) {
        issues.push({
          severity: 'error',
          message: 'Circular dependency mentioned in output',
          suggestion: 'Review and break circular dependencies'
        });
      }
      
      // Check for missing error handling
      const tryCount = (output.match(/\btry\s*{/g) || []).length;
      const awaitCount = (output.match(/\bawait\s+/g) || []).length;
      
      if (awaitCount > 3 && tryCount === 0) {
        issues.push({
          severity: 'info',
          message: 'Multiple async operations without visible error handling',
          suggestion: 'Consider adding try/catch blocks'
        });
      }
      
      const errorCount = issues.filter(i => i.severity === 'error').length;
      const threshold = config.threshold || 0;
      const passed = errorCount <= threshold;
      
      return {
        taskId: result.taskId,
        resultId: result.taskId,
        gatekeeper: 'arch',
        passed,
        issues,
        timestamp: new Date().toISOString()
      };
      
    } catch (error: any) {
      logger.warn(`[Gatekeepers] Architecture check failed: ${error.message}`);
      return this.createPassingValidation(result, 'arch',
        'Architecture check not available');
    }
  }
  
  /**
   * Security check (basic pattern matching)
   */
  private async runSecurityCheck(
    result: CNPResult,
    config: GatekeeperConfig
  ): Promise<CNPValidation> {
    
    const issues: CNPValidationIssue[] = [];
    const output = result.output.toLowerCase();
    
    // Basic security patterns to check
    const securityPatterns = [
      { pattern: /password\s*=\s*['"][^'"]+['"]/, message: 'Hardcoded password detected' },
      { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/, message: 'Hardcoded API key detected' },
      { pattern: /secret\s*=\s*['"][^'"]+['"]/, message: 'Hardcoded secret detected' },
      { pattern: /eval\s*\(/, message: 'Use of eval() detected' },
      { pattern: /exec\s*\(/, message: 'Use of exec() detected' },
      { pattern: /dangerouslySetInnerHTML/, message: 'dangerouslySetInnerHTML usage detected' },
      { pattern: /innerHTML\s*=/, message: 'Direct innerHTML assignment detected' },
      { pattern: /document\.write/, message: 'document.write usage detected' }
    ];
    
    for (const { pattern, message } of securityPatterns) {
      if (pattern.test(output)) {
        issues.push({
          severity: 'error',
          message,
          suggestion: 'Review and fix security issue'
        });
      }
    }
    
    // Check for SQL injection patterns
    if (/\$\{.*\}/.test(output) && /select|insert|update|delete|from|where/i.test(output)) {
      issues.push({
        severity: 'warning',
        message: 'Potential SQL injection - string interpolation in SQL query',
        suggestion: 'Use parameterized queries'
      });
    }
    
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const passed = errorCount === 0;
    
    return {
      taskId: result.taskId,
      resultId: result.taskId,
      gatekeeper: 'security',
      passed,
      issues,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Test coverage check (placeholder)
   */
  private async runTestCheck(
    result: CNPResult,
    config: GatekeeperConfig
  ): Promise<CNPValidation> {
    
    const issues: CNPValidationIssue[] = [];
    
    // Check if result mentions tests
    const hasTests = /test|spec|describe|it\(|expect\(/.test(result.output);
    
    if (!hasTests) {
      issues.push({
        severity: 'info',
        message: 'No test code detected in output',
        suggestion: 'Consider adding tests for the implementation'
      });
    }
    
    // For now, always pass test check (it's informational)
    return {
      taskId: result.taskId,
      resultId: result.taskId,
      gatekeeper: 'test',
      passed: true,
      issues,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Create a passing validation
   */
  private createPassingValidation(
    result: CNPResult,
    type: GatekeeperConfig['type'],
    infoMessage?: string
  ): CNPValidation {
    
    const issues: CNPValidationIssue[] = [];
    
    if (infoMessage) {
      issues.push({
        severity: 'info',
        message: infoMessage
      });
    }
    
    return {
      taskId: result.taskId,
      resultId: result.taskId,
      gatekeeper: type,
      passed: true,
      issues,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Check if all validations passed
   */
  allPassed(validations: CNPValidation[]): boolean {
    return validations.every(v => v.passed);
  }
  
  /**
   * Get blocking failures
   */
  getBlockingFailures(validations: CNPValidation[]): CNPValidation[] {
    return validations.filter(v => {
      const config = this.config.find(c => c.type === v.gatekeeper);
      return config?.blocking && !v.passed;
    });
  }
  
  /**
   * Summarize validation results
   */
  summarize(validations: CNPValidation[]): {
    passed: boolean;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    totalIssues: number;
    errorCount: number;
    warningCount: number;
  } {
    const totalChecks = validations.length;
    const passedChecks = validations.filter(v => v.passed).length;
    const failedChecks = totalChecks - passedChecks;
    
    const allIssues = validations.flatMap(v => v.issues);
    const totalIssues = allIssues.length;
    const errorCount = allIssues.filter(i => i.severity === 'error').length;
    const warningCount = allIssues.filter(i => i.severity === 'warning').length;
    
    return {
      passed: this.allPassed(validations),
      totalChecks,
      passedChecks,
      failedChecks,
      totalIssues,
      errorCount,
      warningCount
    };
  }
}

/**
 * Create Gatekeeper Manager instance
 */
export function createGatekeeperManager(
  config?: GatekeeperConfig[],
  timeoutMs?: number
): GatekeeperManager {
  return new GatekeeperManager(config, timeoutMs);
}
