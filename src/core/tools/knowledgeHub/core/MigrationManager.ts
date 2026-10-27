/**
 * Migration Manager
 * Handles safe migration of existing documents to Knowledge Hub
 */

import * as path from 'path';
import {
  ExistingDocument,
  MigrationResult,
  MigratedFile,
  MigrationError
} from '../types.js';
import {
  fileExists,
  safeMoveFile,
  getFileStats,
  listFilesRecursive
} from '../utils/fileUtils.js';
import { createBackup } from '../utils/backupUtils.js';
import { getHubPath } from '../utils/configUtils.js';

// Known document patterns to migrate
const KNOWN_DOCUMENTS = [
  'INDEX.md',
  'FIELD_DICTIONARY.md',
  'PROJECT_STRUCTURE.md',
  'API_REFERENCE.md',
  'TECH_STACK.md'
];

export class MigrationManager {
  constructor(private projectPath: string) {}
  
  /**
   * Scan for existing documents that should be migrated
   */
  async scanExistingDocuments(): Promise<ExistingDocument[]> {
    const existing: ExistingDocument[] = [];
    
    for (const docName of KNOWN_DOCUMENTS) {
      const docPath = path.join(this.projectPath, docName);
      
      if (await fileExists(docPath)) {
        const stats = await getFileStats(docPath);
        
        // Determine target location based on document name
        const targetLocation = this.determineTargetLocation(docName);
        
        existing.push({
          path: docPath,
          name: docName,
          size: Number(stats.size),
          modified: stats.mtime,
          target_location: targetLocation
        });
      }
    }
    
    return existing;
  }
  
  /**
   * Migrate documents to Knowledge Hub
   */
  async migrate(documents: ExistingDocument[]): Promise<MigrationResult> {
    if (documents.length === 0) {
      return {
        success: true,
        message: 'No documents to migrate',
        migrated_count: 0
      };
    }
    
    try {
      // Create backup first
      const filePaths = documents.map(d => d.path);
      const backup = await createBackup(
        filePaths,
        this.projectPath,
        '.m7/backups/knowledge-hub/'
      );
      
      // Migrate each document
      const migratedFiles: MigratedFile[] = [];
      const errors: string[] = [];
      
      for (const doc of documents) {
        try {
          const newPath = await this.migrateDocument(doc);
          
          migratedFiles.push({
            original_path: doc.path,
            new_path: newPath,
            size: doc.size
          });
        } catch (error: any) {
          errors.push(`Failed to migrate ${doc.name}: ${error.message}`);
        }
      }
      
      // If any migrations failed, we still consider it partial success
      const success = migratedFiles.length > 0;
      
      return {
        success,
        message: success 
          ? `Successfully migrated ${migratedFiles.length} documents`
          : 'Migration failed',
        migrated_count: migratedFiles.length,
        migrated_files: migratedFiles,
        backup_location: backup.location,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error: any) {
      throw new MigrationError(
        `Migration failed: ${error.message}`,
        { error: error.message }
      );
    }
  }
  
  /**
   * Migrate a single document
   */
  private async migrateDocument(doc: ExistingDocument): Promise<string> {
    const targetPath = path.join(
      getHubPath(this.projectPath),
      doc.target_location
    );
    
    // Move file
    await safeMoveFile(doc.path, targetPath);
    
    return targetPath;
  }
  
  /**
   * Determine target location for a document
   */
  private determineTargetLocation(docName: string): string {
    // Map document names to their target locations
    const locationMap: Record<string, string> = {
      'INDEX.md': 'core/INDEX.md',
      'FIELD_DICTIONARY.md': 'core/FIELD_DICTIONARY.md',
      'PROJECT_STRUCTURE.md': 'core/PROJECT_STRUCTURE.md',
      'API_REFERENCE.md': 'api/API_REFERENCE.md',
      'TECH_STACK.md': 'tech/TECH_STACK.md'
    };
    
    return locationMap[docName] || `core/${docName}`;
  }
  
  /**
   * Check if migration is needed
   */
  async isMigrationNeeded(): Promise<boolean> {
    const existing = await this.scanExistingDocuments();
    return existing.length > 0;
  }
  
  /**
   * Get migration report
   */
  async getMigrationReport(): Promise<{
    documents_found: number;
    total_size: number;
    documents: ExistingDocument[];
  }> {
    const documents = await this.scanExistingDocuments();
    const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
    
    return {
      documents_found: documents.length,
      total_size: totalSize,
      documents
    };
  }
}

