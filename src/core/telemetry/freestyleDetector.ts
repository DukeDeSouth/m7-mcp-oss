/**
 * Freestyle Detector — stub (missing implementation)
 * TODO: Implement actual freestyle detection logic
 */

import type { TelemetrySnapshot } from './types.js';

export interface FreestyleResult {
  risk: 'low' | 'medium' | 'high';
  signals: {
    code_volume_spike: boolean;
    hypothesis_absence: boolean;
    convergence_velocity: boolean;
    backtrack_absence: boolean;
    tool_avoidance: boolean;
  };
  hint: string;
}

export class FreestyleDetector {
  analyze(snapshot: TelemetrySnapshot): FreestyleResult {
    return {
      risk: 'low',
      signals: {
        code_volume_spike: false,
        hypothesis_absence: false,
        convergence_velocity: false,
        backtrack_absence: false,
        tool_avoidance: false,
      },
      hint: '',
    };
  }
}
