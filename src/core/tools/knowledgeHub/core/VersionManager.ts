/**
 * Version Manager
 * Handles document versioning and history
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  DocumentVersion,
  VersionMetadata,
  KnowledgeDocument,
  VersionNotFoundError,
  KnowledgeHubError
} from '../types.js';
import {
  safeReadFile,
  safeWriteFile,
  fileExists,
  ensureDirectory,
  listFilesRecursive
} from '../utils/fileUtils.js';
import { getVersionsPath } from '../utils/configUtils.js';

export class VersionManager {
  constructor(private projectPath: string) {}
  
  /**
   * Create a new version of a document
   */
  async createVersion(
    document: KnowledgeDocument,
    metadata: VersionMetadata
  ): Promise<string> {
    try {
      // Generate version number
      const version = await this.generateVersionNumber(document.id);
      
      // Create version object
      const docVersion: DocumentVersion = {
        version,
        document_id: document.id,
        content: document.content,
        metadata,
        created_at: new Date()
      };
      
      // Ensure versions directory exists
      const versionsDir = getVersionsPath(this.projectPath, document.id);
      await ensureDirectory(versionsDir);
      
      // Save version file
      const versionPath = this.getVersionPath(document.id, version);
      await this.saveVersion(versionPath, docVersion);
      
      // Update version registry
      await this.updateVersionRegistry(document.id, version, metadata);
      
      // Prune old versions if needed
      await this.pruneOldVersions(document.id);
      
      return version;
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Failed to create version: ${error.message}`,
        'VERSION_CREATE_ERROR',
        { document_id: document.id, error: error.message }
      );
    }
  }
  
  /**
   * Get specific version of a document
   */
  async getVersion(
    documentId: string,
    version: string
  ): Promise<DocumentVersion> {
    const versionPath = this.getVersionPath(documentId, version);
    
    if (!(await fileExists(versionPath))) {
      throw new VersionNotFoundError(documentId, version);
    }
    
    try {
      const content = await safeReadFile(versionPath);
      const docVersion = yaml.load(content) as DocumentVersion;
      
      // Convert date string back to Date object
      docVersion.created_at = new Date(docVersion.created_at);
      
      return docVersion;
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Failed to load version: ${error.message}`,
        'VERSION_LOAD_ERROR',
        { documentId, version, error: error.message }
      );
    }
  }
  
  /**
   * Get version history for a document
   */
  async getHistory(
    documentId: string,
    limit: number = 10
  ): Promise<DocumentVersion[]> {
    const versionsDir = getVersionsPath(this.projectPath, documentId);
    
    if (!(await fileExists(versionsDir))) {
      return [];
    }
    
    try {
      // List all version files
      const files = await listFilesRecursive(versionsDir, (file) => 
        file.endsWith('.yaml')
      );
      
      // Sort by filename (version number) in descending order
      files.sort((a, b) => {
        const versionA = this.extractVersionFromPath(a);
        const versionB = this.extractVersionFromPath(b);
        return this.compareVersionStrings(versionB, versionA);
      });
      
      // Load versions (up to limit)
      const versions: DocumentVersion[] = [];
      const filesToLoad = files.slice(0, limit);
      
      for (const file of filesToLoad) {
        const version = this.extractVersionFromPath(file);
        const docVersion = await this.getVersion(documentId, version);
        versions.push(docVersion);
      }
      
      return versions;
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Failed to get version history: ${error.message}`,
        'VERSION_HISTORY_ERROR',
        { documentId, error: error.message }
      );
    }
  }
  
  /**
   * Delete a specific version
   */
  async deleteVersion(documentId: string, version: string): Promise<void> {
    const versionPath = this.getVersionPath(documentId, version);
    
    if (!(await fileExists(versionPath))) {
      throw new VersionNotFoundError(documentId, version);
    }
    
    try {
      const fs = await import('fs/promises');
      await fs.unlink(versionPath);
      
      // Update registry
      await this.removeFromRegistry(documentId, version);
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Failed to delete version: ${error.message}`,
        'VERSION_DELETE_ERROR',
        { documentId, version, error: error.message }
      );
    }
  }
  
  /**
   * Get latest version number for a document
   */
  async getLatestVersion(documentId: string): Promise<string | null> {
    const history = await this.getHistory(documentId, 1);
    
    if (history.length === 0) {
      return null;
    }
    
    return history[0].version;
  }
  
  /**
   * Compare two versions
   */
  async compareVersions(
    documentId: string,
    version1: string,
    version2: string
  ): Promise<{ v1: DocumentVersion; v2: DocumentVersion }> {
    const v1 = await this.getVersion(documentId, version1);
    const v2 = await this.getVersion(documentId, version2);
    
    return { v1, v2 };
  }
  
  // ===== Private Helper Methods =====
  
  private getVersionPath(documentId: string, version: string): string {
    const versionsDir = getVersionsPath(this.projectPath, documentId);
    return path.join(versionsDir, `${version}.yaml`);
  }
  
  private getRegistryPath(documentId: string): string {
    const versionsDir = getVersionsPath(this.projectPath, documentId);
    return path.join(versionsDir, 'registry.yaml');
  }
  
  private async saveVersion(
    versionPath: string,
    docVersion: DocumentVersion
  ): Promise<void> {
    const yamlContent = yaml.dump(docVersion, {
      indent: 2,
      lineWidth: 100,
      noRefs: true
    });
    
    await safeWriteFile(versionPath, yamlContent);
  }
  
  private async generateVersionNumber(documentId: string): Promise<string> {
    const latest = await this.getLatestVersion(documentId);
    
    if (!latest) {
      return '1.0.0';
    }
    
    // Parse semantic version
    const parts = latest.split('.').map(Number);
    
    // Increment patch version
    parts[2]++;
    
    return parts.join('.');
  }
  
  private extractVersionFromPath(filePath: string): string {
    const basename = path.basename(filePath, '.yaml');
    return basename;
  }
  
  private compareVersionStrings(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    
    return 0;
  }
  
  private async updateVersionRegistry(
    documentId: string,
    version: string,
    metadata: VersionMetadata
  ): Promise<void> {
    const registryPath = this.getRegistryPath(documentId);
    
    // Load existing registry or create new
    let registry: any = {
      document_id: documentId,
      versions: []
    };
    
    if (await fileExists(registryPath)) {
      const content = await safeReadFile(registryPath);
      registry = yaml.load(content) || registry;
    }
    
    // Add new version entry
    registry.versions.push({
      version,
      created_at: new Date().toISOString(),
      trigger: metadata.trigger,
      author: metadata.author
    });
    
    // Save registry
    const yamlContent = yaml.dump(registry, {
      indent: 2,
      noRefs: true
    });
    
    await safeWriteFile(registryPath, yamlContent);
  }
  
  private async removeFromRegistry(
    documentId: string,
    version: string
  ): Promise<void> {
    const registryPath = this.getRegistryPath(documentId);
    
    if (!(await fileExists(registryPath))) {
      return;
    }
    
    const content = await safeReadFile(registryPath);
    const registry = yaml.load(content) as any;
    
    // Remove version from list
    registry.versions = registry.versions.filter(
      (v: any) => v.version !== version
    );
    
    // Save updated registry
    const yamlContent = yaml.dump(registry, {
      indent: 2,
      noRefs: true
    });
    
    await safeWriteFile(registryPath, yamlContent);
  }
  
  /**
   * Prune old versions (keep only N most recent)
   */
  private async pruneOldVersions(
    documentId: string,
    keepCount: number = 10
  ): Promise<void> {
    const history = await this.getHistory(documentId, 999);
    
    if (history.length <= keepCount) {
      return;
    }
    
    // Get versions to delete (oldest ones)
    const toDelete = history.slice(keepCount);
    
    for (const version of toDelete) {
      await this.deleteVersion(documentId, version.version);
    }
  }
}

