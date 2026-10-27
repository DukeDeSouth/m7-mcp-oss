import { AgentType, AgentProposal } from './agent.js';

/**
 * Hive execution mode
 * - 'fixed': Use predefined agent types (legacy)
 * - 'dynamic': Use Hive Architect to create optimal team (v3.7.0+)
 * - 'planned': Use Planner/Supervisor with CNP auction (v3.8.0+)
 */
export type HiveMode = 'fixed' | 'dynamic' | 'planned';

export interface HiveTask {
  id: string;
  description: string;
  context?: any;
  agents?: AgentType[];
  debate_mode: boolean;
  max_rounds: number;
  priority: 'speed' | 'quality' | 'consensus';
  user_id?: string;
  session_id?: string;
  
  /** 
   * Execution mode (v3.7.0+)
   * - 'dynamic' (default): AI creates optimal team with best models
   * - 'fixed': Use predefined agent types (legacy compatibility)
   * - 'planned': Use Planner/Supervisor with CNP auction (v3.8.0+)
   */
  mode?: HiveMode;
  
  /**
   * Planner options (only used when mode='planned')
   * @since v3.8.0
   */
  plannerOptions?: {
    /** Maximum subtasks to create */
    maxSubtasks?: number;
    /** Auction timeout in ms */
    auctionTimeoutMs?: number;
    /** Gatekeepers to enable */
    gatekeepers?: ('style' | 'arch' | 'security' | 'test')[];
    /** Enable parallel auctions for independent tasks */
    parallelAuctions?: boolean;
  };
}

export interface HiveResult {
  success: boolean;
  task_id: string;
  selected_solution: AgentProposal;
  all_proposals: AgentProposal[];
  execution_time: number;
  total_cost: number;
  agents_used: AgentType[];
  fallback_used?: boolean;
  error?: string;
  recommendations?: string[];
  
  /**
   * Consensus details when debate_mode is enabled
   * @since v6.0
   */
  consensus?: {
    /** How consensus was reached */
    method: 'unanimous' | 'majority' | 'weighted' | 'expertise' | 'synthesis' | 'timeout';
    /** Final confidence score */
    confidence: number;
    /** Number of debate/refinement rounds */
    totalRounds: number;
    /** Number of conflicts detected */
    conflicts: number;
    /** Number of conflicts resolved */
    resolvedConflicts: number;
    /** How close agents came to agreement (0-1) */
    convergenceScore: number;
    /** Preserved minority opinions */
    minorityOpinions: {
      agentId: AgentType;
      concernLevel: 'note' | 'warning' | 'strong_disagreement';
      reason: string;
    }[];
    /** Warnings from consensus process */
    warnings: string[];
  };
}
