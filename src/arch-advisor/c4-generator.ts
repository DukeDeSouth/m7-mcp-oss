/**
 * M7 v3.0 - C4 Diagram Generator
 * 
 * Generates C4 model diagrams from Knowledge Graph data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeGraph } from '../knowledge-graph/index.js';
import {
  C4Diagram,
  C4Level,
  C4Element,
  C4Relationship,
  C4Options,
  C4ElementType
} from './types.js';

/**
 * C4 Diagram Generator
 * 
 * Generates diagrams at 4 levels:
 * - Context: System and external dependencies
 * - Container: Top-level modules/directories
 * - Component: Modules within containers
 * - Code: Classes and interfaces
 */
export class C4Generator {
  private graph: KnowledgeGraph;
  private projectPath: string;
  private projectName: string;
  
  constructor(graph: KnowledgeGraph, projectPath: string) {
    this.graph = graph;
    this.projectPath = projectPath;
    this.projectName = path.basename(projectPath);
  }
  
  // ============================================
  // PUBLIC API
  // ============================================
  
  /**
   * Generate C4 diagram at specified level
   */
  generate(level: C4Level, options?: C4Options): C4Diagram {
    const opts = this.applyDefaults(options);
    
    switch (level) {
      case 'context':
        return this.generateContextDiagram(opts);
      case 'container':
        return this.generateContainerDiagram(opts);
      case 'component':
        return this.generateComponentDiagram(opts);
      case 'code':
        return this.generateCodeDiagram(opts);
    }
  }
  
  /**
   * Generate all C4 diagrams
   */
  generateAll(options?: C4Options): C4Diagram[] {
    return [
      this.generate('context', options),
      this.generate('container', options),
      this.generate('component', options),
      this.generate('code', options)
    ];
  }
  
  // ============================================
  // LEVEL 1: CONTEXT
  // ============================================
  
  private generateContextDiagram(options: Required<C4Options>): C4Diagram {
    const elements: C4Element[] = [];
    const relationships: C4Relationship[] = [];
    
    // Add the main system
    elements.push({
      id: 'main_system',
      type: 'system',
      name: this.projectName,
      description: 'The system being analyzed'
    });
    
    // Add user/developer
    elements.push({
      id: 'user',
      type: 'person',
      name: 'Developer',
      description: 'Uses the system'
    });
    
    relationships.push({
      sourceId: 'user',
      targetId: 'main_system',
      description: 'Uses'
    });
    
    // Detect external systems from package.json
    const externalSystems = this.detectExternalSystems();
    for (const ext of externalSystems) {
      elements.push({
        id: ext.id,
        type: 'external',
        name: ext.name,
        description: ext.description
      });
      relationships.push({
        sourceId: 'main_system',
        targetId: ext.id,
        description: 'Uses',
        technology: ext.technology
      });
    }
    
    return {
      level: 'context',
      title: `System Context - ${this.projectName}`,
      elements: this.limitElements(elements, options.maxElements),
      relationships: this.limitRelationships(relationships, options.maxRelationships),
      mermaid: this.toMermaidC4Context(elements, relationships)
    };
  }
  
  // ============================================
  // LEVEL 2: CONTAINER
  // ============================================
  
  private generateContainerDiagram(options: Required<C4Options>): C4Diagram {
    const elements: C4Element[] = [];
    const relationships: C4Relationship[] = [];
    
    // Get top-level directories from graph
    const topLevelDirs = this.getTopLevelDirectories();
    
    for (const dir of topLevelDirs) {
      elements.push({
        id: `container_${this.sanitizeId(dir)}`,
        type: 'container',
        name: dir,
        description: `${dir} module`,
        technology: 'TypeScript'
      });
    }
    
    // Add relationships between containers
    const containerRels = this.getContainerRelationships(topLevelDirs);
    for (const rel of containerRels) {
      relationships.push(rel);
    }
    
    return {
      level: 'container',
      title: `Container Diagram - ${this.projectName}`,
      elements: this.limitElements(elements, options.maxElements),
      relationships: this.limitRelationships(relationships, options.maxRelationships),
      mermaid: this.toMermaidFlowchart(elements, relationships, 'TB')
    };
  }
  
  // ============================================
  // LEVEL 3: COMPONENT
  // ============================================
  
  private generateComponentDiagram(options: Required<C4Options>): C4Diagram {
    const elements: C4Element[] = [];
    const relationships: C4Relationship[] = [];
    const addedRels = new Set<string>();
    
    // Get all modules from graph
    let modules = this.graph.queryNodes({ type: 'module' });
    
    // Filter by path if specified
    if (options.pathFilter) {
      modules = modules.filter(m => m.filePath.startsWith(options.pathFilter!));
    }
    
    // Group by directory if enabled
    if (options.groupByDirectory) {
      modules = this.groupModulesByDirectory(modules);
    }
    
    // Create elements
    for (const mod of modules) {
      elements.push({
        id: `component_${this.sanitizeId(mod.id)}`,
        type: 'component',
        name: mod.name,
        description: this.shortenPath(mod.filePath),
        technology: 'TypeScript'
      });
    }
    
    // Add relationships
    for (const mod of modules) {
      const deps = this.graph.getDependencies(mod.id);
      for (const dep of deps) {
        // Only add if target is also in our modules list
        if (modules.some(m => m.id === dep.id)) {
          const relKey = `${mod.id}|${dep.id}`;
          if (!addedRels.has(relKey)) {
            addedRels.add(relKey);
            relationships.push({
              sourceId: `component_${this.sanitizeId(mod.id)}`,
              targetId: `component_${this.sanitizeId(dep.id)}`,
              description: 'Imports'
            });
          }
        }
      }
    }
    
    return {
      level: 'component',
      title: `Component Diagram - ${this.projectName}`,
      elements: this.limitElements(elements, options.maxElements),
      relationships: this.limitRelationships(relationships, options.maxRelationships),
      mermaid: this.toMermaidFlowchart(elements, relationships, 'LR')
    };
  }
  
  // ============================================
  // LEVEL 4: CODE
  // ============================================
  
  private generateCodeDiagram(options: Required<C4Options>): C4Diagram {
    const elements: C4Element[] = [];
    const relationships: C4Relationship[] = [];
    const addedRels = new Set<string>();
    
    // Get classes and interfaces
    let classes = this.graph.queryNodes({ type: 'class' });
    let interfaces = this.graph.queryNodes({ type: 'interface' });
    
    // Filter by path if specified
    if (options.pathFilter) {
      classes = classes.filter(c => c.filePath.startsWith(options.pathFilter!));
      interfaces = interfaces.filter(i => i.filePath.startsWith(options.pathFilter!));
    }
    
    // Add classes
    for (const cls of classes) {
      elements.push({
        id: `class_${this.sanitizeId(cls.id)}`,
        type: 'component',
        name: cls.name,
        description: `Class in ${this.shortenPath(cls.filePath)}`
      });
    }
    
    // Add interfaces
    for (const iface of interfaces) {
      elements.push({
        id: `interface_${this.sanitizeId(iface.id)}`,
        type: 'component',
        name: `«interface» ${iface.name}`,
        description: `Interface in ${this.shortenPath(iface.filePath)}`
      });
    }
    
    // Add relationships
    for (const cls of classes) {
      const deps = this.graph.getDependencies(cls.id);
      for (const dep of deps) {
        const targetId = dep.type === 'interface' 
          ? `interface_${this.sanitizeId(dep.id)}`
          : `class_${this.sanitizeId(dep.id)}`;
        
        // Check if target exists
        if (elements.some(e => e.id === targetId)) {
          const relKey = `${cls.id}|${dep.id}`;
          if (!addedRels.has(relKey)) {
            addedRels.add(relKey);
            relationships.push({
              sourceId: `class_${this.sanitizeId(cls.id)}`,
              targetId,
              description: dep.type === 'interface' ? 'Implements' : 'Uses'
            });
          }
        }
      }
    }
    
    return {
      level: 'code',
      title: `Code Diagram - ${this.projectName}`,
      elements: this.limitElements(elements, options.maxElements),
      relationships: this.limitRelationships(relationships, options.maxRelationships),
      mermaid: this.toMermaidClassDiagram(elements, relationships)
    };
  }
  
  // ============================================
  // MERMAID GENERATORS
  // ============================================
  
  private toMermaidC4Context(elements: C4Element[], relationships: C4Relationship[]): string {
    let mermaid = 'graph TB\n';
    mermaid += '  %% C4 Context Diagram\n\n';
    
    // Style definitions
    mermaid += '  classDef person fill:#08427b,stroke:#052e56,color:#fff\n';
    mermaid += '  classDef system fill:#1168bd,stroke:#0b4884,color:#fff\n';
    mermaid += '  classDef external fill:#999,stroke:#666,color:#fff\n\n';
    
    // Elements
    for (const el of elements) {
      const shape = el.type === 'person' ? `(["👤 ${el.name}"])` : `["${el.name}"]`;
      mermaid += `  ${el.id}${shape}\n`;
    }
    
    mermaid += '\n';
    
    // Relationships
    for (const rel of relationships) {
      mermaid += `  ${rel.sourceId} -->|${rel.description}| ${rel.targetId}\n`;
    }
    
    mermaid += '\n';
    
    // Apply styles
    for (const el of elements) {
      mermaid += `  class ${el.id} ${el.type}\n`;
    }
    
    return mermaid;
  }
  
  private toMermaidFlowchart(
    elements: C4Element[], 
    relationships: C4Relationship[],
    direction: 'TB' | 'LR' = 'TB'
  ): string {
    let mermaid = `flowchart ${direction}\n`;
    
    // Elements
    for (const el of elements) {
      const label = el.technology 
        ? `${el.name}<br/><small>${el.technology}</small>`
        : el.name;
      mermaid += `  ${el.id}["${label}"]\n`;
    }
    
    mermaid += '\n';
    
    // Relationships
    for (const rel of relationships) {
      mermaid += `  ${rel.sourceId} --> ${rel.targetId}\n`;
    }
    
    return mermaid;
  }
  
  private toMermaidClassDiagram(elements: C4Element[], relationships: C4Relationship[]): string {
    let mermaid = 'classDiagram\n';
    
    // Classes
    for (const el of elements) {
      if (el.name.includes('interface')) {
        const name = el.name.replace('«interface» ', '');
        mermaid += `  class ${this.sanitizeClassName(el.id)} {\n`;
        mermaid += `    <<interface>>\n`;
        mermaid += `    ${name}\n`;
        mermaid += `  }\n`;
      } else {
        mermaid += `  class ${this.sanitizeClassName(el.id)}\n`;
      }
    }
    
    mermaid += '\n';
    
    // Relationships
    for (const rel of relationships) {
      const arrow = rel.description === 'Implements' ? '..|>' : '-->';
      mermaid += `  ${this.sanitizeClassName(rel.sourceId)} ${arrow} ${this.sanitizeClassName(rel.targetId)}\n`;
    }
    
    return mermaid;
  }
  
  // ============================================
  // HELPERS
  // ============================================
  
  private applyDefaults(options?: C4Options): Required<C4Options> {
    return {
      maxElements: options?.maxElements ?? 50,
      maxRelationships: options?.maxRelationships ?? 100,
      groupByDirectory: options?.groupByDirectory ?? true,
      focusElement: options?.focusElement ?? '',
      pathFilter: options?.pathFilter ?? ''
    };
  }
  
  private detectExternalSystems(): Array<{
    id: string;
    name: string;
    description: string;
    technology?: string;
  }> {
    const systems: Array<{
      id: string;
      name: string;
      description: string;
      technology?: string;
    }> = [];
    
    try {
      const pkgPath = path.join(this.projectPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = Object.keys(pkg.dependencies || {});
        
        // Map known dependencies to external systems
        const knownSystems: Record<string, { name: string; description: string; technology?: string }> = {
          'openai': { name: 'OpenAI API', description: 'LLM provider', technology: 'REST API' },
          'chromadb': { name: 'ChromaDB', description: 'Vector database', technology: 'HTTP' },
          '@modelcontextprotocol/sdk': { name: 'MCP Protocol', description: 'Model Context Protocol' },
          'pg': { name: 'PostgreSQL', description: 'Relational database', technology: 'SQL' },
          'redis': { name: 'Redis', description: 'Cache/message broker', technology: 'Redis Protocol' },
          'mongodb': { name: 'MongoDB', description: 'Document database', technology: 'MongoDB Wire' },
          'axios': { name: 'External APIs', description: 'HTTP client', technology: 'REST' }
        };
        
        for (const dep of deps) {
          if (knownSystems[dep]) {
            const sys = knownSystems[dep];
            systems.push({
              id: this.sanitizeId(dep),
              name: sys.name,
              description: sys.description,
              technology: sys.technology
            });
          }
        }
      }
    } catch (e) {
      // Ignore errors reading package.json
    }
    
    return systems;
  }
  
  private getTopLevelDirectories(): string[] {
    const dirs = new Set<string>();
    const modules = this.graph.queryNodes({ type: 'module' });
    
    for (const mod of modules) {
      const parts = mod.filePath.split('/');
      if (parts.length > 0) {
        // Get first directory (e.g., "src", "lib", "core")
        dirs.add(parts[0]);
      }
    }
    
    return Array.from(dirs).filter(d => d !== '.' && d !== '..');
  }
  
  private getContainerRelationships(containers: string[]): C4Relationship[] {
    const relationships: C4Relationship[] = [];
    const addedRels = new Set<string>();
    
    const modules = this.graph.queryNodes({ type: 'module' });
    
    for (const mod of modules) {
      const sourceDir = mod.filePath.split('/')[0];
      if (!containers.includes(sourceDir)) continue;
      
      const deps = this.graph.getDependencies(mod.id);
      for (const dep of deps) {
        const targetDir = dep.filePath.split('/')[0];
        if (!containers.includes(targetDir)) continue;
        if (sourceDir === targetDir) continue;
        
        const relKey = `${sourceDir}|${targetDir}`;
        if (!addedRels.has(relKey)) {
          addedRels.add(relKey);
          relationships.push({
            sourceId: `container_${this.sanitizeId(sourceDir)}`,
            targetId: `container_${this.sanitizeId(targetDir)}`,
            description: 'Uses'
          });
        }
      }
    }
    
    return relationships;
  }
  
  private groupModulesByDirectory(modules: any[]): any[] {
    // For now, just return as-is
    // Could implement directory grouping logic here
    return modules;
  }
  
  private limitElements(elements: C4Element[], max: number): C4Element[] {
    if (elements.length <= max) return elements;
    
    // Prioritize by type: person > system > container > component > external
    const priority: Record<C4ElementType, number> = {
      'person': 5,
      'system': 4,
      'container': 3,
      'component': 2,
      'external': 1
    };
    
    return elements
      .sort((a, b) => priority[b.type] - priority[a.type])
      .slice(0, max);
  }
  
  private limitRelationships(relationships: C4Relationship[], max: number): C4Relationship[] {
    return relationships.slice(0, max);
  }
  
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_');
  }
  
  private sanitizeClassName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }
  
  private shortenPath(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    return filePath;
  }
}

