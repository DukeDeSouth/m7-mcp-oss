/**
 * Discovery Tracker — stub (missing implementation)
 * TODO: Implement actual discovery phase tracking
 */

import type { DiscoveryPhase } from './types.js';

export interface DiscoveryResult {
  phase: DiscoveryPhase;
  collapsed: boolean;
}

export class DiscoveryTracker {
  track(events: any[]): DiscoveryResult {
    return {
      phase: 'E0_none',
      collapsed: false,
    };
  }
}
