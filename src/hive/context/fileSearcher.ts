/**
 * M7 Hive - File Searcher
 * 
 * Searches for relevant files using ripgrep.
 * 
 * @version 3.8.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeContextOptions, RelevantFile, DEFAULT_CODE_CONTEXT_OPTIONS } from './types.js';

const execAsync = promisify(exec);

/**
 * Search for files containing keyword using grep
 */
async function grepForKeyword(
  projectPath: string,
  keyword: string,
  options: CodeContextOptions
): Promise<Array<{ path: string; matchCount: number; lines: number[] }>> {
  
  // Build exclude pattern for grep
  const excludeDirs = options.excludePatterns
    .filter(p => !p.includes('*'))
    .map(p => `--exclude-dir="${p}"`)
    .join(' ');
  
  const excludeFiles = options.excludePatterns
    .filter(p => p.includes('*'))
    .map(p => `--exclude="${p}"`)
    .join(' ');
  
  // Build include pattern
  const includePatterns = options.includeExtensions.length > 0
    ? options.includeExtensions.map(e => `--include="*${e}"`).join(' ')
    : '--include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx"';
  
  try {
    // Use grep to find files with match counts
    const cmd = `grep -r -c -i "${keyword}" ${excludeDirs} ${excludeFiles} ${includePatterns} "${projectPath}" 2>/dev/null || true`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    
    if (!stdout.trim()) {
      return [];
    }
    
    // Parse grep output: file:count
    return stdout
      .trim()
      .split('\n')
      .filter(line => line.includes(':'))
      .map(line => {
        const lastColon = line.lastIndexOf(':');
        const filePath = line.substring(0, lastColon);
        const count = parseInt(line.substring(lastColon + 1), 10);
        return {
          path: filePath,
          matchCount: isNaN(count) ? 1 : count,
          lines: []
        };
      })
      .filter(f => f.matchCount > 0 && !f.path.includes('node_modules') && !f.path.includes('/dist/'));
      
  } catch (error) {
    // Silently handle errors
    return [];
  }
}

/**
 * Read file snippet around matches
 */
async function readFileSnippet(
  filePath: string,
  keyword: string,
  maxLines: number
): Promise<{ snippet: string; lines: { start: number; end: number } }> {
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Find first match line
    const keywordLower = keyword.toLowerCase();
    let matchLine = lines.findIndex(l => l.toLowerCase().includes(keywordLower));
    
    if (matchLine === -1) {
      matchLine = 0;
    }
    
    // Calculate range (centered on match)
    const halfRange = Math.floor(maxLines / 2);
    let start = Math.max(0, matchLine - halfRange);
    let end = Math.min(lines.length, start + maxLines);
    
    // Adjust if at end of file
    if (end === lines.length && end - start < maxLines) {
      start = Math.max(0, end - maxLines);
    }
    
    const snippet = lines.slice(start, end).join('\n');
    
    return {
      snippet,
      lines: { start: start + 1, end: end } // 1-indexed
    };
    
  } catch (error) {
    return {
      snippet: '',
      lines: { start: 0, end: 0 }
    };
  }
}

/**
 * Get language from file extension
 */
function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.md': 'markdown',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sql': 'sql',
    '.sh': 'bash',
    '.bash': 'bash'
  };
  return langMap[ext] || 'text';
}

/**
 * Search for relevant files based on keywords
 */
export async function searchRelevantFiles(
  projectPath: string,
  keywords: string[],
  options: Partial<CodeContextOptions> = {}
): Promise<RelevantFile[]> {
  
  const opts: CodeContextOptions = { ...DEFAULT_CODE_CONTEXT_OPTIONS, ...options, projectPath };
  const fileScores: Map<string, { matchCount: number; keywords: Set<string> }> = new Map();
  
  // Search for each keyword
  for (const keyword of keywords.slice(0, 5)) { // Limit to top 5 keywords
    const matches = await grepForKeyword(projectPath, keyword, opts);
    
    for (const match of matches) {
      const existing = fileScores.get(match.path);
      if (existing) {
        existing.matchCount += match.matchCount;
        existing.keywords.add(keyword);
      } else {
        fileScores.set(match.path, {
          matchCount: match.matchCount,
          keywords: new Set([keyword])
        });
      }
    }
  }
  
  // Convert to RelevantFile array with snippets
  const results: RelevantFile[] = [];
  
  // Sort by score (match count + keyword diversity)
  const sortedFiles = Array.from(fileScores.entries())
    .map(([filePath, data]) => ({
      path: filePath,
      score: data.matchCount + (data.keywords.size * 5), // Boost files matching multiple keywords
      keywords: data.keywords
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.maxFiles);
  
  // Read snippets for top files
  for (const file of sortedFiles) {
    const primaryKeyword = Array.from(file.keywords)[0];
    const { snippet, lines } = await readFileSnippet(file.path, primaryKeyword, opts.maxLinesPerFile);
    
    if (snippet.trim()) {
      results.push({
        path: file.path,
        relativePath: path.relative(projectPath, file.path),
        relevance: Math.min(1, file.score / 20), // Normalize to 0-1
        matchCount: file.score,
        snippet,
        language: getLanguageFromPath(file.path),
        lines
      });
    }
  }
  
  return results;
}
