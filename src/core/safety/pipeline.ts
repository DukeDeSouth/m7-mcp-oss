/**
 * Safety Pipeline — Orchestrates TRAP detection + Intent verification.
 *
 * Architecture: Input TRAP → Intent Extract → Intent Verify → Output TRAP
 * Fail-open: errors in any stage → degrade to pass (not block).
 */

import type { PipelineResult, ScanResult, VerificationResult } from './types.js';
import { TrapDetector } from './trapDetector.js';
import { IntentVerifier } from './intentVerifier.js';
import { InputAnalyzer } from './inputAnalyzer.js';

export interface PipelineConfig {
  strictMode: boolean;
  enableIntentLayer: boolean;
  enableOutputScan: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
  strictMode: false,
  enableIntentLayer: true,
  enableOutputScan: true,
};

export class SafetyPipeline {
  private trapDetector: TrapDetector;
  private intentVerifier: IntentVerifier;
  private analyzer: InputAnalyzer;
  private config: PipelineConfig;

  constructor(config?: Partial<PipelineConfig>) {
    this.trapDetector = new TrapDetector();
    this.intentVerifier = new IntentVerifier();
    this.analyzer = new InputAnalyzer();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Full pipeline: scan input → extract intent → verify → return verdict.
   * Does NOT call a model — uses rule-based intent extraction.
   */
  processInput(input: string): PipelineResult {
    const start = Date.now();

    // STAGE 1: Input TRAP Detection
    let inputScan: ScanResult;
    try {
      inputScan = this.trapDetector.scanInput(input);
    } catch {
      return this.passThrough(start, 'input_trap_error');
    }

    if (inputScan.blocked) {
      return {
        action: 'block',
        stage: 'input_trap',
        details: inputScan,
        metadata: {
          trapsEvaluated: inputScan.trapsEvaluated,
          intentExtracted: false,
          verificationPassed: false,
          totalTimeMs: Date.now() - start,
          blockedBy: inputScan.verdicts.find(v => v.action === 'block')?.trapId,
        },
      };
    }

    // STAGE 2: Intent Extraction + Verification (rule-based)
    let verification: VerificationResult | undefined;
    let intentExtracted = false;

    if (this.config.enableIntentLayer) {
      try {
        const analysis = this.analyzer.analyze(input);
        const intentGraph = this.intentVerifier.buildIntentGraph(analysis);
        verification = this.intentVerifier.verify(intentGraph);
        intentExtracted = true;

        if (verification.action === 'block') {
          return {
            action: 'block',
            stage: 'intent_verification',
            details: verification,
            metadata: {
              trapsEvaluated: inputScan.trapsEvaluated,
              intentExtracted: true,
              verificationPassed: false,
              totalTimeMs: Date.now() - start,
              blockedBy: verification.violations[0]?.ruleId,
            },
          };
        }
      } catch {
        // Fail-open: intent layer error → continue without it
        intentExtracted = false;
      }
    }

    // Determine final action
    const hasWarnings = inputScan.action === 'warn' ||
      (verification && verification.action === 'warn');

    return {
      action: hasWarnings ? 'warn' : 'pass',
      stage: undefined,
      details: verification || inputScan,
      metadata: {
        trapsEvaluated: inputScan.trapsEvaluated,
        intentExtracted,
        verificationPassed: verification?.passed ?? true,
        totalTimeMs: Date.now() - start,
      },
    };
  }

  /**
   * Scan model output for harmful content patterns.
   */
  processOutput(output: string): PipelineResult {
    const start = Date.now();

    if (!this.config.enableOutputScan) {
      return this.passThrough(start, 'output_scan_disabled');
    }

    let outputScan: ScanResult;
    try {
      outputScan = this.trapDetector.scanOutput(output);
    } catch {
      return this.passThrough(start, 'output_trap_error');
    }

    if (outputScan.blocked) {
      return {
        action: 'block',
        stage: 'output_trap',
        details: outputScan,
        metadata: {
          trapsEvaluated: outputScan.trapsEvaluated,
          intentExtracted: false,
          verificationPassed: false,
          totalTimeMs: Date.now() - start,
          blockedBy: outputScan.verdicts.find(v => v.action === 'block')?.trapId,
        },
      };
    }

    return {
      action: outputScan.action === 'warn' ? 'warn' : 'pass',
      metadata: {
        trapsEvaluated: outputScan.trapsEvaluated,
        intentExtracted: false,
        verificationPassed: true,
        totalTimeMs: Date.now() - start,
      },
    };
  }

  /**
   * Full pipeline: input scan + output scan in one call.
   */
  fullCheck(input: string, output?: string): { input: PipelineResult; output?: PipelineResult } {
    const inputResult = this.processInput(input);

    let outputResult: PipelineResult | undefined;
    if (output && this.config.enableOutputScan) {
      outputResult = this.processOutput(output);
    }

    return { input: inputResult, output: outputResult };
  }

  private passThrough(startTime: number, reason: string): PipelineResult {
    return {
      action: 'pass',
      metadata: {
        trapsEvaluated: 0,
        intentExtracted: false,
        verificationPassed: true,
        totalTimeMs: Date.now() - startTime,
        blockedBy: undefined,
      },
    };
  }
}
