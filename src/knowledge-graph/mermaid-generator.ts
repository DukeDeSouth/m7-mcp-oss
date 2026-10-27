/**
 * M7 v3.0 - Mermaid Diagram Generator
 * 
 * Generates Mermaid diagrams from the knowledge graph
 */

import * as path from 'path';
import {
  GraphNode,
  GraphEdge,
  NodeType,
  RelationType,
  DiagramOptions,
  DiagramType,
  DependencyCycle,
  ImpactAnalysis
} from './types.js';
import { GraphStore } from './graph-store.js';

// ============================================
// MERMAID GENERATOR
// ============================================

export class MermaidGenerator {
  constructor(private graph: GraphStore) {}
  
  /**
   * Generate diagram based on options
   */
  generate(options: DiagramOptions): string {
    switch (options.type) {
      case 'dependency':
        return this.generateDependencyDiagram(options);
      case 'class':
        return this.generateClassDiagram(options);
      case 'component':
        return this.generateComponentDiagram(options);
      case 'module':
        return this.generateModuleDiagram(options);
      case 'impact':
        return this.generateImpactDiagram(options);
      default:
        return this.generateDependencyDiagram(options);
    }
  }
  
  /**
   * Generate dependency flowchart
   */
  generateDependencyDiagram(options: DiagramOptions): string {
    const {
      direction = 'TB',
      maxNodes = 50,
      maxDepth = 3,
      rootNode,
      nodeTypes,
      edgeTypes = ['imports', 'depends_on'],
      colorScheme = 'type'
    } = options;
    
    const lines: string[] = [];
    lines.push(`flowchart ${direction}`);
    lines.push('');
    
    // Add styles
    lines.push(...this.getStyles(colorScheme));
    lines.push('');
    
    // Get nodes to include
    let nodes: GraphNode[] = [];
    
    if (rootNode) {
      // Start from root node and traverse
      const rootNodeObj = this.graph.getNode(rootNode);
      if (rootNodeObj) {
        nodes.push(rootNodeObj);
        const deps = this.graph.getAllDependencies(rootNode, maxDepth);
        for (const nodeId of deps.keys()) {
          const node = this.graph.getNode(nodeId);
          if (node) nodes.push(node);
        }
      }
    } else {
      // Get all file nodes
      nodes = this.graph.queryNodes({ type: 'file' });
    }
    
    // Filter by type
    if (nodeTypes && nodeTypes.length > 0) {
      nodes = nodes.filter(n => nodeTypes.includes(n.type));
    }
    
    // Limit nodes
    nodes = nodes.slice(0, maxNodes);
    
    // Generate node definitions
    const nodeIds = new Set(nodes.map(n => n.id));
    for (const node of nodes) {
      lines.push(this.formatNode(node, colorScheme));
    }
    
    lines.push('');
    
    // Generate edges
    const seenEdges = new Set<string>();
    for (const node of nodes) {
      const edges = this.graph.queryEdges({ source: node.id });
      
      for (const edge of edges) {
        if (!edgeTypes.includes(edge.type)) continue;
        if (!nodeIds.has(edge.target)) continue;
        
        const edgeKey = `${edge.source}-${edge.target}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        
        lines.push(this.formatEdge(edge));
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Generate class diagram
   */
  generateClassDiagram(options: DiagramOptions): string {
    const { maxNodes = 30 } = options;
    
    const lines: string[] = [];
    lines.push('classDiagram');
    lines.push('');
    
    // Get classes and interfaces
    const classes = this.graph.queryNodes({ type: 'class' }).slice(0, maxNodes);
    const interfaces = this.graph.queryNodes({ type: 'interface' }).slice(0, maxNodes);
    
    // Generate class definitions
    for (const cls of classes) {
      lines.push(`    class ${this.sanitizeName(cls.name)} {`);
      
      // Add metadata as attributes
      if (cls.metadata.extends) {
        lines.push(`        <<extends ${cls.metadata.extends.join(', ')}>>`);
      }
      if (cls.metadata.implements && cls.metadata.implements.length > 0) {
        lines.push(`        <<implements ${cls.metadata.implements.join(', ')}>>`);
      }
      
      lines.push('    }');
    }
    
    lines.push('');
    
    // Generate interface definitions
    for (const iface of interfaces) {
      lines.push(`    class ${this.sanitizeName(iface.name)} {`);
      lines.push('        <<interface>>');
      lines.push('    }');
    }
    
    lines.push('');
    
    // Generate relationships
    for (const cls of classes) {
      // Extends
      if (cls.metadata.extends) {
        for (const parent of cls.metadata.extends) {
          lines.push(`    ${this.sanitizeName(parent)} <|-- ${this.sanitizeName(cls.name)}`);
        }
      }
      
      // Implements
      if (cls.metadata.implements) {
        for (const iface of cls.metadata.implements) {
          lines.push(`    ${this.sanitizeName(iface)} <|.. ${this.sanitizeName(cls.name)}`);
        }
      }
    }
    
    // Interface extends
    for (const iface of interfaces) {
      if (iface.metadata.extends) {
        for (const parent of iface.metadata.extends) {
          lines.push(`    ${this.sanitizeName(parent)} <|-- ${this.sanitizeName(iface.name)}`);
        }
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Generate component diagram
   */
  generateComponentDiagram(options: DiagramOptions): string {
    const { direction = 'LR', maxNodes = 40 } = options;
    
    const lines: string[] = [];
    lines.push(`flowchart ${direction}`);
    lines.push('');
    
    // Get components and hooks
    const components = this.graph.queryNodes({ type: 'component' }).slice(0, maxNodes / 2);
    const hooks = this.graph.queryNodes({ type: 'hook' }).slice(0, maxNodes / 2);
    
    // Subgraph for components
    lines.push('    subgraph Components');
    for (const comp of components) {
      const sanitizedId = this.sanitizeId(comp.id);
      lines.push(`        ${sanitizedId}[["${comp.name}"]]`);
    }
    lines.push('    end');
    lines.push('');
    
    // Subgraph for hooks
    lines.push('    subgraph Hooks');
    for (const hook of hooks) {
      const sanitizedId = this.sanitizeId(hook.id);
      lines.push(`        ${sanitizedId}(("${hook.name}"))`);
    }
    lines.push('    end');
    lines.push('');
    
    // Add relationships
    const allNodes = [...components, ...hooks];
    const nodeIds = new Set(allNodes.map(n => n.id));
    
    for (const node of allNodes) {
      const edges = this.graph.queryEdges({ source: node.id });
      
      for (const edge of edges) {
        if (!nodeIds.has(edge.target)) continue;
        
        const sourceId = this.sanitizeId(edge.source);
        const targetId = this.sanitizeId(edge.target);
        lines.push(`    ${sourceId} --> ${targetId}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Generate module/directory diagram
   */
  generateModuleDiagram(options: DiagramOptions): string {
    const { direction = 'LR' } = options;
    
    const lines: string[] = [];
    lines.push(`flowchart ${direction}`);
    lines.push('');
    
    // Group files by directory
    const directories = new Map<string, GraphNode[]>();
    
    for (const node of this.graph.queryNodes({ type: 'file' })) {
      const dir = path.dirname(node.filePath).split('/').slice(-2).join('/');
      if (!directories.has(dir)) {
        directories.set(dir, []);
      }
      directories.get(dir)!.push(node);
    }
    
    // Generate subgraphs for directories
    let dirIndex = 0;
    const dirIds = new Map<string, string>();
    
    for (const [dir, files] of directories) {
      const dirId = `dir_${dirIndex++}`;
      dirIds.set(dir, dirId);
      
      const cleanDir = this.sanitizeName(dir);
      lines.push(`    subgraph ${dirId}["${cleanDir}"]`);
      
      for (const file of files.slice(0, 10)) {
        const fileId = this.sanitizeId(file.id);
        const fileName = path.basename(file.filePath);
        lines.push(`        ${fileId}["${fileName}"]`);
      }
      
      if (files.length > 10) {
        lines.push(`        more_${dirIndex}["+${files.length - 10} more"]`);
      }
      
      lines.push('    end');
      lines.push('');
    }
    
    // Add inter-directory edges
    const seenEdges = new Set<string>();
    
    for (const [dir1, files1] of directories) {
      for (const file of files1) {
        const edges = this.graph.queryEdges({ source: file.id, type: 'imports' });
        
        for (const edge of edges) {
          const targetNode = this.graph.getNode(edge.target);
          if (!targetNode) continue;
          
          const targetDir = path.dirname(targetNode.filePath).split('/').slice(-2).join('/');
          if (targetDir === dir1) continue; // Skip same-directory
          
          const edgeKey = `${dir1}-${targetDir}`;
          if (seenEdges.has(edgeKey)) continue;
          seenEdges.add(edgeKey);
          
          const dir1Id = dirIds.get(dir1);
          const dir2Id = dirIds.get(targetDir);
          if (dir1Id && dir2Id) {
            lines.push(`    ${dir1Id} --> ${dir2Id}`);
          }
        }
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Generate impact analysis diagram
   */
  generateImpactDiagram(options: DiagramOptions): string {
    const { rootNode, direction = 'TB', maxNodes = 30 } = options;
    
    if (!rootNode) {
      return 'flowchart TB\n    ERROR["No root node specified"]';
    }
    
    const lines: string[] = [];
    lines.push(`flowchart ${direction}`);
    lines.push('');
    
    // Styles for impact levels
    lines.push('    classDef changed fill:#ff6b6b,stroke:#333,stroke-width:2px');
    lines.push('    classDef direct fill:#feca57,stroke:#333,stroke-width:2px');
    lines.push('    classDef transitive fill:#54a0ff,stroke:#333,stroke-width:1px');
    lines.push('');
    
    const centerNode = this.graph.getNode(rootNode);
    if (!centerNode) {
      return 'flowchart TB\n    ERROR["Node not found"]';
    }
    
    // Center node
    const centerId = this.sanitizeId(centerNode.id);
    lines.push(`    ${centerId}[["${centerNode.name} (CHANGED)"]]:::changed`);
    
    // Get dependents
    const directDeps = this.graph.getDependents(rootNode);
    const allDeps = this.graph.getAllDependents(rootNode, 3);
    
    // Add direct dependents
    const directIds = new Set(directDeps.map(d => d.id));
    for (const dep of directDeps.slice(0, maxNodes / 2)) {
      const depId = this.sanitizeId(dep.id);
      lines.push(`    ${depId}["${dep.name}"]:::direct`);
      lines.push(`    ${centerId} -.-> ${depId}`);
    }
    
    // Add transitive dependents
    let transitiveCount = 0;
    for (const [depId, depth] of allDeps) {
      if (directIds.has(depId)) continue;
      if (transitiveCount++ >= maxNodes / 2) break;
      
      const dep = this.graph.getNode(depId);
      if (!dep) continue;
      
      const sanitizedId = this.sanitizeId(depId);
      lines.push(`    ${sanitizedId}["${dep.name}"]:::transitive`);
      
      // Find path back to direct dependents
      for (const directDep of directDeps) {
        const edges = this.graph.queryEdges({ 
          source: depId, 
          target: directDep.id 
        });
        if (edges.length > 0) {
          lines.push(`    ${sanitizedId} -.-> ${this.sanitizeId(directDep.id)}`);
          break;
        }
      }
    }
    
    lines.push('');
    lines.push('    subgraph Legend');
    lines.push('        L1["Changed"]:::changed');
    lines.push('        L2["Direct Impact"]:::direct');
    lines.push('        L3["Transitive Impact"]:::transitive');
    lines.push('    end');
    
    return lines.join('\n');
  }
  
  /**
   * Generate diagram for a cycle
   */
  generateCycleDiagram(cycle: DependencyCycle): string {
    const lines: string[] = [];
    lines.push('flowchart LR');
    lines.push('');
    
    // Style based on severity
    const severityColors: Record<string, string> = {
      info: '#54a0ff',
      warning: '#feca57',
      error: '#ff6b6b'
    };
    
    lines.push(`    classDef cycle fill:${severityColors[cycle.severity]},stroke:#333,stroke-width:2px`);
    lines.push('');
    
    // Add nodes
    for (const node of cycle.nodes) {
      const sanitizedId = this.sanitizeId(node.id);
      const label = node.name || path.basename(node.filePath);
      lines.push(`    ${sanitizedId}["${label}"]:::cycle`);
    }
    
    // Add edges forming the cycle
    for (let i = 0; i < cycle.nodes.length; i++) {
      const sourceId = this.sanitizeId(cycle.nodes[i].id);
      const targetId = this.sanitizeId(cycle.nodes[(i + 1) % cycle.nodes.length].id);
      const edge = cycle.edges[i];
      const label = edge ? edge.type : '';
      lines.push(`    ${sourceId} -->|${label}| ${targetId}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Get styles for color scheme
   */
  private getStyles(colorScheme: string): string[] {
    const styles: string[] = [];
    
    if (colorScheme === 'type') {
      styles.push('    classDef file fill:#e3f2fd,stroke:#1976d2,stroke-width:1px');
      styles.push('    classDef class fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1px');
      styles.push('    classDef function fill:#e8f5e9,stroke:#388e3c,stroke-width:1px');
      styles.push('    classDef component fill:#fff3e0,stroke:#f57c00,stroke-width:1px');
      styles.push('    classDef hook fill:#fce4ec,stroke:#c2185b,stroke-width:1px');
      styles.push('    classDef interface fill:#e1f5fe,stroke:#0288d1,stroke-width:1px');
      styles.push('    classDef type fill:#f1f8e9,stroke:#689f38,stroke-width:1px');
    } else if (colorScheme === 'health') {
      styles.push('    classDef healthy fill:#c8e6c9,stroke:#388e3c,stroke-width:1px');
      styles.push('    classDef warning fill:#fff9c4,stroke:#fbc02d,stroke-width:1px');
      styles.push('    classDef critical fill:#ffcdd2,stroke:#d32f2f,stroke-width:1px');
    }
    
    return styles;
  }
  
  /**
   * Format a node for Mermaid
   */
  private formatNode(node: GraphNode, colorScheme: string): string {
    const sanitizedId = this.sanitizeId(node.id);
    const label = node.name || path.basename(node.filePath);
    
    // Choose shape based on type
    let shape = `["${label}"]`;
    switch (node.type) {
      case 'class':
        shape = `[["${label}"]]`;
        break;
      case 'function':
      case 'hook':
        shape = `(["${label}"])`;
        break;
      case 'interface':
      case 'type':
        shape = `{{"${label}"}}`;
        break;
      case 'component':
        shape = `>"${label}"]`;
        break;
    }
    
    // Add class for styling
    const cssClass = colorScheme === 'type' ? `:::${node.type}` : '';
    
    return `    ${sanitizedId}${shape}${cssClass}`;
  }
  
  /**
   * Format an edge for Mermaid
   */
  private formatEdge(edge: GraphEdge): string {
    const sourceId = this.sanitizeId(edge.source);
    const targetId = this.sanitizeId(edge.target);
    
    // Choose arrow style based on type
    let arrow = '-->';
    switch (edge.type) {
      case 'extends':
        arrow = '--|>';
        break;
      case 'implements':
        arrow = '..|>';
        break;
      case 'uses':
      case 'calls':
        arrow = '-.->';
        break;
      case 're_exports':
        arrow = '==>';
        break;
    }
    
    // Add label for certain edge types
    let label = '';
    if (edge.metadata?.namedImports?.length) {
      const imports = edge.metadata.namedImports.slice(0, 3).join(', ');
      if (edge.metadata.namedImports.length > 3) {
        label = `|${imports}...|`;
      } else {
        label = `|${imports}|`;
      }
    }
    
    return `    ${sourceId} ${arrow}${label} ${targetId}`;
  }
  
  /**
   * Sanitize node ID for Mermaid
   */
  private sanitizeId(id: string): string {
    return id
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50); // Mermaid has ID length limits
  }
  
  /**
   * Sanitize name for display
   */
  private sanitizeName(name: string): string {
    return name
      .replace(/"/g, "'")
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

export default MermaidGenerator;

