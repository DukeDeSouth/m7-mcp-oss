/**
 * M7 v3.0 - Architecture Scorer
 * 
 * Calculates architecture quality score (A-F) based on various metrics.
 */

import {
  ArchitectureScore,
  ArchitectureGrade,
  ScoreBreakdown,
  DetectedAntipattern,
  RefactoringSuggestion,
  AntipatternSeverity
} from './types.js';

/**
 * Metrics input for scoring
 */
export interface ScoringMetrics {
  /** Average coupling (0-1, lower is better) */
  coupling: number;
  /** Average cohesion (0-1, higher is better) */
  cohesion: number;
  /** Average complexity */
  complexity: number;
}

/**
 * Architecture Scorer
 * 
 * Calculates a grade based on:
 * - Antipatterns: 0-25 points
 * - Complexity: 0-25 points
 * - Coupling: 0-25 points
 * - Testability: 0-25 points
 * 
 * Total: 0-100 points → A-F grade
 */
export class ArchitectureScorer {
  // ============================================
  // PUBLIC API
  // ============================================
  
  /**
   * Calculate architecture score
   */
  calculate(
    antipatterns: DetectedAntipattern[],
    suggestions: RefactoringSuggestion[],
    metrics: ScoringMetrics,
    previousScore?: number
  ): ArchitectureScore {
    // Calculate individual scores
    const antipatternScore = this.calculateAntipatternScore(antipatterns);
    const complexityScore = this.calculateComplexityScore(metrics.complexity);
    const couplingScore = this.calculateCouplingScore(metrics.coupling, metrics.cohesion);
    const testabilityScore = this.calculateTestabilityScore(antipatterns);
    
    // Total score
    const totalScore = antipatternScore + complexityScore + couplingScore + testabilityScore;
    
    // Determine grade
    const grade = this.scoreToGrade(totalScore);
    
    // Determine trend
    let trend: 'improving' | 'stable' | 'declining' | undefined;
    if (previousScore !== undefined) {
      if (totalScore > previousScore + 5) {
        trend = 'improving';
      } else if (totalScore < previousScore - 5) {
        trend = 'declining';
      } else {
        trend = 'stable';
      }
    }
    
    // Generate explanation
    const explanation = this.generateExplanation(
      grade,
      totalScore,
      { antipatterns: antipatternScore, complexity: complexityScore, coupling: couplingScore, testability: testabilityScore },
      antipatterns
    );
    
    return {
      grade,
      score: totalScore,
      breakdown: {
        antipatterns: antipatternScore,
        complexity: complexityScore,
        coupling: couplingScore,
        testability: testabilityScore
      },
      antipatterns,
      suggestions,
      previousScore,
      trend,
      explanation
    };
  }
  
  // ============================================
  // SCORE CALCULATIONS
  // ============================================
  
  /**
   * Calculate antipattern score (0-25)
   * 
   * Deductions:
   * - Critical: -10 points each
   * - Major: -3 points each
   * - Minor: -1 point each
   */
  private calculateAntipatternScore(antipatterns: DetectedAntipattern[]): number {
    const critical = antipatterns.filter(a => a.severity === AntipatternSeverity.CRITICAL).length;
    const major = antipatterns.filter(a => a.severity === AntipatternSeverity.MAJOR).length;
    const minor = antipatterns.filter(a => a.severity === AntipatternSeverity.MINOR).length;
    
    const deduction = critical * 10 + major * 3 + minor * 1;
    return Math.max(0, 25 - deduction);
  }
  
  /**
   * Calculate complexity score (0-25)
   * 
   * Based on average cyclomatic complexity:
   * - <5: 25 (Excellent)
   * - <10: 20 (Good)
   * - <15: 15 (Moderate)
   * - <20: 10 (Poor)
   * - >=20: 5 (Bad)
   */
  private calculateComplexityScore(avgComplexity: number): number {
    if (avgComplexity < 5) return 25;
    if (avgComplexity < 10) return 20;
    if (avgComplexity < 15) return 15;
    if (avgComplexity < 20) return 10;
    return 5;
  }
  
  /**
   * Calculate coupling score (0-25)
   * 
   * Based on coupling (0-1, lower is better) and cohesion (0-1, higher is better)
   */
  private calculateCouplingScore(coupling: number, cohesion: number): number {
    // Normalize coupling: 0 coupling = 12.5 points, 1 coupling = 0 points
    const couplingPoints = Math.round((1 - coupling) * 12.5);
    
    // Normalize cohesion: 1 cohesion = 12.5 points, 0 cohesion = 0 points
    const cohesionPoints = Math.round(cohesion * 12.5);
    
    return Math.min(25, couplingPoints + cohesionPoints);
  }
  
  /**
   * Calculate testability score (0-25)
   * 
   * God objects and circular deps hurt testability significantly
   */
  private calculateTestabilityScore(antipatterns: DetectedAntipattern[]): number {
    const godObjects = antipatterns.filter(a => a.name === 'God Object').length;
    const circularDeps = antipatterns.filter(a => a.name === 'Circular Dependency').length;
    
    // God objects: -5 each (hard to mock)
    // Circular deps: -8 each (hard to isolate)
    const deduction = godObjects * 5 + circularDeps * 8;
    
    return Math.max(0, 25 - deduction);
  }
  
  // ============================================
  // GRADE CONVERSION
  // ============================================
  
  /**
   * Convert score to letter grade
   */
  private scoreToGrade(score: number): ArchitectureGrade {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
  
  // ============================================
  // EXPLANATION
  // ============================================
  
  /**
   * Generate human-readable explanation of the score
   */
  private generateExplanation(
    grade: ArchitectureGrade,
    score: number,
    breakdown: ScoreBreakdown,
    antipatterns: DetectedAntipattern[]
  ): string {
    const lines: string[] = [];
    
    // Overall assessment
    lines.push(this.getGradeDescription(grade));
    lines.push('');
    
    // Breakdown analysis
    lines.push('Score Breakdown:');
    lines.push(`• Antipatterns: ${breakdown.antipatterns}/25 ${this.getScoreEmoji(breakdown.antipatterns, 25)}`);
    lines.push(`• Complexity: ${breakdown.complexity}/25 ${this.getScoreEmoji(breakdown.complexity, 25)}`);
    lines.push(`• Coupling: ${breakdown.coupling}/25 ${this.getScoreEmoji(breakdown.coupling, 25)}`);
    lines.push(`• Testability: ${breakdown.testability}/25 ${this.getScoreEmoji(breakdown.testability, 25)}`);
    lines.push('');
    
    // Critical issues
    const criticalIssues = antipatterns.filter(a => a.severity === AntipatternSeverity.CRITICAL);
    if (criticalIssues.length > 0) {
      lines.push('🚨 Critical Issues (fix immediately):');
      for (const issue of criticalIssues.slice(0, 3)) {
        lines.push(`  • ${issue.name}: ${issue.target.name}`);
      }
      if (criticalIssues.length > 3) {
        lines.push(`  ... and ${criticalIssues.length - 3} more`);
      }
      lines.push('');
    }
    
    // Quick wins
    if (grade !== 'A') {
      lines.push('💡 Quick Wins to Improve Score:');
      if (criticalIssues.length > 0) {
        lines.push(`  1. Fix ${criticalIssues.length} critical issues (+${criticalIssues.length * 10} points potential)`);
      }
      const majorIssues = antipatterns.filter(a => a.severity === AntipatternSeverity.MAJOR);
      if (majorIssues.length > 0) {
        lines.push(`  2. Address ${majorIssues.length} major issues (+${majorIssues.length * 3} points potential)`);
      }
    }
    
    return lines.join('\n');
  }
  
  private getGradeDescription(grade: ArchitectureGrade): string {
    const descriptions: Record<ArchitectureGrade, string> = {
      'A': '🏆 Excellent architecture! Well-designed, maintainable, and testable.',
      'B': '✅ Good architecture with minor issues. Some improvements possible.',
      'C': '⚠️ Moderate architecture. Several issues need attention.',
      'D': '🔶 Poor architecture. Significant issues affecting maintainability.',
      'F': '🚨 Critical architecture problems. Immediate attention required.'
    };
    return descriptions[grade];
  }
  
  private getScoreEmoji(score: number, max: number): string {
    const ratio = score / max;
    if (ratio >= 0.9) return '✅';
    if (ratio >= 0.7) return '👍';
    if (ratio >= 0.5) return '⚠️';
    return '❌';
  }
}

