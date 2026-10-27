/**
 * File Utilities for Knowledge Hub
 * Provides safe, atomic file operations with error handling
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { KnowledgeHubError } from '../types.js';

/**
 * Safely write file with atomic operation
 * Writes to temp file first, then renames (atomic on most systems)
 */
export async function safeWriteFile(
  filePath: string,
  content: string
): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  
  try {
    // Write to temp file
    await fs.writeFile(tempPath, content, 'utf-8');
    
    // Atomic rename
    await fs.rename(tempPath, filePath);
  } catch (error: any) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {}
    
    throw new KnowledgeHubError(
      `Failed to write file: ${error.message}`,
      'FILE_WRITE_ERROR',
      { filePath, error: error.message }
    );
  }
}

/**
 * Safely read file with error handling
 */
export async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new KnowledgeHubError(
        `File not found: ${filePath}`,
        'FILE_NOT_FOUND',
        { filePath }
      );
    }
    
    if (error.code === 'EACCES') {
      throw new KnowledgeHubError(
        `Permission denied: ${filePath}`,
        'PERMISSION_DENIED',
        { filePath }
      );
    }
    
    throw new KnowledgeHubError(
      `Failed to read file: ${error.message}`,
      'FILE_READ_ERROR',
      { filePath, error: error.message }
    );
  }
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure directory exists, create if not
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    throw new KnowledgeHubError(
      `Failed to create directory: ${error.message}`,
      'DIRECTORY_CREATE_ERROR',
      { dirPath, error: error.message }
    );
  }
}

/**
 * Safely copy file
 */
export async function safeCopyFile(
  source: string,
  destination: string
): Promise<void> {
  try {
    // Ensure destination directory exists
    await ensureDirectory(path.dirname(destination));
    
    // Copy file
    await fs.copyFile(source, destination);
  } catch (error: any) {
    throw new KnowledgeHubError(
      `Failed to copy file: ${error.message}`,
      'FILE_COPY_ERROR',
      { source, destination, error: error.message }
    );
  }
}

/**
 * Safely move file
 */
export async function safeMoveFile(
  source: string,
  destination: string
): Promise<void> {
  try {
    // Ensure destination directory exists
    await ensureDirectory(path.dirname(destination));
    
    // Move file (rename is atomic)
    await fs.rename(source, destination);
  } catch (error: any) {
    // If rename fails (cross-device), copy then delete
    if (error.code === 'EXDEV') {
      await safeCopyFile(source, destination);
      await fs.unlink(source);
    } else {
      throw new KnowledgeHubError(
        `Failed to move file: ${error.message}`,
        'FILE_MOVE_ERROR',
        { source, destination, error: error.message }
      );
    }
  }
}

/**
 * Get file stats safely
 */
export async function getFileStats(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  try {
    return await fs.stat(filePath);
  } catch (error: any) {
    throw new KnowledgeHubError(
      `Failed to get file stats: ${error.message}`,
      'FILE_STAT_ERROR',
      { filePath, error: error.message }
    );
  }
}

/**
 * Validate path is within project (prevent path traversal)
 */
export function validatePath(
  userPath: string,
  projectRoot: string
): string {
  // Normalize and resolve path
  const normalized = path.normalize(userPath);
  const resolved = path.resolve(projectRoot, normalized);
  
  // Ensure path is within project
  if (!resolved.startsWith(projectRoot)) {
    throw new KnowledgeHubError(
      'Path traversal detected',
      'INVALID_PATH',
      { userPath, projectRoot }
    );
  }
  
  return resolved;
}

/**
 * List files in directory recursively
 */
export async function listFilesRecursive(
  dirPath: string,
  filter?: (file: string) => boolean
): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath, filter);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        if (!filter || filter(fullPath)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error: any) {
    // Ignore permission denied errors, just skip directory
    if (error.code !== 'EACCES') {
      throw new KnowledgeHubError(
        `Failed to list files: ${error.message}`,
        'FILE_LIST_ERROR',
        { dirPath, error: error.message }
      );
    }
  }
  
  return files;
}

/**
 * Check if path is writable
 */
export async function isWritable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get relative path from project root
 */
export function getRelativePath(
  filePath: string,
  projectRoot: string
): string {
  return path.relative(projectRoot, filePath);
}

/**
 * Safely delete file
 */
export async function safeDeleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw new KnowledgeHubError(
        `Failed to delete file: ${error.message}`,
        'FILE_DELETE_ERROR',
        { filePath, error: error.message }
      );
    }
  }
}

