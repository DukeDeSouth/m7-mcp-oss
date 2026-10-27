import { createLogger } from '../../../utils/logger.js';
const log = createLogger('[AutoSyncTriggers]');
/**
 * Auto-sync Triggers
 * Automatic synchronization on M7 events
 * v5.0: Memory parameter removed - triggers don't need direct memory access
 */

import { KnowledgeHub } from '../core/KnowledgeHub.js';
import { JournalSystem } from '../../../../journal/journalSystem.js';

export interface TriggerConfig {
  enabled: boolean;
  on_session_complete: boolean;
  on_schema_update: boolean;
  on_type_change: boolean;
  on_tool_add: boolean;
}

export class AutoSyncTriggers {
  private config: TriggerConfig;
  private hub: KnowledgeHub;
  private journal: JournalSystem;
  
  constructor(
    hub: KnowledgeHub,
    journal: JournalSystem,
    config?: Partial<TriggerConfig>
  ) {
    this.hub = hub;
    this.journal = journal;
    
    // Default config
    this.config = {
      enabled: true,
      on_session_complete: true,
      on_schema_update: true,
      on_type_change: true,
      on_tool_add: true,
      ...config
    };
  }
  
  /**
   * Enable auto-sync triggers
   */
  enable() {
    this.config.enabled = true;
    log.debug('Knowledge Hub] Auto-sync triggers enabled');
  }
  
  /**
   * Disable auto-sync triggers
   */
  disable() {
    this.config.enabled = false;
    log.debug('Knowledge Hub] Auto-sync triggers disabled');
  }
  
  /**
   * Trigger sync on M7 session completion
   */
  async onSessionComplete(sessionId: string): Promise<void> {
    if (!this.config.enabled || !this.config.on_session_complete) {
      return;
    }
    
    log.debug(`Knowledge Hub] Session completed: ${sessionId}, triggering sync...`);
    
    try {
      // Sync all documents
      const result = await this.hub.sync(true); // auto_sync = true
      
      if (result.success) {
        log.debug(`Knowledge Hub] Auto-sync completed after session ${sessionId}`);
        log.debug(`Knowledge Hub] Updated: ${result.updated} documents`);
        
        // Memory integration can be added later if needed
      }
    } catch (error: any) {
      log.debug(`Knowledge Hub] Auto-sync failed:`, error.message);
      
      // Journal integration can be added later if needed
    }
  }
  
  /**
   * Trigger update on schema changes
   */
  async onSchemaUpdate(changes: string[]): Promise<void> {
    if (!this.config.enabled || !this.config.on_schema_update) {
      return;
    }
    
    log.debug('Knowledge Hub] Schema updated, triggering PROJECT_STRUCTURE sync...');
    
    try {
      // Update PROJECT_STRUCTURE document
      const result = await this.hub.updateDocument('PROJECT_STRUCTURE');
      
      if (result.success && result.updated) {
        log.debug('Knowledge Hub] PROJECT_STRUCTURE updated after schema change');
      }
    } catch (error: any) {
      log.debug('Knowledge Hub] Schema update trigger failed:', error.message);
    }
  }
  
  /**
   * Trigger update on TypeScript type changes
   */
  async onTypeChange(files: string[]): Promise<void> {
    if (!this.config.enabled || !this.config.on_type_change) {
      return;
    }
    
    log.debug(`Knowledge Hub] Type changes detected in ${files.length} files, triggering FIELD_DICTIONARY sync...`);
    
    try {
      // Update FIELD_DICTIONARY document
      const result = await this.hub.updateDocument('FIELD_DICTIONARY');
      
      if (result.success && result.updated) {
        log.debug('Knowledge Hub] FIELD_DICTIONARY updated after type changes');
        log.debug(`Knowledge Hub] Affected files: ${files.join(', ')}`);
        
        // Memory integration can be added later if needed
      }
    } catch (error: any) {
      log.debug('Knowledge Hub] Type change trigger failed:', error.message);
    }
  }
  
  /**
   * Trigger update on new MCP tool addition
   */
  async onToolAdd(toolName: string): Promise<void> {
    if (!this.config.enabled || !this.config.on_tool_add) {
      return;
    }
    
    log.debug(`Knowledge Hub] New tool added: ${toolName}, triggering INDEX sync...`);
    
    try {
      // Update INDEX document
      const result = await this.hub.updateDocument('INDEX');
      
      if (result.success && result.updated) {
        log.debug('Knowledge Hub] INDEX updated after tool addition');
      }
    } catch (error: any) {
      log.debug('Knowledge Hub] Tool add trigger failed:', error.message);
    }
  }
  
  /**
   * Manual trigger for any document update
   */
  async trigger(documentId: string, reason: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    
    log.debug(`Knowledge Hub] Manual trigger: ${documentId} (${reason})`);
    
    try {
      const result = await this.hub.updateDocument(documentId);
      
      if (result.success) {
        log.debug(`Knowledge Hub] ${documentId} updated: ${result.message}`);
      }
    } catch (error: any) {
      log.debug(`Knowledge Hub] Manual trigger failed:`, error.message);
    }
  }
  
  /**
   * Get trigger configuration
   */
  getConfig(): TriggerConfig {
    return { ...this.config };
  }
  
  /**
   * Update trigger configuration
   */
  updateConfig(updates: Partial<TriggerConfig>): void {
    this.config = { ...this.config, ...updates };
    log.debug('Knowledge Hub] Trigger config updated:', this.config);
  }
}

/**
 * Create and register auto-sync triggers
 * v5.0: Memory parameter removed
 */
export function createAutoSyncTriggers(
  hub: KnowledgeHub,
  journal: JournalSystem,
  config?: Partial<TriggerConfig>
): AutoSyncTriggers {
  const triggers = new AutoSyncTriggers(hub, journal, config);
  
  log.debug('Knowledge Hub] Auto-sync triggers initialized');
  
  return triggers;
}

