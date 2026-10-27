/**
 * Knowledge Hub Types
 * Complete type definitions for the Knowledge Hub system
 */

import { z } from 'zod';

// ===== CONFIGURATION TYPES =====

export interface KnowledgeHubConfig {
  version: string;
  initialized_at: string;
  hub_path: string;
  auto_sync: AutoSyncConfig;
  documents: DocumentConfig[];
  versioning: VersioningConfig;
  migration: MigrationConfig;
}

export interface AutoSyncConfig {
  enabled: boolean;
  require_confirmation: boolean;
  triggers: {
    on_session_complete: boolean;
    on_schema_update: boolean;
    on_type_change: boolean;
    on_tool_add: boolean;
  };
}

export interface DocumentConfig {
  id: string;
  name: string;
  path: string;              // Relative to knowledge-hub/
  auto_update: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  generators: string[];      // Generator IDs
  triggers?: string[];       // Trigger events
  update_frequency?: 'on_demand' | 'daily' | 'weekly';
}

export interface VersioningConfig {
  enabled: boolean;
  strategy: 'semantic' | 'timestamp';
  auto_commit: boolean;
  retain_versions: number;
}

export interface MigrationConfig {
  backup_original: boolean;
  backup_location: string;
  update_references: boolean;
}

// ===== DOCUMENT TYPES =====

export interface KnowledgeDocument {
  id: string;
  name: string;
  path: string;
  content: string;
  metadata: DocumentMetadata;
  version: string;
}

export interface DocumentMetadata {
  created_at: string;
  updated_at: string;
  last_generated: string;
  generator: string;
  auto_generated: boolean;
  manual_edits: boolean;
}

// ===== VERSION TYPES =====

export interface DocumentVersion {
  version: string;
  document_id: string;
  content: string;
  metadata: VersionMetadata;
  created_at: Date;
}

export interface VersionMetadata {
  changes: string[];
  trigger: 'manual' | 'auto' | 'session_complete' | 'schema_update' | 'type_change';
  session_id?: string;
  author: 'system' | 'user';
}

// ===== DIFF TYPES =====

export interface DocumentDiff {
  document_id: string;
  old_version: string;
  new_version: string;
  changes: Change[];
  summary: DiffSummary;
}

export interface Change {
  type: 'add' | 'remove' | 'modify';
  line_number: number;
  old_content?: string;
  new_content?: string;
}

export interface DiffSummary {
  lines_added: number;
  lines_removed: number;
  lines_modified: number;
  sections_affected: string[];
}

// ===== SCANNER TYPES =====

export interface ScanResult<T> {
  success: boolean;
  data: T;
  timestamp: Date;
  scan_time_ms: number;
  errors?: string[];
}

export interface TypeScanData {
  interfaces: InterfaceInfo[];
  types: TypeAliasInfo[];
  enums: EnumInfo[];
  classes: ClassInfo[];
}

export interface InterfaceInfo {
  name: string;
  file: string;
  exported: boolean;
  fields: FieldInfo[];
  extends?: string[];
  description?: string;
}

export interface FieldInfo {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

export interface TypeAliasInfo {
  name: string;
  file: string;
  exported: boolean;
  type: string;
  description?: string;
}

export interface EnumInfo {
  name: string;
  file: string;
  exported: boolean;
  members: EnumMember[];
  description?: string;
}

export interface EnumMember {
  name: string;
  value?: string | number;
}

export interface ClassInfo {
  name: string;
  file: string;
  exported: boolean;
  methods: MethodInfo[];
  properties: PropertyInfo[];
  description?: string;
}

export interface MethodInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  description?: string;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  description?: string;
}

// ===== RESULT TYPES =====

export interface InitResult {
  success: boolean;
  hub_path: string;
  documents_created?: number;
  documents_migrated?: number;
  config?: KnowledgeHubConfig;
  error?: string;
  next_steps?: string[];
}

export interface SyncResult {
  success: boolean;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  results: DocumentSyncResult[];
}

export interface DocumentSyncResult {
  success: boolean;
  document_id: string;
  updated: boolean;
  skipped: boolean;
  error?: string;
  message?: string;
}

export interface UpdateResult {
  success: boolean;
  updated: boolean;
  document_id: string;
  version?: string;
  changes?: DiffSummary;
  requires_confirmation?: boolean;
  diff?: DocumentDiff;
  preview?: string;
  message?: string;
}

export interface MigrationResult {
  success: boolean;
  message: string;
  migrated_count: number;
  migrated_files?: MigratedFile[];
  backup_location?: string;
  errors?: string[];
}

export interface MigratedFile {
  original_path: string;
  new_path: string;
  size: number;
}

export interface HistoryResult {
  success: boolean;
  document_id: string;
  total_versions: number;
  versions: VersionInfo[];
}

export interface VersionInfo {
  version: string;
  created_at: string;
  changes: string[];
  trigger: string;
  author: string;
}

export interface RollbackResult {
  success: boolean;
  document_id: string;
  rolled_back_to: string;
  message: string;
}

export interface StatusResult {
  success: boolean;
  initialized: boolean;
  hub_path?: string;
  documents?: DocumentStatus[];
  auto_sync_enabled?: boolean;
  last_sync?: string;
}

export interface DocumentStatus {
  id: string;
  name: string;
  exists: boolean;
  up_to_date: boolean;
  last_updated?: string;
  version?: string;
}

// ===== MIGRATION TYPES =====

export interface ExistingDocument {
  path: string;
  name: string;
  size: number;
  modified: Date;
  target_location: string;
}

export interface BackupInfo {
  timestamp: string;
  location: string;
  files: string[];
}

// ===== ZOD SCHEMAS =====

export const KnowledgeHubRequestSchema = z.object({
  action: z.enum([
    'init',
    'sync',
    'update',
    'migrate',
    'verify',
    'history',
    'add_document',
    'diff',
    'rollback',
    'status'
  ]),
  
  // Optional parameters
  document_id: z.string().optional(),
  force: z.boolean().default(false),
  require_confirmation: z.boolean().default(true),
  version: z.string().optional(),
  
  // For add_document
  document_config: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    auto_update: z.boolean(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    generators: z.array(z.string())
  }).optional(),
  
  // For diff
  from_version: z.string().optional(),
  to_version: z.string().optional()
});

export type KnowledgeHubRequest = z.infer<typeof KnowledgeHubRequestSchema>;

// Config schema for validation
export const KnowledgeHubConfigSchema = z.object({
  version: z.string(),
  initialized_at: z.string(),
  hub_path: z.string(),
  auto_sync: z.object({
    enabled: z.boolean(),
    require_confirmation: z.boolean(),
    triggers: z.object({
      on_session_complete: z.boolean(),
      on_schema_update: z.boolean(),
      on_type_change: z.boolean(),
      on_tool_add: z.boolean()
    })
  }),
  documents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    auto_update: z.boolean(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    generators: z.array(z.string()),
    triggers: z.array(z.string()).optional(),
    update_frequency: z.enum(['on_demand', 'daily', 'weekly']).optional()
  })),
  versioning: z.object({
    enabled: z.boolean(),
    strategy: z.enum(['semantic', 'timestamp']),
    auto_commit: z.boolean(),
    retain_versions: z.number().min(1).max(100)
  }),
  migration: z.object({
    backup_original: z.boolean(),
    backup_location: z.string(),
    update_references: z.boolean()
  })
});

// ===== CONSTANTS =====

export const KNOWLEDGE_HUB_VERSION = '1.0.0';

export const DEFAULT_HUB_PATH = 'knowledge-hub';

export const DEFAULT_DOCUMENTS: DocumentConfig[] = [
  {
    id: 'INDEX',
    name: 'Project Index',
    path: 'core/INDEX.md',
    auto_update: true,
    priority: 'critical',
    generators: ['project_scanner', 'documentation_scanner'],
    update_frequency: 'on_demand'
  },
  {
    id: 'FIELD_DICTIONARY',
    name: 'Field Dictionary',
    path: 'core/FIELD_DICTIONARY.md',
    auto_update: true,
    priority: 'critical',
    generators: ['type_scanner', 'validation_scanner'],
    triggers: ['type_change']
  },
  {
    id: 'PROJECT_STRUCTURE',
    name: 'Project Structure',
    path: 'core/PROJECT_STRUCTURE.md',
    auto_update: true,
    priority: 'high',
    generators: ['structure_scanner']
  }
];

export const HUB_DIRECTORIES = [
  'core',
  'api',
  'tech',
  'methodology',
  'versions',
  'config',
  '.migrations'
] as const;

export const CONFIG_FILE_NAME = 'hub-config.yaml';
export const METADATA_FILE_NAME = 'metadata.yaml';
export const MIGRATION_LOG_FILE = 'migration-log.yaml';

// ===== ERROR TYPES =====

export class KnowledgeHubError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'KnowledgeHubError';
  }
}

export class MigrationError extends KnowledgeHubError {
  constructor(message: string, details?: any) {
    super(message, 'MIGRATION_ERROR', details);
    this.name = 'MigrationError';
  }
}

export class ValidationError extends KnowledgeHubError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class DocumentNotFoundError extends KnowledgeHubError {
  constructor(documentId: string) {
    super(`Document not found: ${documentId}`, 'DOCUMENT_NOT_FOUND', { documentId });
    this.name = 'DocumentNotFoundError';
  }
}

export class VersionNotFoundError extends KnowledgeHubError {
  constructor(documentId: string, version: string) {
    super(
      `Version ${version} not found for document ${documentId}`,
      'VERSION_NOT_FOUND',
      { documentId, version }
    );
    this.name = 'VersionNotFoundError';
  }
}

