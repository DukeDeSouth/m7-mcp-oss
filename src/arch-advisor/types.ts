/**
 * M7 v3.0 - Architectural Advisor Types
 * 
 * Type definitions for architecture analysis, antipattern detection,
 * C4 diagrams, and refactoring suggestions.
 */

// ============================================
// ENUMS
// ============================================

/**
 * Severity levels for detected antipatterns
 */
export enum AntipatternSeverity {
  /** Blocks deployment - must fix immediately */
  CRITICAL = 'critical',
  /** Requires attention - should fix soon */
  MAJOR = 'major',
  /** Nice to fix - low priority */
  MINOR = 'minor'
}

/**
 * Categories of antipatterns
 */
export enum AntipatternCategory {
  /** High coupling between components */
  COUPLING = 'coupling',
  /** Low cohesion within components */
  COHESION = 'cohesion',
  /** Excessive complexity */
  COMPLEXITY = 'complexity',
  /** Unused or unreachable code */
  DEAD_CODE = 'dead_code',
  /** Naming convention violations */
  NAMING = 'naming'
}

/**
 * Types of refactoring operations
 */
export enum RefactoringType {
  /** Extract code to new module/class/function */
  EXTRACT = 'extract',
  /** Move code to different location */
  MOVE = 'move',
  /** Rename element */
  RENAME = 'rename',
  /** Merge multiple elements */
  MERGE = 'merge',
  /** Split element into parts */
  SPLIT = 'split',
  /** Remove unused code */
  DELETE = 'delete'
}

/**
 * Architecture quality grade
 */
export type ArchitectureGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * C4 diagram levels
 */
export type C4Level = 'context' | 'container' | 'component' | 'code';

// ============================================
// ANTIPATTERN TYPES
// ============================================

/**
 * Location of detected antipattern
 */
export interface AntipatternTarget {
  /** Node ID in Knowledge Graph */
  nodeId: string;
  /** File path relative to project root */
  filePath: string;
  /** Name of the affected element */
  name: string;
  /** Line number if available */
  lineNumber?: number;
}

/**
 * Detected antipattern
 */
export interface DetectedAntipattern {
  /** Unique identifier for this detection */
  id: string;
  /** Name of the antipattern (e.g., "God Object") */
  name: string;
  /** Category of the antipattern */
  category: AntipatternCategory;
  /** Severity level */
  severity: AntipatternSeverity;
  /** Location of the antipattern */
  target: AntipatternTarget;
  /** Human-readable description */
  description: string;
  /** Evidence supporting the detection */
  evidence: string[];
  /** Quantitative metrics */
  metrics?: Record<string, number>;
  /** Confidence score (0-1) */
  confidence: number;
}

// ============================================
// REFACTORING TYPES
// ============================================

/**
 * Reference to external resource
 */
export interface RefactoringReference {
  /** Type of reference */
  type: 'pattern' | 'article' | 'book' | 'documentation';
  /** Title of the resource */
  title: string;
  /** URL if available */
  url?: string;
}

/**
 * Refactoring suggestion
 */
export interface RefactoringSuggestion {
  /** Unique identifier */
  id: string;
  /** ID of the antipattern this addresses */
  antipatternId: string;
  /** Type of refactoring operation */
  type: RefactoringType;
  /** Priority (same as antipattern severity) */
  priority: AntipatternSeverity;
  /** What to refactor */
  target: AntipatternTarget;
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Step-by-step instructions */
  steps: string[];
  /** Effort estimation */
  effort: 'low' | 'medium' | 'high';
  /** Impact on codebase */
  impact: 'low' | 'medium' | 'high';
  /** Confidence in suggestion */
  confidence: number;
  /** Example code before refactoring */
  beforeCode?: string;
  /** Example code after refactoring */
  afterCode?: string;
  /** External references */
  references?: RefactoringReference[];
}

// ============================================
// C4 DIAGRAM TYPES
// ============================================

/**
 * Type of C4 element
 */
export type C4ElementType = 'person' | 'system' | 'container' | 'component' | 'external';

/**
 * C4 element (person, system, container, or component)
 */
export interface C4Element {
  /** Unique identifier */
  id: string;
  /** Type of element */
  type: C4ElementType;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Technology (for containers/components) */
  technology?: string;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Relationship between C4 elements
 */
export interface C4Relationship {
  /** Source element ID */
  sourceId: string;
  /** Target element ID */
  targetId: string;
  /** Description of relationship */
  description: string;
  /** Technology/protocol used */
  technology?: string;
}

/**
 * Complete C4 diagram
 */
export interface C4Diagram {
  /** Diagram level */
  level: C4Level;
  /** Diagram title */
  title: string;
  /** Elements in the diagram */
  elements: C4Element[];
  /** Relationships between elements */
  relationships: C4Relationship[];
  /** Generated Mermaid code */
  mermaid: string;
}

/**
 * Options for C4 diagram generation
 */
export interface C4Options {
  /** Maximum elements to include */
  maxElements?: number;
  /** Maximum relationships */
  maxRelationships?: number;
  /** Group elements by directory */
  groupByDirectory?: boolean;
  /** Focus on specific element */
  focusElement?: string;
  /** Filter by path prefix */
  pathFilter?: string;
}

// ============================================
// COMPLEXITY TYPES
// ============================================

/**
 * Complexity metrics for a code element
 */
export interface ComplexityMetrics {
  // File-level metrics
  /** Lines of code */
  linesOfCode: number;
  /** Cyclomatic complexity */
  cyclomaticComplexity: number;
  /** Cognitive complexity */
  cognitiveComplexity: number;
  
  // Class-level metrics
  /** Number of methods */
  methodCount: number;
  /** Number of properties */
  propertyCount: number;
  /** Number of dependencies */
  dependencyCount: number;
  
  // Project-level metrics
  /** Coupling (0-1, lower is better) */
  coupling: number;
  /** Cohesion (0-1, higher is better) */
  cohesion: number;
  /** Abstractness (0-1) */
  abstractness: number;
  /** Instability (0-1) */
  instability: number;
}

// ============================================
// ARCHITECTURE SCORE
// ============================================

/**
 * Breakdown of architecture score
 */
export interface ScoreBreakdown {
  /** Antipattern score (0-25) */
  antipatterns: number;
  /** Complexity score (0-25) */
  complexity: number;
  /** Coupling score (0-25) */
  coupling: number;
  /** Testability score (0-25) */
  testability: number;
}

/**
 * Complete architecture score
 */
export interface ArchitectureScore {
  /** Letter grade (A-F) */
  grade: ArchitectureGrade;
  /** Numeric score (0-100) */
  score: number;
  /** Score breakdown by category */
  breakdown: ScoreBreakdown;
  /** Detected antipatterns */
  antipatterns: DetectedAntipattern[];
  /** Refactoring suggestions */
  suggestions: RefactoringSuggestion[];
  /** Previous score for comparison */
  previousScore?: number;
  /** Trend direction */
  trend?: 'improving' | 'stable' | 'declining';
  /** Explanation of score */
  explanation?: string;
}

// ============================================
// ANALYSIS OPTIONS
// ============================================

/**
 * Threshold configuration
 */
export interface AnalysisThresholds {
  /** Methods threshold for God Object (default: 20) */
  godObjectMethods?: number;
  /** Lines threshold for God Object (default: 500) */
  godObjectLines?: number;
  /** Connections threshold for God Object (default: 15) */
  godObjectConnections?: number;
  /** Parameters threshold for Long Parameter List (default: 5) */
  longParameterList?: number;
  /** Maximum cyclomatic complexity (default: 10) */
  maxCyclomaticComplexity?: number;
  /** Minimum confidence to report (default: 0.7) */
  minConfidence?: number;
}

/**
 * Analysis options
 */
export interface AnalysisOptions {
  /** Paths to include (glob patterns) */
  includePaths?: string[];
  /** Paths to exclude (glob patterns) */
  excludePaths?: string[];
  /** Enabled rule IDs */
  enabledRules?: string[];
  /** Disabled rule IDs */
  disabledRules?: string[];
  /** Threshold configuration */
  thresholds?: AnalysisThresholds;
  /** Generate C4 diagrams */
  generateDiagrams?: boolean;
  /** Which C4 levels to generate */
  diagramLevels?: C4Level[];
  /** Use cached results */
  useCache?: boolean;
  /** Progress callback */
  onProgress?: (progress: AnalysisProgress) => void;
}

/**
 * Analysis progress
 */
export interface AnalysisProgress {
  /** Current phase */
  phase: 'scanning' | 'analyzing' | 'generating' | 'scoring';
  /** Current item being processed */
  current: number;
  /** Total items */
  total: number;
  /** Progress message */
  message: string;
}

// ============================================
// RULE TYPES
// ============================================

/**
 * Rule metadata
 */
export interface RuleMetadata {
  /** Unique rule ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category */
  category: AntipatternCategory;
  /** Default severity */
  defaultSeverity: AntipatternSeverity;
  /** Description */
  description: string;
  /** Is rule enabled by default */
  enabledByDefault: boolean;
}

/**
 * Rule interface
 */
export interface IRule {
  /** Rule metadata */
  readonly metadata: RuleMetadata;
  /** Detect antipatterns */
  detect(): DetectedAntipattern[];
  /** Generate suggestion for antipattern */
  suggest(antipattern: DetectedAntipattern): RefactoringSuggestion;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Default exclusions to reduce false positives
 */
export const DEFAULT_EXCLUSIONS = {
  /** Node types excluded from orphan detection */
  orphanExclusions: ['interface', 'type', 'enum'] as const,
  
  /** File patterns for public API */
  publicApiPatterns: [
    '**/index.ts',
    '**/index.js',
    '**/types.ts',
    '**/types.js'
  ],
  
  /** File patterns for tests */
  testPatterns: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/*.test.js',
    '**/*.spec.js'
  ],
  
  /** Directories to exclude */
  excludeDirectories: [
    'node_modules',
    'dist',
    'build',
    '.git',
    'coverage'
  ]
};

/**
 * Default thresholds
 */
export const DEFAULT_THRESHOLDS: Required<AnalysisThresholds> = {
  godObjectMethods: 20,
  godObjectLines: 500,
  godObjectConnections: 15,
  longParameterList: 5,
  maxCyclomaticComplexity: 10,
  minConfidence: 0.7
};

