/**
 * Documentation Scanner
 * Scans and analyzes existing documentation files
 */

import * as path from 'path';
import { listFilesRecursive, safeReadFile } from '../utils/fileUtils.js';
import { ScanResult } from '../types.js';

export interface DocumentationItem {
  path: string;
  name: string;
  title: string;
  size: number;
  lines: number;
  sections: Section[];
  links: Link[];
  codeBlocks: CodeBlock[];
  lastModified: Date;
}

export interface Section {
  level: number;
  title: string;
  line: number;
  content: string;
}

export interface Link {
  text: string;
  url: string;
  line: number;
}

export interface CodeBlock {
  language: string;
  code: string;
  line: number;
}

export interface DocumentationScanData {
  documents: DocumentationItem[];
  total_files: number;
  total_size: number;
  total_lines: number;
}

export class DocumentationScanner {
  constructor(private projectPath: string) {}
  
  /**
   * Scan all markdown documentation files
   */
  async scan(): Promise<ScanResult<DocumentationScanData>> {
    const startTime = Date.now();
    
    try {
      // Find all .md files
      const mdFiles = await listFilesRecursive(this.projectPath, (file) => 
        file.endsWith('.md') && !file.includes('node_modules')
      );
      
      // Analyze each file
      const documents: DocumentationItem[] = [];
      let totalSize = 0;
      let totalLines = 0;
      
      for (const file of mdFiles) {
        const doc = await this.analyzeDocument(file);
        if (doc) {
          documents.push(doc);
          totalSize += doc.size;
          totalLines += doc.lines;
        }
      }
      
      const scanTime = Date.now() - startTime;
      
      return {
        success: true,
        data: {
          documents,
          total_files: documents.length,
          total_size: totalSize,
          total_lines: totalLines
        },
        timestamp: new Date(),
        scan_time_ms: scanTime
      };
    } catch (error: any) {
      return {
        success: false,
        data: {
          documents: [],
          total_files: 0,
          total_size: 0,
          total_lines: 0
        },
        timestamp: new Date(),
        scan_time_ms: Date.now() - startTime,
        errors: [error.message]
      };
    }
  }
  
  /**
   * Analyze a single markdown document
   */
  private async analyzeDocument(filePath: string): Promise<DocumentationItem | null> {
    try {
      const content = await safeReadFile(filePath);
      const lines = content.split('\n');
      
      // Extract title (first H1)
      const title = this.extractTitle(content);
      
      // Extract sections
      const sections = this.extractSections(content);
      
      // Extract links
      const links = this.extractLinks(content);
      
      // Extract code blocks
      const codeBlocks = this.extractCodeBlocks(content);
      
      // Get file stats
      const fs = await import('fs/promises');
      const stats = await fs.stat(filePath);
      
      return {
        path: path.relative(this.projectPath, filePath),
        name: path.basename(filePath),
        title: title || path.basename(filePath, '.md'),
        size: Number(stats.size),
        lines: lines.length,
        sections,
        links,
        codeBlocks,
        lastModified: stats.mtime
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract title from markdown content
   */
  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }
  
  /**
   * Extract all sections (headings)
   */
  private extractSections(content: string): Section[] {
    const sections: Section[] = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();
        
        // Get content until next heading of same or higher level
        const contentLines: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          const nextMatch = nextLine.match(/^(#{1,6})\s+/);
          
          if (nextMatch && nextMatch[1].length <= level) {
            break;
          }
          
          contentLines.push(nextLine);
        }
        
        sections.push({
          level,
          title,
          line: i + 1,
          content: contentLines.join('\n').trim()
        });
      }
    }
    
    return sections;
  }
  
  /**
   * Extract all links
   */
  private extractLinks(content: string): Link[] {
    const links: Link[] = [];
    const lines = content.split('\n');
    
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      
      while ((match = linkRegex.exec(line)) !== null) {
        links.push({
          text: match[1],
          url: match[2],
          line: i + 1
        });
      }
    }
    
    return links;
  }
  
  /**
   * Extract all code blocks
   */
  private extractCodeBlocks(content: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    const lines = content.split('\n');
    
    let inCodeBlock = false;
    let language = '';
    let codeLines: string[] = [];
    let startLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          // Start of code block
          inCodeBlock = true;
          language = line.substring(3).trim();
          codeLines = [];
          startLine = i + 1;
        } else {
          // End of code block
          inCodeBlock = false;
          codeBlocks.push({
            language,
            code: codeLines.join('\n'),
            line: startLine
          });
        }
      } else if (inCodeBlock) {
        codeLines.push(line);
      }
    }
    
    return codeBlocks;
  }
}

