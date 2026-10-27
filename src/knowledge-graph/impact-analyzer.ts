/**
 * M7 v3.0 - Impact Analyzer
 * 
 * Analyzes the impact of changes in the codebase
 */

import {
  GraphNode,
  GraphEdge,
  ImpactAnalysis,
  RelationType
} from './types.js';
import { GraphStore } from './graph-store.js';

// ============================================
// IMPACT ANALYZER
// ============================================

export class ImpactAnalyzer {
  constructor(private graph: GraphStore) {}
  
  /**
   * Analyze impact of changing a node
   */
  analyze(nodeId: string, options: {
    maxDepth?: number;
    includeTestFiles?: boolean;
  } = {}): ImpactAnalysis | null {
    const { maxDepth = 5, includeTestFiles = true } = options;
    
    const node = this.graph.getNode(nodeId);
    if (!node) {
      return null;
    }
    
    // Get direct dependents (what depends on this node)
    const directDependents = this.graph.getDependents(nodeId);
    
    // Get all transitive dependents with depth
    const allDependentsMap = this.graph.getAllDependents(nodeId, maxDepth);
    
    // Convert to nodes
    const transitiveDependents: GraphNode[] = [];
    for (const [depId, depth] of allDependentsMap) {
      if (depth > 1) { // Exclude direct (depth 1)
        const depNode = this.graph.getNode(depId);
        if (depNode) {
          transitiveDependents.push(depNode);
        }
      }
    }
    
    // Extract unique affected files
    const affectedFilesSet = new Set<string>();
    affectedFilesSet.add(node.filePath);
    
    for (const dep of directDependents) {
      affectedFilesSet.add(dep.filePath);
    }
    for (const dep of transitiveDependents) {
      affectedFilesSet.add(dep.filePath);
    }
    
    let affectedFiles = Array.from(affectedFilesSet);
    
    // Filter test files if needed
    if (!includeTestFiles) {
      affectedFiles = affectedFiles.filter(f => 
        !f.includes('.test.') && 
        !f.includes('.spec.') && 
        !f.includes('__tests__')
      );
    }
    
    // Find suggested tests
    const suggestedTests = affectedFiles.filter(f =>
      f.includes('.test.') || 
      f.includes('.spec.') || 
      f.includes('__tests__')
    );
    
    // Calculate impact score
    const impactScore = this.calculateImpactScore(
      node,
      directDependents,
      transitiveDependents,
      affectedFiles
    );
    
    // Determine risk level
    const riskLevel = this.determineRiskLevel(
      node,
      directDependents.length,
      transitiveDependents.length,
      impactScore
    );
    
    return {
      node,
      directImpact: directDependents,
      transitiveImpact: transitiveDependents,
      affectedFiles,
      suggestedTests,
      riskLevel,
      impactScore
    };
  }
  
  /**
   * Analyze impact of changing a file
   */
  analyzeFile(filePath: string): ImpactAnalysis[] {
    const fileNodes = this.graph.getNodesByFile(filePath);
    const fileNode = fileNodes.find(n => n.type === 'file');
    
    if (!fileNode) {
      return [];
    }
    
    // Analyze the file itself
    const fileAnalysis = this.analyze(fileNode.id);
    
    // Also analyze all exported elements
    const analyses: ImpactAnalysis[] = [];
    if (fileAnalysis) {
      analyses.push(fileAnalysis);
    }
    
    // Analyze each exported element
    for (const node of fileNodes) {
      if (node.type !== 'file' && node.metadata.exported) {
        const analysis = this.analyze(node.id);
        if (analysis) {
          analyses.push(analysis);
        }
      }
    }
    
    return analyses;
  }
  
  /**
   * Get change propagation paths
   */
  getChangePropagation(nodeId: string, maxDepth: number = 3): Array<{
    path: GraphNode[];
    edges: GraphEdge[];
    riskFactor: number;
  }> {
    const results: Array<{
      path: GraphNode[];
      edges: GraphEdge[];
      riskFactor: number;
    }> = [];
    
    const node = this.graph.getNode(nodeId);
    if (!node) return results;
    
    // DFS to find all propagation paths
    const dfs = (
      currentId: string,
      currentPath: GraphNode[],
      currentEdges: GraphEdge[],
      visited: Set<string>,
      depth: number
    ) => {
      if (depth > maxDepth) return;
      
      const edges = this.graph.queryEdges({ target: currentId });
      
      for (const edge of edges) {
        if (visited.has(edge.source)) continue;
        
        const sourceNode = this.graph.getNode(edge.source);
        if (!sourceNode) continue;
        
        const newPath = [...currentPath, sourceNode];
        const newEdges = [...currentEdges, edge];
        const newVisited = new Set(visited);
        newVisited.add(edge.source);
        
        // Calculate risk factor based on edge type and path length
        const riskFactor = this.calculatePathRisk(newEdges);
        
        results.push({
          path: newPath,
          edges: newEdges,
          riskFactor
        });
        
        // Continue DFS
        dfs(edge.source, newPath, newEdges, newVisited, depth + 1);
      }
    };
    
    dfs(nodeId, [node], [], new Set([nodeId]), 0);
    
    // Sort by risk factor (highest first)
    results.sort((a, b) => b.riskFactor - a.riskFactor);
    
    return results;
  }
  
  /**
   * Find common ancestors (shared dependencies)
   */
  findCommonAncestors(nodeIds: string[]): GraphNode[] {
    if (nodeIds.length === 0) return [];
    if (nodeIds.length === 1) {
      const deps = this.graph.getAllDependencies(nodeIds[0]);
      return Array.from(deps.keys())
        .map(id => this.graph.getNode(id)!)
        .filter(Boolean);
    }
    
    // Get dependencies for each node
    const depSets = nodeIds.map(id => {
      const deps = this.graph.getAllDependencies(id);
      return new Set(deps.keys());
    });
    
    // Find intersection
    const common = depSets.reduce((acc, set) => {
      return new Set([...acc].filter(x => set.has(x)));
    });
    
    return Array.from(common)
      .map(id => this.graph.getNode(id)!)
      .filter(Boolean);
  }
  
  /**
   * Get critical paths (most impactful nodes)
   */
  getCriticalPaths(limit: number = 10): Array<{
    node: GraphNode;
    dependentCount: number;
    impactScore: number;
  }> {
    const results: Array<{
      node: GraphNode;
      dependentCount: number;
      impactScore: number;
    }> = [];
    
    for (const node of this.graph.getAllNodes()) {
      // Skip non-exported and files
      if (node.type === 'file' || !node.metadata.exported) continue;
      
      const dependents = this.graph.getAllDependents(node.id);
      const dependentCount = dependents.size;
      
      if (dependentCount > 0) {
        results.push({
          node,
          dependentCount,
          impactScore: this.calculateNodeCentrality(node)
        });
      }
    }
    
    // Sort by impact score
    results.sort((a, b) => b.impactScore - a.impactScore);
    
    return results.slice(0, limit);
  }
  
  /**
   * Calculate impact score (0-100)
   */
  private calculateImpactScore(
    node: GraphNode,
    directDeps: GraphNode[],
    transitiveDeps: GraphNode[],
    affectedFiles: string[]
  ): number {
    let score = 0;
    
    // Base score from node type
    const typeScores: Record<string, number> = {
      'class': 30,
      'interface': 25,
      'function': 20,
      'component': 25,
      'hook': 20,
      'type': 15,
      'variable': 10,
      'file': 20
    };
    score += typeScores[node.type] || 10;
    
    // Direct dependents (up to 30 points)
    score += Math.min(directDeps.length * 5, 30);
    
    // Transitive dependents (up to 20 points)
    score += Math.min(transitiveDeps.length * 2, 20);
    
    // Affected files (up to 20 points)
    score += Math.min(affectedFiles.length * 3, 20);
    
    return Math.min(score, 100);
  }
  
  /**
   * Determine risk level
   */
  private determineRiskLevel(
    node: GraphNode,
    directCount: number,
    transitiveCount: number,
    impactScore: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical risk indicators
    if (
      impactScore >= 80 ||
      directCount >= 20 ||
      transitiveCount >= 50 ||
      node.type === 'interface' && directCount >= 10
    ) {
      return 'critical';
    }
    
    // High risk
    if (
      impactScore >= 60 ||
      directCount >= 10 ||
      transitiveCount >= 20
    ) {
      return 'high';
    }
    
    // Medium risk
    if (
      impactScore >= 30 ||
      directCount >= 5 ||
      transitiveCount >= 10
    ) {
      return 'medium';
    }
    
    return 'low';
  }
  
  /**
   * Calculate path risk factor
   */
  private calculatePathRisk(edges: GraphEdge[]): number {
    let risk = 0;
    
    const edgeRisks: Record<RelationType, number> = {
      'imports': 1,
      'exports': 1,
      'extends': 3,
      'implements': 2,
      'calls': 2,
      'uses': 1,
      'depends_on': 2,
      'tested_by': 0.5,
      'contains': 0.5,
      're_exports': 1.5,
      // CNP Relations (Hive v3.0)
      'cnp_depends_on': 2,
      'cnp_assigned_to': 1,
      'cnp_produces': 1,
      'cnp_validated_by': 0.5,
      'cnp_derived_from': 1.5,
      'cnp_subtask_of': 2
    };
    
    for (const edge of edges) {
      risk += edgeRisks[edge.type] || 1;
      risk *= edge.weight;
    }
    
    // Path length bonus (longer = more risk)
    risk *= 1 + (edges.length * 0.1);
    
    return Math.round(risk * 10) / 10;
  }
  
  /**
   * Calculate node centrality (importance in graph)
   */
  private calculateNodeCentrality(node: GraphNode): number {
    const deps = this.graph.getAllDependencies(node.id);
    const dependents = this.graph.getAllDependents(node.id);
    
    // Betweenness-like score
    const depsCount = deps.size;
    const dependentsCount = dependents.size;
    
    // Weight by depth
    let depsScore = 0;
    for (const depth of deps.values()) {
      depsScore += 1 / depth;
    }
    
    let dependentsScore = 0;
    for (const depth of dependents.values()) {
      dependentsScore += 1 / depth;
    }
    
    return Math.round((depsScore + dependentsScore * 2) * 10);
  }
}

export default ImpactAnalyzer;

