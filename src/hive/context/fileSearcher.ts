import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeContextOptions, RelevantFile, DEFAULT_CODE_CONTEXT_OPTIONS } from './types.js';

const execFileAsync = promisify(execFile);

function buildGrepArgs(
  projectPath: string,
  keyword: string,
  options: CodeContextOptions,
): string[] {
  const args = ['-r', '-c', '-i', '-e', keyword];

  for (const pattern of options.excludePatterns) {
    if (pattern.includes('*')) {
      args.push('--exclude', pattern);
    } else {
      args.push('--exclude-dir', pattern);
    }
  }

  const extensions =
    options.includeExtensions.length > 0
      ? options.includeExtensions
      : ['.ts', '.js', '.tsx', '.jsx'];

  for (const ext of extensions) {
    args.push('--include', `*${ext}`);
  }

  args.push('--', projectPath);
  return args;
}

/**
 * Search for files containing keyword using grep (argv array — HYG-3).
 */
async function grepForKeyword(
  projectPath: string,
  keyword: string,
  options: CodeContextOptions
): Promise<Array<{ path: string; matchCount: number; lines: number[] }>> {
  const args = buildGrepArgs(projectPath, keyword, options);

  try {
    const { stdout } = await execFileAsync('grep', args, {
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) {
      return [];
    }

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

  } catch (error: unknown) {
    const err = error as { code?: number | string };
    if (err.code === 1) {
      return [];
    }
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
    
    const keywordLower = keyword.toLowerCase();
    let matchLine = lines.findIndex(l => l.toLowerCase().includes(keywordLower));
    
    if (matchLine === -1) {
      matchLine = 0;
    }
    
    const halfRange = Math.floor(maxLines / 2);
    let start = Math.max(0, matchLine - halfRange);
    let end = Math.min(lines.length, start + maxLines);
    
    if (end === lines.length && end - start < maxLines) {
      start = Math.max(0, end - maxLines);
    }
    
    const snippet = lines.slice(start, end).join('\n');
    
    return {
      snippet,
      lines: { start: start + 1, end: end }
    };
    
  } catch {
    return {
      snippet: '',
      lines: { start: 0, end: 0 }
    };
  }
}

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

export async function searchRelevantFiles(
  projectPath: string,
  keywords: string[],
  options: Partial<CodeContextOptions> = {}
): Promise<RelevantFile[]> {
  
  const opts: CodeContextOptions = { ...DEFAULT_CODE_CONTEXT_OPTIONS, ...options, projectPath };
  const fileScores: Map<string, { matchCount: number; keywords: Set<string> }> = new Map();
  
  for (const keyword of keywords.slice(0, 5)) {
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
  
  const results: RelevantFile[] = [];
  
  const sortedFiles = Array.from(fileScores.entries())
    .map(([filePath, data]) => ({
      path: filePath,
      score: data.matchCount + (data.keywords.size * 5),
      keywords: data.keywords
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.maxFiles);
  
  for (const file of sortedFiles) {
    const primaryKeyword = Array.from(file.keywords)[0];
    const { snippet, lines } = await readFileSnippet(file.path, primaryKeyword, opts.maxLinesPerFile);
    
    if (snippet.trim()) {
      results.push({
        path: file.path,
        relativePath: path.relative(projectPath, file.path),
        relevance: Math.min(1, file.score / 20),
        matchCount: file.score,
        snippet,
        language: getLanguageFromPath(file.path),
        lines
      });
    }
  }
  
  return results;
}

/** @internal tests — HYG-3 */
export async function grepForKeywordTestHarness(
  projectPath: string,
  keyword: string,
  options: Partial<CodeContextOptions> = {},
) {
  const opts: CodeContextOptions = { ...DEFAULT_CODE_CONTEXT_OPTIONS, ...options, projectPath };
  return grepForKeyword(projectPath, keyword, opts);
}
