import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[KnowledgeGraph]');
/**
 * M7 v3.0 - Knowledge Graph
 * 
 * Project dependency graph for code analysis
 */

export * from './types.js';
export { CodeParser } from './code-parser.js';
export { GraphStore } from './graph-store.js';
export { ImpactAnalyzer } from './impact-analyzer.js';
export { CycleDetector } from './cycle-detector.js';
export { MermaidGenerator } from './mermaid-generator.js';

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { getProjectPath } from '../core/utils/projectPath.js';
import { GraphStore } from './graph-store.js';
import { ImpactAnalyzer } from './impact-analyzer.js';
import { CycleDetector } from './cycle-detector.js';
import { MermaidGenerator } from './mermaid-generator.js';
import {
  BuildOptions,
  BuildReport,
  GraphMetrics,
  ImpactAnalysis,
  DependencyCycle,
  DiagramOptions,
  NodeQuery,
  GraphNode,
  OrphanNode
} from './types.js';

// ============================================
// KNOWLEDGE GRAPH CLASS
// ============================================

/**
 * Main Knowledge Graph class - unified API for all graph operations
 */
export class KnowledgeGraph {
  private graphStore: GraphStore;
  private impactAnalyzer: ImpactAnalyzer;
  private cycleDetector: CycleDetector;
  private mermaidGenerator: MermaidGenerator;
  
  private isBuilt: boolean = false;
  private lastBuildReport: BuildReport | null = null;
  
  constructor() {
    this.graphStore = new GraphStore();
    this.impactAnalyzer = new ImpactAnalyzer(this.graphStore);
    this.cycleDetector = new CycleDetector(this.graphStore);
    this.mermaidGenerator = new MermaidGenerator(this.graphStore);
  }
  
  // ============================================
  // BUILD
  // ============================================
  
  /**
   * Build knowledge graph from project
   */
  async build(options: BuildOptions): Promise<BuildReport> {
    log.debug(`KnowledgeGraph] Building graph for: ${options.rootPath}`);
    
    const report = await this.graphStore.build(options);
    
    this.isBuilt = true;
    this.lastBuildReport = report;
    
    log.debug(`KnowledgeGraph] Build complete: ${report.nodesCreated} nodes, ${report.edgesCreated} edges`);
    
    return report;
  }
  
  /**
   * Rebuild the graph
   */
  async rebuild(options: BuildOptions): Promise<BuildReport> {
    this.clear();
    return this.build(options);
  }
  
  /**
   * Get last build report
   */
  getBuildReport(): BuildReport | null {
    return this.lastBuildReport;
  }
  
  // ============================================
  // QUERY
  // ============================================
  
  /**
   * Query nodes
   */
  queryNodes(query: NodeQuery): GraphNode[] {
    return this.graphStore.queryNodes(query);
  }
  
  /**
   * Search nodes by name
   */
  searchByName(name: string): GraphNode[] {
    return this.graphStore.searchByName(name);
  }
  
  /**
   * Get node by ID
   */
  getNode(nodeId: string): GraphNode | undefined {
    return this.graphStore.getNode(nodeId);
  }
  
  /**
   * Get nodes by file
   */
  getNodesByFile(filePath: string): GraphNode[] {
    return this.graphStore.getNodesByFile(filePath);
  }
  
  /**
   * Get dependencies of a node
   */
  getDependencies(nodeId: string): GraphNode[] {
    return this.graphStore.getDependencies(nodeId);
  }
  
  /**
   * Get dependents of a node
   */
  getDependents(nodeId: string): GraphNode[] {
    return this.graphStore.getDependents(nodeId);
  }
  
  /**
   * Find path between two nodes
   */
  findPath(fromId: string, toId: string): GraphNode[] | null {
    return this.graphStore.findPath(fromId, toId);
  }
  
  // ============================================
  // ANALYSIS
  // ============================================
  
  /**
   * Analyze impact of changing a node
   */
  analyzeImpact(nodeId: string): ImpactAnalysis | null {
    return this.impactAnalyzer.analyze(nodeId);
  }
  
  /**
   * Analyze impact of changing a file
   */
  analyzeFileImpact(filePath: string): ImpactAnalysis[] {
    return this.impactAnalyzer.analyzeFile(filePath);
  }
  
  /**
   * Get change propagation paths
   */
  getChangePropagation(nodeId: string, maxDepth?: number) {
    return this.impactAnalyzer.getChangePropagation(nodeId, maxDepth);
  }
  
  /**
   * Get critical paths (most impactful nodes)
   */
  getCriticalPaths(limit?: number) {
    return this.impactAnalyzer.getCriticalPaths(limit);
  }
  
  // ============================================
  // CYCLES
  // ============================================
  
  /**
   * Detect cycles
   */
  detectCycles(options?: {
    maxCycles?: number;
    includeTypeOnly?: boolean;
  }): DependencyCycle[] {
    return this.cycleDetector.detectCycles(options);
  }
  
  /**
   * Detect cycles from a specific node
   */
  detectCyclesFrom(nodeId: string): DependencyCycle[] {
    return this.cycleDetector.detectCyclesFrom(nodeId);
  }
  
  /**
   * Check if adding an edge would create a cycle
   */
  wouldCreateCycle(sourceId: string, targetId: string): boolean {
    return this.cycleDetector.wouldCreateCycle(sourceId, targetId);
  }
  
  /**
   * Get strongly connected components
   */
  getStronglyConnectedComponents(): GraphNode[][] {
    return this.cycleDetector.getStronglyConnectedComponents();
  }
  
  /**
   * Get cycle statistics
   */
  getCycleStats() {
    return this.cycleDetector.getCycleStats();
  }
  
  // ============================================
  // ORPHANS
  // ============================================
  
  /**
   * Find orphan nodes (unused exports)
   */
  findOrphans(): OrphanNode[] {
    const orphans = this.graphStore.findOrphans();
    
    return orphans.map(node => ({
      node,
      reason: 'unused_export' as const,
      confidence: 0.8,
      suggestion: `Consider removing "${node.name}" if it's not used externally, or document its public API usage.`
    }));
  }
  
  // ============================================
  // DIAGRAMS
  // ============================================
  
  /**
   * Generate Mermaid diagram
   */
  generateDiagram(options: DiagramOptions): string {
    return this.mermaidGenerator.generate(options);
  }
  
  /**
   * Generate dependency diagram
   */
  generateDependencyDiagram(rootNode?: string, maxDepth?: number): string {
    return this.mermaidGenerator.generate({
      type: 'dependency',
      format: 'mermaid',
      rootNode,
      maxDepth
    });
  }
  
  /**
   * Generate class diagram
   */
  generateClassDiagram(): string {
    return this.mermaidGenerator.generate({
      type: 'class',
      format: 'mermaid'
    });
  }
  
  /**
   * Generate module diagram
   */
  generateModuleDiagram(): string {
    return this.mermaidGenerator.generate({
      type: 'module',
      format: 'mermaid'
    });
  }
  
  /**
   * Generate impact diagram
   */
  generateImpactDiagram(nodeId: string): string {
    return this.mermaidGenerator.generate({
      type: 'impact',
      format: 'mermaid',
      rootNode: nodeId
    });
  }
  
  /**
   * Generate cycle diagram
   */
  generateCycleDiagram(cycle: DependencyCycle): string {
    return this.mermaidGenerator.generateCycleDiagram(cycle);
  }
  
  // ============================================
  // METRICS
  // ============================================
  
  /**
   * Get graph metrics
   */
  getMetrics(): GraphMetrics {
    return this.graphStore.getMetrics();
  }
  
  /**
   * Get summary report
   */
  getSummary(): {
    isBuilt: boolean;
    metrics: GraphMetrics | null;
    buildReport: BuildReport | null;
    cycleStats: {
      totalCycles: number;
      sccCount: number;
      largestSccSize: number;
      cyclesByType: Record<string, number>;
      mostInvolvedFiles: Array<{ file: string; cycleCount: number }>;
    } | null;
    orphanCount: number;
  } {
    if (!this.isBuilt) {
      return {
        isBuilt: false,
        metrics: null,
        buildReport: null,
        cycleStats: null,
        orphanCount: 0
      };
    }
    
    return {
      isBuilt: true,
      metrics: this.getMetrics(),
      buildReport: this.lastBuildReport,
      cycleStats: this.getCycleStats(),
      orphanCount: this.findOrphans().length
    };
  }
  
  // ============================================
  // PERSISTENCE
  // ============================================
  
  /**
   * Export graph to JSON
   */
  export(): object {
    return this.graphStore.export();
  }
  
  /**
   * Import graph from JSON
   */
  import(data: any): void {
    this.graphStore.import(data);
    this.isBuilt = true;
  }
  
  /**
   * Save graph to file
   */
  saveToFile(filePath: string): void {
    this.graphStore.saveToFile(filePath);
  }
  
  /**
   * Load graph from file
   */
  loadFromFile(filePath: string): void {
    this.graphStore.loadFromFile(filePath);
    this.isBuilt = true;
  }
  
  /**
   * Clear graph
   */
  clear(): void {
    this.graphStore.clear();
    this.isBuilt = false;
    this.lastBuildReport = null;
  }
  
  // ============================================
  // GETTERS
  // ============================================
  
  get nodeCount(): number {
    return this.graphStore.nodeCount;
  }
  
  get edgeCount(): number {
    return this.graphStore.edgeCount;
  }
  
  get built(): boolean {
    return this.isBuilt;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let knowledgeGraphInstance: KnowledgeGraph | null = null;
let kgLazyLoaded = false;

/**
 * Get or create Knowledge Graph instance.
 * v6.0: Lazy loading — cache is loaded from disk on first access, not at startup.
 */
export function getKnowledgeGraph(): KnowledgeGraph {
  if (!knowledgeGraphInstance) {
    knowledgeGraphInstance = new KnowledgeGraph();
  }
  
  // v6.0: Lazy load from cache on first access
  if (!kgLazyLoaded) {
    kgLazyLoaded = true;
    try {
      const projectPath = getProjectPath();
      const cacheFile = join(projectPath, '.m7', 'knowledge-graph.json');
      const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24h
      
      if (existsSync(cacheFile)) {
        const stats = statSync(cacheFile);
        const cacheAge = Date.now() - stats.mtimeMs;
        
        if (cacheAge < MAX_CACHE_AGE_MS) {
          knowledgeGraphInstance.loadFromFile(cacheFile);
          log.info(`Lazy-loaded KG from cache (${knowledgeGraphInstance.nodeCount} nodes)`);
        } else {
          log.info(`KG cache expired (${Math.round(cacheAge / 3600000)}h old), will build on demand`);
        }
      } else {
        log.info('No KG cache found, will build on demand');
      }
    } catch (err: any) {
      log.warn(`KG lazy load failed: ${err.message}`);
    }
  }
  
  return knowledgeGraphInstance;
}

/**
 * Create new Knowledge Graph instance
 */
export function createKnowledgeGraph(): KnowledgeGraph {
  return new KnowledgeGraph();
}

export default KnowledgeGraph;

