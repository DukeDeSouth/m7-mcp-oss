/**
 * M7 v3.10 Atomic Write System
 * 
 * Provides crash-safe file operations using temp→rename pattern.
 * Includes automatic backup rotation to prevent data loss.
 * 
 * Pattern: Write to temp file → sync → rename to target
 * This ensures the target file is either complete or unchanged.
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('[AtomicWrite]');

// ============================================
// CONFIGURATION
// ============================================

export interface AtomicWriteConfig {
  /** Maximum number of backup files to keep (default: 5) */
  maxBackups: number;
  /** Create backup before overwriting (default: true) */
  createBackup: boolean;
  /** Verify write by reading back (default: false for performance) */
  verifyWrite: boolean;
  /** Temp file prefix (default: '.tmp-') */
  tempPrefix: string;
  /** Backup file suffix (default: '.bak') */
  backupSuffix: string;
}

export const DEFAULT_ATOMIC_CONFIG: AtomicWriteConfig = {
  maxBackups: 3,
  createBackup: true,
  verifyWrite: false,
  tempPrefix: '.tmp-',
  backupSuffix: '.bak',
};

// ============================================
// ATOMIC WRITE RESULT
// ============================================

export interface AtomicWriteResult {
  success: boolean;
  path: string;
  bytesWritten: number;
  backupCreated: boolean;
  backupPath?: string;
  tempPath?: string;
  error?: string;
  durationMs: number;
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Write data to file atomically using temp→rename pattern.
 * 
 * Process:
 * 1. Write data to temporary file (.tmp-{random})
 * 2. Sync temp file to disk (fsync)
 * 3. If target exists, rotate to backup (.bak.1 → .bak.2, etc.)
 * 4. Rename temp to target (atomic on POSIX)
 * 
 * @param filePath - Target file path
 * @param data - Data to write (string or Buffer)
 * @param config - Configuration options
 * @returns Result with success status and metadata
 */
export async function atomicWrite(
  filePath: string,
  data: string | Buffer,
  config: Partial<AtomicWriteConfig> = {}
): Promise<AtomicWriteResult> {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_ATOMIC_CONFIG, ...config };
  
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const tempPath = path.join(dir, `${cfg.tempPrefix}${basename}.${randomSuffix}`);
  
  const result: AtomicWriteResult = {
    success: false,
    path: filePath,
    bytesWritten: 0,
    backupCreated: false,
    tempPath,
    durationMs: 0,
  };

  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });
    
    // Step 1: Write to temp file
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    await fs.writeFile(tempPath, buffer);
    result.bytesWritten = buffer.length;
    
    // Step 2: Sync to disk (critical for crash safety)
    const tempHandle = await fs.open(tempPath, 'r');
    await tempHandle.sync();
    await tempHandle.close();
    
    // Step 3: Create backup if target exists
    if (cfg.createBackup) {
      const targetExists = await fileExists(filePath);
      if (targetExists) {
        const backupPath = await rotateBackups(filePath, cfg);
        if (backupPath) {
          result.backupCreated = true;
          result.backupPath = backupPath;
        }
      }
    }
    
    // Step 4: Atomic rename
    await fs.rename(tempPath, filePath);
    
    // Step 5: Optional verification
    if (cfg.verifyWrite) {
      const verified = await verifyWrittenData(filePath, buffer);
      if (!verified) {
        throw new Error('Write verification failed: data mismatch');
      }
    }
    
    result.success = true;
    result.durationMs = Date.now() - startTime;
    
    log.debug(`Atomic write OK: ${filePath} (${result.bytesWritten} bytes, ${result.durationMs}ms)`);
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.durationMs = Date.now() - startTime;
    
    // Cleanup temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    
    log.warn(`Atomic write FAILED: ${filePath} - ${result.error}`);
  }
  
  return result;
}

/**
 * Write JSON data atomically with pretty formatting.
 */
export async function atomicWriteJSON(
  filePath: string,
  data: unknown,
  config: Partial<AtomicWriteConfig> = {}
): Promise<AtomicWriteResult> {
  const jsonString = JSON.stringify(data, null, 2);
  return atomicWrite(filePath, jsonString, config);
}

// ============================================
// BACKUP ROTATION
// ============================================

/**
 * Rotate backup files: .bak.5 → delete, .bak.4 → .bak.5, ..., original → .bak.1
 * 
 * @returns Path to the new backup (.bak.1) or null if backup failed
 */
async function rotateBackups(
  filePath: string,
  config: AtomicWriteConfig
): Promise<string | null> {
  const { maxBackups, backupSuffix } = config;
  
  try {
    // Delete oldest backup if it exists
    const oldestBackup = `${filePath}${backupSuffix}.${maxBackups}`;
    if (await fileExists(oldestBackup)) {
      await fs.unlink(oldestBackup);
    }
    
    // Rotate existing backups: .bak.4 → .bak.5, .bak.3 → .bak.4, etc.
    for (let i = maxBackups - 1; i >= 1; i--) {
      const currentBackup = `${filePath}${backupSuffix}.${i}`;
      const nextBackup = `${filePath}${backupSuffix}.${i + 1}`;
      
      if (await fileExists(currentBackup)) {
        await fs.rename(currentBackup, nextBackup);
      }
    }
    
    // Move current file to .bak.1
    const newBackup = `${filePath}${backupSuffix}.1`;
    await fs.copyFile(filePath, newBackup);
    
    return newBackup;
    
  } catch (error) {
    log.warn(`Backup rotation failed for ${filePath}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Get list of existing backup files for a path.
 */
export async function listBackups(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): Promise<string[]> {
  const cfg = { ...DEFAULT_ATOMIC_CONFIG, ...config };
  const backups: string[] = [];
  
  for (let i = 1; i <= cfg.maxBackups; i++) {
    const backupPath = `${filePath}${cfg.backupSuffix}.${i}`;
    if (await fileExists(backupPath)) {
      backups.push(backupPath);
    }
  }
  
  return backups;
}

/**
 * Restore file from most recent backup.
 * 
 * @returns Path to restored backup or null if no backup available
 */
export async function restoreFromBackup(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): Promise<string | null> {
  const cfg = { ...DEFAULT_ATOMIC_CONFIG, ...config };
  
  // Find most recent backup
  for (let i = 1; i <= cfg.maxBackups; i++) {
    const backupPath = `${filePath}${cfg.backupSuffix}.${i}`;
    
    if (await fileExists(backupPath)) {
      try {
        // Use atomic write to restore
        const backupData = await fs.readFile(backupPath);
        const result = await atomicWrite(filePath, backupData, {
          ...config,
          createBackup: false, // Don't create backup when restoring
        });
        
        if (result.success) {
          log.info(`Restored ${filePath} from ${backupPath}`);
          return backupPath;
        }
      } catch (error) {
        log.warn(`Failed to restore from ${backupPath}: ${error}`);
      }
    }
  }
  
  return null;
}

/**
 * Delete all backup files for a path.
 */
export async function cleanupBackups(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): Promise<number> {
  const cfg = { ...DEFAULT_ATOMIC_CONFIG, ...config };
  let deleted = 0;
  
  for (let i = 1; i <= cfg.maxBackups; i++) {
    const backupPath = `${filePath}${cfg.backupSuffix}.${i}`;
    
    try {
      await fs.unlink(backupPath);
      deleted++;
    } catch {
      // File doesn't exist, skip
    }
  }
  
  return deleted;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if file exists without throwing.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify written data matches expected content.
 */
async function verifyWrittenData(
  filePath: string,
  expectedData: Buffer
): Promise<boolean> {
  try {
    const actualData = await fs.readFile(filePath);
    return Buffer.compare(actualData, expectedData) === 0;
  } catch {
    return false;
  }
}

function tryParseJsonBuffer<T>(buf: Buffer): T | null {
  try {
    return JSON.parse(buf.toString('utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Read backup files (.bak.1 … .bak.N) in order. First readable backup wins.
 */
export async function readBackups(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): Promise<{ data: Buffer; recoveredFrom: string } | null> {
  const cfg = { ...DEFAULT_ATOMIC_CONFIG, ...config };

  for (let i = 1; i <= cfg.maxBackups; i++) {
    const backupPath = `${filePath}${cfg.backupSuffix}.${i}`;
    try {
      const data = await fs.readFile(backupPath);
      log.info(`Recovered data from backup: ${backupPath}`);
      return { data, recoveredFrom: backupPath };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Safe read with automatic recovery from backup if main file is corrupted.
 */
export async function safeRead(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): Promise<{ data: Buffer | null; recoveredFrom?: string; error?: string }> {
  try {
    const data = await fs.readFile(filePath);
    return { data };
  } catch {
    log.warn(`Main file read failed: ${filePath}, trying backups...`);
  }

  const backup = await readBackups(filePath, config);
  if (backup) {
    return { data: backup.data, recoveredFrom: backup.recoveredFrom };
  }

  return { data: null, error: 'No readable file or backup found' };
}

/**
 * Safe read JSON with automatic recovery (read failure or JSON parse failure on main).
 */
export async function safeReadJSON<T = unknown>(
  filePath: string,
  config: Partial<AtomicWriteConfig> = {}
): Promise<{ data: T | null; recoveredFrom?: string; error?: string }> {
  const cfg = { ...DEFAULT_ATOMIC_CONFIG, ...config };
  let mainBuf: Buffer | null = null;

  try {
    mainBuf = await fs.readFile(filePath);
  } catch {
    // missing or unreadable main — fall through to backups
  }

  if (mainBuf !== null) {
    const parsed = tryParseJsonBuffer<T>(mainBuf);
    if (parsed !== null) {
      return { data: parsed };
    }
    log.warn(`Main file JSON parse failed: ${filePath}, trying backups...`);
    for (let i = 1; i <= cfg.maxBackups; i++) {
      const backupPath = `${filePath}${cfg.backupSuffix}.${i}`;
      try {
        const bbuf = await fs.readFile(backupPath);
        const bparsed = tryParseJsonBuffer<T>(bbuf);
        if (bparsed !== null) {
          log.info(`Recovered JSON from backup: ${backupPath}`);
          return { data: bparsed, recoveredFrom: backupPath };
        }
      } catch {
        // next backup
      }
    }
    return { data: null, error: 'JSON parse error on main file and no valid backup' };
  }

  const backup = await readBackups(filePath, config);
  if (!backup) {
    return { data: null, error: 'No readable file or backup found' };
  }
  const parsed = tryParseJsonBuffer<T>(backup.data);
  if (parsed === null) {
    return { data: null, error: 'Backup readable but JSON invalid' };
  }
  return { data: parsed, recoveredFrom: backup.recoveredFrom };
}

// ============================================
// EXPORTS
// ============================================

export default {
  atomicWrite,
  atomicWriteJSON,
  listBackups,
  restoreFromBackup,
  cleanupBackups,
  readBackups,
  safeRead,
  safeReadJSON,
};
