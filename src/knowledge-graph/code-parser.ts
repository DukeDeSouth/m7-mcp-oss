/**
 * M7 v3.0 - Code Parser
 * 
 * Regex-based parser for extracting code structure
 * (No native dependencies - pure JavaScript)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  GraphNode,
  GraphEdge,
  NodeType,
  RelationType,
  GraphNodeMetadata,
  GraphEdgeMetadata
} from './types.js';

// ============================================
// PARSED ELEMENTS
// ============================================

export interface ParsedFile {
  filePath: string;
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx';
  imports: ParsedImport[];
  exports: ParsedExport[];
  classes: ParsedClass[];
  functions: ParsedFunction[];
  interfaces: ParsedInterface[];
  types: ParsedType[];
  variables: ParsedVariable[];
  errors: string[];
}

export interface ParsedImport {
  source: string;           // Import path
  defaultImport?: string;   // Default import name
  namedImports: string[];   // Named imports
  namespaceImport?: string; // import * as X
  typeOnly: boolean;        // import type
  dynamic: boolean;         // Dynamic import
  line: number;
}

export interface ParsedExport {
  name: string;
  type: 'default' | 'named' | 're-export';
  source?: string;          // For re-exports
  line: number;
}

export interface ParsedClass {
  name: string;
  exported: boolean;
  defaultExport: boolean;
  extends?: string;
  implements: string[];
  methods: string[];
  line: number;
}

export interface ParsedFunction {
  name: string;
  exported: boolean;
  defaultExport: boolean;
  async: boolean;
  params: number;
  line: number;
  isHook: boolean;          // React hook
  isComponent: boolean;     // React component
}

export interface ParsedInterface {
  name: string;
  exported: boolean;
  extends: string[];
  line: number;
}

export interface ParsedType {
  name: string;
  exported: boolean;
  line: number;
}

export interface ParsedVariable {
  name: string;
  exported: boolean;
  isConst: boolean;
  line: number;
}

// ============================================
// REGEX PATTERNS
// ============================================

const PATTERNS = {
  // Imports
  importDefault: /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
  importNamed: /import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g,
  importNamespace: /import\s*\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
  importType: /import\s+type\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g,
  importTypeDefault: /import\s+type\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
  importMixed: /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g,
  importDynamic: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  require: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  
  // Exports
  exportDefault: /export\s+default\s+(?:class|function|const|let|var)?\s*(\w*)/g,
  exportNamed: /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
  exportList: /export\s*\{([^}]+)\}/g,
  exportFrom: /export\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g,
  exportAllFrom: /export\s*\*\s*from\s+['"]([^'"]+)['"]/g,
  exportAllAs: /export\s*\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
  
  // Classes
  classDecl: /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g,
  classMethod: /(?:public|private|protected|static|async|get|set)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g,
  
  // Functions
  functionDecl: /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
  arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g,
  
  // Interfaces & Types
  interfaceDecl: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{/g,
  typeDecl: /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=/g,
  enumDecl: /(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g,
  
  // Variables
  constDecl: /(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=/g,
  letDecl: /(?:export\s+)?let\s+(\w+)\s*(?::\s*[^=]+)?\s*=/g,
  
  // React specific
  reactComponent: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]\s*(?:React\.)?(?:FC|FunctionComponent|Component)/g,
  useHook: /(?:export\s+)?(?:const|function)\s+(use[A-Z]\w+)/g
};

// ============================================
// CODE PARSER CLASS
// ============================================

export class CodeParser {
  /**
   * Parse a single file
   */
  parseFile(filePath: string, content?: string): ParsedFile {
    const fileContent = content || fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    
    const language = this.detectLanguage(ext);
    const lines = fileContent.split('\n');
    
    const result: ParsedFile = {
      filePath,
      language,
      imports: [],
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      types: [],
      variables: [],
      errors: []
    };
    
    try {
      // Remove comments for cleaner parsing
      const cleanContent = this.removeComments(fileContent);
      
      // Parse imports
      result.imports = this.parseImports(cleanContent, lines);
      
      // Parse exports
      result.exports = this.parseExports(cleanContent, lines);
      
      // Parse classes
      result.classes = this.parseClasses(cleanContent, lines);
      
      // Parse functions
      result.functions = this.parseFunctions(cleanContent, lines);
      
      // Parse interfaces (TypeScript only)
      if (language === 'typescript' || language === 'tsx') {
        result.interfaces = this.parseInterfaces(cleanContent, lines);
        result.types = this.parseTypes(cleanContent, lines);
      }
      
      // Parse variables
      result.variables = this.parseVariables(cleanContent, lines);
      
    } catch (error: any) {
      result.errors.push(`Parse error: ${error.message}`);
    }
    
    return result;
  }
  
  /**
   * Detect language from extension
   */
  private detectLanguage(ext: string): 'typescript' | 'javascript' | 'tsx' | 'jsx' {
    switch (ext) {
      case '.ts': return 'typescript';
      case '.tsx': return 'tsx';
      case '.jsx': return 'jsx';
      default: return 'javascript';
    }
  }
  
  /**
   * Remove comments from code
   */
  private removeComments(content: string): string {
    // Remove single-line comments
    let result = content.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    return result;
  }
  
  /**
   * Get line number for a match
   */
  private getLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }
  
  /**
   * Parse imports
   */
  private parseImports(content: string, lines: string[]): ParsedImport[] {
    const imports: ParsedImport[] = [];
    
    // Default imports: import X from 'y'
    let match;
    const defaultPattern = new RegExp(PATTERNS.importDefault.source, 'g');
    while ((match = defaultPattern.exec(content)) !== null) {
      imports.push({
        source: match[2],
        defaultImport: match[1],
        namedImports: [],
        typeOnly: false,
        dynamic: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Named imports: import { X, Y } from 'z'
    const namedPattern = new RegExp(PATTERNS.importNamed.source, 'g');
    while ((match = namedPattern.exec(content)) !== null) {
      const isTypeImport = content.substring(match.index - 5, match.index).includes('type');
      imports.push({
        source: match[2],
        namedImports: match[1].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean),
        typeOnly: isTypeImport,
        dynamic: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Namespace imports: import * as X from 'y'
    const namespacePattern = new RegExp(PATTERNS.importNamespace.source, 'g');
    while ((match = namespacePattern.exec(content)) !== null) {
      imports.push({
        source: match[2],
        namespaceImport: match[1],
        namedImports: [],
        typeOnly: false,
        dynamic: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Mixed imports: import X, { Y, Z } from 'w'
    const mixedPattern = new RegExp(PATTERNS.importMixed.source, 'g');
    while ((match = mixedPattern.exec(content)) !== null) {
      imports.push({
        source: match[3],
        defaultImport: match[1],
        namedImports: match[2].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean),
        typeOnly: false,
        dynamic: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Type imports
    const typePattern = new RegExp(PATTERNS.importType.source, 'g');
    while ((match = typePattern.exec(content)) !== null) {
      imports.push({
        source: match[2],
        namedImports: match[1].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean),
        typeOnly: true,
        dynamic: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Dynamic imports
    const dynamicPattern = new RegExp(PATTERNS.importDynamic.source, 'g');
    while ((match = dynamicPattern.exec(content)) !== null) {
      imports.push({
        source: match[1],
        namedImports: [],
        typeOnly: false,
        dynamic: true,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Require (CommonJS)
    const requirePattern = new RegExp(PATTERNS.require.source, 'g');
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push({
        source: match[1],
        namedImports: [],
        typeOnly: false,
        dynamic: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return imports;
  }
  
  /**
   * Parse exports
   */
  private parseExports(content: string, lines: string[]): ParsedExport[] {
    const exports: ParsedExport[] = [];
    let match;
    
    // Default exports
    const defaultPattern = new RegExp(PATTERNS.exportDefault.source, 'g');
    while ((match = defaultPattern.exec(content)) !== null) {
      exports.push({
        name: match[1] || 'default',
        type: 'default',
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Named exports
    const namedPattern = new RegExp(PATTERNS.exportNamed.source, 'g');
    while ((match = namedPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'named',
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Export list: export { X, Y }
    const listPattern = new RegExp(PATTERNS.exportList.source, 'g');
    while ((match = listPattern.exec(content)) !== null) {
      const names = match[1].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean);
      for (const name of names) {
        exports.push({
          name,
          type: 'named',
          line: this.getLineNumber(content, match.index)
        });
      }
    }
    
    // Re-exports: export { X } from 'y'
    const reExportPattern = new RegExp(PATTERNS.exportFrom.source, 'g');
    while ((match = reExportPattern.exec(content)) !== null) {
      const names = match[1].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean);
      for (const name of names) {
        exports.push({
          name,
          type: 're-export',
          source: match[2],
          line: this.getLineNumber(content, match.index)
        });
      }
    }
    
    // Export all: export * from 'y'
    const exportAllPattern = new RegExp(PATTERNS.exportAllFrom.source, 'g');
    while ((match = exportAllPattern.exec(content)) !== null) {
      exports.push({
        name: '*',
        type: 're-export',
        source: match[1],
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return exports;
  }
  
  /**
   * Parse classes
   */
  private parseClasses(content: string, lines: string[]): ParsedClass[] {
    const classes: ParsedClass[] = [];
    let match;
    
    const classPattern = new RegExp(PATTERNS.classDecl.source, 'g');
    while ((match = classPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const isExported = fullMatch.includes('export');
      const isDefault = fullMatch.includes('default');
      
      const implementsList = match[3] 
        ? match[3].split(',').map(s => s.trim()).filter(Boolean)
        : [];
      
      classes.push({
        name: match[1],
        exported: isExported,
        defaultExport: isDefault,
        extends: match[2],
        implements: implementsList,
        methods: [], // Would need deeper parsing
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return classes;
  }
  
  /**
   * Parse functions
   */
  private parseFunctions(content: string, lines: string[]): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    let match;
    
    // Function declarations
    const funcPattern = new RegExp(PATTERNS.functionDecl.source, 'g');
    while ((match = funcPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const name = match[1];
      const params = match[2] ? match[2].split(',').filter(Boolean).length : 0;
      
      functions.push({
        name,
        exported: fullMatch.includes('export'),
        defaultExport: fullMatch.includes('default'),
        async: fullMatch.includes('async'),
        params,
        line: this.getLineNumber(content, match.index),
        isHook: name.startsWith('use') && /^use[A-Z]/.test(name),
        isComponent: /^[A-Z]/.test(name)
      });
    }
    
    // Arrow functions
    const arrowPattern = new RegExp(PATTERNS.arrowFunction.source, 'g');
    while ((match = arrowPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const name = match[1];
      
      functions.push({
        name,
        exported: fullMatch.includes('export'),
        defaultExport: false,
        async: fullMatch.includes('async'),
        params: 0, // Hard to determine from regex
        line: this.getLineNumber(content, match.index),
        isHook: name.startsWith('use') && /^use[A-Z]/.test(name),
        isComponent: /^[A-Z]/.test(name)
      });
    }
    
    return functions;
  }
  
  /**
   * Parse interfaces
   */
  private parseInterfaces(content: string, lines: string[]): ParsedInterface[] {
    const interfaces: ParsedInterface[] = [];
    let match;
    
    const interfacePattern = new RegExp(PATTERNS.interfaceDecl.source, 'g');
    while ((match = interfacePattern.exec(content)) !== null) {
      const extendsList = match[2]
        ? match[2].split(',').map(s => s.trim()).filter(Boolean)
        : [];
      
      interfaces.push({
        name: match[1],
        exported: match[0].includes('export'),
        extends: extendsList,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return interfaces;
  }
  
  /**
   * Parse types
   */
  private parseTypes(content: string, lines: string[]): ParsedType[] {
    const types: ParsedType[] = [];
    let match;
    
    const typePattern = new RegExp(PATTERNS.typeDecl.source, 'g');
    while ((match = typePattern.exec(content)) !== null) {
      types.push({
        name: match[1],
        exported: match[0].includes('export'),
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Enums
    const enumPattern = new RegExp(PATTERNS.enumDecl.source, 'g');
    while ((match = enumPattern.exec(content)) !== null) {
      types.push({
        name: match[1],
        exported: match[0].includes('export'),
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return types;
  }
  
  /**
   * Parse variables
   */
  private parseVariables(content: string, lines: string[]): ParsedVariable[] {
    const variables: ParsedVariable[] = [];
    let match;
    
    // Constants
    const constPattern = new RegExp(PATTERNS.constDecl.source, 'g');
    while ((match = constPattern.exec(content)) !== null) {
      // Skip if it's actually a function/arrow function
      const afterMatch = content.substring(match.index + match[0].length, match.index + match[0].length + 50);
      if (afterMatch.includes('=>') || afterMatch.includes('function')) continue;
      
      variables.push({
        name: match[1],
        exported: match[0].includes('export'),
        isConst: true,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Let variables
    const letPattern = new RegExp(PATTERNS.letDecl.source, 'g');
    while ((match = letPattern.exec(content)) !== null) {
      variables.push({
        name: match[1],
        exported: match[0].includes('export'),
        isConst: false,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return variables;
  }
  
  /**
   * Convert parsed file to graph nodes and edges
   */
  toGraphElements(parsed: ParsedFile): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const fileId = `file:${parsed.filePath}`;
    
    // Create file node
    nodes.push({
      id: fileId,
      type: 'file',
      name: path.basename(parsed.filePath),
      filePath: parsed.filePath,
      metadata: {
        language: parsed.language,
        exported: parsed.exports.length > 0
      }
    });
    
    // Process imports -> edges
    for (const imp of parsed.imports) {
      const targetPath = this.resolveImportPath(parsed.filePath, imp.source);
      const targetId = `file:${targetPath}`;
      
      edges.push({
        id: `${fileId}:imports:${targetId}`,
        source: fileId,
        target: targetId,
        type: 'imports',
        weight: 1,
        metadata: {
          line: imp.line,
          typeOnly: imp.typeOnly,
          namedImports: imp.namedImports,
          dynamic: imp.dynamic
        }
      });
    }
    
    // Process classes -> nodes + edges
    for (const cls of parsed.classes) {
      const classId = `class:${parsed.filePath}:${cls.name}`;
      
      nodes.push({
        id: classId,
        type: 'class',
        name: cls.name,
        filePath: parsed.filePath,
        line: cls.line,
        metadata: {
          language: parsed.language,
          exported: cls.exported,
          defaultExport: cls.defaultExport,
          extends: cls.extends ? [cls.extends] : [],
          implements: cls.implements
        }
      });
      
      // File contains class
      edges.push({
        id: `${fileId}:contains:${classId}`,
        source: fileId,
        target: classId,
        type: 'contains',
        weight: 1
      });
      
      // Extends relationship
      if (cls.extends) {
        edges.push({
          id: `${classId}:extends:${cls.extends}`,
          source: classId,
          target: `class:*:${cls.extends}`, // Will resolve later
          type: 'extends',
          weight: 2
        });
      }
      
      // Implements relationships
      for (const iface of cls.implements) {
        edges.push({
          id: `${classId}:implements:${iface}`,
          source: classId,
          target: `interface:*:${iface}`,
          type: 'implements',
          weight: 2
        });
      }
    }
    
    // Process functions -> nodes
    for (const func of parsed.functions) {
      let nodeType: NodeType = 'function';
      if (func.isHook) nodeType = 'hook';
      else if (func.isComponent) nodeType = 'component';
      
      const funcId = `${nodeType}:${parsed.filePath}:${func.name}`;
      
      nodes.push({
        id: funcId,
        type: nodeType,
        name: func.name,
        filePath: parsed.filePath,
        line: func.line,
        metadata: {
          language: parsed.language,
          exported: func.exported,
          defaultExport: func.defaultExport,
          paramCount: func.params
        }
      });
      
      edges.push({
        id: `${fileId}:contains:${funcId}`,
        source: fileId,
        target: funcId,
        type: 'contains',
        weight: 1
      });
    }
    
    // Process interfaces -> nodes
    for (const iface of parsed.interfaces) {
      const ifaceId = `interface:${parsed.filePath}:${iface.name}`;
      
      nodes.push({
        id: ifaceId,
        type: 'interface',
        name: iface.name,
        filePath: parsed.filePath,
        line: iface.line,
        metadata: {
          language: parsed.language,
          exported: iface.exported,
          extends: iface.extends
        }
      });
      
      edges.push({
        id: `${fileId}:contains:${ifaceId}`,
        source: fileId,
        target: ifaceId,
        type: 'contains',
        weight: 1
      });
    }
    
    // Process types -> nodes
    for (const type of parsed.types) {
      const typeId = `type:${parsed.filePath}:${type.name}`;
      
      nodes.push({
        id: typeId,
        type: 'type',
        name: type.name,
        filePath: parsed.filePath,
        line: type.line,
        metadata: {
          language: parsed.language,
          exported: type.exported
        }
      });
      
      edges.push({
        id: `${fileId}:contains:${typeId}`,
        source: fileId,
        target: typeId,
        type: 'contains',
        weight: 1
      });
    }
    
    return { nodes, edges };
  }
  
  /**
   * Resolve import path to absolute path
   */
  private resolveImportPath(fromFile: string, importPath: string): string {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const dir = path.dirname(fromFile);
      let resolved = path.resolve(dir, importPath);
      
      // Add extension if missing
      if (!path.extname(resolved)) {
        // Try common extensions
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
          if (fs.existsSync(resolved + ext)) {
            return resolved + ext;
          }
        }
        // Default to .ts
        return resolved + '.ts';
      }
      
      return resolved;
    }
    
    // Handle path aliases (simplified)
    if (importPath.startsWith('@/')) {
      return importPath.replace('@/', 'src/');
    }
    
    // External module
    return `node_modules/${importPath}`;
  }
}

export default CodeParser;

