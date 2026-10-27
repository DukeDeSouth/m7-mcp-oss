/**
 * M7 v3.0 - Context Visualizer Types
 * 
 * Types for graph visualization and real-time context tracking
 */

// ============================================
// GRAPH DATA TYPES
// ============================================

/**
 * Visual node for graph rendering
 */
export interface VisualNode {
  id: string;
  name: string;
  type: NodeType;
  filePath: string;
  x?: number;
  y?: number;
  
  // Visual properties
  color: string;
  size: number;
  opacity: number;
  
  // State
  isActive: boolean;      // Currently editing
  isHighlighted: boolean; // In impact zone
  isOrphan: boolean;      // Unused export
  
  // Metadata
  line?: number;
  exported?: boolean;
  dependencies: number;
  dependents: number;
}

/**
 * Visual link for graph rendering
 */
export interface VisualLink {
  id: string;
  source: string;
  target: string;
  type: LinkType;
  
  // Visual properties
  color: string;
  width: number;
  opacity: number;
  dashed: boolean;
  
  // State
  isHighlighted: boolean;
}

/**
 * Node types
 */
export type NodeType = 
  | 'file'
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'component'
  | 'hook'
  | 'variable'
  | 'module'
  | 'enum';

/**
 * Link types
 */
export type LinkType =
  | 'imports'
  | 'exports'
  | 'extends'
  | 'implements'
  | 'contains'
  | 'calls'
  | 'uses';

// ============================================
// CONTEXT TYPES
// ============================================

/**
 * Current editing context
 */
export interface CurrentContext {
  /** Currently active file */
  activeFile: string | null;
  
  /** Currently active function/class */
  activeSymbol: string | null;
  
  /** Current session ID */
  sessionId: string | null;
  
  /** Current task description */
  taskDescription: string | null;
  
  /** Files modified in this session */
  modifiedFiles: string[];
  
  /** Navigation history */
  history: HistoryEntry[];
  
  /** Timestamp */
  updatedAt: Date;
}

/**
 * Navigation history entry
 */
export interface HistoryEntry {
  file: string;
  symbol?: string;
  timestamp: Date;
  action: 'open' | 'edit' | 'save';
}

// ============================================
// IMPACT TYPES
// ============================================

/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
  /** Node being analyzed */
  nodeId: string;
  
  /** Directly affected nodes */
  directImpact: string[];
  
  /** Transitively affected nodes */
  transitiveImpact: string[];
  
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  /** Risk score 0-100 */
  riskScore: number;
  
  /** Affected tests */
  affectedTests: string[];
}

// ============================================
// GRAPH STATE
// ============================================

/**
 * Complete graph state for visualization
 */
export interface GraphState {
  nodes: VisualNode[];
  links: VisualLink[];
  context: CurrentContext;
  impact: ImpactAnalysis | null;
  
  // Metrics
  metrics: {
    totalNodes: number;
    totalLinks: number;
    orphanCount: number;
    cycleCount: number;
    healthGrade: string;
  };
  
  // View settings
  view: ViewSettings;
}

/**
 * View settings
 */
export interface ViewSettings {
  /** Zoom level */
  zoom: number;
  
  /** Pan offset */
  panX: number;
  panY: number;
  
  /** Show/hide filters */
  showFiles: boolean;
  showClasses: boolean;
  showFunctions: boolean;
  showInterfaces: boolean;
  showOrphans: boolean;
  
  /** Layout algorithm */
  layout: 'force' | 'hierarchy' | 'radial';
  
  /** Focus on specific node */
  focusNodeId: string | null;
}

// ============================================
// WEBSOCKET MESSAGES
// ============================================

/**
 * WebSocket message types
 */
export type WSMessageType =
  | 'graph_update'
  | 'context_update'
  | 'impact_update'
  | 'node_focus'
  | 'view_change'
  | 'ping'
  | 'pong';

/**
 * WebSocket message
 */
export interface WSMessage<T = any> {
  type: WSMessageType;
  payload: T;
  timestamp: number;
}

/**
 * Graph update payload
 */
export interface GraphUpdatePayload {
  nodes?: VisualNode[];
  links?: VisualLink[];
  metrics?: GraphState['metrics'];
}

/**
 * Context update payload
 */
export interface ContextUpdatePayload {
  context: Partial<CurrentContext>;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Visualizer configuration
 */
export interface VisualizerConfig {
  /** WebSocket port */
  wsPort: number;
  
  /** HTTP port for static files */
  httpPort: number;
  
  /** Update interval (ms) */
  updateInterval: number;
  
  /** Max nodes to display */
  maxNodes: number;
  
  /** Enable auto-focus on active file */
  autoFocus: boolean;
  
  /** Color scheme */
  colors: ColorScheme;
}

/**
 * Color scheme for node types
 */
export interface ColorScheme {
  file: string;
  class: string;
  function: string;
  interface: string;
  type: string;
  component: string;
  hook: string;
  variable: string;
  module: string;
  enum: string;
  
  // Link colors
  imports: string;
  exports: string;
  extends: string;
  implements: string;
  contains: string;
  
  // State colors
  active: string;
  highlighted: string;
  orphan: string;
}

/**
 * Default configuration
 */
export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  wsPort: 3847,
  httpPort: 3848,
  updateInterval: 1000,
  maxNodes: 500,
  autoFocus: true,
  colors: {
    // Node colors (Nord theme inspired)
    file: '#5E81AC',
    class: '#B48EAD',
    function: '#A3BE8C',
    interface: '#EBCB8B',
    type: '#D08770',
    component: '#88C0D0',
    hook: '#81A1C1',
    variable: '#8FBCBB',
    module: '#5E81AC',
    enum: '#BF616A',
    
    // Link colors
    imports: '#4C566A',
    exports: '#4C566A',
    extends: '#B48EAD',
    implements: '#EBCB8B',
    contains: '#3B4252',
    
    // State colors
    active: '#A3BE8C',
    highlighted: '#EBCB8B',
    orphan: '#BF616A',
  }
};

/**
 * Default view settings
 */
export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  zoom: 1,
  panX: 0,
  panY: 0,
  showFiles: true,
  showClasses: true,
  showFunctions: true,
  showInterfaces: true,
  showOrphans: false,
  layout: 'force',
  focusNodeId: null,
};

