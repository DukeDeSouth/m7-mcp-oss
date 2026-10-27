import { createLogger } from '../../../utils/logger.js';
const log = createLogger('[KnowledgeHub]');
/**
 * Knowledge Hub Main Class
 * Orchestrates all Knowledge Hub operations
 * v5.0: Uses UnifiedMemoryCore instead of MemorySystem
 */

import * as path from 'path';
import { JournalSystem } from '../../../../journal/journalSystem.js';
import { getMemoryCore, UnifiedMemoryCore } from '../../../../memory/auto/unified-memory-core.js';
import { DocumentManager } from './DocumentManager.js';
import { VersionManager } from './VersionManager.js';
import { MigrationManager } from './MigrationManager.js';
import { DocumentGenerator } from '../generators/DocumentGenerator.js';
import {
  KnowledgeHubConfig,
  InitResult,
  SyncResult,
  UpdateResult,
  MigrationResult,
  HistoryResult,
  RollbackResult,
  StatusResult,
  DocumentSyncResult,
  DocumentStatus,
  KnowledgeHubError,
  DocumentConfig
} from '../types.js';
import {
  loadConfig,
  saveConfig,
  isInitialized,
  generateDefaultConfig,
  getHubPath,
  getDocumentConfig,
  getHubDirectories
} from '../utils/configUtils.js';
import { fileExists, ensureDirectory } from '../utils/fileUtils.js';

export class KnowledgeHub {
  private config?: KnowledgeHubConfig;
  private documentManager: DocumentManager;
  private versionManager: VersionManager;
  private migrationManager: MigrationManager;
  private documentGenerator: DocumentGenerator;
  private memoryCore: UnifiedMemoryCore | null = null;
  
  // v3.9: Content hash cache to skip unnecessary generation
  private contentHashCache: Map<string, { hash: string; timestamp: number }> = new Map();
  private readonly HASH_CACHE_TTL = 60000; // 1 minute
  
  constructor(
    private projectPath: string,
    private journal: JournalSystem
  ) {
    this.documentManager = new DocumentManager(projectPath);
    this.versionManager = new VersionManager(projectPath);
    this.migrationManager = new MigrationManager(projectPath);
    this.documentGenerator = new DocumentGenerator(projectPath);
  }
  
  /**
   * v3.9: Compute simple hash for content comparison
   */
  private computeContentHash(content: string): string {
    // Simple hash using djb2 algorithm (fast, no crypto overhead)
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash) + content.charCodeAt(i);
      hash = hash >>> 0; // Convert to unsigned 32-bit
    }
    return hash.toString(36);
  }
  
  /**
   * v3.9: Check if document content hash matches cached hash
   */
  private isContentUnchanged(documentId: string, currentContent: string): boolean {
    const cached = this.contentHashCache.get(documentId);
    if (!cached) return false;
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.HASH_CACHE_TTL) {
      this.contentHashCache.delete(documentId);
      return false;
    }
    
    const currentHash = this.computeContentHash(currentContent);
    return cached.hash === currentHash;
  }
  
  /**
   * v3.9: Update content hash cache
   */
  private updateContentHash(documentId: string, content: string): void {
    this.contentHashCache.set(documentId, {
      hash: this.computeContentHash(content),
      timestamp: Date.now()
    });
  }
  
  /**
   * Initialize Knowledge Hub in project
   */
  async init(force: boolean = false): Promise<InitResult> {
    const hubPath = getHubPath(this.projectPath);
    
    // Check if already initialized
    if (!force) {
      const initialized = await isInitialized(this.projectPath);
      if (initialized) {
        return {
          success: false,
          error: 'Knowledge Hub already initialized. Use force=true to reinitialize.',
          hub_path: hubPath
        };
      }
    }
    
    try {
      // Create directory structure
      await this.createDirectoryStructure();
      
      // Generate default config
      const config = generateDefaultConfig();
      await saveConfig(this.projectPath, config);
      this.config = config;
      
      // Scan for existing documents to migrate
      const existingDocs = await this.migrationManager.scanExistingDocuments();
      
      let migrationResult: MigrationResult | undefined;
      if (existingDocs.length > 0) {
        // Auto-migrate if found
        migrationResult = await this.migrationManager.migrate(existingDocs);
      }
      
      // Generate missing core documents (if any)
      await this.generateMissingDocuments();
      
      // Log to journal
      await this.journal.logFeature({
        name: 'Knowledge Hub Initialized',
        description: 'Knowledge Hub system initialized in project',
        implementation: `Created at ${hubPath}`,
        lessons: [],
        patterns: ['knowledge-management'],
        complexity: 'medium'
      });
      
      // v5.0: Store in unified memory
      try {
        if (!this.memoryCore) {
          this.memoryCore = await getMemoryCore();
        }
        await this.memoryCore.store(
          JSON.stringify({
            type: 'knowledge_hub_init',
            initialized_at: new Date().toISOString(),
            hub_path: hubPath,
            documents: config.documents.length,
            migrated: migrationResult?.migrated_count || 0
          }),
          {
            level: 'L2',
            source: 'runtime',
            contextKeys: ['knowledge-hub', 'init', 'project'],
            confidence: 1.0
          }
        );
      } catch (memError) {
        // Non-critical, continue
      }
      
      return {
        success: true,
        hub_path: hubPath,
        documents_created: config.documents.length,
        documents_migrated: migrationResult?.migrated_count || 0,
        config: config,
        next_steps: [
          'Review generated documents in knowledge-hub/',
          'Customize hub-config.yaml if needed',
          'Run @m7 knowledge_hub verify to validate setup',
          'Documents will auto-sync when you complete M7 sessions'
        ]
      };
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Initialization failed: ${error.message}`,
        'INIT_ERROR',
        { error: error.message }
      );
    }
  }
  
  /**
   * Sync all documents
   * v3.9: Uses content hash cache to skip unchanged documents
   */
  async sync(requireConfirmation: boolean = true): Promise<SyncResult> {
    await this.ensureInitialized();
    
    const startTime = Date.now();
    const results: DocumentSyncResult[] = [];
    let cacheHits = 0;
    
    for (const docConfig of this.config!.documents) {
      if (!docConfig.auto_update) {
        results.push({
          success: true,
          document_id: docConfig.id,
          updated: false,
          skipped: true,
          message: 'Auto-update disabled'
        });
        continue;
      }
      
      // v3.9: Quick hash check before full sync
      const exists = await this.documentManager.exists(docConfig.path);
      if (exists) {
        const currentDoc = await this.documentManager.load(docConfig.path);
        if (this.isContentUnchanged(docConfig.id, currentDoc.content)) {
          cacheHits++;
          results.push({
            success: true,
            document_id: docConfig.id,
            updated: false,
            skipped: true,
            message: 'Content unchanged (cache hit)'
          });
          continue;
        }
      }
      
      const result = await this.syncDocument(docConfig.id, requireConfirmation);
      results.push(result);
    }
    
    const updated = results.filter(r => r.updated).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;
    
    log.debug(`KnowledgeHub] Sync complete: ${updated} updated, ${skipped} skipped (${cacheHits} cache hits), ${elapsed}ms`);
    
    return {
      success: failed === 0,
      total: results.length,
      updated,
      skipped,
      failed,
      results
    };
  }
  
  /**
   * Update specific document using generators
   */
  async updateDocument(
    documentId: string,
    requireConfirmation: boolean = true
  ): Promise<UpdateResult> {
    await this.ensureInitialized();
    
    const docConfig = getDocumentConfig(this.config!, documentId);
    if (!docConfig) {
      throw new KnowledgeHubError(
        `Document not found: ${documentId}`,
        'DOCUMENT_NOT_FOUND',
        { documentId }
      );
    }
    
    try {
      // Generate new content using appropriate generator
      let newContent: string;
      
      switch (documentId) {
        case 'FIELD_DICTIONARY':
          newContent = await this.documentGenerator.generateFieldDictionary();
          break;
        
        case 'INDEX':
          newContent = await this.documentGenerator.generateProjectIndex();
          break;
        
        case 'PROJECT_STRUCTURE':
          newContent = await this.documentGenerator.generateProjectStructure();
          break;
        
        default:
          return {
            success: false,
            updated: false,
            document_id: documentId,
            message: `No generator found for document: ${documentId}`
          };
      }
      
      // Check if document exists
      const exists = await this.documentManager.exists(docConfig.path);
      
      if (!exists) {
        // Create new document
        await this.documentManager.save(docConfig.path, newContent, {
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_generated: new Date().toISOString(),
          generator: docConfig.generators[0] || 'auto',
          auto_generated: true,
          manual_edits: false
        });
        
        return {
          success: true,
          updated: true,
          document_id: documentId,
          message: 'Document created successfully'
        };
      }
      
      // Load current document
      const currentDoc = await this.documentManager.load(docConfig.path);
      
      // Compare content
      if (currentDoc.content.trim() === newContent.trim()) {
        // v3.9: Update hash cache for future quick checks
        this.updateContentHash(documentId, currentDoc.content);
        return {
          success: true,
          updated: false,
          document_id: documentId,
          message: 'No changes detected - document is up-to-date'
        };
      }
      
      // Create version of current document before updating
      await this.versionManager.createVersion(currentDoc, {
        changes: ['Auto-update from generators'],
        trigger: 'auto',
        author: 'system'
      });
      
      // Update document
      await this.documentManager.save(docConfig.path, newContent, {
        ...currentDoc.metadata,
        updated_at: new Date().toISOString(),
        last_generated: new Date().toISOString(),
        auto_generated: true
      });
      
      // v3.9: Update hash cache after successful update
      this.updateContentHash(documentId, newContent);
      
      return {
        success: true,
        updated: true,
        document_id: documentId,
        message: 'Document updated successfully',
        version: await this.versionManager.getLatestVersion(documentId) || undefined
      };
    } catch (error: any) {
      return {
        success: false,
        updated: false,
        document_id: documentId,
        message: `Update failed: ${error.message}`
      };
    }
  }
  
  /**
   * Migrate existing documents
   */
  async migrate(): Promise<MigrationResult> {
    const existingDocs = await this.migrationManager.scanExistingDocuments();
    
    if (existingDocs.length === 0) {
      return {
        success: true,
        message: 'No documents to migrate',
        migrated_count: 0
      };
    }
    
    return await this.migrationManager.migrate(existingDocs);
  }
  
  /**
   * Get document history
   */
  async getHistory(documentId: string, limit: number = 10): Promise<HistoryResult> {
    await this.ensureInitialized();
    
    const versions = await this.versionManager.getHistory(documentId, limit);
    
    return {
      success: true,
      document_id: documentId,
      total_versions: versions.length,
      versions: versions.map(v => ({
        version: v.version,
        created_at: v.created_at.toISOString(),
        changes: v.metadata.changes,
        trigger: v.metadata.trigger,
        author: v.metadata.author
      }))
    };
  }
  
  /**
   * Rollback document to specific version
   */
  async rollback(documentId: string, version: string): Promise<RollbackResult> {
    await this.ensureInitialized();
    
    const docConfig = getDocumentConfig(this.config!, documentId);
    if (!docConfig) {
      throw new KnowledgeHubError(
        `Document not found: ${documentId}`,
        'DOCUMENT_NOT_FOUND',
        { documentId }
      );
    }
    
    // Get the old version
    const oldVersion = await this.versionManager.getVersion(documentId, version);
    
    // Load current document
    const currentDoc = await this.documentManager.load(docConfig.path);
    
    // Create version of current before rollback
    await this.versionManager.createVersion(currentDoc, {
      changes: [`Rollback to ${version}`],
      trigger: 'manual',
      author: 'user'
    });
    
    // Restore old version content
    await this.documentManager.save(docConfig.path, oldVersion.content);
    
    return {
      success: true,
      document_id: documentId,
      rolled_back_to: version,
      message: `Document rolled back to version ${version}`
    };
  }
  
  /**
   * Get Knowledge Hub status
   */
  async getStatus(): Promise<StatusResult> {
    const initialized = await isInitialized(this.projectPath);
    
    if (!initialized) {
      return {
        success: true,
        initialized: false
      };
    }
    
    await this.ensureInitialized();
    
    // Check status of each document
    const documentStatuses: DocumentStatus[] = [];
    
    for (const docConfig of this.config!.documents) {
      const exists = await this.documentManager.exists(docConfig.path);
      
      let lastUpdated: string | undefined;
      let version: string | undefined;
      
      if (exists) {
        const metadata = await this.documentManager.getMetadata(docConfig.path);
        lastUpdated = metadata.updated_at;
        
        const latestVersion = await this.versionManager.getLatestVersion(docConfig.id);
        version = latestVersion || undefined;
      }
      
      documentStatuses.push({
        id: docConfig.id,
        name: docConfig.name,
        exists,
        up_to_date: exists, // Phase 1: assume up-to-date if exists
        last_updated: lastUpdated,
        version
      });
    }
    
    return {
      success: true,
      initialized: true,
      hub_path: getHubPath(this.projectPath),
      documents: documentStatuses,
      auto_sync_enabled: this.config!.auto_sync.enabled,
      last_sync: undefined // TODO: track last sync time
    };
  }
  
  /**
   * Check if Knowledge Hub is enabled
   */
  isEnabled(): boolean {
    return this.config?.auto_sync.enabled ?? false;
  }
  
  // ===== Private Helper Methods =====
  
  private async ensureInitialized(): Promise<void> {
    if (!this.config) {
      this.config = await loadConfig(this.projectPath);
    }
  }
  
  private async createDirectoryStructure(): Promise<void> {
    const directories = getHubDirectories(this.projectPath);
    
    for (const dir of directories) {
      await ensureDirectory(dir);
    }
  }
  
  private async syncDocument(
    documentId: string,
    requireConfirmation: boolean
  ): Promise<DocumentSyncResult> {
    try {
      const result = await this.updateDocument(documentId, requireConfirmation);
      return {
        success: result.success,
        document_id: documentId,
        updated: result.updated || false,
        skipped: result.requires_confirmation || false,
        message: result.message
      };
    } catch (error: any) {
      return {
        success: false,
        document_id: documentId,
        updated: false,
        skipped: false,
        error: error.message
      };
    }
  }
  
  private async generateMissingDocuments(): Promise<void> {
    // Phase 2: Use actual generators
    
    for (const docConfig of this.config!.documents) {
      const exists = await this.documentManager.exists(docConfig.path);
      
      if (!exists) {
        // Generate content using appropriate generator
        let content: string;
        
        try {
          switch (docConfig.id) {
            case 'FIELD_DICTIONARY':
              content = await this.documentGenerator.generateFieldDictionary();
              break;
            
            case 'INDEX':
              content = await this.documentGenerator.generateProjectIndex();
              break;
            
            case 'PROJECT_STRUCTURE':
              content = await this.documentGenerator.generateProjectStructure();
              break;
            
            default:
              // Fallback to placeholder
              content = this.generatePlaceholder(docConfig);
          }
          
          await this.documentManager.save(docConfig.path, content, {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_generated: new Date().toISOString(),
            generator: docConfig.generators[0] || 'auto',
            auto_generated: true,
            manual_edits: false
          });
        } catch (error) {
          // If generation fails, create placeholder
          const placeholder = this.generatePlaceholder(docConfig);
          await this.documentManager.save(docConfig.path, placeholder, {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_generated: new Date().toISOString(),
            generator: 'placeholder',
            auto_generated: true,
            manual_edits: false
          });
        }
      }
    }
  }
  
  private generatePlaceholder(docConfig: DocumentConfig): string {
    return `# ${docConfig.name}

**Status:** 🚧 Placeholder  
**Auto-generated:** Yes  
**Last updated:** ${new Date().toISOString()}

---

This document is awaiting generator implementation or generation failed.

**Document ID:** ${docConfig.id}  
**Priority:** ${docConfig.priority}  
**Generators:** ${docConfig.generators.join(', ')}

---

*Generated by Knowledge Hub v1.0.0 (Phase 2)*
`;
  }
}

