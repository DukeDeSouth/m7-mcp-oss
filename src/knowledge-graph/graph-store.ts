import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[GraphStore]');
/**
 * M7 v3.10 - Graph Store
 * 
 * In-memory graph storage with adjacency lists and indexes
 * v3.10.0: Added atomic writes for crash safety
 */

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJSON, safeReadJSON } from '../core/utils/atomicWrite.js';
import {
  GraphNode,
  GraphEdge,
  NodeType,
  RelationType,
  NodeQuery,
  EdgeQuery,
  GraphMetrics,
  BuildOptions,
  BuildReport,
  DEFAULT_KNOWLEDGE_GRAPH_CONFIG
} from './types.js';
import { CodeParser, ParsedFile } from './code-parser.js';

// ============================================
// GRAPH STORE CLASS
// ============================================

export class GraphStore {
  /** All nodes indexed by ID */
  private nodes: Map<string, GraphNode> = new Map();
  
  /** All edges indexed by ID */
  private edges: Map<string, GraphEdge> = new Map();
  
  /** Adjacency list: nodeId -> outgoing edge IDs */
  private outgoing: Map<string, Set<string>> = new Map();
  
  /** Reverse adjacency: nodeId -> incoming edge IDs */
  private incoming: Map<string, Set<string>> = new Map();
  
  /** Index by node type */
  private nodesByType: Map<NodeType, Set<string>> = new Map();
  
  /** Index by edge type */
  private edgesByType: Map<RelationType, Set<string>> = new Map();
  
  /** Index by file path */
  private nodesByFile: Map<string, Set<string>> = new Map();
  
  /** Index by name (for fuzzy search) */
  private nodesByName: Map<string, Set<string>> = new Map();
  
  /** Parser instance */
  private parser: CodeParser;
  
  /** Root path of the project */
  private rootPath: string = '';
  
  // v9.1: TTL auto-clear — free memory after 10 min of inactivity
  private lastAccessTime: number = 0;
  private ttlTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly TTL_MS = 10 * 60 * 1000; // 10 minutes
  
  constructor() {
    this.parser = new CodeParser();
  }
  
  /** v9.1: Touch — reset TTL timer on any access */
  private touch(): void {
    this.lastAccessTime = Date.now();
    if (this.ttlTimer) clearTimeout(this.ttlTimer);
    this.ttlTimer = setTimeout(() => {
      if (this.nodes.size > 0) {
        this.clear();
      }
      this.ttlTimer = null;
    }, GraphStore.TTL_MS);
    if (this.ttlTimer && typeof this.ttlTimer === 'object' && 'unref' in this.ttlTimer) {
      (this.ttlTimer as NodeJS.Timeout).unref();
    }
  }
  
  // ============================================
  // NODE OPERATIONS
  // ============================================
  
  /**
   * Add a node to the graph
   */
  addNode(node: GraphNode): void {
    // Store node
    this.nodes.set(node.id, node);
    
    // Index by type
    if (!this.nodesByType.has(node.type)) {
      this.nodesByType.set(node.type, new Set());
    }
    this.nodesByType.get(node.type)!.add(node.id);
    
    // Index by file
    if (!this.nodesByFile.has(node.filePath)) {
      this.nodesByFile.set(node.filePath, new Set());
    }
    this.nodesByFile.get(node.filePath)!.add(node.id);
    
    // Index by name
    const nameLower = node.name.toLowerCase();
    if (!this.nodesByName.has(nameLower)) {
      this.nodesByName.set(nameLower, new Set());
    }
    this.nodesByName.get(nameLower)!.add(node.id);
    
    // Initialize adjacency lists
    if (!this.outgoing.has(node.id)) {
      this.outgoing.set(node.id, new Set());
    }
    if (!this.incoming.has(node.id)) {
      this.incoming.set(node.id, new Set());
    }
  }
  
  /**
   * Get a node by ID
   */
  getNode(id: string): GraphNode | undefined {
    // v9.1: NO touch() here — getNode is called in hot loops (Tarjan, impact analysis)
    // TTL is reset by entry-point methods (build, getMetrics) instead
    return this.nodes.get(id);
  }
  
  /**
   * Query nodes with filters
   */
  queryNodes(query: NodeQuery): GraphNode[] {
    let candidates: string[] = [];
    
    // Start with type filter if provided
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      for (const type of types) {
        const typeNodes = this.nodesByType.get(type);
        if (typeNodes) {
          candidates.push(...typeNodes);
        }
      }
    } else {
      candidates = Array.from(this.nodes.keys());
    }
    
    // Apply filters
    let results = candidates.map(id => this.nodes.get(id)!);
    
    if (query.name) {
      const namePattern = typeof query.name === 'string' 
        ? new RegExp(query.name, 'i')
        : query.name;
      results = results.filter(n => namePattern.test(n.name));
    }
    
    if (query.path) {
      results = results.filter(n => n.filePath.includes(query.path!));
    }
    
    if (query.tags) {
      results = results.filter(n => 
        query.tags!.some(tag => n.metadata.tags?.includes(tag))
      );
    }
    
    if (query.exported !== undefined) {
      results = results.filter(n => n.metadata.exported === query.exported);
    }
    
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    
    return results;
  }
  
  /**
   * Search nodes by name (fuzzy)
   */
  searchByName(name: string): GraphNode[] {
    const nameLower = name.toLowerCase();
    const results: GraphNode[] = [];
    
    for (const [key, ids] of this.nodesByName) {
      if (key.includes(nameLower)) {
        for (const id of ids) {
          const node = this.nodes.get(id);
          if (node) results.push(node);
        }
      }
    }
    
    return results;
  }
  
  // ============================================
  // EDGE OPERATIONS
  // ============================================
  
  /**
   * Add an edge to the graph
   */
  addEdge(edge: GraphEdge): void {
    // Store edge
    this.edges.set(edge.id, edge);
    
    // Index by type
    if (!this.edgesByType.has(edge.type)) {
      this.edgesByType.set(edge.type, new Set());
    }
    this.edgesByType.get(edge.type)!.add(edge.id);
    
    // Update adjacency lists
    if (!this.outgoing.has(edge.source)) {
      this.outgoing.set(edge.source, new Set());
    }
    this.outgoing.get(edge.source)!.add(edge.id);
    
    if (!this.incoming.has(edge.target)) {
      this.incoming.set(edge.target, new Set());
    }
    this.incoming.get(edge.target)!.add(edge.id);
  }
  
  /**
   * Get an edge by ID
   */
  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }
  
  /**
   * Query edges with filters
   */
  queryEdges(query: EdgeQuery): GraphEdge[] {
    let candidates: string[] = [];
    
    // Start with source filter
    if (query.source) {
      const sourceEdges = this.outgoing.get(query.source);
      if (sourceEdges) {
        candidates.push(...sourceEdges);
      }
    }
    // Or target filter
    else if (query.target) {
      const targetEdges = this.incoming.get(query.target);
      if (targetEdges) {
        candidates.push(...targetEdges);
      }
    }
    // Or type filter
    else if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      for (const type of types) {
        const typeEdges = this.edgesByType.get(type);
        if (typeEdges) {
          candidates.push(...typeEdges);
        }
      }
    }
    // Or all edges
    else {
      candidates = Array.from(this.edges.keys());
    }
    
    // Apply filters
    let results = candidates.map(id => this.edges.get(id)!).filter(Boolean);
    
    if (query.source && candidates.length > 0) {
      results = results.filter(e => e.source === query.source);
    }
    
    if (query.target) {
      results = results.filter(e => e.target === query.target);
    }
    
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      results = results.filter(e => types.includes(e.type));
    }
    
    return results;
  }
  
  // ============================================
  // GRAPH TRAVERSAL
  // ============================================
  
  /**
   * Get direct dependencies of a node
   */
  getDependencies(nodeId: string): GraphNode[] {
    this.touch(); // v9.1: reset TTL on entry-point access
    const edgeIds = this.outgoing.get(nodeId) || new Set();
    const dependencies: GraphNode[] = [];
    
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        const targetNode = this.nodes.get(edge.target);
        if (targetNode) {
          dependencies.push(targetNode);
        }
      }
    }
    
    return dependencies;
  }
  
  /**
   * Get direct dependents (what depends on this node)
   */
  getDependents(nodeId: string): GraphNode[] {
    this.touch(); // v9.1: reset TTL on entry-point access
    const edgeIds = this.incoming.get(nodeId) || new Set();
    const dependents: GraphNode[] = [];
    
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        const sourceNode = this.nodes.get(edge.source);
        if (sourceNode) {
          dependents.push(sourceNode);
        }
      }
    }
    
    return dependents;
  }
  
  /**
   * Get all transitive dependencies (BFS)
   */
  getAllDependencies(nodeId: string, maxDepth: number = 10): Map<string, number> {
    const visited = new Map<string, number>(); // nodeId -> depth
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      
      if (visited.has(id) || depth > maxDepth) continue;
      visited.set(id, depth);
      
      const edgeIds = this.outgoing.get(id) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (edge && !visited.has(edge.target)) {
          queue.push({ id: edge.target, depth: depth + 1 });
        }
      }
    }
    
    visited.delete(nodeId); // Remove self
    return visited;
  }
  
  /**
   * Get all transitive dependents (what transitively depends on this node)
   */
  getAllDependents(nodeId: string, maxDepth: number = 10): Map<string, number> {
    const visited = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      
      if (visited.has(id) || depth > maxDepth) continue;
      visited.set(id, depth);
      
      const edgeIds = this.incoming.get(id) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (edge && !visited.has(edge.source)) {
          queue.push({ id: edge.source, depth: depth + 1 });
        }
      }
    }
    
    visited.delete(nodeId);
    return visited;
  }
  
  /**
   * Find shortest path between two nodes
   */
  findPath(fromId: string, toId: string): GraphNode[] | null {
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
    
    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      
      if (id === toId) {
        return path.map(nodeId => this.nodes.get(nodeId)!).filter(Boolean);
      }
      
      if (visited.has(id)) continue;
      visited.add(id);
      
      const edgeIds = this.outgoing.get(id) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (edge && !visited.has(edge.target)) {
          queue.push({ id: edge.target, path: [...path, edge.target] });
        }
      }
    }
    
    return null;
  }
  
  // ============================================
  // BUILD & INDEXING
  // ============================================
  
  /**
   * Build graph from project directory
   */
  async build(options: BuildOptions): Promise<BuildReport> {
    this.touch(); // v9.1: reset TTL
    // Clear existing graph to prevent node duplication on rebuild
    this.clear();
    
    const startTime = Date.now();
    this.rootPath = options.rootPath;
    
    const report: BuildReport = {
      filesProcessed: 0,
      filesSkipped: 0,
      nodesCreated: 0,
      edgesCreated: 0,
      errors: [],
      duration: 0
    };
    
    // Get file patterns
    const include = options.include || DEFAULT_KNOWLEDGE_GRAPH_CONFIG.defaultBuildOptions.include!;
    const exclude = options.exclude || DEFAULT_KNOWLEDGE_GRAPH_CONFIG.defaultBuildOptions.exclude!;
    
    // Find all matching files
    const files = await this.findFiles(options.rootPath, include, exclude);
    
    // Process each file
    for (const filePath of files) {
      if (options.maxFiles && report.filesProcessed >= options.maxFiles) break;
      
      try {
        const parsed = this.parser.parseFile(filePath);
        
        if (parsed.errors.length > 0) {
          for (const error of parsed.errors) {
            report.errors.push({ file: filePath, error });
          }
        }
        
        const { nodes, edges } = this.parser.toGraphElements(parsed);
        
        for (const node of nodes) {
          this.addNode(node);
          report.nodesCreated++;
        }
        
        for (const edge of edges) {
          this.addEdge(edge);
          report.edgesCreated++;
        }
        
        report.filesProcessed++;
      } catch (error: any) {
        report.filesSkipped++;
        report.errors.push({ file: filePath, error: error.message });
      }
    }
    
    // Resolve cross-file references
    this.resolveReferences();
    
    report.duration = Date.now() - startTime;
    return report;
  }
  
  /**
   * Find files matching patterns
   */
  private async findFiles(
    rootPath: string,
    include: string[],
    exclude: string[]
  ): Promise<string[]> {
    const files: string[] = [];
    
    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error: any) {
        // Skip directories we can't access (EPERM, EACCES, etc.)
        return;
      }
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootPath, fullPath);
        
        // Check exclude patterns
        if (exclude.some(pattern => this.matchPattern(relativePath, pattern))) {
          continue;
        }
        
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          // Check include patterns
          if (include.some(pattern => this.matchPattern(relativePath, pattern))) {
            files.push(fullPath);
          }
        }
      }
    };
    
    walkDir(rootPath);
    return files;
  }
  
  /**
   * Simple pattern matching (glob-like)
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Normalize paths
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Simple extension matching for patterns like **/*.ts
    if (pattern.startsWith('**/')) {
      const suffix = pattern.slice(3); // Remove **/
      
      // If suffix contains *, it's like *.ts
      if (suffix.startsWith('*')) {
        const ext = suffix.slice(1); // Get .ts
        return normalizedPath.endsWith(ext);
      }
      
      // Directory or file pattern like **/node_modules/**
      if (suffix.endsWith('/**')) {
        const dir = suffix.slice(0, -3); // Remove /**
        return normalizedPath.includes('/' + dir + '/') || normalizedPath.includes(dir + '/');
      }
      
      // Exact file/dir match anywhere
      return normalizedPath.includes(suffix) || normalizedPath.endsWith(suffix);
    }
    
    // Exact match or simple wildcard
    const regex = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\./g, '\\.')
      .replace(/\?/g, '.');
    
    return new RegExp(regex).test(normalizedPath);
  }
  
  /**
   * Resolve cross-file references
   */
  private resolveReferences(): void {
    // Find edges with wildcard targets and resolve them
    for (const edge of this.edges.values()) {
      if (edge.target.includes(':*:')) {
        const [type, , name] = edge.target.split(':');
        
        // Find actual node
        for (const node of this.nodes.values()) {
          if (node.name === name && node.type === type) {
            // Update edge target
            edge.target = node.id;
            
            // Update incoming index
            if (!this.incoming.has(node.id)) {
              this.incoming.set(node.id, new Set());
            }
            this.incoming.get(node.id)!.add(edge.id);
            break;
          }
        }
      }
    }
  }
  
  // ============================================
  // METRICS
  // ============================================
  
  /**
   * Get graph metrics
   */
  getMetrics(): GraphMetrics {
    this.touch(); // v9.1: reset TTL
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};
    
    for (const [type, ids] of this.nodesByType) {
      nodesByType[type] = ids.size;
    }
    
    for (const [type, ids] of this.edgesByType) {
      edgesByType[type] = ids.size;
    }
    
    // Calculate degrees
    const degrees: number[] = [];
    for (const nodeId of this.nodes.keys()) {
      const outDegree = this.outgoing.get(nodeId)?.size || 0;
      const inDegree = this.incoming.get(nodeId)?.size || 0;
      degrees.push(outDegree + inDegree);
    }
    
    const avgDegree = degrees.length > 0 
      ? degrees.reduce((a, b) => a + b, 0) / degrees.length 
      : 0;
    const maxDegree = Math.max(...degrees, 0);
    
    // Count components (connected subgraphs)
    const components = this.countComponents();
    
    // Count cycles (approximate)
    const cycles = this.countCycles();
    
    // Count orphans
    const orphans = this.findOrphans().length;
    
    // Calculate coupling (ratio of external to internal edges)
    const coupling = this.calculateCoupling();
    
    // Calculate cohesion
    const cohesion = this.calculateCohesion();
    
    // Health grade
    const healthGrade = this.calculateHealthGrade(coupling, cohesion, cycles, orphans);
    
    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      nodesByType: nodesByType as Record<NodeType, number>,
      edgesByType: edgesByType as Record<RelationType, number>,
      avgDegree,
      maxDegree,
      components,
      cycles,
      orphans,
      couplingScore: coupling,
      cohesionScore: cohesion,
      healthGrade
    };
  }
  
  /**
   * Count connected components
   */
  private countComponents(): number {
    const visited = new Set<string>();
    let components = 0;
    
    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        components++;
        // BFS to mark all connected nodes
        const queue = [nodeId];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          
          // Add all connected nodes (both directions)
          for (const edgeId of this.outgoing.get(id) || []) {
            const edge = this.edges.get(edgeId);
            if (edge) queue.push(edge.target);
          }
          for (const edgeId of this.incoming.get(id) || []) {
            const edge = this.edges.get(edgeId);
            if (edge) queue.push(edge.source);
          }
        }
      }
    }
    
    return components;
  }
  
  /**
   * Count cycles (iterative DFS to avoid stack overflow)
   * Uses explicit stack instead of recursion for safety
   */
  private countCycles(maxIterations: number = 100000): number {
    let cycleCount = 0;
    let iterations = 0;
    const visited = new Set<string>();
    const fullyProcessed = new Set<string>();
    
    // Iterative DFS with explicit stack
    for (const startNode of this.nodes.keys()) {
      if (visited.has(startNode)) continue;
      if (iterations >= maxIterations) {
        log.debug(`GraphStore] Cycle detection stopped: exceeded ${maxIterations} iterations`);
        break;
      }
      
      // Stack holds: nodeId and current edge index
      const stack: Array<{ nodeId: string; edgeIndex: number }> = [];
      const currentPath = new Set<string>();
      
      stack.push({ nodeId: startNode, edgeIndex: 0 });
      currentPath.add(startNode);
      visited.add(startNode);
      
      while (stack.length > 0 && iterations < maxIterations) {
        iterations++;
        const frame = stack[stack.length - 1];
        const edges = Array.from(this.outgoing.get(frame.nodeId) || []);
        
        if (frame.edgeIndex >= edges.length) {
          // All edges processed, backtrack
          fullyProcessed.add(frame.nodeId);
          currentPath.delete(frame.nodeId);
          stack.pop();
          continue;
        }
        
        const edgeId = edges[frame.edgeIndex];
        frame.edgeIndex++;
        
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        
        const target = edge.target;
        
        if (currentPath.has(target)) {
          // Cycle detected!
          cycleCount++;
        } else if (!fullyProcessed.has(target)) {
          // Visit new node
          if (!visited.has(target)) {
            visited.add(target);
          }
          currentPath.add(target);
          stack.push({ nodeId: target, edgeIndex: 0 });
        }
      }
    }
    
    return cycleCount;
  }
  
  /**
   * Find orphan nodes (no incoming edges except from file)
   */
  findOrphans(): GraphNode[] {
    const orphans: GraphNode[] = [];
    
    for (const node of this.nodes.values()) {
      if (node.type === 'file') continue; // Files can't be orphans
      
      // Check if exported and unused
      if (node.metadata.exported) {
        const incomingEdges = this.incoming.get(node.id) || new Set();
        
        // Only 'contains' edges from file = potentially orphan
        let realUsages = 0;
        for (const edgeId of incomingEdges) {
          const edge = this.edges.get(edgeId);
          if (edge && edge.type !== 'contains') {
            realUsages++;
          }
        }
        
        if (realUsages === 0) {
          orphans.push(node);
        }
      }
    }
    
    return orphans;
  }
  
  /**
   * Calculate coupling score
   */
  private calculateCoupling(): number {
    if (this.edges.size === 0) return 0;
    
    let externalEdges = 0;
    let totalEdges = 0;
    
    for (const edge of this.edges.values()) {
      if (edge.type === 'imports') {
        totalEdges++;
        // External if importing from different directory
        const sourceNode = this.nodes.get(edge.source);
        const targetNode = this.nodes.get(edge.target);
        
        if (sourceNode && targetNode) {
          const sourceDir = path.dirname(sourceNode.filePath);
          const targetDir = path.dirname(targetNode.filePath);
          
          if (sourceDir !== targetDir) {
            externalEdges++;
          }
        }
      }
    }
    
    return totalEdges > 0 ? externalEdges / totalEdges : 0;
  }
  
  /**
   * Calculate cohesion score
   */
  private calculateCohesion(): number {
    // Higher cohesion = more internal connections within modules
    const moduleConnections = new Map<string, { internal: number; external: number }>();
    
    for (const node of this.nodes.values()) {
      if (node.type === 'file') {
        const dir = path.dirname(node.filePath);
        if (!moduleConnections.has(dir)) {
          moduleConnections.set(dir, { internal: 0, external: 0 });
        }
      }
    }
    
    for (const edge of this.edges.values()) {
      if (edge.type !== 'imports') continue;
      
      const sourceNode = this.nodes.get(edge.source);
      const targetNode = this.nodes.get(edge.target);
      
      if (sourceNode && targetNode) {
        const sourceDir = path.dirname(sourceNode.filePath);
        const targetDir = path.dirname(targetNode.filePath);
        const stats = moduleConnections.get(sourceDir);
        
        if (stats) {
          if (sourceDir === targetDir) {
            stats.internal++;
          } else {
            stats.external++;
          }
        }
      }
    }
    
    let totalCohesion = 0;
    let moduleCount = 0;
    
    for (const stats of moduleConnections.values()) {
      const total = stats.internal + stats.external;
      if (total > 0) {
        totalCohesion += stats.internal / total;
        moduleCount++;
      }
    }
    
    return moduleCount > 0 ? totalCohesion / moduleCount : 0;
  }
  
  /**
   * Calculate health grade
   */
  private calculateHealthGrade(
    coupling: number,
    cohesion: number,
    cycles: number,
    orphans: number
  ): 'A' | 'B' | 'C' | 'D' | 'F' {
    let score = 100;
    
    // Coupling penalty (max 30 points)
    score -= coupling * 30;
    
    // Low cohesion penalty (max 30 points)
    score -= (1 - cohesion) * 30;
    
    // Cycles penalty (5 points each, max 20)
    score -= Math.min(cycles * 5, 20);
    
    // Orphans penalty (2 points each, max 20)
    const orphanRatio = this.nodes.size > 0 ? orphans / this.nodes.size : 0;
    score -= orphanRatio * 20;
    
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
  
  // ============================================
  // PERSISTENCE
  // ============================================
  
  /**
   * Export graph to JSON
   */
  export(): object {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      rootPath: this.rootPath,
      exportedAt: new Date().toISOString()
    };
  }
  
  /**
   * Import graph from JSON
   */
  import(data: { nodes: GraphNode[]; edges: GraphEdge[]; rootPath?: string }): void {
    this.clear();
    
    if (data.rootPath) {
      this.rootPath = data.rootPath;
    }
    
    for (const node of data.nodes) {
      this.addNode(node);
    }
    
    for (const edge of data.edges) {
      this.addEdge(edge);
    }
  }
  
  /**
   * Save graph to file (v3.10: atomic write with backup)
   */
  async saveToFile(filePath: string): Promise<void> {
    const data = this.export();
    const result = await atomicWriteJSON(filePath, data, {
      maxBackups: 3,
      createBackup: true,
    });
    
    if (!result.success) {
      throw new Error(`Failed to save graph: ${result.error}`);
    }
    
    if (result.backupCreated) {
      log.debug(`Graph backup created: ${result.backupPath}`);
    }
  }
  
  /**
   * Save graph to file (sync version for backward compatibility)
   */
  saveToFileSync(filePath: string): void {
    const data = this.export();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
  
  /**
   * Load graph from file (v3.10: with backup recovery)
   */
  async loadFromFile(filePath: string): Promise<void> {
    const result = await safeReadJSON<{ nodes: GraphNode[]; edges: GraphEdge[]; rootPath?: string }>(filePath);
    
    if (result.recoveredFrom) {
      log.warn(`Graph recovered from backup: ${result.recoveredFrom}`);
    }
    
    if (result.data) {
      this.import(result.data);
    }
  }
  
  /**
   * Load graph from file (sync version for backward compatibility)
   */
  loadFromFileSync(filePath: string): void {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this.import(data);
    }
  }
  
  /**
   * Clear all data
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outgoing.clear();
    this.incoming.clear();
    this.nodesByType.clear();
    this.edgesByType.clear();
    this.nodesByFile.clear();
    this.nodesByName.clear();
  }
  
  // ============================================
  // GETTERS
  // ============================================
  
  get nodeCount(): number {
    return this.nodes.size;
  }
  
  get edgeCount(): number {
    return this.edges.size;
  }
  
  getAllNodes(): GraphNode[] {
    this.touch(); // v9.1: reset TTL on entry-point access
    return Array.from(this.nodes.values());
  }
  
  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }
  
  getNodesByFile(filePath: string): GraphNode[] {
    const nodeIds = this.nodesByFile.get(filePath) || new Set();
    return Array.from(nodeIds).map(id => this.nodes.get(id)!).filter(Boolean);
  }
}

export default GraphStore;

