import path from 'path';
import { getProjectPath } from '../core/utils/projectPath.js';

export interface ChaosDetection {
  isChaotic: boolean;
  confidence: number;
  reason?: string;
  suggestion?: string;
  canRequestOverride?: boolean;
  overrideUsed?: boolean;
  emergencyLink?: string;
}

const PANIC_PATTERNS = [
  /urgent/i,
  /asap/i,
  /emergency/i,
  /quick\s*fix/i,
  /hotfix/i,
  /panic/i,
  /critical\s*bug/i,
  /blocker/i,
  /rush/i
];

// NEW: Scope creep patterns
const SCOPE_CREEP_PATTERNS = [
  /while\s+i['']m\s+here/i,
  /might\s+as\s+well/i,
  /let['']s\s+also/i,
  /proper\s+way/i,
  /refactor\s+this/i,
  /clean\s+up/i,
  /improve\s+the/i,
  /fix\s+everything/i,
  /better\s+approach/i,
  /should\s+probably/i,
  /todo.*later/i,
  /fix.*properly/i
];

export class ChaosGuard {
  private redFlags = [
    /drop\s+table/i,
    /delete\s+from/i,
    /rm\s+-rf/i,
    /force\s+push/i,
    /--force/i
  ];

  private panicPatterns = [
    'urgent', 'asap', 'emergency', 'quick fix', 'hotfix', 
    'panic', 'critical bug', 'blocker', 'rush'
  ];

  private _dataPath: string;

  constructor(projectPath?: string) {
    // Используем проектную папку .m7/ вместо глобальной ~/.m7-mcp
    const basePath = projectPath || getProjectPath();
    this._dataPath = path.join(basePath, '.m7');
  }

  async detectChaos(request: string, _context?: any, overrideToken?: string): Promise<ChaosDetection> {
    // Check for override token
    if (overrideToken && await this.validateOverrideToken(overrideToken)) {
      return {
        isChaotic: false,
        confidence: 0,
        overrideUsed: true,
        reason: 'Valid emergency override token provided'
      };
    }

    const lowerRequest = request.toLowerCase();
    const hasRedFlag = this.redFlags.some(flag => flag.test(request));
    const hasPanicPattern = this.panicPatterns.some(pattern => 
      lowerRequest.includes(pattern.toLowerCase())
    );
    
    const confidence = this.calculateConfidence(request, hasRedFlag, hasPanicPattern);
    const isChaotic = hasRedFlag || hasPanicPattern || confidence > 0.7;

    if (isChaotic) {
      return {
        isChaotic: true,
        confidence,
        reason: this.determineReason(hasRedFlag, hasPanicPattern),
        suggestion: this.generateMethodologySuggestion(request),
        canRequestOverride: this.isOverrideEligible(_context),
        emergencyLink: '/request-override'
      };
    }

    return {
      isChaotic: false,
      confidence,
      reason: 'Pattern appears methodical'
    };
  }

  private async validateOverrideToken(_token: string): Promise<boolean> {
    // In real implementation, validate against stored tokens
    return false;
  }

  private calculateConfidence(request: string, hasRedFlag: boolean, hasPanicPattern: boolean): number {
    let confidence = 0;
    
    if (hasRedFlag) confidence += 0.4;
    if (hasPanicPattern) confidence += 0.3;
    
    // Check for multiple urgency indicators
    const urgencyCount = (request.match(/urgent|asap|quick|fast|срочно|быстро/gi) || []).length;
    confidence += Math.min(urgencyCount * 0.1, 0.3);
    
    return Math.min(confidence, 1.0);
  }

  private determineReason(hasRedFlag: boolean, hasPanicPattern: boolean): string {
    if (hasRedFlag) return 'Red flag keywords detected';
    if (hasPanicPattern) return 'Panic pattern identified';
    return 'High chaos confidence score';
  }

  private generateMethodologySuggestion(request: string): string {
    if (request.toLowerCase().includes('fix') || request.toLowerCase().includes('исправ')) {
      return 'Consider using: @m7 analyze task "Debug and fix [specific issue]"';
    }
    return 'Consider breaking this down into smaller, methodical steps using @m7 analyze task';
  }

  private isOverrideEligible(_context?: any): boolean {
    // Check if context suggests this is truly an emergency
    // For now, always allow override requests
    return true;
  }

  // NEW: Detect scope creep patterns
  detectScopeCreep(text: string): boolean {
    return SCOPE_CREEP_PATTERNS.some(pattern => pattern.test(text));
  }

  // NEW: Get specific scope creep warning
  getScopeCreepWarning(text: string): string | null {
    const warnings: Record<string, string> = {
      'while.*here': '⚠️ "While I\'m here" detected - This often leads to scope creep',
      'might.*well': '⚠️ "Might as well" detected - Stay focused on the original task',
      'proper.*way': '⚠️ "Proper way" detected - Is this necessary for the current task?',
      'refactor': '⚠️ Refactoring detected - Consider creating a separate task',
      'clean.*up': '⚠️ Cleanup detected - Focus on the primary objective first',
      'improve': '⚠️ Improvement detected - Document for future iteration'
    };

    for (const [pattern, warning] of Object.entries(warnings)) {
      if (new RegExp(pattern, 'i').test(text)) {
        return warning;
      }
    }

    return null;
  }
} 