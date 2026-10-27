/**
 * M7 Hive History Tool
 * 
 * List and load past Hive reports saved to docs/hive/.
 * Enables re-using Hive analysis in subsequent conversations.
 * 
 * Actions:
 * - list: Show all saved reports with date, topic, size, and metadata
 * - load: Read a specific report by filename and return its content
 * 
 * Security: strict filename validation, realpath + prefix check, no path leaks.
 * 
 * @version 1.1.0 (hardened per Hive self-review)
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { getProjectPath } from '../../core/utils/projectPath.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('[HiveHistory]');

// Strict filename pattern: date_time_slug.md only
const SAFE_FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,200}\.md$/;

const HiveHistorySchema = z.object({
  action: z.enum(['list', 'load']).describe(
    'Action: "list" shows all saved Hive reports, "load" returns the full content of a specific report'
  ),
  filename: z.string().optional().describe(
    'Filename to load (required for "load" action). Use "list" first to see available files.'
  ),
  query: z.string().optional().describe(
    'Optional search query to filter reports by topic (for "list" action)'
  ),
  limit: z.number().optional().default(20).describe(
    'Maximum number of reports to list (default: 20)'
  )
});

// ============================================================================
// HELPERS
// ============================================================================

function getHiveDir(): string {
  const projectRoot = getProjectPath();
  return path.join(projectRoot, 'docs', 'hive');
}

/**
 * Validate and resolve a filename safely.
 * Returns the canonical path if safe, null if rejected.
 */
async function safeResolvePath(filename: string): Promise<string | null> {
  // Step 1: Reject anything that doesn't match safe pattern
  const basename = path.basename(filename);
  if (!SAFE_FILENAME_RE.test(basename)) {
    log.debug(`[HiveHistory] Rejected unsafe filename: ${basename}`);
    return null;
  }
  
  // Step 2: Construct path from hive dir + basename only
  const hiveDir = getHiveDir();
  const candidatePath = path.join(hiveDir, basename);
  
  // Step 3: Resolve canonical path (follows symlinks, resolves ..)
  try {
    const realHiveDir = fsSync.existsSync(hiveDir) 
      ? await fs.realpath(hiveDir) 
      : hiveDir;
    const realCandidate = await fs.realpath(candidatePath);
    
    // Step 4: Verify canonical path is inside hive dir
    if (!realCandidate.startsWith(realHiveDir + path.sep) && realCandidate !== realHiveDir) {
      log.debug(`[HiveHistory] Path escape blocked: resolved outside hive dir`);
      return null;
    }
    
    return realCandidate;
  } catch {
    // realpath fails if file doesn't exist — that's fine
    return null;
  }
}

// ============================================================================
// LIST ACTION
// ============================================================================

async function listReports(query?: string, limit: number = 20): Promise<string> {
  const hiveDir = getHiveDir();
  
  try {
    await fs.access(hiveDir);
  } catch {
    return '# Hive History\n\nNo reports found. Run a Hive analysis first (`mcp_m7_hive_coordinator`).';
  }
  
  let entries: string[];
  try {
    entries = await fs.readdir(hiveDir);
  } catch {
    return '# Hive History\n\nCannot read reports directory.';
  }
  
  let files = entries
    .filter(f => f.endsWith('.md') && SAFE_FILENAME_RE.test(f))
    .sort()
    .reverse(); // Newest first
  
  if (query) {
    const q = query.toLowerCase();
    files = files.filter(f => f.toLowerCase().includes(q));
  }
  
  if (files.length === 0) {
    return query 
      ? `# Hive History\n\nNo reports matching "${query}". Use \`list\` without query to see all.`
      : '# Hive History\n\nNo reports found.';
  }
  
  const total = files.length;
  files = files.slice(0, Math.min(limit, 50)); // Hard cap at 50
  
  const rows: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const filepath = path.join(hiveDir, f);
      const stats = await fs.stat(filepath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      
      // Parse date and topic from filename: 2026-02-10_1958_slug.md
      const match = f.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})_(.+)\.md$/);
      const date = match ? match[1] : '?';
      const time = match ? `${match[2].slice(0, 2)}:${match[2].slice(2)}` : '?';
      const topic = match ? match[3].replace(/-/g, ' ') : f;
      
      rows.push(`| ${i + 1} | ${date} ${time} | ${topic} | ${sizeKB} KB | \`${f}\` |`);
    } catch {
      // Skip unreadable files
      continue;
    }
  }
  
  let output = `# Hive Reports (${total} total${query ? `, filtered by "${query}"` : ''})\n\n`;
  output += `| # | Date | Topic | Size | Filename |\n`;
  output += `|---|------|-------|------|----------|\n`;
  output += rows.join('\n');
  output += `\n\nTo load a report into chat: use action \`load\` with the filename from the last column.`;
  
  return output;
}

// ============================================================================
// LOAD ACTION
// ============================================================================

async function loadReport(filename: string): Promise<string> {
  // Validate and resolve path safely
  const resolvedPath = await safeResolvePath(filename);
  
  if (!resolvedPath) {
    // Try fuzzy match without leaking paths
    const hiveDir = getHiveDir();
    try {
      const entries = await fs.readdir(hiveDir);
      const basename = path.basename(filename).toLowerCase();
      const match = entries.find(f => 
        f.endsWith('.md') && f.toLowerCase().includes(basename)
      );
      
      if (match) {
        const matchPath = await safeResolvePath(match);
        if (matchPath) {
          const content = await fs.readFile(matchPath, 'utf-8');
          return `> Fuzzy match: loaded \`${match}\`\n\n${content}`;
        }
      }
    } catch {
      // Directory doesn't exist or unreadable
    }
    
    return `Report not found. Use action \`list\` to see available reports.`;
  }
  
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    
    // Safety: cap at ~200KB to avoid blowing up context
    const MAX_SIZE = 200 * 1024;
    if (content.length > MAX_SIZE) {
      const truncated = content.substring(0, MAX_SIZE);
      return `${truncated}\n\n---\n> Report truncated (${(content.length / 1024).toFixed(0)} KB). Full report available on disk.`;
    }
    
    return content;
  } catch (err: any) {
    log.debug(`[HiveHistory] Read error: ${err.code}`);
    return `Cannot read report. Use action \`list\` to see available reports.`;
  }
}

// ============================================================================
// TOOL EXPORT
// ============================================================================

export const hiveHistoryTool = {
  name: 'mcp_m7_hive_history',
  description: `Browse and load past Hive analysis reports.

Use "list" to see all saved reports with dates, topics, and sizes.
Use "load" with a filename to bring a full report into the conversation context.

Reports are saved automatically when running mcp_m7_hive_coordinator.
Use this tool to reference past analyses in follow-up discussions.`,
  inputSchema: HiveHistorySchema,
  
  handler: async (request: any) => {
    try {
      const action = request.action || 'list';
      
      if (action === 'list') {
        const output = await listReports(request.query, request.limit ?? 20);
        return {
          content: [{ type: 'text', text: output }]
        };
      }
      
      if (action === 'load') {
        if (!request.filename) {
          return {
            content: [{
              type: 'text',
              text: 'Error: `filename` is required for load action. Use `list` first to see available reports.'
            }]
          };
        }
        
        const output = await loadReport(request.filename);
        return {
          content: [{ type: 'text', text: output }]
        };
      }
      
      return {
        content: [{ type: 'text', text: `Unknown action: ${action}. Use "list" or "load".` }]
      };
    } catch (error: any) {
      log.debug(`[HiveHistory] Error: ${error.code || error.message}`);
      return {
        content: [{
          type: 'text',
          text: 'Hive History: unexpected error. Check that the project path is correctly configured.'
        }]
      };
    }
  }
};
