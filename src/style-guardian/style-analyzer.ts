import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[StyleGuardian]');
/**
 * M7 v3.0 - Style Analyzer
 * 
 * AST-based analysis for extracting code style patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  NamingConvention,
  NamingPattern,
  CodeElement,
  ImportPattern,
  AsyncPattern,
  ErrorHandlingPattern,
  FormattingPattern,
  DocumentationPattern,
  StyleProfile,
  AntiPattern,
  DEFAULT_ANTI_PATTERNS,
  AnalysisContext,
  StyleGuardianConfig,
  DEFAULT_STYLE_GUARDIAN_CONFIG
} from './types.js';

// ============================================
// NAMING DETECTION
// ============================================

function detectNamingConvention(name: string): NamingConvention {
  if (!name || name.length === 0) return 'mixed';
  
  // Check for _prefixed
  if (name.startsWith('_')) {
    return '_prefixed';
  }
  
  // Check for UPPER_SNAKE_CASE
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
    return 'UPPER_SNAKE_CASE';
  }
  
  // Check for snake_case
  if (/^[a-z][a-z0-9_]*$/.test(name)) {
    return 'snake_case';
  }
  
  // Check for kebab-case
  if (/^[a-z][a-z0-9-]*$/.test(name)) {
    return 'kebab-case';
  }
  
  // Check for PascalCase
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
    return 'PascalCase';
  }
  
  // Check for camelCase
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) {
    return 'camelCase';
  }
  
  return 'mixed';
}

// ============================================
// PATTERN EXTRACTION (Regex-based for simplicity)
// ============================================

interface ExtractedNames {
  variables: string[];
  functions: string[];
  classes: string[];
  interfaces: string[];
  types: string[];
  constants: string[];
  parameters: string[];
  properties: string[];
  methods: string[];
  enums: string[];
}

function extractNames(content: string, language: string): ExtractedNames {
  const result: ExtractedNames = {
    variables: [],
    functions: [],
    classes: [],
    interfaces: [],
    types: [],
    constants: [],
    parameters: [],
    properties: [],
    methods: [],
    enums: []
  };
  
  // Extract variable names (let, const, var)
  const varMatches = content.matchAll(/(?:let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
  for (const match of varMatches) {
    result.variables.push(match[1]);
  }
  
  // Extract constants (const with UPPER_CASE or regular)
  const constMatches = content.matchAll(/const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
  for (const match of constMatches) {
    if (/^[A-Z][A-Z0-9_]*$/.test(match[1])) {
      result.constants.push(match[1]);
    } else {
      result.variables.push(match[1]);
    }
  }
  
  // Extract function names
  const funcMatches = content.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
  for (const match of funcMatches) {
    result.functions.push(match[1]);
  }
  
  // Extract arrow functions assigned to variables
  const arrowMatches = content.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
  for (const match of arrowMatches) {
    result.functions.push(match[1]);
  }
  
  // Extract class names
  const classMatches = content.matchAll(/class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
  for (const match of classMatches) {
    result.classes.push(match[1]);
  }
  
  // Extract interface names (TypeScript)
  if (language === 'typescript' || language === 'tsx') {
    const interfaceMatches = content.matchAll(/interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    for (const match of interfaceMatches) {
      result.interfaces.push(match[1]);
    }
    
    // Extract type names
    const typeMatches = content.matchAll(/type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g);
    for (const match of typeMatches) {
      result.types.push(match[1]);
    }
    
    // Extract enum names
    const enumMatches = content.matchAll(/enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    for (const match of enumMatches) {
      result.enums.push(match[1]);
    }
  }
  
  // Extract method names from classes
  const methodMatches = content.matchAll(/(?:public|private|protected|async)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g);
  for (const match of methodMatches) {
    if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'class'].includes(match[1])) {
      result.methods.push(match[1]);
    }
  }
  
  return result;
}

function analyzeNamingPatterns(names: ExtractedNames): NamingPattern[] {
  const patterns: NamingPattern[] = [];
  
  const elementMap: Record<string, CodeElement> = {
    variables: 'variable',
    functions: 'function',
    classes: 'class',
    interfaces: 'interface',
    types: 'type',
    constants: 'constant',
    parameters: 'parameter',
    properties: 'property',
    methods: 'method',
    enums: 'enum'
  };
  
  for (const [key, element] of Object.entries(elementMap)) {
    const nameList = names[key as keyof ExtractedNames];
    if (nameList.length === 0) continue;
    
    // Count conventions
    const conventionCounts: Record<NamingConvention, string[]> = {
      'camelCase': [],
      'PascalCase': [],
      'snake_case': [],
      'UPPER_SNAKE_CASE': [],
      'kebab-case': [],
      '_prefixed': [],
      'mixed': []
    };
    
    for (const name of nameList) {
      const convention = detectNamingConvention(name);
      conventionCounts[convention].push(name);
    }
    
    // Find dominant convention
    let maxCount = 0;
    let dominantConvention: NamingConvention = 'mixed';
    let examples: string[] = [];
    
    for (const [convention, names] of Object.entries(conventionCounts)) {
      if (names.length > maxCount) {
        maxCount = names.length;
        dominantConvention = convention as NamingConvention;
        examples = names.slice(0, 5);
      }
    }
    
    if (maxCount > 0) {
      const confidence = maxCount / nameList.length;
      
      // Find exceptions (names not following dominant convention)
      const exceptions = nameList
        .filter(n => detectNamingConvention(n) !== dominantConvention)
        .slice(0, 5);
      
      patterns.push({
        element,
        convention: dominantConvention,
        confidence,
        examples,
        exceptions
      });
    }
  }
  
  return patterns;
}

// ============================================
// IMPORT PATTERN ANALYSIS
// ============================================

function analyzeImportPatterns(content: string): ImportPattern {
  const imports = content.matchAll(/import\s+(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+))?\s*(?:,\s*(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+)))?\s*from\s*['"]([^'"]+)['"]/g);
  
  let namedCount = 0;
  let defaultCount = 0;
  let namespaceCount = 0;
  let hasBarrelImports = false;
  let pathAliases = new Set<string>();
  
  for (const match of imports) {
    const [, named1, namespace1, default1, named2, namespace2, default2, importPath] = match;
    
    if (named1 || named2) namedCount++;
    if (default1 || default2) defaultCount++;
    if (namespace1 || namespace2) namespaceCount++;
    
    // Check for barrel imports
    if (importPath.endsWith('/index') || importPath.match(/\/[^./]+$/)) {
      hasBarrelImports = true;
    }
    
    // Check for path aliases
    if (importPath.startsWith('@/')) pathAliases.add('@/');
    if (importPath.startsWith('~/')) pathAliases.add('~/');
    if (importPath.startsWith('#/')) pathAliases.add('#/');
  }
  
  const total = namedCount + defaultCount + namespaceCount;
  let style: 'named' | 'default' | 'namespace' | 'mixed' = 'mixed';
  
  if (total > 0) {
    if (namedCount > total * 0.7) style = 'named';
    else if (defaultCount > total * 0.7) style = 'default';
    else if (namespaceCount > total * 0.7) style = 'namespace';
  }
  
  return {
    style,
    barrelFiles: hasBarrelImports,
    pathAlias: pathAliases.size > 0 ? Array.from(pathAliases)[0] : null,
    grouping: 'none', // Would need more analysis
    confidence: total > 5 ? 0.9 : total / 5 * 0.9
  };
}

// ============================================
// ASYNC PATTERN ANALYSIS
// ============================================

function analyzeAsyncPatterns(content: string): AsyncPattern {
  const asyncAwaitCount = (content.match(/async\s+/g) || []).length;
  const thenCount = (content.match(/\.then\s*\(/g) || []).length;
  const callbackCount = (content.match(/function\s*\([^)]*callback[^)]*\)/gi) || []).length +
                        (content.match(/,\s*\([^)]*\)\s*=>\s*\{/g) || []).length;
  
  const tryCatchCount = (content.match(/try\s*\{/g) || []).length;
  const catchChainCount = (content.match(/\.catch\s*\(/g) || []).length;
  
  const total = asyncAwaitCount + thenCount + callbackCount;
  let style: 'async-await' | 'promises' | 'callbacks' | 'mixed' = 'mixed';
  
  if (total > 0) {
    if (asyncAwaitCount > total * 0.7) style = 'async-await';
    else if (thenCount > total * 0.7) style = 'promises';
    else if (callbackCount > total * 0.7) style = 'callbacks';
  }
  
  let errorHandling: 'try-catch' | 'catch-chain' | 'none' = 'none';
  if (tryCatchCount > catchChainCount && tryCatchCount > 0) {
    errorHandling = 'try-catch';
  } else if (catchChainCount > 0) {
    errorHandling = 'catch-chain';
  }
  
  return {
    style,
    errorHandling,
    confidence: total > 3 ? 0.85 : total / 3 * 0.85
  };
}

// ============================================
// ERROR HANDLING ANALYSIS
// ============================================

function analyzeErrorHandling(content: string): ErrorHandlingPattern {
  // Look for custom error classes
  const customErrors = content.matchAll(/class\s+(\w*Error)\s+extends\s+Error/g);
  const customErrorClasses: string[] = [];
  for (const match of customErrors) {
    customErrorClasses.push(match[1]);
  }
  
  const throwNewError = (content.match(/throw\s+new\s+Error\(/g) || []).length;
  const throwCustom = (content.match(/throw\s+new\s+\w+Error\(/g) || []).length;
  const errorCodes = (content.match(/error\.code\s*[=!]=|errorCode|ERROR_/g) || []).length;
  
  let style: 'custom-errors' | 'native-errors' | 'error-codes' | 'mixed' = 'mixed';
  if (throwCustom > throwNewError || customErrorClasses.length > 0) {
    style = 'custom-errors';
  } else if (errorCodes > 0) {
    style = 'error-codes';
  } else if (throwNewError > 0) {
    style = 'native-errors';
  }
  
  const consoleLog = (content.match(/console\.(log|error|warn)/g) || []).length;
  const loggerCalls = (content.match(/logger\.(info|error|warn|debug)/g) || []).length;
  
  let loggingStyle: 'console' | 'logger' | 'none' = 'none';
  if (loggerCalls > consoleLog) {
    loggingStyle = 'logger';
  } else if (consoleLog > 0) {
    loggingStyle = 'console';
  }
  
  return {
    style,
    customErrorClasses,
    loggingStyle,
    confidence: 0.75
  };
}

// ============================================
// FORMATTING ANALYSIS
// ============================================

function analyzeFormatting(content: string): FormattingPattern {
  const lines = content.split('\n');
  
  // Detect indentation
  let tabCount = 0;
  let spaceCount = 0;
  let spaceSizes: number[] = [];
  
  for (const line of lines) {
    const leadingWhitespace = line.match(/^(\s+)/);
    if (leadingWhitespace) {
      if (leadingWhitespace[1].includes('\t')) {
        tabCount++;
      } else {
        spaceCount++;
        const spaces = leadingWhitespace[1].length;
        if (spaces > 0 && spaces <= 8) {
          spaceSizes.push(spaces);
        }
      }
    }
  }
  
  const indentation = tabCount > spaceCount ? 'tabs' : 'spaces';
  
  // Calculate most common indent size
  let indentSize = 2;
  if (spaceSizes.length > 0) {
    // Find GCD of space sizes for indent
    const minSize = Math.min(...spaceSizes.filter(s => s > 0));
    indentSize = minSize <= 4 ? minSize : 2;
  }
  
  // Detect quotes
  const singleQuotes = (content.match(/'/g) || []).length;
  const doubleQuotes = (content.match(/"/g) || []).length;
  const quotes = singleQuotes > doubleQuotes ? 'single' : 'double';
  
  // Detect semicolons
  const withSemi = (content.match(/;\s*$/gm) || []).length;
  const statements = (content.match(/(?:const|let|var|return|import|export)\s+/g) || []).length;
  const semicolons = statements > 0 && withSemi / statements > 0.5;
  
  // Detect trailing comma
  const trailingCommaES5 = (content.match(/,\s*\]/g) || []).length;
  const trailingCommaAll = (content.match(/,\s*\)/g) || []).length;
  let trailingComma: 'none' | 'es5' | 'all' = 'none';
  if (trailingCommaAll > 0) trailingComma = 'all';
  else if (trailingCommaES5 > 0) trailingComma = 'es5';
  
  // Detect line width (approximate)
  const lineLengths = lines.map(l => l.length).filter(l => l > 0);
  const maxLine = Math.max(...lineLengths, 80);
  const lineWidth = maxLine > 120 ? 120 : maxLine > 100 ? 100 : 80;
  
  return {
    indentation,
    indentSize,
    quotes,
    semicolons,
    trailingComma,
    lineWidth,
    confidence: 0.8
  };
}

// ============================================
// DOCUMENTATION ANALYSIS
// ============================================

function analyzeDocumentation(content: string): DocumentationPattern {
  const jsdocBlocks = (content.match(/\/\*\*[\s\S]*?\*\//g) || []).length;
  const inlineComments = (content.match(/\/\/[^\n]*/g) || []).length;
  
  const hasParamDocs = content.includes('@param');
  const hasReturnDocs = content.includes('@returns') || content.includes('@return');
  
  let style: 'jsdoc' | 'tsdoc' | 'inline' | 'none' = 'none';
  if (jsdocBlocks > 0) {
    style = content.includes('@remarks') ? 'tsdoc' : 'jsdoc';
  } else if (inlineComments > 0) {
    style = 'inline';
  }
  
  // Determine what requires docs
  const functionsWithDocs = (content.match(/\/\*\*[\s\S]*?\*\/\s*(?:export\s+)?(?:async\s+)?function/g) || []).length;
  const totalFunctions = (content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+/g) || []).length;
  
  const requiredFor: CodeElement[] = [];
  if (functionsWithDocs > totalFunctions * 0.5) {
    requiredFor.push('function');
  }
  
  return {
    style,
    requiredFor,
    paramDescriptions: hasParamDocs,
    returnDescriptions: hasReturnDocs,
    confidence: jsdocBlocks > 3 ? 0.85 : 0.5
  };
}

// ============================================
// ANTI-PATTERN DETECTION
// ============================================

function detectAntiPatterns(content: string, patterns: AntiPattern[]): AntiPattern[] {
  const results: AntiPattern[] = [];
  
  for (const pattern of patterns) {
    if (!pattern.enabled) continue;
    
    try {
      const regex = new RegExp(pattern.pattern, 'g');
      const matches = content.match(regex) || [];
      
      results.push({
        ...pattern,
        occurrences: matches.length
      });
    } catch {
      // Invalid regex, skip
    }
  }
  
  return results.filter(p => p.occurrences > 0);
}

// ============================================
// MAIN ANALYZER CLASS
// ============================================

export class StyleAnalyzer {
  private config: StyleGuardianConfig;
  
  constructor(config: Partial<StyleGuardianConfig> = {}) {
    this.config = { ...DEFAULT_STYLE_GUARDIAN_CONFIG, ...config };
  }
  
  /**
   * Analyze a single file
   */
  analyzeFile(filePath: string, content?: string): AnalysisContext & {
    naming: NamingPattern[];
    imports: ImportPattern;
    async: AsyncPattern;
    errorHandling: ErrorHandlingPattern;
    formatting: FormattingPattern;
    documentation: DocumentationPattern;
    antiPatterns: AntiPattern[];
  } {
    const fileContent = content || fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    
    let language: 'typescript' | 'javascript' | 'tsx' | 'jsx' = 'javascript';
    if (ext === '.ts') language = 'typescript';
    else if (ext === '.tsx') language = 'tsx';
    else if (ext === '.jsx') language = 'jsx';
    
    const names = extractNames(fileContent, language);
    
    return {
      filePath,
      content: fileContent,
      language,
      naming: analyzeNamingPatterns(names),
      imports: analyzeImportPatterns(fileContent),
      async: analyzeAsyncPatterns(fileContent),
      errorHandling: analyzeErrorHandling(fileContent),
      formatting: analyzeFormatting(fileContent),
      documentation: analyzeDocumentation(fileContent),
      antiPatterns: detectAntiPatterns(fileContent, DEFAULT_ANTI_PATTERNS)
    };
  }
  
  /**
   * Analyze a directory and create a StyleProfile
   */
  async analyzeProject(projectPath: string): Promise<StyleProfile> {
    const files = await this.findFiles(projectPath);
    const analyses: ReturnType<typeof this.analyzeFile>[] = [];
    
    for (const file of files) {
      try {
        analyses.push(this.analyzeFile(file));
      } catch (error) {
        log.error(`Error analyzing ${file}:`, error);
      }
    }
    
    return this.aggregateAnalyses(projectPath, analyses);
  }
  
  /**
   * Find all relevant files in a directory
   */
  private async findFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    
    const walk = async (currentDir: string) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        // Check ignore patterns
        if (this.shouldIgnore(fullPath)) continue;
        
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    };
    
    await walk(dir);
    return files;
  }
  
  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(filePath: string): boolean {
    const relativePath = filePath;
    
    for (const pattern of this.config.ignorePatterns) {
      // Simple glob matching
      const regex = new RegExp(
        pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\./g, '\\.')
      );
      
      if (regex.test(relativePath)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Aggregate analyses from multiple files into a StyleProfile
   */
  private aggregateAnalyses(
    projectPath: string,
    analyses: ReturnType<typeof this.analyzeFile>[]
  ): StyleProfile {
    // Aggregate naming patterns
    const namingMap = new Map<string, NamingPattern[]>();
    for (const analysis of analyses) {
      for (const pattern of analysis.naming) {
        const key = pattern.element;
        if (!namingMap.has(key)) {
          namingMap.set(key, []);
        }
        namingMap.get(key)!.push(pattern);
      }
    }
    
    // Find dominant patterns
    const naming: NamingPattern[] = [];
    for (const [element, patterns] of namingMap) {
      const conventionCounts = new Map<NamingConvention, number>();
      const allExamples: string[] = [];
      
      for (const pattern of patterns) {
        const current = conventionCounts.get(pattern.convention) || 0;
        conventionCounts.set(pattern.convention, current + 1);
        allExamples.push(...pattern.examples);
      }
      
      let maxCount = 0;
      let dominantConvention: NamingConvention = 'mixed';
      
      for (const [convention, count] of conventionCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominantConvention = convention;
        }
      }
      
      naming.push({
        element: element as CodeElement,
        convention: dominantConvention,
        confidence: maxCount / patterns.length,
        examples: [...new Set(allExamples)].slice(0, 5),
        exceptions: []
      });
    }
    
    // Aggregate import patterns (use most common)
    const imports = this.aggregatePattern(analyses.map(a => a.imports));
    const async = this.aggregatePattern(analyses.map(a => a.async));
    const errorHandling = this.aggregatePattern(analyses.map(a => a.errorHandling));
    const formatting = this.aggregatePattern(analyses.map(a => a.formatting));
    const documentation = this.aggregatePattern(analyses.map(a => a.documentation));
    
    // Aggregate anti-patterns
    const antiPatternMap = new Map<string, AntiPattern>();
    for (const analysis of analyses) {
      for (const ap of analysis.antiPatterns) {
        const existing = antiPatternMap.get(ap.id);
        if (existing) {
          existing.occurrences += ap.occurrences;
        } else {
          antiPatternMap.set(ap.id, { ...ap });
        }
      }
    }
    
    // Calculate overall confidence
    const confidences = [
      ...naming.map(n => n.confidence),
      imports.confidence,
      async.confidence,
      errorHandling.confidence,
      formatting.confidence,
      documentation.confidence
    ];
    const overallConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    
    return {
      projectId: path.basename(projectPath),
      projectPath,
      createdAt: new Date(),
      updatedAt: new Date(),
      filesAnalyzed: analyses.length,
      naming,
      imports,
      async,
      errorHandling,
      formatting,
      documentation,
      antiPatterns: Array.from(antiPatternMap.values()),
      customRules: [],
      confidence: overallConfidence,
      learningRate: 0
    };
  }
  
  /**
   * Helper to aggregate a pattern type by finding the most common values
   */
  private aggregatePattern<T extends { confidence: number }>(patterns: T[]): T {
    if (patterns.length === 0) {
      throw new Error('No patterns to aggregate');
    }
    
    // Use the pattern with highest confidence as base
    let best = patterns[0];
    for (const p of patterns) {
      if (p.confidence > best.confidence) {
        best = p;
      }
    }
    
    // Adjust confidence based on agreement
    const agreementRatio = patterns.filter(p => 
      JSON.stringify(p) === JSON.stringify(best)
    ).length / patterns.length;
    
    return {
      ...best,
      confidence: best.confidence * (0.5 + agreementRatio * 0.5)
    };
  }
}

export default StyleAnalyzer;

