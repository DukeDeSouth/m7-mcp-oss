/**
 * M7 v3.0 - Knowledge Graph Types
 * 
 * Types for project dependency graph analysis
 */

// ============================================
// NODE TYPES
// ============================================

export type NodeType =
  | 'file'           // Source file
  | 'class'          // Class declaration
  | 'function'       // Function/method
  | 'interface'      // Interface declaration
  | 'type'           // Type alias
  | 'variable'       // Variable/constant
  | 'module'         // Module/namespace
  | 'enum'           // Enum declaration
  | 'component'      // React component
  | 'hook'           // React hook
  | 'api_endpoint'   // API route
  | 'test'           // Test file
  | 'config'         // Config file
  // CNP Types (Hive v3.0)
  | 'cnp_task'       // CNP task node
  | 'cnp_agent'      // CNP agent node
  | 'cnp_artifact'   // CNP artifact node
  | 'cnp_decision';  // CNP decision node

export type RelationType =
  | 'imports'        // A imports B
  | 'exports'        // A exports B
  | 'extends'        // A extends B (class inheritance)
  | 'implements'     // A implements B (interface)
  | 'calls'          // A calls function B
  | 'uses'           // A uses B (generic usage)
  | 'depends_on'     // A depends on B (module level)
  | 'tested_by'      // A is tested by B
  | 'contains'       // A contains B (file contains class)
  | 're_exports'     // A re-exports from B
  // CNP Relations (Hive v3.0)
  | 'cnp_depends_on'   // CNP task depends on another task
  | 'cnp_assigned_to'  // CNP task assigned to agent
  | 'cnp_produces'     // CNP task produces artifact
  | 'cnp_validated_by' // CNP artifact validated by gatekeeper
  | 'cnp_derived_from' // CNP artifact derived from another
  | 'cnp_subtask_of';  // CNP subtask relationship

// ============================================
// GRAPH NODE
// ============================================

export interface GraphNode {
  /** Unique identifier (path:type:name) */
  id: string;
  
  /** Node type */
  type: NodeType;
  
  /** Name of the element */
  name: string;
  
  /** File path */
  filePath: string;
  
  /** Line number (for code elements) */
  line?: number;
  
  /** Additional metadata */
  metadata: GraphNodeMetadata;
}

export interface GraphNodeMetadata {
  /** Programming language */
  language?: 'typescript' | 'javascript' | 'tsx' | 'jsx';
  
  /** Is exported? */
  exported?: boolean;
  
  /** Is default export? */
  defaultExport?: boolean;
  
  /** Parent class/interface for inheritance */
  extends?: string[];
  
  /** Implemented interfaces */
  implements?: string[];
  
  /** Function parameters count */
  paramCount?: number;
  
  /** Lines of code */
  loc?: number;
  
  /** Complexity score */
  complexity?: number;
  
  /** Last modified timestamp */
  lastModified?: Date;
  
  /** Custom tags */
  tags?: string[];
}

// ============================================
// GRAPH EDGE
// ============================================

export interface GraphEdge {
  /** Unique identifier */
  id: string;
  
  /** Source node ID */
  source: string;
  
  /** Target node ID */
  target: string;
  
  /** Relationship type */
  type: RelationType;
  
  /** Edge weight (strength) */
  weight: number;
  
  /** Additional metadata */
  metadata?: GraphEdgeMetadata;
}

export interface GraphEdgeMetadata {
  /** Line where relationship is defined */
  line?: number;
  
  /** Import is type-only? */
  typeOnly?: boolean;
  
  /** Named imports */
  namedImports?: string[];
  
  /** Is dynamic import? */
  dynamic?: boolean;
  
  /** Custom data */
  [key: string]: unknown;
}

// ============================================
// ANALYSIS RESULTS
// ============================================

export interface ImpactAnalysis {
  /** The node being analyzed */
  node: GraphNode;
  
  /** Nodes directly affected */
  directImpact: GraphNode[];
  
  /** Nodes transitively affected */
  transitiveImpact: GraphNode[];
  
  /** Files that need attention */
  affectedFiles: string[];
  
  /** Suggested tests to run */
  suggestedTests: string[];
  
  /** Overall risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  /** Impact score (0-100) */
  impactScore: number;
}

export interface DependencyCycle {
  /** Nodes involved in cycle */
  nodes: GraphNode[];
  
  /** Edges forming the cycle */
  edges: GraphEdge[];
  
  /** Cycle severity */
  severity: 'info' | 'warning' | 'error';
  
  /** Human readable path */
  path: string;
  
  /** Suggestion to break cycle */
  suggestion: string;
}

export interface OrphanNode {
  /** The orphan node */
  node: GraphNode;
  
  /** Why it's considered orphan */
  reason: 'no_imports' | 'no_exports' | 'unused_export' | 'dead_code';
  
  /** Confidence level */
  confidence: number;
  
  /** Suggestion */
  suggestion: string;
}

// ============================================
// GRAPH METRICS
// ============================================

export interface GraphMetrics {
  /** Total number of nodes */
  totalNodes: number;
  
  /** Total number of edges */
  totalEdges: number;
  
  /** Nodes by type */
  nodesByType: Record<NodeType, number>;
  
  /** Edges by type */
  edgesByType: Record<RelationType, number>;
  
  /** Average node degree (connections) */
  avgDegree: number;
  
  /** Max node degree */
  maxDegree: number;
  
  /** Number of connected components */
  components: number;
  
  /** Number of cycles detected */
  cycles: number;
  
  /** Number of orphan nodes */
  orphans: number;
  
  /** Coupling score (0-1, lower is better) */
  couplingScore: number;
  
  /** Cohesion score (0-1, higher is better) */
  cohesionScore: number;
  
  /** Overall health grade */
  healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

// ============================================
// QUERY TYPES
// ============================================

export interface NodeQuery {
  /** Filter by type */
  type?: NodeType | NodeType[];
  
  /** Filter by name (regex) */
  name?: string | RegExp;
  
  /** Filter by path (glob) */
  path?: string;
  
  /** Filter by tags */
  tags?: string[];
  
  /** Only exported */
  exported?: boolean;
  
  /** Limit results */
  limit?: number;
}

export interface EdgeQuery {
  /** Filter by source */
  source?: string;
  
  /** Filter by target */
  target?: string;
  
  /** Filter by type */
  type?: RelationType | RelationType[];
  
  /** Filter by direction */
  direction?: 'outgoing' | 'incoming' | 'both';
  
  /** Max depth for traversal */
  depth?: number;
}

// ============================================
// BUILD OPTIONS
// ============================================

export interface BuildOptions {
  /** Root directory to scan */
  rootPath: string;
  
  /** File patterns to include */
  include?: string[];
  
  /** File patterns to exclude */
  exclude?: string[];
  
  /** Parse depth for nested structures */
  depth?: number;
  
  /** Follow symlinks */
  followSymlinks?: boolean;
  
  /** Include node_modules */
  includeNodeModules?: boolean;
  
  /** Max files to process */
  maxFiles?: number;
}

export interface BuildReport {
  /** Files processed */
  filesProcessed: number;
  
  /** Files skipped */
  filesSkipped: number;
  
  /** Nodes created */
  nodesCreated: number;
  
  /** Edges created */
  edgesCreated: number;
  
  /** Errors encountered */
  errors: Array<{
    file: string;
    error: string;
  }>;
  
  /** Build duration in ms */
  duration: number;
}

// ============================================
// DIAGRAM TYPES
// ============================================

export type DiagramFormat = 'mermaid' | 'dot' | 'd3' | 'cytoscape';

export type DiagramType = 
  | 'dependency'     // Module dependency graph
  | 'class'          // Class hierarchy
  | 'component'      // Component relationships
  | 'module'         // Module boundaries
  | 'impact';        // Impact analysis visualization

export interface DiagramOptions {
  /** Diagram type */
  type: DiagramType;
  
  /** Output format */
  format: DiagramFormat;
  
  /** Root node to start from */
  rootNode?: string;
  
  /** Max depth to traverse */
  maxDepth?: number;
  
  /** Max nodes to show */
  maxNodes?: number;
  
  /** Filter by node types */
  nodeTypes?: NodeType[];
  
  /** Filter by edge types */
  edgeTypes?: RelationType[];
  
  /** Include orphans */
  includeOrphans?: boolean;
  
  /** Color scheme */
  colorScheme?: 'default' | 'health' | 'type';
  
  /** Layout direction */
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
}

// ============================================
// CONFIGURATION
// ============================================

export interface KnowledgeGraphConfig {
  /** Enable graph building */
  enabled: boolean;
  
  /** Auto-build on project load */
  autoBuild: boolean;
  
  /** Watch for file changes */
  watchMode: boolean;
  
  /** Cache graph to disk */
  persistGraph: boolean;
  
  /** Cache path */
  cachePath: string;
  
  /** Default build options */
  defaultBuildOptions: Partial<BuildOptions>;
  
  /** Analysis thresholds */
  thresholds: {
    /** Max acceptable coupling */
    maxCoupling: number;
    /** Min acceptable cohesion */
    minCohesion: number;
    /** Cycle severity threshold */
    cycleSeverity: 'info' | 'warning' | 'error';
  };
}

export const DEFAULT_KNOWLEDGE_GRAPH_CONFIG: KnowledgeGraphConfig = {
  enabled: true,
  autoBuild: false,
  watchMode: false,
  persistGraph: true,
  cachePath: '~/.m7/graph-cache.json',
  defaultBuildOptions: {
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
    depth: 10,
    followSymlinks: false,
    includeNodeModules: false,
    maxFiles: 10000
  },
  thresholds: {
    maxCoupling: 0.7,
    minCohesion: 0.3,
    cycleSeverity: 'warning'
  }
};

