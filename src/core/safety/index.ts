/**
 * Safety Engine — Facade for the safety verification subsystem.
 *
 * Single entry point for all safety operations.
 * Pipeline: validate → check → verify.
 */

import type {
  PipelineResult,
  ScanResult,
  VerificationResult,
  IntentGraph,
  TrapDefinition,
} from './types.js';
import { SafetyPipeline, PipelineConfig } from './pipeline.js';
import { TrapDetector } from './trapDetector.js';
import { IntentVerifier } from './intentVerifier.js';
import { InputAnalyzer } from './inputAnalyzer.js';
import { TRAP_CATALOG, INPUT_TRAPS, OUTPUT_TRAPS } from './trapCatalog.js';

export type {
  PipelineResult,
  ScanResult,
  VerificationResult,
  IntentGraph,
  TrapDefinition,
  CoreIntent,
  TrapVerdict,
  TrapSeverity,
  TrapClass,
  TrapAction,
  InputAnalysis,
  SafetyRuleResult,
  PipelineStage,
} from './types.js';

export { SafetyPipeline } from './pipeline.js';
export { TrapDetector } from './trapDetector.js';
export { IntentVerifier } from './intentVerifier.js';
export { InputAnalyzer } from './inputAnalyzer.js';
export { TRAP_CATALOG, INPUT_TRAPS, OUTPUT_TRAPS } from './trapCatalog.js';

export class SafetyEngine {
  private pipeline: SafetyPipeline;
  private detector: TrapDetector;
  private verifier: IntentVerifier;
  private analyzer: InputAnalyzer;

  constructor(config?: Partial<PipelineConfig>) {
    this.pipeline = new SafetyPipeline(config);
    this.detector = new TrapDetector();
    this.verifier = new IntentVerifier();
    this.analyzer = new InputAnalyzer();
  }

  /**
   * Full safety check on input text.
   * Runs TRAP detection + intent verification.
   */
  checkInput(input: string): PipelineResult {
    return this.pipeline.processInput(input);
  }

  /**
   * Check model output for harmful patterns.
   */
  checkOutput(output: string): PipelineResult {
    return this.pipeline.processOutput(output);
  }

  /**
   * Full pipeline: check both input and output.
   */
  fullCheck(input: string, output?: string): { input: PipelineResult; output?: PipelineResult } {
    return this.pipeline.fullCheck(input, output);
  }

  /**
   * TRAP-only scan (no intent layer). Fastest path.
   */
  trapScan(text: string, side: 'input' | 'output' = 'input'): ScanResult {
    return side === 'input'
      ? this.detector.scanInput(text)
      : this.detector.scanOutput(text);
  }

  /**
   * Extract and verify intent from text (no TRAP scan).
   */
  verifyIntent(text: string): VerificationResult {
    const analysis = this.analyzer.analyze(text);
    const intent = this.verifier.buildIntentGraph(analysis);
    return this.verifier.verify(intent);
  }

  /**
   * Get the full TRAP catalog for inspection/audit.
   */
  getCatalog(): TrapDefinition[] {
    return [...TRAP_CATALOG];
  }

  /**
   * Get catalog statistics.
   */
  getStats(): {
    totalTraps: number;
    inputTraps: number;
    outputTraps: number;
    byClass: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const byClass: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const trap of TRAP_CATALOG) {
      byClass[trap.class] = (byClass[trap.class] || 0) + 1;
      bySeverity[trap.severity] = (bySeverity[trap.severity] || 0) + 1;
    }

    return {
      totalTraps: TRAP_CATALOG.length,
      inputTraps: INPUT_TRAPS.length,
      outputTraps: OUTPUT_TRAPS.length,
      byClass,
      bySeverity,
    };
  }
}

let _engine: SafetyEngine | null = null;

export function getSafetyEngine(config?: Partial<PipelineConfig>): SafetyEngine {
  if (!_engine) {
    _engine = new SafetyEngine(config);
  }
  return _engine;
}
