import { createLogger } from '../../../utils/logger.js';
const log = createLogger('[backupUtils]');
/**
 * Backup Utilities for Knowledge Hub
 * Provides safe backup and restore operations
 */

import * as path from 'path';
import { 
  safeCopyFile, 
  ensureDirectory, 
  fileExists,
  getFileStats,
  listFilesRecursive
} from './fileUtils.js';
import { BackupInfo, MigrationError } from '../types.js';

/**
 * Create backup of files
 */
export async function createBackup(
  files: string[],
  projectPath: string,
  backupLocation: string
): Promise<BackupInfo> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(projectPath, backupLocation, timestamp);
  
  try {
    // Ensure backup directory exists
    await ensureDirectory(backupDir);
    
    // Copy each file
    const backedUpFiles: string[] = [];
    
    for (const file of files) {
      const relativePath = path.relative(projectPath, file);
      const backupPath = path.join(backupDir, relativePath);
      
      // Ensure parent directory exists
      await ensureDirectory(path.dirname(backupPath));
      
      // Copy file
      await safeCopyFile(file, backupPath);
      backedUpFiles.push(relativePath);
    }
    
    // Create backup manifest
    const manifest = {
      timestamp,
      files: backedUpFiles,
      count: backedUpFiles.length
    };
    
    return {
      timestamp,
      location: backupDir,
      files: backedUpFiles
    };
  } catch (error: any) {
    throw new MigrationError(
      `Failed to create backup: ${error.message}`,
      { backupDir, error: error.message }
    );
  }
}

/**
 * Restore files from backup
 */
export async function restoreBackup(
  backupInfo: BackupInfo,
  projectPath: string
): Promise<void> {
  try {
    // Restore each file
    for (const relativePath of backupInfo.files) {
      const sourceFile = path.join(backupInfo.location, relativePath);
      const targetFile = path.join(projectPath, relativePath);
      
      // Check if backup file exists
      if (!(await fileExists(sourceFile))) {
        throw new Error(`Backup file not found: ${sourceFile}`);
      }
      
      // Restore file
      await safeCopyFile(sourceFile, targetFile);
    }
  } catch (error: any) {
    throw new MigrationError(
      `Failed to restore backup: ${error.message}`,
      { backupInfo, error: error.message }
    );
  }
}

/**
 * List available backups
 */
export async function listBackups(
  projectPath: string,
  backupLocation: string
): Promise<BackupInfo[]> {
  const backupDir = path.join(projectPath, backupLocation);
  
  if (!(await fileExists(backupDir))) {
    return [];
  }
  
  try {
    const files = await listFilesRecursive(backupDir);
    
    // Group by timestamp directory
    const backupsByTimestamp = new Map<string, string[]>();
    
    for (const file of files) {
      const relativePath = path.relative(backupDir, file);
      const parts = relativePath.split(path.sep);
      
      if (parts.length > 0) {
        const timestamp = parts[0];
        
        if (!backupsByTimestamp.has(timestamp)) {
          backupsByTimestamp.set(timestamp, []);
        }
        
        backupsByTimestamp.get(timestamp)!.push(relativePath);
      }
    }
    
    // Convert to BackupInfo array
    const backups: BackupInfo[] = [];
    
    for (const [timestamp, files] of backupsByTimestamp) {
      backups.push({
        timestamp,
        location: path.join(backupDir, timestamp),
        files
      });
    }
    
    // Sort by timestamp (newest first)
    backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    return backups;
  } catch (error: any) {
    // Return empty array on error
    return [];
  }
}

/**
 * Delete old backups (keep only N most recent)
 */
export async function pruneOldBackups(
  projectPath: string,
  backupLocation: string,
  keepCount: number = 5
): Promise<number> {
  const backups = await listBackups(projectPath, backupLocation);
  
  if (backups.length <= keepCount) {
    return 0;
  }
  
  // Get backups to delete (oldest ones)
  const toDelete = backups.slice(keepCount);
  let deletedCount = 0;
  
  for (const backup of toDelete) {
    try {
      // Delete backup directory recursively using rm with recursive option (Node.js 14.14+)
      const fs = await import('fs/promises');
      await fs.rm(backup.location, { recursive: true, force: true });
      deletedCount++;
    } catch (error) {
      // Continue even if deletion fails
      log.error(`Failed to delete backup ${backup.timestamp}:`, error);
    }
  }
  
  return deletedCount;
}

/**
 * Get backup size in bytes
 */
export async function getBackupSize(backup: BackupInfo): Promise<number> {
  let totalSize = 0;
  
  for (const file of backup.files) {
    const filePath = path.join(backup.location, file);
    
    try {
      const stats = await getFileStats(filePath);
      totalSize += Number(stats.size);
    } catch {
      // Skip files that can't be accessed
    }
  }
  
  return totalSize;
}

/**
 * Format backup size for display
 */
export function formatBackupSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Validate backup integrity
 */
export async function validateBackup(backup: BackupInfo): Promise<boolean> {
  // Check if backup directory exists
  if (!(await fileExists(backup.location))) {
    return false;
  }
  
  // Check if all files exist
  for (const file of backup.files) {
    const filePath = path.join(backup.location, file);
    
    if (!(await fileExists(filePath))) {
      return false;
    }
  }
  
  return true;
}

