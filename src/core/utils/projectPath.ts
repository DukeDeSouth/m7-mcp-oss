/**
 * Project Path Resolution Utility
 * 
 * Determines the correct project path for M7 operations.
 * When M7 MCP server runs, it needs to operate on the user's workspace,
 * not on the M7 installation directory.
 * 
 * Priority:
 * 1. Explicit project_path on tool call (applyProjectPath — sticky for session)
 * 2. MCP Roots (lazy retry on tool calls, not only oninitialized)
 * 3. CURSOR_WORKSPACE / WORKSPACE_FOLDER_PATHS / AGENT_TRANSCRIPTS env
 * 4. Cursor projects dir scan (~/.cursor/projects/<slug> by activity mtime)
 * 5. M7_PROJECT_PATH (only after Roots retries exhausted)
 * 6. process.cwd() (warn if M7 installation dir or bare home)
 */

import { join, resolve, isAbsolute } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { silentLogger as logger } from './logger.js';

let cachedProjectPath: string | null = null;
let userExplicitProjectPath: string | null = null;
let resolvedFromRoots = false;
let rootsResolutionComplete = false;
let mcpServerRef: unknown = null;
let rootsChangeHandlerRegistered = false;

const ROOTS_TIMEOUT_MS = 8000;
const ROOTS_MAX_ATTEMPTS = 5;
let rootsAttemptCount = 0;

type WorkspaceChangeCallback = (oldPath: string | null, newPath: string) => void;
const onChangeCallbacks: WorkspaceChangeCallback[] = [];

export function onProjectPathChange(cb: WorkspaceChangeCallback): void {
  onChangeCallbacks.push(cb);
}

export function bindMcpServerForRoots(server: unknown): void {
  mcpServerRef = server;
  registerRootsChangeHandler(server);
}

function parseRootUri(uri: string): string | null {
  try {
    if (uri.startsWith('file://')) {
      return fileURLToPath(uri);
    }
  } catch {
    // invalid URI
  }
  return null;
}

function resolveExplicitProjectPath(explicitPath: string): string {
  const resolvedPath = isAbsolute(explicitPath)
    ? explicitPath
    : resolve(process.cwd(), explicitPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`[M7 ProjectPath] Path does not exist: ${resolvedPath}`);
  }

  return resolve(resolvedPath);
}

function isM7InstallationDirectory(dirPath: string): boolean {
  return existsSync(join(dirPath, 'src', 'index.ts'))
    && existsSync(join(dirPath, 'src', 'core', 'utils', 'projectPath.ts'));
}

function isBareHomeDirectory(dirPath: string): boolean {
  try {
    return resolve(dirPath) === resolve(homedir());
  } catch {
    return false;
  }
}

function isUnsafeFallbackPath(dirPath: string): boolean {
  return isBareHomeDirectory(dirPath) && !isValidProjectDirectory(dirPath);
}

function decodeCursorProjectSlug(slug: string): string | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;

  const home = resolve(homedir());
  // Cross-platform slug base: strip a leading POSIX root or a Windows drive
  // root ("C:\"), then turn every remaining separator into '-'.
  // POSIX-only replace(/\//g, '-') leaves backslashes intact on win32.
  const homeSlug = home
    .replace(/^(?:[A-Za-z]:)?[\\/]/, '')
    .replace(/[\\/]/g, '-');

  if (trimmed === homeSlug) {
    return isUnsafeFallbackPath(home) ? null : home;
  }

  if (trimmed.startsWith(`${homeSlug}-`)) {
    const relative = trimmed.slice(homeSlug.length + 1).split('-').join('/');
    const candidate = resolve(home, relative);
    if (existsSync(candidate) && !isUnsafeFallbackPath(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveWorkspaceFromAgentTranscriptsEnv(): string | null {
  const agentTranscripts = process.env.AGENT_TRANSCRIPTS;
  if (!agentTranscripts) return null;

  const match = agentTranscripts.match(/[/\\]\.cursor[/\\]projects[/\\]([^/\\]+)/);
  if (!match) return null;

  const decoded = decodeCursorProjectSlug(match[1]);
  if (decoded) {
    logger.info(`[M7 ProjectPath] Decoded workspace from AGENT_TRANSCRIPTS slug: ${decoded}`);
  }
  return decoded;
}

function getCursorProjectsDir(): string {
  return process.env.CURSOR_PROJECTS_DIR || join(homedir(), '.cursor', 'projects');
}

function getCursorProjectActivityMtime(projectDir: string): number {
  const transcriptsDir = join(projectDir, 'agent-transcripts');
  if (!existsSync(transcriptsDir)) {
    try {
      return statSync(projectDir).mtimeMs;
    } catch {
      return 0;
    }
  }

  let maxMtime = 0;
  try {
    maxMtime = statSync(transcriptsDir).mtimeMs;
    for (const entry of readdirSync(transcriptsDir, { withFileTypes: true })) {
      const fullPath = join(transcriptsDir, entry.name);
      try {
        const mtime = statSync(fullPath).mtimeMs;
        if (mtime > maxMtime) maxMtime = mtime;
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    return 0;
  }

  return maxMtime;
}

function resolveWorkspaceFromCursorProjectsDir(): string | null {
  const projectsDir = getCursorProjectsDir();
  if (!existsSync(projectsDir)) return null;

  let best: { path: string; mtime: number } | null = null;

  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const decoded = decodeCursorProjectSlug(entry.name);
    if (!decoded || !existsSync(decoded) || isUnsafeFallbackPath(decoded)) continue;

    const projectMetaDir = join(projectsDir, entry.name);
    const mtime = getCursorProjectActivityMtime(projectMetaDir);
    if (mtime <= 0) continue;

    // Active Cursor session is enough — empty/new folders may lack package.json/.git.
    if (!best || mtime > best.mtime) {
      best = { path: decoded, mtime };
    }
  }

  if (best) {
    logger.info(`[M7 ProjectPath] Resolved from Cursor projects dir: ${best.path}`);
    return best.path;
  }

  return null;
}

function pickBestWorkspaceCandidate(candidates: string[]): string | null {
  const normalized = candidates
    .filter(Boolean)
    .map(candidate => resolve(candidate))
    .filter((candidate, index, all) => all.indexOf(candidate) === index);

  for (const candidate of normalized) {
    if (!existsSync(candidate) || isUnsafeFallbackPath(candidate)) continue;
    if (isValidProjectDirectory(candidate)) return candidate;
  }

  for (const candidate of normalized) {
    if (!existsSync(candidate) || isUnsafeFallbackPath(candidate)) continue;
    if (isM7InstallationDirectory(candidate)) return candidate;
  }

  for (const candidate of normalized) {
    if (!existsSync(candidate) || isUnsafeFallbackPath(candidate)) continue;
    return candidate;
  }

  return null;
}

function resolveCursorWorkspaceFromEnv(): string | null {
  const cursorWorkspace = process.env.CURSOR_WORKSPACE;
  if (cursorWorkspace && existsSync(cursorWorkspace)) {
    return cursorWorkspace;
  }

  const workspaceFolders = process.env.WORKSPACE_FOLDER_PATHS;
  if (workspaceFolders) {
    try {
      const folders = JSON.parse(workspaceFolders) as string[];
      const best = pickBestWorkspaceCandidate(folders);
      if (best) return best;
    } catch {
      if (existsSync(workspaceFolders)) {
        const best = pickBestWorkspaceCandidate([workspaceFolders]);
        if (best) return best;
      }
    }
  }

  const fromAgentTranscripts = resolveWorkspaceFromAgentTranscriptsEnv();
  if (fromAgentTranscripts) {
    return fromAgentTranscripts;
  }

  const fromProjectsDir = resolveWorkspaceFromCursorProjectsDir();
  if (fromProjectsDir) {
    return fromProjectsDir;
  }

  return null;
}

function resolveEnvFallbackPath(allowCache: boolean): string {
  const cursorPath = resolveCursorWorkspaceFromEnv();
  if (cursorPath) {
    if (allowCache) {
      logger.info(`[M7 ProjectPath] Using Cursor workspace env: ${cursorPath}`);
      cachedProjectPath = cursorPath;
    }
    return cursorPath;
  }

  if (rootsResolutionComplete) {
    const m7ProjectPath = process.env.M7_PROJECT_PATH;
    if (m7ProjectPath && existsSync(m7ProjectPath)) {
      if (allowCache) {
        logger.info(`[M7 ProjectPath] Using M7_PROJECT_PATH: ${m7ProjectPath}`);
        cachedProjectPath = m7ProjectPath;
      }
      return m7ProjectPath;
    }
  }

  const cwd = process.cwd();
  const candidates = pickBestWorkspaceCandidate([cwd]) ?? cwd;

  if (isUnsafeFallbackPath(candidates)) {
    const fromProjectsDir = resolveWorkspaceFromCursorProjectsDir();
    if (fromProjectsDir) {
      if (allowCache) {
        cachedProjectPath = fromProjectsDir;
      }
      logger.info(`[M7 ProjectPath] Using Cursor projects dir instead of home: ${fromProjectsDir}`);
      return fromProjectsDir;
    }

    if (rootsResolutionComplete) {
      logger.warn(`[M7 ProjectPath] Refusing bare home directory fallback (${candidates}). Pass project_path or open a workspace folder.`);
    } else {
      logger.info(`[M7 ProjectPath] Awaiting MCP Roots — home directory fallback blocked (${candidates})`);
    }
    return candidates;
  }

  const bestCwd = candidates;

  if (isM7InstallationDirectory(bestCwd)) {
    if (rootsResolutionComplete) {
      logger.warn(`[M7 ProjectPath] Running from M7 installation directory! Set workspace via MCP Roots or project_path.`);
    } else {
      logger.info(`[M7 ProjectPath] Awaiting MCP Roots before env fallback (cwd: ${bestCwd})`);
    }
  } else if (allowCache) {
    logger.info(`[M7 ProjectPath] Using process.cwd(): ${bestCwd}`);
  }

  if (allowCache && !isUnsafeFallbackPath(bestCwd)) {
    cachedProjectPath = bestCwd;
  }

  return bestCwd;
}

function notifyChange(oldPath: string | null, newPath: string): void {
  for (const cb of onChangeCallbacks) {
    try { cb(oldPath, newPath); } catch { /* non-critical */ }
  }
}

function applyResolvedWorkspace(workspacePath: string, fromRoots: boolean): string {
  const oldPath = cachedProjectPath;
  cachedProjectPath = resolve(workspacePath);
  resolvedFromRoots = fromRoots;
  logger.info(`[M7 ProjectPath] ${fromRoots ? 'Resolved from MCP Roots' : 'Resolved workspace'}: ${cachedProjectPath}`);
  if (oldPath && oldPath !== cachedProjectPath) {
    notifyChange(oldPath, cachedProjectPath);
  }
  return cachedProjectPath;
}

export function markRootsResolutionComplete(): void {
  rootsResolutionComplete = true;
}

export function isRootsResolutionComplete(): boolean {
  return rootsResolutionComplete;
}

export function applyProjectPath(path: string): string {
  const resolved = resolveExplicitProjectPath(path);
  const oldPath = cachedProjectPath;

  userExplicitProjectPath = resolved;
  cachedProjectPath = resolved;
  resolvedFromRoots = false;
  logger.info(`[M7 ProjectPath] Explicitly set to: ${cachedProjectPath}`);

  if (oldPath !== resolved) {
    notifyChange(oldPath, resolved);
  }

  return resolved;
}

export async function fetchWorkspaceFromMcpRoots(server?: unknown): Promise<string | null> {
  const mcpServer = server ?? mcpServerRef;
  if (!mcpServer) return null;
  if (rootsAttemptCount >= ROOTS_MAX_ATTEMPTS && !resolvedFromRoots) {
    return null;
  }

  try {
    const underlying = (mcpServer as any).server || mcpServer;
    rootsAttemptCount++;
    const result = await underlying.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS });

    if (result?.roots?.length > 0) {
      const rootPaths = result.roots
        .map((root: { uri: string }) => parseRootUri(root.uri))
        .filter((workspacePath: string | null): workspacePath is string => Boolean(workspacePath));
      const workspacePath = pickBestWorkspaceCandidate(rootPaths);
      if (workspacePath) {
        return applyResolvedWorkspace(workspacePath, true);
      }
    }
  } catch (err: any) {
    const isTimeout = err?.code === -32001;
    logger.info(`[M7 ProjectPath] Roots attempt ${rootsAttemptCount}/${ROOTS_MAX_ATTEMPTS} ${isTimeout ? 'timed out' : 'failed'}: ${err.message}`);
  }

  return null;
}

function registerRootsChangeHandler(mcpServer: unknown): void {
  if (rootsChangeHandlerRegistered) return;
  rootsChangeHandlerRegistered = true;

  try {
    const underlying = (mcpServer as any).server || mcpServer;
    underlying.setNotificationHandler?.({ method: 'notifications/roots/list_changed' }, async () => {
      logger.info('[M7 ProjectPath] Roots changed notification received');
      resolvedFromRoots = false;
      userExplicitProjectPath = null;
      rootsAttemptCount = 0;
      const oldPath = cachedProjectPath;
      cachedProjectPath = null;
      await fetchWorkspaceFromMcpRoots(mcpServer);
      if (oldPath && cachedProjectPath && oldPath !== cachedProjectPath) {
        notifyChange(oldPath, cachedProjectPath);
      }
    });
  } catch {
    // Client may not support notifications
  }
}

/**
 * Resolve active project path for tool handlers.
 * Retries MCP Roots at tool time (fixes oninitialized race).
 */
export async function ensureProjectPathResolved(server?: unknown): Promise<string> {
  if (userExplicitProjectPath) {
    return userExplicitProjectPath;
  }

  if (cachedProjectPath && resolvedFromRoots) {
    return cachedProjectPath;
  }

  const rootsPath = await fetchWorkspaceFromMcpRoots(server);
  if (rootsPath) {
    markRootsResolutionComplete();
    return rootsPath;
  }

  const cursorPath = resolveCursorWorkspaceFromEnv();
  if (cursorPath) {
    applyResolvedWorkspace(cursorPath, false);
    markRootsResolutionComplete();
    return cursorPath;
  }

  if (rootsAttemptCount >= ROOTS_MAX_ATTEMPTS || rootsResolutionComplete) {
    if (!rootsResolutionComplete) {
      markRootsResolutionComplete();
    }
    return getProjectPath();
  }

  // Still waiting for roots — return best-effort without caching M7_PROJECT_PATH
  return resolveEnvFallbackPath(false);
}

export async function initFromMcpRoots(mcpServer: any): Promise<string | null> {
  bindMcpServerForRoots(mcpServer);
  const rootsPath = await fetchWorkspaceFromMcpRoots(mcpServer);
  if (rootsPath) {
    markRootsResolutionComplete();
    return rootsPath;
  }
  // Do NOT cache env fallback here — tool calls will retry Roots
  return null;
}

export function getProjectPath(explicitPath?: string): string {
  if (explicitPath) {
    try {
      return resolveExplicitProjectPath(explicitPath);
    } catch (err) {
      logger.warn(`[M7 ProjectPath] ${err instanceof Error ? err.message : 'Invalid explicit path'}, falling back...`);
    }
  }

  if (userExplicitProjectPath) {
    return userExplicitProjectPath;
  }

  if (cachedProjectPath) {
    return cachedProjectPath;
  }

  return resolveEnvFallbackPath(rootsResolutionComplete);
}

export function clearProjectPathCache(): void {
  cachedProjectPath = null;
  userExplicitProjectPath = null;
}

export function setProjectPath(path: string): void {
  applyProjectPath(path);
}

export function resetProjectPathStateForTests(): void {
  cachedProjectPath = null;
  userExplicitProjectPath = null;
  resolvedFromRoots = false;
  rootsResolutionComplete = false;
  mcpServerRef = null;
  rootsChangeHandlerRegistered = false;
  rootsAttemptCount = 0;
}

export function getProjectPathDiagnostics(): {
  currentPath: string;
  source: string;
  resolvedFromRoots: boolean;
  rootsResolutionComplete: boolean;
  userExplicitProjectPath: string | null;
  rootsAttemptCount: number;
  cursorWorkspace?: string;
  m7ProjectPath?: string;
  agentTranscripts?: string;
  processCwd: string;
  isSelfDirectory: boolean;
  isUnsafeFallback: boolean;
} {
  const cwd = process.cwd();
  const cursorWorkspace = process.env.CURSOR_WORKSPACE;
  const m7ProjectPath = process.env.M7_PROJECT_PATH;
  const agentTranscripts = process.env.AGENT_TRANSCRIPTS;
  const isSelfDirectory = isM7InstallationDirectory(cwd);

  let source: string;
  let currentPath: string;

  if (userExplicitProjectPath) {
    currentPath = userExplicitProjectPath;
    source = 'explicit project_path';
  } else if (resolvedFromRoots && cachedProjectPath) {
    currentPath = cachedProjectPath;
    source = 'MCP Roots';
  } else if (cachedProjectPath) {
    currentPath = cachedProjectPath;
    source = 'cached';
  } else if (resolveCursorWorkspaceFromEnv()) {
    currentPath = resolveCursorWorkspaceFromEnv()!;
    const fromProjectsDir = resolveWorkspaceFromCursorProjectsDir();
    source = fromProjectsDir && currentPath === fromProjectsDir
      ? 'Cursor projects dir'
      : process.env.AGENT_TRANSCRIPTS
        ? 'AGENT_TRANSCRIPTS'
        : 'CURSOR env';
  } else if (rootsResolutionComplete && m7ProjectPath && existsSync(m7ProjectPath)) {
    currentPath = m7ProjectPath;
    source = 'M7_PROJECT_PATH';
  } else {
    currentPath = cwd;
    source = rootsResolutionComplete ? 'process.cwd()' : 'awaiting MCP Roots';
  }

  return {
    currentPath,
    source,
    resolvedFromRoots,
    rootsResolutionComplete,
    userExplicitProjectPath,
    rootsAttemptCount,
    cursorWorkspace,
    m7ProjectPath,
    agentTranscripts,
    processCwd: cwd,
    isSelfDirectory,
    isUnsafeFallback: isUnsafeFallbackPath(currentPath)
  };
}

export function isValidProjectDirectory(projectPath: string): boolean {
  if (!existsSync(projectPath)) {
    return false;
  }

  const indicators = [
    'package.json',
    '.git',
    'tsconfig.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml'
  ];

  return indicators.some(indicator =>
    existsSync(join(projectPath, indicator))
  );
}

export function getProjectRelativePath(
  absolutePath: string,
  projectPath?: string
): string {
  const base = projectPath || getProjectPath();
  const relative = absolutePath.startsWith(base)
    ? absolutePath.slice(base.length + 1)
    : absolutePath;

  return relative.startsWith('/') ? relative.slice(1) : relative;
}

export function resolveProjectPath(
  path: string,
  projectPath?: string
): string {
  const base = projectPath || getProjectPath();

  if (isAbsolute(path)) {
    if (!path.startsWith(base)) {
      logger.warn(`[M7 ProjectPath] Path is outside project: ${path}`);
    }
    return path;
  }

  return join(base, path);
}
