/**
 * M7 Git Capture Module v3.12
 * Captures git diffs during M7 sessions for telemetry
 * 
 * Captures diffs at two points:
 * 1. On-demand via collectCurrentDiff() — called by M7 tools
 * 2. Post-commit via watchForCommits() — polls for new commits
 * 
 * All diffs are sanitized before collection.
 * Requires consent tier 3 (code_diffs enabled).
 * 
 * @module telemetry/gitCapture
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { createLogger } from '../core/utils/logger.js';
import { getTelemetryCollector } from './collector.js';
import { redactSecrets, anonymizePaths } from './sanitizer.js';

const log = createLogger('[GitCapture]');

// Max diff size to collect (chars)
const MAX_DIFF_SIZE = 50000;
// Max commit message length
const MAX_COMMIT_MSG = 500;
// Files to always exclude from diffs
const EXCLUDED_PATTERNS = [
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.wasm',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg',
  '*.woff', '*.woff2', '*.ttf', '*.eot',
  '*.pdf', '*.zip', '*.tar.gz',
  '.env*',
  '*.db', '*.sqlite',
  'node_modules/*',
  '.git/*',
  '.m7/*',
];

/**
 * Run a git command in the specified directory, return stdout or null on error
 */
function git(cmd: string, cwd?: string): string | null {
  try {
    return execSync(`git ${cmd}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if current directory is a git repo
 */
export function isGitRepo(cwd?: string): boolean {
  return git('rev-parse --is-inside-work-tree', cwd) === 'true';
}

/**
 * Get a privacy-safe hash of the repo identity
 * Hashes the remote URL so we can correlate events without revealing the actual repo
 */
export function getRepoHash(cwd?: string): string {
  const remote = git('config --get remote.origin.url', cwd);
  if (!remote) return 'local-repo';
  return createHash('sha256').update(remote).digest('hex').substring(0, 16);
}

/**
 * Get current branch name
 */
export function getCurrentBranch(cwd?: string): string | null {
  return git('rev-parse --abbrev-ref HEAD', cwd);
}

/**
 * Get the latest commit hash (short)
 */
export function getLatestCommitHash(cwd?: string): string | null {
  return git('rev-parse --short=8 HEAD', cwd);
}

/**
 * Detect languages from changed file extensions
 */
function detectLanguages(files: string[]): string[] {
  const extMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.rb': 'ruby',
    '.php': 'php',
    '.css': 'css', '.scss': 'scss',
    '.html': 'html',
    '.md': 'markdown',
    '.json': 'json',
    '.yaml': 'yaml', '.yml': 'yaml',
    '.sql': 'sql',
    '.sh': 'shell',
  };
  
  const langs = new Set<string>();
  for (const file of files) {
    const ext = file.substring(file.lastIndexOf('.'));
    if (extMap[ext]) langs.add(extMap[ext]);
  }
  return [...langs];
}

/**
 * Build exclude args for git diff
 */
function buildExcludeArgs(): string {
  return EXCLUDED_PATTERNS.map(p => `':(exclude)${p}'`).join(' ');
}

/**
 * Sanitize a diff string — remove secrets, anonymize paths, truncate
 */
function sanitizeDiff(diff: string): string {
  let sanitized = redactSecrets(diff);
  sanitized = anonymizePaths(sanitized);
  
  if (sanitized.length > MAX_DIFF_SIZE) {
    const truncPoint = sanitized.lastIndexOf('\n', MAX_DIFF_SIZE);
    sanitized = sanitized.substring(0, truncPoint > 0 ? truncPoint : MAX_DIFF_SIZE);
    sanitized += '\n... [diff truncated]';
  }
  
  return sanitized;
}

/**
 * Capture the diff from the last commit
 */
export function captureLastCommitDiff(cwd?: string): {
  diff: string;
  files_changed: number;
  additions: number;
  deletions: number;
  languages: string[];
  commit_hash: string | null;
  commit_message: string | null;
} | null {
  if (!isGitRepo(cwd)) return null;
  
  const excludes = buildExcludeArgs();
  
  // Get diff from last commit
  const diff = git(`show HEAD --format="" --patch -- . ${excludes}`, cwd);
  if (!diff) return null;
  
  // Get numstat for additions/deletions
  const numstat = git(`show HEAD --format="" --numstat -- . ${excludes}`, cwd);
  let additions = 0;
  let deletions = 0;
  const files: string[] = [];
  
  if (numstat) {
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const add = parseInt(parts[0]) || 0;
        const del = parseInt(parts[1]) || 0;
        additions += add;
        deletions += del;
        files.push(parts[2]);
      }
    }
  }
  
  const commitHash = getLatestCommitHash(cwd);
  const commitMsg = git('log -1 --format=%s', cwd);
  
  return {
    diff: sanitizeDiff(diff),
    files_changed: files.length,
    additions,
    deletions,
    languages: detectLanguages(files),
    commit_hash: commitHash,
    commit_message: commitMsg ? commitMsg.substring(0, MAX_COMMIT_MSG) : null,
  };
}

/**
 * Capture current staged diff (before commit)
 */
export function captureStagedDiff(cwd?: string): {
  diff: string;
  files_changed: number;
  additions: number;
  deletions: number;
  languages: string[];
} | null {
  if (!isGitRepo(cwd)) return null;
  
  const excludes = buildExcludeArgs();
  
  const diff = git(`diff --cached -- . ${excludes}`, cwd);
  if (!diff) return null;
  
  const numstat = git(`diff --cached --numstat -- . ${excludes}`, cwd);
  let additions = 0;
  let deletions = 0;
  const files: string[] = [];
  
  if (numstat) {
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        additions += parseInt(parts[0]) || 0;
        deletions += parseInt(parts[1]) || 0;
        files.push(parts[2]);
      }
    }
  }
  
  return {
    diff: sanitizeDiff(diff),
    files_changed: files.length,
    additions,
    deletions,
    languages: detectLanguages(files),
  };
}

/**
 * Collect the last commit as a code_diff telemetry event
 * Call this after a git commit during an M7 session
 */
export function collectLastCommitDiff(cwd?: string): boolean {
  const collector = getTelemetryCollector();
  
  if (!collector.isEnabled() || !collector.isEventTypeEnabled('code_diff')) {
    return false;
  }
  
  const data = captureLastCommitDiff(cwd);
  if (!data || !data.diff || data.files_changed === 0) {
    return false;
  }
  
  const repoHash = getRepoHash(cwd);
  const branch = getCurrentBranch(cwd);
  
  collector.collectCodeDiff(
    {
      unified_diff: data.diff,
      files_changed: data.files_changed,
      additions: data.additions,
      deletions: data.deletions,
      languages: data.languages,
    },
    data.commit_hash ? {
      hash: data.commit_hash,
      message: data.commit_message || '',
      repo_hash: repoHash,
      branch: branch || undefined,
    } : undefined
  );
  
  log.debug(`Collected diff: ${data.files_changed} files, +${data.additions}/-${data.deletions}`);
  return true;
}

/**
 * Git commit watcher — polls for new commits and auto-captures diffs
 * Only active when telemetry is enabled with code_diffs consent
 */
export class GitCommitWatcher {
  private lastKnownHead: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private cwd: string;
  private pollIntervalMs: number;

  constructor(cwd?: string, pollIntervalMs: number = 30000) {
    this.cwd = cwd || process.cwd();
    this.pollIntervalMs = pollIntervalMs;
    this.lastKnownHead = getLatestCommitHash(this.cwd);
  }

  /**
   * Start watching for new commits
   */
  start(): void {
    if (this.pollTimer) return;
    if (!isGitRepo(this.cwd)) {
      log.debug('Not a git repo, skipping commit watcher');
      return;
    }
    
    this.pollTimer = setInterval(() => {
      this.checkForNewCommit();
    }, this.pollIntervalMs);
    
    log.debug(`Git commit watcher started (polling every ${this.pollIntervalMs}ms)`);
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Check if HEAD has changed (new commit)
   */
  private checkForNewCommit(): void {
    const currentHead = getLatestCommitHash(this.cwd);
    
    if (currentHead && currentHead !== this.lastKnownHead) {
      log.debug(`New commit detected: ${this.lastKnownHead} → ${currentHead}`);
      this.lastKnownHead = currentHead;
      
      // Auto-capture the diff
      collectLastCommitDiff(this.cwd);
    }
  }
}
