/**
 * File Hash Cache for Incremental Project Index Updates
 * Tracks file changes using content hashes to enable incremental updates
 * 
 * @module projectIndex/fileHashCache
 * @version 1.0.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('[FileHashCache]');

export interface FileHashEntry {
  path: string;
  hash: string;
  size: number;
  mtime: number;
}

export interface FileChanges {
  added: string[];
  modified: string[];
  removed: string[];
  unchanged: string[];
}

export interface HashCacheData {
  version: string;
  projectPath: string;
  lastScanTime: number;
  files: Record<string, FileHashEntry>;
}

const CACHE_VERSION = '1.0.0';
const CACHE_FILENAME = '.m7-index-cache.json';

export class FileHashCache {
  private cache: HashCacheData | null = null;
  private cachePath: string;
  private dirty: boolean = false;

  constructor(private projectPath: string) {
    this.cachePath = path.join(projectPath, '.m7', CACHE_FILENAME);
  }

  /**
   * Load cache from disk
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(data) as HashCacheData;
      
      // Validate cache version and project path
      if (parsed.version === CACHE_VERSION && parsed.projectPath === this.projectPath) {
        this.cache = parsed;
        log.debug(`✓ Loaded cache with ${Object.keys(parsed.files).length} entries`);
      } else {
        log.debug(`Cache version mismatch, starting fresh`);
        this.initializeCache();
      }
    } catch (err) {
      // Cache doesn't exist or is corrupted, initialize new
      this.initializeCache();
    }
  }

  /**
   * Initialize empty cache
   */
  private initializeCache(): void {
    this.cache = {
      version: CACHE_VERSION,
      projectPath: this.projectPath,
      lastScanTime: 0,
      files: {}
    };
    this.dirty = true;
  }

  /**
   * Save cache to disk
   */
  async save(): Promise<void> {
    if (!this.cache || !this.dirty) return;
    
    try {
      const dir = path.dirname(this.cachePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf-8');
      this.dirty = false;
      log.debug(`✓ Saved cache`);
    } catch (err) {
      log.warn(`Failed to save cache: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Compute hash for a file (fast: uses mtime+size first, content hash only if needed)
   */
  async computeFileHash(filePath: string): Promise<FileHashEntry | null> {
    try {
      const stats = await fs.stat(filePath);
      
      // Quick check: if mtime and size match, skip content hash
      const relativePath = path.relative(this.projectPath, filePath);
      const cached = this.cache?.files[relativePath];
      
      if (cached && cached.mtime === stats.mtimeMs && cached.size === stats.size) {
        return cached; // No change detected
      }
      
      // Compute content hash only for changed files
      const content = await fs.readFile(filePath, 'utf-8');
      const hash = crypto.createHash('md5').update(content).digest('hex');
      
      return {
        path: relativePath,
        hash,
        size: stats.size,
        mtime: stats.mtimeMs
      };
    } catch (err) {
      return null; // File doesn't exist or unreadable
    }
  }

  /**
   * Detect changes between current state and cache
   */
  async detectChanges(currentFiles: string[]): Promise<FileChanges> {
    if (!this.cache) {
      await this.load();
    }
    
    const changes: FileChanges = {
      added: [],
      modified: [],
      removed: [],
      unchanged: []
    };
    
    const currentSet = new Set(currentFiles.map(f => path.relative(this.projectPath, f)));
    const cachedSet = new Set(Object.keys(this.cache?.files || {}));
    
    // Find added and modified files
    for (const filePath of currentFiles) {
      const relativePath = path.relative(this.projectPath, filePath);
      const entry = await this.computeFileHash(filePath);
      
      if (!entry) continue;
      
      const cachedEntry = this.cache?.files[relativePath];
      
      if (!cachedEntry) {
        changes.added.push(relativePath);
      } else if (cachedEntry.hash !== entry.hash) {
        changes.modified.push(relativePath);
      } else {
        changes.unchanged.push(relativePath);
      }
    }
    
    // Find removed files
    for (const cachedPath of cachedSet) {
      if (!currentSet.has(cachedPath)) {
        changes.removed.push(cachedPath);
      }
    }
    
    return changes;
  }

  /**
   * Update cache with new file hashes
   */
  async updateCache(files: string[]): Promise<void> {
    if (!this.cache) {
      this.initializeCache();
    }
    
    const newFiles: Record<string, FileHashEntry> = {};
    
    for (const filePath of files) {
      const entry = await this.computeFileHash(filePath);
      if (entry) {
        newFiles[entry.path] = entry;
      }
    }
    
    this.cache!.files = newFiles;
    this.cache!.lastScanTime = Date.now();
    this.dirty = true;
    
    await this.save();
  }

  /**
   * Check if cache is stale (older than maxAge ms)
   */
  isCacheStale(maxAgeMs: number = 300000): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.lastScanTime > maxAgeMs;
  }

  /**
   * Get last scan time
   */
  getLastScanTime(): number {
    return this.cache?.lastScanTime || 0;
  }

  /**
   * Get cached file count
   */
  getCachedFileCount(): number {
    return Object.keys(this.cache?.files || {}).length;
  }

  /**
   * Clear cache
   */
  async clear(): Promise<void> {
    this.initializeCache();
    try {
      await fs.unlink(this.cachePath);
    } catch (err) {
      // File doesn't exist, ignore
    }
  }
}
