/**
 * Document Manager
 * Handles CRUD operations for Knowledge Hub documents
 */

import * as path from 'path';
import {
  KnowledgeDocument,
  DocumentMetadata,
  DocumentNotFoundError,
  KnowledgeHubError
} from '../types.js';
import {
  safeReadFile,
  safeWriteFile,
  fileExists,
  ensureDirectory,
  getFileStats
} from '../utils/fileUtils.js';
import { getDocumentPath, getHubPath } from '../utils/configUtils.js';

export class DocumentManager {
  constructor(private projectPath: string) {}
  
  /**
   * Load document by path
   */
  async load(documentPath: string): Promise<KnowledgeDocument> {
    const fullPath = this.getFullPath(documentPath);
    
    // Check if file exists
    if (!(await fileExists(fullPath))) {
      throw new DocumentNotFoundError(documentPath);
    }
    
    try {
      // Read file content
      const content = await safeReadFile(fullPath);
      
      // Get file stats
      const stats = await getFileStats(fullPath);
      
      // Extract metadata if present in frontmatter
      const { metadata, cleanContent } = this.extractMetadata(content);
      
      // Build document object
      const document: KnowledgeDocument = {
        id: this.getDocumentId(documentPath),
        name: path.basename(documentPath),
        path: documentPath,
        content: cleanContent,
        metadata: {
          created_at: metadata?.created_at || stats.birthtime.toISOString(),
          updated_at: stats.mtime.toISOString(),
          last_generated: metadata?.last_generated || stats.mtime.toISOString(),
          generator: metadata?.generator || 'unknown',
          auto_generated: metadata?.auto_generated ?? false,
          manual_edits: metadata?.manual_edits ?? false
        },
        version: metadata?.version || '1.0.0'
      };
      
      return document;
    } catch (error: any) {
      if (error instanceof DocumentNotFoundError) {
        throw error;
      }
      
      throw new KnowledgeHubError(
        `Failed to load document: ${error.message}`,
        'DOCUMENT_LOAD_ERROR',
        { documentPath, error: error.message }
      );
    }
  }
  
  /**
   * Save document
   */
  async save(
    documentPath: string,
    content: string,
    metadata?: Partial<DocumentMetadata>
  ): Promise<void> {
    const fullPath = this.getFullPath(documentPath);
    
    try {
      // Ensure parent directory exists
      await ensureDirectory(path.dirname(fullPath));
      
      // Update metadata
      const now = new Date().toISOString();
      const updatedMetadata: DocumentMetadata = {
        created_at: metadata?.created_at || now,
        updated_at: now,
        last_generated: metadata?.last_generated || now,
        generator: metadata?.generator || 'manual',
        auto_generated: metadata?.auto_generated ?? false,
        manual_edits: metadata?.manual_edits ?? false
      };
      
      // Combine content with metadata (as comment at top of file)
      const fullContent = this.embedMetadata(content, updatedMetadata);
      
      // Write file (atomic)
      await safeWriteFile(fullPath, fullContent);
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Failed to save document: ${error.message}`,
        'DOCUMENT_SAVE_ERROR',
        { documentPath, error: error.message }
      );
    }
  }
  
  /**
   * Check if document exists
   */
  async exists(documentPath: string): Promise<boolean> {
    const fullPath = this.getFullPath(documentPath);
    return await fileExists(fullPath);
  }
  
  /**
   * Delete document
   */
  async delete(documentPath: string): Promise<void> {
    const fullPath = this.getFullPath(documentPath);
    
    if (!(await fileExists(fullPath))) {
      throw new DocumentNotFoundError(documentPath);
    }
    
    try {
      const fs = await import('fs/promises');
      await fs.unlink(fullPath);
    } catch (error: any) {
      throw new KnowledgeHubError(
        `Failed to delete document: ${error.message}`,
        'DOCUMENT_DELETE_ERROR',
        { documentPath, error: error.message }
      );
    }
  }
  
  /**
   * List all documents in a directory
   */
  async listDocuments(dirPath: string = ''): Promise<string[]> {
    const fullPath = path.join(getHubPath(this.projectPath), dirPath);
    
    try {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      const documents: string[] = [];
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const relativePath = path.join(dirPath, entry.name);
          documents.push(relativePath);
        }
      }
      
      return documents;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      
      throw new KnowledgeHubError(
        `Failed to list documents: ${error.message}`,
        'DOCUMENT_LIST_ERROR',
        { dirPath, error: error.message }
      );
    }
  }
  
  /**
   * Get document metadata
   */
  async getMetadata(documentPath: string): Promise<DocumentMetadata> {
    const document = await this.load(documentPath);
    return document.metadata;
  }
  
  /**
   * Update document metadata
   */
  async updateMetadata(
    documentPath: string,
    metadata: Partial<DocumentMetadata>
  ): Promise<void> {
    // Load current document
    const document = await this.load(documentPath);
    
    // Merge metadata
    const updatedMetadata = {
      ...document.metadata,
      ...metadata,
      updated_at: new Date().toISOString()
    };
    
    // Save with updated metadata
    await this.save(documentPath, document.content, updatedMetadata);
  }
  
  // ===== Private Helper Methods =====
  
  private getFullPath(documentPath: string): string {
    return getDocumentPath(this.projectPath, documentPath);
  }
  
  private getDocumentId(documentPath: string): string {
    // Extract document ID from path
    // e.g., "core/INDEX.md" -> "INDEX"
    const basename = path.basename(documentPath, '.md');
    return basename.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }
  
  /**
   * Extract metadata from document content (HTML comment format)
   */
  private extractMetadata(content: string): {
    metadata: Partial<DocumentMetadata & { version?: string }>;
    cleanContent: string;
  } {
    // Look for HTML comment with metadata at start of file
    const metadataRegex = /^<!--\s*KNOWLEDGE_HUB_METADATA\s*\n([\s\S]*?)\n-->\s*\n/;
    const match = content.match(metadataRegex);
    
    if (!match) {
      return { metadata: {}, cleanContent: content };
    }
    
    try {
      // Parse JSON from comment
      const metadataJson = match[1].trim();
      const metadata = JSON.parse(metadataJson);
      
      // Remove metadata comment from content
      const cleanContent = content.replace(metadataRegex, '');
      
      return { metadata, cleanContent };
    } catch {
      // If parsing fails, return original content
      return { metadata: {}, cleanContent: content };
    }
  }
  
  /**
   * Embed metadata into document content (as HTML comment)
   */
  private embedMetadata(
    content: string,
    metadata: DocumentMetadata
  ): string {
    // Create metadata comment
    const metadataComment = `<!-- KNOWLEDGE_HUB_METADATA
${JSON.stringify(metadata, null, 2)}
-->

`;
    
    // Prepend to content
    return metadataComment + content;
  }
}

