/**
 * M7 Project Identity System Types
 * 
 * Defines immutable project constraints to prevent AI
 * from generating code in wrong framework/version.
 * 
 * Example: If project migrated from PHP7 to PHP8, PIS ensures
 * AI never generates PHP7 syntax again.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Migration information
 */
export interface MigrationInfo {
  from: string;           // e.g., "PHP 7.4 / Slim 3"
  to: string;             // e.g., "PHP 8.2 / Slim 4"
  status: 'in-progress' | 'completed';
  date: string;           // ISO date
  notes?: string;
}

/**
 * Failure record for accumulated wisdom
 */
export interface FailureRecord {
  date: string;
  description: string;
  lesson: string;
  wasM7Used: boolean;
}

/**
 * Success record
 */
export interface SuccessRecord {
  date: string;
  description: string;
  m7Phases: string[];     // which phases were used
}

/**
 * Accumulated Wisdom — project history of successes and failures
 */
export interface AccumulatedWisdom {
  failures: FailureRecord[];
  successes: SuccessRecord[];
  insights: string[];     // general learnings
}

/**
 * Project constraints — the core identity
 */
export interface ProjectConstraints {
  language: string;       // e.g., "PHP 8.2", "TypeScript 5.x"
  framework: string;      // e.g., "Slim 4.12", "Next.js 14"
  database?: string;      // e.g., "PostgreSQL 15"
  runtime?: string;       // e.g., "Node.js 20"
  migrations?: MigrationInfo;
}

/**
 * Project type classification
 */
export type ProjectType = 
  | 'backend-api' 
  | 'frontend' 
  | 'fullstack' 
  | 'library' 
  | 'cli' 
  | 'mcp-server'
  | 'mobile'
  | 'other';

/**
 * Main Project Identity
 * 
 * Stored in .m7/identity.json
 */
export interface ProjectIdentity {
  version: number;
  lastUpdated: string;
  
  project: {
    name: string;
    type: ProjectType;
    description?: string;
  };
  
  constraints: ProjectConstraints;
  
  /** What is FORBIDDEN in this project */
  forbidden: string[];      // e.g., ["PHP 7 syntax", "mysql_* functions"]
  
  /** Coding rules to follow */
  codingRules: string[];    // e.g., ["Use typed properties", "PSR-12 style"]
  
  /** Files that should be studied before changes */
  criticalFiles: string[];  // e.g., ["src/App.php", "config/routes.php"]
  
  /** Accumulated wisdom from project history */
  accumulatedWisdom?: AccumulatedWisdom;
}

/**
 * Constants
 */
export const IDENTITY_FILE = '.m7/identity.json';
export const IDENTITY_VERSION = 1;
export const MAX_FAILURES_TO_KEEP = 10;
export const MAX_SUCCESSES_TO_KEEP = 5;
export const MAX_INSIGHTS_TO_KEEP = 10;
