/**
 * M7 Doctor Tool v1.0
 * 
 * Диагностика и автоматическое исправление проблем с .m7/ директорией.
 * Запуск: @m7 doctor
 * 
 * @version 1.0.0
 * @since M7 v3.10.2
 */

import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '../utils/logger.js';
import { getProjectPath, applyProjectPath, ensureProjectPathResolved, getProjectPathDiagnostics } from '../utils/projectPath.js';
import { safeReadJSON, listBackups, restoreFromBackup } from '../utils/atomicWrite.js';

const log = createLogger('[Doctor]');

// ============================================================================
// Types
// ============================================================================

export interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  autoFixable: boolean;
  fixed?: boolean;
  details?: string;
}

export interface DoctorReport {
  timestamp: string;
  projectPath: string;
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    fixed: number;
  };
  checks: CheckResult[];
  recommendations: string[];
}

// ============================================================================
// Schema
// ============================================================================

export const DoctorToolSchema = z.object({
  action: z.enum([
    'check',      // Только проверка
    'fix',        // Проверка + автоисправление
    'report'      // Полный отчёт
  ]).default('check').describe('Action: check, fix, or report'),
  
  verbose: z.boolean().optional().default(false).describe(
    'Show detailed output for all checks'
  ),

  project_path: z.string().optional().describe(
    'Explicit path to project directory. If not provided, auto-detected from MCP roots or environment.'
  )
});

export type DoctorToolRequest = z.infer<typeof DoctorToolSchema>;

// ============================================================================
// Check Functions
// ============================================================================

type CheckFn = (projectPath: string, autoFix: boolean) => Promise<CheckResult>;

/**
 * Check 1: .m7/ directory exists
 */
const checkM7Directory: CheckFn = async (projectPath, autoFix) => {
  const m7Path = path.join(projectPath, '.m7');
  
  try {
    const stat = await fs.stat(m7Path);
    if (stat.isDirectory()) {
      return {
        name: '.m7/ directory',
        status: 'pass',
        message: 'Directory exists',
        autoFixable: true
      };
    }
    throw new Error('Not a directory');
  } catch {
    if (autoFix) {
      await fs.mkdir(m7Path, { recursive: true });
      return {
        name: '.m7/ directory',
        status: 'pass',
        message: 'Created .m7/ directory',
        autoFixable: true,
        fixed: true
      };
    }
    return {
      name: '.m7/ directory',
      status: 'fail',
      message: '.m7/ directory does not exist',
      autoFixable: true
    };
  }
};

/**
 * Check 2: memory/ files are valid JSON
 */
const checkMemoryFiles: CheckFn = async (projectPath, autoFix) => {
  const memoryPath = path.join(projectPath, '.m7', 'memory');
  const files = ['longterm.json', 'conceptual.json', 'project.json'];
  const issues: string[] = [];
  let fixed = false;
  
  for (const file of files) {
    const filePath = path.join(memoryPath, file);
    try {
      const result = await safeReadJSON(filePath);
      if (result.error) {
        if (autoFix && result.recoveredFrom) {
          fixed = true;
        } else {
          issues.push(`${file}: ${result.error}`);
        }
      }
    } catch {
      // File doesn't exist - not an error
    }
  }
  
  if (issues.length === 0) {
    return {
      name: 'memory/ files',
      status: 'pass',
      message: fixed ? 'Recovered from backups' : 'All memory files valid',
      autoFixable: true,
      fixed
    };
  }
  
  return {
    name: 'memory/ files',
    status: 'fail',
    message: `${issues.length} corrupted file(s)`,
    autoFixable: true,
    details: issues.join('\n')
  };
};

/**
 * Check 3: Core JSON files (errors.json, features.json, etc.)
 */
const checkCoreFiles: CheckFn = async (projectPath, autoFix) => {
  const m7Path = path.join(projectPath, '.m7');
  const files = [
    'errors.json',
    'features.json',
    'compliance.json',
    'task-graph.json',
    'knowledge-graph.json',
    'warm-state.json'
  ];
  
  const issues: string[] = [];
  let fixed = false;
  
  for (const file of files) {
    const filePath = path.join(m7Path, file);
    try {
      await fs.access(filePath);
      const result = await safeReadJSON(filePath);
      
      if (result.error) {
        if (autoFix) {
          const backups = await listBackups(filePath);
          if (backups.length > 0) {
            const restored = await restoreFromBackup(filePath);
            if (restored) {
              fixed = true;
              continue;
            }
          }
          // No backup - create empty
          await fs.writeFile(filePath, '{}');
          fixed = true;
        } else {
          issues.push(`${file}: invalid JSON`);
        }
      }
    } catch {
      // File doesn't exist - OK
    }
  }
  
  if (issues.length === 0) {
    return {
      name: 'core JSON files',
      status: 'pass',
      message: fixed ? 'Recovered/created missing files' : 'All core files valid',
      autoFixable: true,
      fixed
    };
  }
  
  return {
    name: 'core JSON files',
    status: 'fail',
    message: `${issues.length} corrupted file(s)`,
    autoFixable: true,
    details: issues.join('\n')
  };
};

/**
 * Check 4: warm-state.json freshness
 */
const checkWarmState: CheckFn = async (projectPath, autoFix) => {
  const warmStatePath = path.join(projectPath, '.m7', 'warm-state.json');
  
  try {
    const result = await safeReadJSON<{ lastWarmedAt?: string }>(warmStatePath);
    
    if (!result.data?.lastWarmedAt) {
      return {
        name: 'warmup state',
        status: 'warn',
        message: 'No warmup state - run @m7 warmup',
        autoFixable: false
      };
    }
    
    const lastWarmed = new Date(result.data.lastWarmedAt).getTime();
    const ageHours = (Date.now() - lastWarmed) / (1000 * 60 * 60);
    
    if (ageHours > 24) {
      if (autoFix) {
        await fs.unlink(warmStatePath);
        return {
          name: 'warmup state',
          status: 'warn',
          message: `Stale warmup (${Math.round(ageHours)}h old) - invalidated`,
          autoFixable: true,
          fixed: true
        };
      }
      return {
        name: 'warmup state',
        status: 'warn',
        message: `Warmup is ${Math.round(ageHours)}h old - consider refreshing`,
        autoFixable: true
      };
    }
    
    return {
      name: 'warmup state',
      status: 'pass',
      message: `Fresh (${Math.round(ageHours)}h ago)`,
      autoFixable: true
    };
  } catch {
    return {
      name: 'warmup state',
      status: 'warn',
      message: 'No warmup state',
      autoFixable: false
    };
  }
};

/**
 * Check 5: File sizes
 */
const checkFileSizes: CheckFn = async (projectPath, _autoFix) => {
  const m7Path = path.join(projectPath, '.m7');
  const largeFiles: string[] = [];
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  
  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_SIZE) {
            const relativePath = path.relative(m7Path, fullPath);
            const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
            largeFiles.push(`${relativePath} (${sizeMB}MB)`);
          }
        }
      }
    } catch {}
  }
  
  await scanDir(m7Path);
  
  if (largeFiles.length === 0) {
    return {
      name: 'file sizes',
      status: 'pass',
      message: 'All files under 10MB',
      autoFixable: false
    };
  }
  
  return {
    name: 'file sizes',
    status: 'warn',
    message: `${largeFiles.length} large file(s) found`,
    autoFixable: false,
    details: largeFiles.join('\n')
  };
};

/**
 * Check 6: Backup integrity
 */
const checkBackups: CheckFn = async (projectPath, _autoFix) => {
  const m7Path = path.join(projectPath, '.m7');
  const backupDir = path.join(m7Path, 'backups');
  
  try {
    await fs.access(backupDir);
    const entries = await fs.readdir(backupDir);
    
    return {
      name: 'backups',
      status: 'pass',
      message: `${entries.length} backup set(s) available`,
      autoFixable: false
    };
  } catch {
    return {
      name: 'backups',
      status: 'warn',
      message: 'No backups directory - backups will be created on next write',
      autoFixable: false
    };
  }
};

/**
 * Check 7: Manifest integrity (Phase 2)
 */
const checkManifest: CheckFn = async (projectPath, autoFix) => {
  const manifestPath = path.join(projectPath, '.m7', 'manifest.json');
  
  try {
    const result = await safeReadJSON<{ version?: string; stats?: { totalFiles?: number } }>(manifestPath);
    
    if (result.data?.version) {
      return {
        name: 'manifest (Phase 2)',
        status: 'pass',
        message: `v${result.data.version}, ${result.data.stats?.totalFiles || 0} files tracked`,
        autoFixable: true
      };
    }
    
    if (autoFix) {
      await fs.writeFile(manifestPath, JSON.stringify({
        version: '1.0.0',
        projectId: path.basename(projectPath),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        files: {},
        stats: { totalFiles: 0, totalSize: 0, warmupCount: 0 }
      }, null, 2));
      
      return {
        name: 'manifest (Phase 2)',
        status: 'pass',
        message: 'Created new manifest',
        autoFixable: true,
        fixed: true
      };
    }
    
    return {
      name: 'manifest (Phase 2)',
      status: 'warn',
      message: 'Invalid manifest - run with fix to repair',
      autoFixable: true
    };
  } catch {
    return {
      name: 'manifest (Phase 2)',
      status: 'warn',
      message: 'No manifest - incremental warmup disabled',
      autoFixable: true
    };
  }
};

/**
 * Check 8: Config file (m7-config.yaml)
 */
const checkConfig: CheckFn = async (projectPath, _autoFix) => {
  const configPath = path.join(projectPath, 'config', 'm7-config.yaml');
  
  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, 'utf-8');
    
    // Basic YAML validation
    if (content.includes('reliability:') && content.includes('hive:')) {
      return {
        name: 'm7-config.yaml',
        status: 'pass',
        message: 'Configuration valid',
        autoFixable: false
      };
    }
    
    return {
      name: 'm7-config.yaml',
      status: 'warn',
      message: 'Configuration may be incomplete',
      autoFixable: false
    };
  } catch {
    return {
      name: 'm7-config.yaml',
      status: 'warn',
      message: 'No config file - using defaults',
      autoFixable: false
    };
  }
};

/**
 * Check 9: Cross-session data
 */
const checkCrossSession: CheckFn = async (projectPath, autoFix) => {
  const crossSessionPath = path.join(projectPath, '.m7', 'cross-session');
  const files = ['insights.json', 'heuristics.json', 'stats.json'];
  let valid = 0;
  let fixed = false;
  
  for (const file of files) {
    const filePath = path.join(crossSessionPath, file);
    try {
      const result = await safeReadJSON(filePath);
      if (result.data) {
        valid++;
      } else if (autoFix) {
        await fs.mkdir(crossSessionPath, { recursive: true });
        await fs.writeFile(filePath, '{}');
        fixed = true;
        valid++;
      }
    } catch {
      if (autoFix) {
        await fs.mkdir(crossSessionPath, { recursive: true });
        await fs.writeFile(filePath, '{}');
        fixed = true;
        valid++;
      }
    }
  }
  
  if (valid === files.length) {
    return {
      name: 'cross-session data',
      status: 'pass',
      message: fixed ? 'Initialized missing files' : 'All files valid',
      autoFixable: true,
      fixed
    };
  }
  
  return {
    name: 'cross-session data',
    status: 'warn',
    message: `${valid}/${files.length} files valid`,
    autoFixable: true
  };
};

/**
 * Check 10: Total .m7/ size
 */
const checkTotalSize: CheckFn = async (projectPath, _autoFix) => {
  const m7Path = path.join(projectPath, '.m7');
  let totalSize = 0;
  const MAX_TOTAL = 100 * 1024 * 1024; // 100MB
  
  async function calcSize(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await calcSize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
        }
      }
    } catch {}
  }
  
  await calcSize(m7Path);
  
  const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
  
  if (totalSize > MAX_TOTAL) {
    return {
      name: 'total .m7/ size',
      status: 'warn',
      message: `${sizeMB}MB - consider cleanup`,
      autoFixable: false,
      details: 'Run @m7 memory cleanup to reduce size'
    };
  }
  
  return {
    name: 'total .m7/ size',
    status: 'pass',
    message: `${sizeMB}MB`,
    autoFixable: false
  };
};

// ============================================================================
// All Checks
// ============================================================================

const ALL_CHECKS: CheckFn[] = [
  checkM7Directory,
  checkMemoryFiles,
  checkCoreFiles,
  checkWarmState,
  checkFileSizes,
  checkBackups,
  checkManifest,
  checkConfig,
  checkCrossSession,
  checkTotalSize
];

// ============================================================================
// Handler
// ============================================================================

export async function handleDoctorTool(
  request: DoctorToolRequest,
  projectPath?: string,
  server?: unknown
): Promise<string> {
  if (projectPath) {
    applyProjectPath(projectPath);
  } else if (request.project_path) {
    applyProjectPath(request.project_path);
  } else {
    await ensureProjectPathResolved(server);
  }

  const resolvedPath = getProjectPath();
  const pathDiagnostics = getProjectPathDiagnostics();
  const autoFix = request.action === 'fix';
  
  log.info(`Doctor running (action: ${request.action}, path: ${resolvedPath})`);
  
  const checks: CheckResult[] = [];
  
  for (const check of ALL_CHECKS) {
    try {
      const result = await check(resolvedPath, autoFix);
      checks.push(result);
    } catch (err: any) {
      checks.push({
        name: 'unknown check',
        status: 'fail',
        message: err.message,
        autoFixable: false
      });
    }
  }
  
  // Calculate summary
  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    warnings: checks.filter(c => c.status === 'warn').length,
    failed: checks.filter(c => c.status === 'fail').length,
    fixed: checks.filter(c => c.fixed).length
  };
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (summary.failed > 0) {
    recommendations.push('Run `@m7 doctor fix` to attempt auto-repair');
  }
  if (checks.some(c => c.name === 'warmup state' && c.status === 'warn')) {
    recommendations.push('Run `@m7 warmup` to refresh context');
  }
  if (checks.some(c => c.name === 'total .m7/ size' && c.status === 'warn')) {
    recommendations.push('Consider running cleanup to reduce storage');
  }
  
  // Format output
  let output = `## 🩺 M7 Doctor Report\n\n`;

  output += `### 📍 Project Path\n\n`;
  output += `| Field | Value |\n`;
  output += `|-------|-------|\n`;
  output += `| Path | \`${resolvedPath}\` |\n`;
  output += `| Source | ${pathDiagnostics.source} |\n`;
  output += `| MCP Roots | ${pathDiagnostics.resolvedFromRoots ? 'yes' : 'no'} |\n`;
  output += `| Roots attempts | ${pathDiagnostics.rootsAttemptCount}/${5} |\n`;
  output += `| process.cwd() | \`${pathDiagnostics.processCwd}\` |\n`;
  if (pathDiagnostics.isUnsafeFallback) {
    output += `| ⚠️ Unsafe fallback | bare home directory — pass \`project_path\` or open workspace folder |\n`;
  }
  output += `\n`;
  
  // Summary box
  const healthIcon = summary.failed > 0 ? '🔴' : summary.warnings > 0 ? '🟡' : '🟢';
  output += `### ${healthIcon} Health Status\n\n`;
  output += `| Metric | Value |\n`;
  output += `|--------|-------|\n`;
  output += `| Checks | ${summary.total} |\n`;
  output += `| Passed | ${summary.passed} ✅ |\n`;
  output += `| Warnings | ${summary.warnings} ⚠️ |\n`;
  output += `| Failed | ${summary.failed} ❌ |\n`;
  if (autoFix && summary.fixed > 0) {
    output += `| Auto-fixed | ${summary.fixed} 🔧 |\n`;
  }
  output += `\n`;
  
  // Detailed checks
  output += `### 📋 Checks\n\n`;
  output += `| # | Check | Status | Message |\n`;
  output += `|---|-------|--------|----------|\n`;
  
  checks.forEach((check, i) => {
    const statusIcon = check.status === 'pass' ? '✅' : 
                       check.status === 'warn' ? '⚠️' : '❌';
    const fixedIcon = check.fixed ? ' 🔧' : '';
    output += `| ${i + 1} | ${check.name} | ${statusIcon}${fixedIcon} | ${check.message} |\n`;
  });
  output += `\n`;
  
  // Details for failures/warnings
  const withDetails = checks.filter(c => c.details && (c.status !== 'pass' || request.verbose));
  if (withDetails.length > 0) {
    output += `### 📝 Details\n\n`;
    for (const check of withDetails) {
      output += `**${check.name}:**\n\`\`\`\n${check.details}\n\`\`\`\n\n`;
    }
  }
  
  // Recommendations
  if (recommendations.length > 0) {
    output += `### 💡 Recommendations\n\n`;
    for (const rec of recommendations) {
      output += `- ${rec}\n`;
    }
    output += `\n`;
  }
  
  // Footer
  output += `---\n`;
  output += `*Diagnosed: ${new Date().toISOString()}*\n`;
  output += `*Path: ${resolvedPath}*\n`;
  
  return output;
}

// ============================================================================
// Tool Export
// ============================================================================

export function createDoctorTool(server?: unknown) {
  return {
    name: 'mcp_m7_doctor',
    description: 'M7 Doctor - диагностика и авто-исправление проблем с .m7/ директорией',
    inputSchema: DoctorToolSchema,
    handler: (request: DoctorToolRequest) => handleDoctorTool(request, undefined, server)
  };
}
