/**
 * M7 v3.0 - Cycle Detector
 * 
 * Detects circular dependencies in the graph
 */

import {
  GraphNode,
  GraphEdge,
  DependencyCycle,
  RelationType
} from './types.js';
import { GraphStore } from './graph-store.js';

// ============================================
// CYCLE DETECTOR
// ============================================

export class CycleDetector {
  constructor(private graph: GraphStore) {}
  
  /**
   * Detect all cycles in the graph
   */
  detectCycles(options: {
    maxCycles?: number;
    includeTypeOnly?: boolean;
    edgeTypes?: RelationType[];
  } = {}): DependencyCycle[] {
    const {
      maxCycles = 100,
      includeTypeOnly = false,
      edgeTypes = ['imports', 'depends_on', 'extends', 'implements']
    } = options;
    
    const cycles: DependencyCycle[] = [];
    const visited = new Set<string>();
    const recursionStack: string[] = [];
    const recursionSet = new Set<string>();
    
    // Get all file nodes as starting points
    const fileNodes = this.graph.queryNodes({ type: 'file' });
    
    const dfs = (nodeId: string): boolean => {
      if (cycles.length >= maxCycles) return false;
      
      visited.add(nodeId);
      recursionStack.push(nodeId);
      recursionSet.add(nodeId);
      
      // Get outgoing edges
      const edges = this.graph.queryEdges({ source: nodeId });
      
      for (const edge of edges) {
        // Filter by edge type
        if (!edgeTypes.includes(edge.type)) continue;
        
        // Skip type-only imports if specified
        if (!includeTypeOnly && edge.metadata?.typeOnly) continue;
        
        const targetId = edge.target;
        
        // Found a cycle!
        if (recursionSet.has(targetId)) {
          const cycleStart = recursionStack.indexOf(targetId);
          const cycleNodeIds = recursionStack.slice(cycleStart);
          
          const cycle = this.buildCycle(cycleNodeIds, edgeTypes);
          if (cycle) {
            cycles.push(cycle);
          }
        }
        
        // Continue DFS
        if (!visited.has(targetId)) {
          dfs(targetId);
        }
      }
      
      recursionStack.pop();
      recursionSet.delete(nodeId);
      
      return false;
    };
    
    // Start DFS from each file node
    for (const node of fileNodes) {
      if (!visited.has(node.id)) {
        dfs(node.id);
      }
      
      if (cycles.length >= maxCycles) break;
    }
    
    // Deduplicate cycles (same cycle can be detected from different starting points)
    return this.deduplicateCycles(cycles);
  }
  
  /**
   * Detect cycles starting from a specific node
   */
  detectCyclesFrom(nodeId: string, maxDepth: number = 20): DependencyCycle[] {
    const cycles: DependencyCycle[] = [];
    const path: string[] = [];
    const pathSet = new Set<string>();
    
    const dfs = (currentId: string, depth: number) => {
      if (depth > maxDepth) return;
      
      path.push(currentId);
      pathSet.add(currentId);
      
      const edges = this.graph.queryEdges({ source: currentId });
      
      for (const edge of edges) {
        if (edge.type !== 'imports' && edge.type !== 'depends_on') continue;
        
        const targetId = edge.target;
        
        // Found a cycle back to the start!
        if (targetId === nodeId) {
          const cycleNodeIds = [...path, nodeId];
          const cycle = this.buildCycle(cycleNodeIds);
          if (cycle) cycles.push(cycle);
        }
        
        // Continue DFS
        if (!pathSet.has(targetId)) {
          dfs(targetId, depth + 1);
        }
      }
      
      path.pop();
      pathSet.delete(currentId);
    };
    
    dfs(nodeId, 0);
    
    return cycles;
  }
  
  /**
   * Check if adding an edge would create a cycle
   */
  wouldCreateCycle(sourceId: string, targetId: string): boolean {
    // Check if there's already a path from target to source
    const path = this.graph.findPath(targetId, sourceId);
    return path !== null && path.length > 0;
  }
  
  /**
   * Get strongly connected components (SCCs)
   * Using Tarjan's algorithm
   */
  getStronglyConnectedComponents(): GraphNode[][] {
    const sccs: GraphNode[][] = [];
    const index = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let currentIndex = 0;
    
    const strongConnect = (nodeId: string) => {
      index.set(nodeId, currentIndex);
      lowLink.set(nodeId, currentIndex);
      currentIndex++;
      stack.push(nodeId);
      onStack.add(nodeId);
      
      // Get successors
      const edges = this.graph.queryEdges({ source: nodeId });
      
      for (const edge of edges) {
        const targetId = edge.target;
        
        if (!index.has(targetId)) {
          // Not visited yet
          strongConnect(targetId);
          lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, lowLink.get(targetId)!));
        } else if (onStack.has(targetId)) {
          // On stack = in current SCC
          lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, index.get(targetId)!));
        }
      }
      
      // If nodeId is a root node, pop the stack and generate an SCC
      if (lowLink.get(nodeId) === index.get(nodeId)) {
        const scc: GraphNode[] = [];
        let w: string;
        
        do {
          w = stack.pop()!;
          onStack.delete(w);
          const node = this.graph.getNode(w);
          if (node) scc.push(node);
        } while (w !== nodeId);
        
        // Only keep SCCs with more than 1 node (actual cycles)
        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };
    
    // Run for all nodes
    for (const node of this.graph.getAllNodes()) {
      if (!index.has(node.id)) {
        strongConnect(node.id);
      }
    }
    
    return sccs;
  }
  
  /**
   * Get cycle statistics
   */
  getCycleStats(): {
    totalCycles: number;
    sccCount: number;
    largestSccSize: number;
    cyclesByType: Record<string, number>;
    mostInvolvedFiles: Array<{ file: string; cycleCount: number }>;
  } {
    const cycles = this.detectCycles();
    const sccs = this.getStronglyConnectedComponents();
    
    // Count by type
    const cyclesByType: Record<string, number> = {
      import: 0,
      inheritance: 0,
      mixed: 0
    };
    
    // Count file involvement
    const fileInvolvement = new Map<string, number>();
    
    for (const cycle of cycles) {
      // Classify cycle
      const hasInheritance = cycle.edges.some(e => 
        e.type === 'extends' || e.type === 'implements'
      );
      const hasImport = cycle.edges.some(e => e.type === 'imports');
      
      if (hasInheritance && hasImport) {
        cyclesByType.mixed++;
      } else if (hasInheritance) {
        cyclesByType.inheritance++;
      } else {
        cyclesByType.import++;
      }
      
      // Track file involvement
      for (const node of cycle.nodes) {
        const count = fileInvolvement.get(node.filePath) || 0;
        fileInvolvement.set(node.filePath, count + 1);
      }
    }
    
    // Get most involved files
    const mostInvolvedFiles = Array.from(fileInvolvement.entries())
      .map(([file, cycleCount]) => ({ file, cycleCount }))
      .sort((a, b) => b.cycleCount - a.cycleCount)
      .slice(0, 10);
    
    return {
      totalCycles: cycles.length,
      sccCount: sccs.length,
      largestSccSize: Math.max(...sccs.map(s => s.length), 0),
      cyclesByType,
      mostInvolvedFiles
    };
  }
  
  /**
   * Build a DependencyCycle object from node IDs
   */
  private buildCycle(
    nodeIds: string[],
    edgeTypes: RelationType[] = ['imports', 'depends_on', 'extends', 'implements']
  ): DependencyCycle | null {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    
    for (let i = 0; i < nodeIds.length; i++) {
      const node = this.graph.getNode(nodeIds[i]);
      if (!node) return null;
      nodes.push(node);
      
      // Get edge to next node
      const nextId = nodeIds[(i + 1) % nodeIds.length];
      const edgeList = this.graph.queryEdges({ source: nodeIds[i], target: nextId });
      const edge = edgeList.find(e => edgeTypes.includes(e.type));
      if (edge) edges.push(edge);
    }
    
    // Generate path string
    const pathStr = nodes.map(n => n.name || n.filePath.split('/').pop()).join(' → ') + ' → (cycle)';
    
    // Determine severity
    const severity = this.determineSeverity(edges);
    
    // Generate suggestion
    const suggestion = this.generateSuggestion(nodes, edges);
    
    return {
      nodes,
      edges,
      severity,
      path: pathStr,
      suggestion
    };
  }
  
  /**
   * Determine cycle severity
   */
  private determineSeverity(edges: GraphEdge[]): 'info' | 'warning' | 'error' {
    // Type-only cycles are less severe
    const allTypeOnly = edges.every(e => e.metadata?.typeOnly);
    if (allTypeOnly) return 'info';
    
    // Inheritance cycles are more severe
    const hasInheritance = edges.some(e => 
      e.type === 'extends' || e.type === 'implements'
    );
    if (hasInheritance) return 'error';
    
    // Long cycles are more severe
    if (edges.length >= 5) return 'error';
    if (edges.length >= 3) return 'warning';
    
    return 'warning';
  }
  
  /**
   * Generate suggestion to break cycle
   */
  private generateSuggestion(nodes: GraphNode[], edges: GraphEdge[]): string {
    // Find the weakest link (lowest weight edge)
    const sortedEdges = [...edges].sort((a, b) => a.weight - b.weight);
    const weakestEdge = sortedEdges[0];
    
    if (!weakestEdge) return 'Consider refactoring to break the cycle.';
    
    const sourceNode = nodes.find(n => n.id === weakestEdge.source);
    const targetNode = nodes.find(n => n.id === weakestEdge.target);
    
    const suggestions: string[] = [];
    
    // Type-specific suggestions
    if (weakestEdge.type === 'imports') {
      suggestions.push(
        `Consider moving shared code to a separate module to break the dependency between "${sourceNode?.name}" and "${targetNode?.name}".`,
        'Use dependency injection to invert the dependency.',
        'Extract an interface to a shared location.'
      );
    } else if (weakestEdge.type === 'extends') {
      suggestions.push(
        'Consider using composition instead of inheritance.',
        `Extract common functionality to a base class that both can extend.`
      );
    } else if (weakestEdge.type === 'implements') {
      suggestions.push(
        'Move the interface to a separate file.',
        'Consider if the interface is in the right location.'
      );
    }
    
    return suggestions[0] || 'Consider refactoring to break the cycle.';
  }
  
  /**
   * Deduplicate cycles (same cycle from different starting points)
   */
  private deduplicateCycles(cycles: DependencyCycle[]): DependencyCycle[] {
    const seen = new Set<string>();
    const unique: DependencyCycle[] = [];
    
    for (const cycle of cycles) {
      // Create canonical key (sorted node IDs)
      const key = [...cycle.nodes.map(n => n.id)].sort().join('|');
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(cycle);
      }
    }
    
    return unique;
  }
}

export default CycleDetector;

