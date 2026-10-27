/**
 * TRAP Detector — Scans input/output against the TRAP catalog.
 *
 * Two-phase detection:
 * 1. Surface pattern match (fast, regex-based)
 * 2. Discrimination rule (prevents false positives)
 *
 * Only triggers when BOTH phases agree.
 */

import type { TrapDefinition, InputAnalysis, TrapVerdict, ScanResult } from './types.js';
import { InputAnalyzer } from './inputAnalyzer.js';
import { INPUT_TRAPS, OUTPUT_TRAPS } from './trapCatalog.js';

export class TrapDetector {
  private analyzer: InputAnalyzer;

  constructor() {
    this.analyzer = new InputAnalyzer();
  }

  scanInput(input: string): ScanResult {
    return this.scan(input, INPUT_TRAPS);
  }

  scanOutput(output: string): ScanResult {
    return this.scan(output, OUTPUT_TRAPS);
  }

  scan(text: string, traps: TrapDefinition[]): ScanResult {
    const start = Date.now();
    const analysis = this.analyzer.analyze(text);
    const verdicts: TrapVerdict[] = [];

    for (const trap of traps) {
      const verdict = this.evaluateTrap(trap, analysis);
      if (verdict.triggered) {
        verdicts.push(verdict);
      }
    }

    const highestAction = this.getHighestAction(verdicts);

    return {
      blocked: highestAction === 'block',
      action: highestAction,
      verdicts,
      analysisTimeMs: Date.now() - start,
      trapsEvaluated: traps.length,
    };
  }

  private evaluateTrap(trap: TrapDefinition, analysis: InputAnalysis): TrapVerdict {
    const matchedPatterns: string[] = [];
    let totalWeight = 0;

    for (const sp of trap.surfacePatterns) {
      if (sp.pattern.test(analysis.raw) || sp.pattern.test(analysis.normalized)) {
        matchedPatterns.push(sp.description);
        totalWeight += sp.weight;
      }
    }

    if (matchedPatterns.length === 0) {
      return this.noTrigger(trap);
    }

    const discriminationPassed = trap.discriminate(analysis);

    if (!discriminationPassed) {
      return this.noTrigger(trap);
    }

    const confidence = Math.min(1.0, totalWeight / trap.surfacePatterns.length);

    return {
      triggered: true,
      trapId: trap.id,
      trapClass: trap.class,
      severity: trap.severity,
      action: trap.action,
      confidence,
      evidence: matchedPatterns,
    };
  }

  private noTrigger(trap: TrapDefinition): TrapVerdict {
    return {
      triggered: false,
      trapId: trap.id,
      trapClass: trap.class,
      severity: trap.severity,
      action: 'log',
      confidence: 0,
      evidence: [],
    };
  }

  private getHighestAction(verdicts: TrapVerdict[]): ScanResult['action'] {
    if (verdicts.some(v => v.action === 'block')) return 'block';
    if (verdicts.some(v => v.action === 'warn')) return 'warn';
    return 'log';
  }
}
