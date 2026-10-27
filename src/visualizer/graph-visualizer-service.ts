/**
 * M7 v3.0 - Graph Visualizer Service
 * 
 * Transforms Knowledge Graph data into visual representation
 */

import { getKnowledgeGraph, KnowledgeGraph, GraphNode } from '../knowledge-graph/index.js';
import {
  VisualNode,
  VisualLink,
  GraphState,
  CurrentContext,
  ImpactAnalysis,
  ViewSettings,
  VisualizerConfig,
  NodeType,
  LinkType,
  DEFAULT_VISUALIZER_CONFIG,
  DEFAULT_VIEW_SETTINGS,
} from './types.js';

// ============================================
// GRAPH VISUALIZER SERVICE
// ============================================

export class GraphVisualizerService {
  private graph: KnowledgeGraph;
  private config: VisualizerConfig;
  private context: CurrentContext;
  private viewSettings: ViewSettings;
  
  constructor(config?: Partial<VisualizerConfig>) {
    this.graph = getKnowledgeGraph();
    this.config = { ...DEFAULT_VISUALIZER_CONFIG, ...config };
    this.viewSettings = { ...DEFAULT_VIEW_SETTINGS };
    this.context = {
      activeFile: null,
      activeSymbol: null,
      sessionId: null,
      taskDescription: null,
      modifiedFiles: [],
      history: [],
      updatedAt: new Date(),
    };
  }
  
  // ============================================
  // GRAPH STATE
  // ============================================
  
  /**
   * Get complete graph state for visualization
   */
  async getGraphState(): Promise<GraphState> {
    const nodes = this.getVisualNodes();
    const links = this.getVisualLinks(nodes);
    const metrics = this.graph.getMetrics();
    
    // Apply view filters
    const filteredNodes = this.applyNodeFilters(nodes);
    const filteredLinks = this.filterLinksForNodes(links, filteredNodes);
    
    // Calculate positions if not set
    this.calculateLayout(filteredNodes, filteredLinks);
    
    // Get impact if active node
    let impact: ImpactAnalysis | null = null;
    if (this.context.activeFile) {
      const activeNodeId = `file:${this.context.activeFile}`;
      impact = this.getImpactAnalysis(activeNodeId);
    }
    
    return {
      nodes: filteredNodes,
      links: filteredLinks,
      context: this.context,
      impact,
      metrics: {
        totalNodes: metrics.totalNodes,
        totalLinks: metrics.totalEdges,
        orphanCount: metrics.orphans,
        cycleCount: metrics.cycles,
        healthGrade: metrics.healthGrade,
      },
      view: this.viewSettings,
    };
  }
  
  /**
   * Get visual nodes from Knowledge Graph
   */
  getVisualNodes(): VisualNode[] {
    // Query all nodes
    const graphNodes = this.graph.queryNodes({});
    const colors = this.config.colors;
    
    return graphNodes.map((node: GraphNode) => {
      const nodeType = this.mapNodeType(node.type);
      const isActive = this.context.activeFile === node.filePath;
      const isOrphan = this.isOrphanNode(node);
      
      // Calculate size based on connections
      const deps = this.graph.getDependencies(node.id);
      const dependents = this.graph.getDependents(node.id);
      const connectionCount = deps.length + dependents.length;
      const size = Math.min(30, 8 + connectionCount * 2);
      
      return {
        id: node.id,
        name: node.name,
        type: nodeType,
        filePath: node.filePath,
        
        color: this.getNodeColor(nodeType, isActive, isOrphan),
        size,
        opacity: isOrphan ? 0.5 : 1,
        
        isActive,
        isHighlighted: false,
        isOrphan,
        
        line: node.line,
        exported: node.metadata.exported,
        dependencies: deps.length,
        dependents: dependents.length,
      };
    });
  }
  
  /**
   * Get visual links from Knowledge Graph
   */
  getVisualLinks(nodes: VisualNode[]): VisualLink[] {
    const links: VisualLink[] = [];
    const nodeIds = new Set(nodes.map(n => n.id));
    
    // Build links from dependencies
    for (const node of nodes) {
      const deps = this.graph.getDependencies(node.id);
      for (const dep of deps) {
        if (nodeIds.has(dep.id)) {
          const linkId = `${node.id}:imports:${dep.id}`;
          // Avoid duplicates
          if (!links.some(l => l.id === linkId)) {
            links.push({
              id: linkId,
              source: node.id,
              target: dep.id,
              type: 'imports',
              color: this.config.colors.imports,
              width: 1,
              opacity: 0.6,
              dashed: false,
              isHighlighted: false,
            });
          }
        }
      }
    }
    
    return links;
  }
  
  // ============================================
  // CONTEXT MANAGEMENT
  // ============================================
  
  /**
   * Update current context
   */
  updateContext(updates: Partial<CurrentContext>): void {
    const oldActiveFile = this.context.activeFile;
    
    this.context = {
      ...this.context,
      ...updates,
      updatedAt: new Date(),
    };
    
    // Add to history if file changed
    if (updates.activeFile && updates.activeFile !== oldActiveFile) {
      this.context.history.push({
        file: updates.activeFile,
        symbol: updates.activeSymbol || undefined,
        timestamp: new Date(),
        action: 'open',
      });
      
      // Keep history limited
      if (this.context.history.length > 50) {
        this.context.history = this.context.history.slice(-50);
      }
    }
  }
  
  /**
   * Set active file
   */
  setActiveFile(filePath: string | null): void {
    this.updateContext({ activeFile: filePath });
    
    // Auto-focus if enabled
    if (filePath && this.config.autoFocus) {
      this.viewSettings.focusNodeId = `file:${filePath}`;
    }
  }
  
  /**
   * Add modified file
   */
  addModifiedFile(filePath: string): void {
    if (!this.context.modifiedFiles.includes(filePath)) {
      this.context.modifiedFiles.push(filePath);
    }
    
    // Add to history
    this.context.history.push({
      file: filePath,
      timestamp: new Date(),
      action: 'edit',
    });
  }
  
  // ============================================
  // IMPACT ANALYSIS
  // ============================================
  
  /**
   * Get impact analysis for a node
   */
  getImpactAnalysis(nodeId: string): ImpactAnalysis {
    const directDeps = this.graph.getDependents(nodeId);
    const directIds = directDeps.map(n => n.id);
    
    // Get transitive dependents (limited depth)
    const transitiveIds: string[] = [];
    const visited = new Set<string>();
    const queue = [...directIds];
    
    while (queue.length > 0 && transitiveIds.length < 100) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      transitiveIds.push(id);
      
      const deps = this.graph.getDependents(id);
      for (const dep of deps) {
        if (!visited.has(dep.id)) {
          queue.push(dep.id);
        }
      }
    }
    
    // Calculate risk based on impact
    const impactCount = transitiveIds.length;
    let riskLevel: ImpactAnalysis['riskLevel'] = 'low';
    let riskScore = 0;
    
    if (impactCount > 50) {
      riskLevel = 'critical';
      riskScore = 90 + Math.min(10, (impactCount - 50) / 10);
    } else if (impactCount > 20) {
      riskLevel = 'high';
      riskScore = 70 + (impactCount - 20) * 0.67;
    } else if (impactCount > 5) {
      riskLevel = 'medium';
      riskScore = 30 + (impactCount - 5) * 2.67;
    } else {
      riskLevel = 'low';
      riskScore = impactCount * 6;
    }
    
    // Find affected tests
    const affectedTests = transitiveIds.filter(id => 
      id.includes('.test.') || id.includes('.spec.') || id.includes('__tests__')
    );
    
    return {
      nodeId,
      directImpact: directIds,
      transitiveImpact: transitiveIds,
      riskLevel,
      riskScore: Math.round(riskScore),
      affectedTests,
    };
  }
  
  /**
   * Highlight impact zone on graph
   */
  highlightImpact(nodes: VisualNode[], links: VisualLink[], impact: ImpactAnalysis): void {
    const impactedIds = new Set([
      impact.nodeId,
      ...impact.directImpact,
      ...impact.transitiveImpact,
    ]);
    
    // Highlight nodes
    for (const node of nodes) {
      node.isHighlighted = impactedIds.has(node.id);
      if (node.isHighlighted) {
        node.color = this.config.colors.highlighted;
      }
    }
    
    // Highlight links
    for (const link of links) {
      link.isHighlighted = impactedIds.has(link.source) && impactedIds.has(link.target);
      if (link.isHighlighted) {
        link.opacity = 1;
        link.width = 2;
      }
    }
  }
  
  // ============================================
  // VIEW MANAGEMENT
  // ============================================
  
  /**
   * Update view settings
   */
  updateViewSettings(updates: Partial<ViewSettings>): void {
    this.viewSettings = { ...this.viewSettings, ...updates };
  }
  
  /**
   * Focus on a specific node
   */
  focusNode(nodeId: string | null): void {
    this.viewSettings.focusNodeId = nodeId;
  }
  
  /**
   * Reset view to default
   */
  resetView(): void {
    this.viewSettings = { ...DEFAULT_VIEW_SETTINGS };
  }
  
  // ============================================
  // HELPERS
  // ============================================
  
  /**
   * Apply node filters based on view settings
   */
  private applyNodeFilters(nodes: VisualNode[]): VisualNode[] {
    return nodes.filter(node => {
      if (!this.viewSettings.showFiles && node.type === 'file') return false;
      if (!this.viewSettings.showClasses && node.type === 'class') return false;
      if (!this.viewSettings.showFunctions && node.type === 'function') return false;
      if (!this.viewSettings.showInterfaces && node.type === 'interface') return false;
      if (!this.viewSettings.showOrphans && node.isOrphan) return false;
      return true;
    }).slice(0, this.config.maxNodes);
  }
  
  /**
   * Filter links to only include those between visible nodes
   */
  private filterLinksForNodes(links: VisualLink[], nodes: VisualNode[]): VisualLink[] {
    const nodeIds = new Set(nodes.map(n => n.id));
    return links.filter(link => 
      nodeIds.has(link.source) && nodeIds.has(link.target)
    );
  }
  
  /**
   * Calculate layout positions
   */
  private calculateLayout(nodes: VisualNode[], links: VisualLink[]): void {
    // Simple force-directed layout approximation
    const width = 1000;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Group nodes by file/directory
    const fileGroups = new Map<string, VisualNode[]>();
    for (const node of nodes) {
      const dir = node.filePath.split('/').slice(0, -1).join('/');
      if (!fileGroups.has(dir)) {
        fileGroups.set(dir, []);
      }
      fileGroups.get(dir)!.push(node);
    }
    
    // Position groups in a circle
    const groupArray = Array.from(fileGroups.entries());
    const groupCount = groupArray.length;
    
    groupArray.forEach(([dir, groupNodes], groupIndex) => {
      const groupAngle = (2 * Math.PI * groupIndex) / Math.max(1, groupCount);
      const groupRadius = Math.min(width, height) * 0.35;
      const groupCenterX = centerX + Math.cos(groupAngle) * groupRadius;
      const groupCenterY = centerY + Math.sin(groupAngle) * groupRadius;
      
      // Position nodes within group
      const nodeCount = groupNodes.length;
      groupNodes.forEach((node, nodeIndex) => {
        if (nodeCount === 1) {
          node.x = groupCenterX;
          node.y = groupCenterY;
        } else {
          const nodeAngle = (2 * Math.PI * nodeIndex) / nodeCount;
          const nodeRadius = Math.min(50, nodeCount * 5);
          node.x = groupCenterX + Math.cos(nodeAngle) * nodeRadius;
          node.y = groupCenterY + Math.sin(nodeAngle) * nodeRadius;
        }
      });
    });
  }
  
  /**
   * Map Knowledge Graph node type to visual type
   */
  private mapNodeType(type: string): NodeType {
    const typeMap: Record<string, NodeType> = {
      'file': 'file',
      'class': 'class',
      'function': 'function',
      'interface': 'interface',
      'type': 'type',
      'component': 'component',
      'hook': 'hook',
      'variable': 'variable',
      'module': 'module',
      'enum': 'enum',
    };
    return typeMap[type] || 'file';
  }
  
  /**
   * Get color for node
   */
  private getNodeColor(type: NodeType, isActive: boolean, isOrphan: boolean): string {
    if (isActive) return this.config.colors.active;
    if (isOrphan) return this.config.colors.orphan;
    return this.config.colors[type] || this.config.colors.file;
  }
  
  /**
   * Check if node is orphan
   */
  private isOrphanNode(node: GraphNode): boolean {
    if (node.type === 'file') return false;
    if (!node.metadata.exported) return false;
    
    const dependents = this.graph.getDependents(node.id);
    return dependents.length === 0;
  }
}

// ============================================
// SINGLETON
// ============================================

let visualizerInstance: GraphVisualizerService | null = null;

export function getGraphVisualizerService(config?: Partial<VisualizerConfig>): GraphVisualizerService {
  if (!visualizerInstance) {
    visualizerInstance = new GraphVisualizerService(config);
  }
  return visualizerInstance;
}

export function createGraphVisualizerService(config?: Partial<VisualizerConfig>): GraphVisualizerService {
  return new GraphVisualizerService(config);
}
