/**
 * Project Scanner
 * Scans project structure and generates overview
 */

import * as path from 'path';
import { listFilesRecursive, safeReadFile, fileExists } from '../utils/fileUtils.js';
import { ScanResult } from '../types.js';

export interface ProjectScanData {
  name: string;
  version: string;
  description: string;
  structure: DirectoryNode;
  tech_stack: TechStackInfo;
  statistics: ProjectStatistics;
}

export interface DirectoryNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: DirectoryNode[];
  size?: number;
  extension?: string;
}

export interface TechStackInfo {
  languages: LanguageInfo[];
  frameworks: string[];
  tools: string[];
  dependencies: DependencyInfo;
}

export interface LanguageInfo {
  name: string;
  files: number;
  lines: number;
  percentage: number;
}

export interface DependencyInfo {
  production: string[];
  development: string[];
  total: number;
}

export interface ProjectStatistics {
  total_files: number;
  total_lines: number;
  total_size: number;
  languages_count: number;
  directories_count: number;
}

export class ProjectScanner {
  constructor(private projectPath: string) {}
  
  /**
   * Scan entire project structure
   */
  async scan(): Promise<ScanResult<ProjectScanData>> {
    const startTime = Date.now();
    
    try {
      // Get project info from package.json
      const projectInfo = await this.getProjectInfo();
      
      // Scan directory structure
      const structure = await this.scanDirectory(this.projectPath);
      
      // Analyze tech stack
      const techStack = await this.analyzeTechStack();
      
      // Calculate statistics
      const statistics = this.calculateStatistics(structure);
      
      const scanTime = Date.now() - startTime;
      
      return {
        success: true,
        data: {
          name: projectInfo.name,
          version: projectInfo.version,
          description: projectInfo.description,
          structure,
          tech_stack: techStack,
          statistics
        },
        timestamp: new Date(),
        scan_time_ms: scanTime
      };
    } catch (error: any) {
      return {
        success: false,
        data: {
          name: 'Unknown',
          version: '0.0.0',
          description: '',
          structure: { name: '', path: '', type: 'directory' },
          tech_stack: {
            languages: [],
            frameworks: [],
            tools: [],
            dependencies: { production: [], development: [], total: 0 }
          },
          statistics: {
            total_files: 0,
            total_lines: 0,
            total_size: 0,
            languages_count: 0,
            directories_count: 0
          }
        },
        timestamp: new Date(),
        scan_time_ms: Date.now() - startTime,
        errors: [error.message]
      };
    }
  }
  
  /**
   * Get project info from package.json
   */
  private async getProjectInfo(): Promise<{
    name: string;
    version: string;
    description: string;
  }> {
    try {
      const packagePath = path.join(this.projectPath, 'package.json');
      const content = await safeReadFile(packagePath);
      const pkg = JSON.parse(content);
      
      return {
        name: pkg.name || 'Unknown',
        version: pkg.version || '0.0.0',
        description: pkg.description || ''
      };
    } catch (error) {
      return {
        name: 'Unknown',
        version: '0.0.0',
        description: ''
      };
    }
  }
  
  /**
   * Scan directory structure recursively
   */
  private async scanDirectory(
    dirPath: string,
    maxDepth: number = 3,
    currentDepth: number = 0
  ): Promise<DirectoryNode> {
    const fs = await import('fs/promises');
    const name = path.basename(dirPath);
    const relativePath = path.relative(this.projectPath, dirPath);
    
    // Check if we should skip this directory
    if (this.shouldSkipDirectory(name)) {
      return {
        name,
        path: relativePath || '.',
        type: 'directory',
        children: []
      };
    }
    
    // If max depth reached, don't recurse
    if (currentDepth >= maxDepth) {
      return {
        name,
        path: relativePath || '.',
        type: 'directory',
        children: []
      };
    }
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const children: DirectoryNode[] = [];
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          const subDir = await this.scanDirectory(fullPath, maxDepth, currentDepth + 1);
          children.push(subDir);
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          children.push({
            name: entry.name,
            path: path.relative(this.projectPath, fullPath),
            type: 'file',
            size: Number(stats.size),
            extension: path.extname(entry.name)
          });
        }
      }
      
      return {
        name,
        path: relativePath || '.',
        type: 'directory',
        children
      };
    } catch (error) {
      return {
        name,
        path: relativePath || '.',
        type: 'directory',
        children: []
      };
    }
  }
  
  /**
   * Analyze tech stack from package.json and project files
   */
  private async analyzeTechStack(): Promise<TechStackInfo> {
    try {
      const packagePath = path.join(this.projectPath, 'package.json');
      const content = await safeReadFile(packagePath);
      const pkg = JSON.parse(content);
      
      // Get dependencies
      const prodDeps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      
      // Detect frameworks from dependencies
      const frameworks = this.detectFrameworks(prodDeps);
      
      // Detect tools
      const tools = this.detectTools([...prodDeps, ...devDeps]);
      
      // Count language files
      const languages = await this.countLanguages();
      
      return {
        languages,
        frameworks,
        tools,
        dependencies: {
          production: prodDeps,
          development: devDeps,
          total: prodDeps.length + devDeps.length
        }
      };
    } catch (error) {
      return {
        languages: [],
        frameworks: [],
        tools: [],
        dependencies: {
          production: [],
          development: [],
          total: 0
        }
      };
    }
  }
  
  /**
   * Count files and lines by language
   */
  private async countLanguages(): Promise<LanguageInfo[]> {
    const languageMap = new Map<string, { files: number; lines: number }>();
    
    try {
      const srcPath = path.join(this.projectPath, 'src');
      const files = await listFilesRecursive(srcPath, () => true);
      
      for (const file of files) {
        const ext = path.extname(file);
        const language = this.extensionToLanguage(ext);
        
        if (language) {
          try {
            const content = await safeReadFile(file);
            const lines = content.split('\n').length;
            
            const current = languageMap.get(language) || { files: 0, lines: 0 };
            languageMap.set(language, {
              files: current.files + 1,
              lines: current.lines + lines
            });
          } catch {
            // Skip files that can't be read
          }
        }
      }
      
      // Calculate total lines for percentages
      let totalLines = 0;
      for (const [, stats] of languageMap) {
        totalLines += stats.lines;
      }
      
      // Convert to array and calculate percentages
      const languages: LanguageInfo[] = [];
      for (const [name, stats] of languageMap) {
        languages.push({
          name,
          files: stats.files,
          lines: stats.lines,
          percentage: totalLines > 0 ? (stats.lines / totalLines) * 100 : 0
        });
      }
      
      // Sort by lines (descending)
      languages.sort((a, b) => b.lines - a.lines);
      
      return languages;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Detect frameworks from dependencies
   */
  private detectFrameworks(dependencies: string[]): string[] {
    const frameworkPatterns = [
      'react', 'vue', 'angular', 'svelte', 'next', 'nuxt',
      'express', 'fastify', 'koa', 'nest',
      'electron', 'react-native'
    ];
    
    return dependencies.filter(dep =>
      frameworkPatterns.some(pattern => dep.toLowerCase().includes(pattern))
    );
  }
  
  /**
   * Detect tools from dependencies
   */
  private detectTools(dependencies: string[]): string[] {
    const toolPatterns = [
      'typescript', 'webpack', 'vite', 'rollup', 'esbuild',
      'jest', 'mocha', 'vitest', 'playwright', 'cypress',
      'eslint', 'prettier', 'babel'
    ];
    
    return dependencies.filter(dep =>
      toolPatterns.some(pattern => dep.toLowerCase().includes(pattern))
    );
  }
  
  /**
   * Map file extension to language name
   */
  private extensionToLanguage(ext: string): string | null {
    const mapping: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.c': 'C',
      '.cpp': 'C++',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin'
    };
    
    return mapping[ext] || null;
  }
  
  /**
   * Check if directory should be skipped
   */
  private shouldSkipDirectory(name: string): boolean {
    const skipList = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      'coverage',
      '.cache',
      'tmp',
      'temp'
    ];
    
    return skipList.includes(name);
  }
  
  /**
   * Calculate project statistics
   */
  private calculateStatistics(structure: DirectoryNode): ProjectStatistics {
    let totalFiles = 0;
    let totalLines = 0;
    let totalSize = 0;
    let directoriesCount = 0;
    const languages = new Set<string>();
    
    const traverse = (node: DirectoryNode) => {
      if (node.type === 'directory') {
        directoriesCount++;
        if (node.children) {
          for (const child of node.children) {
            traverse(child);
          }
        }
      } else {
        totalFiles++;
        totalSize += node.size || 0;
        
        if (node.extension) {
          const language = this.extensionToLanguage(node.extension);
          if (language) languages.add(language);
        }
      }
    };
    
    traverse(structure);
    
    return {
      total_files: totalFiles,
      total_lines: totalLines,
      total_size: totalSize,
      languages_count: languages.size,
      directories_count: directoriesCount
    };
  }
}

