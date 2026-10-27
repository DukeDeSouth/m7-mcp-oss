import { createLogger } from '../../utils/logger.js';
const log = createLogger('[knowledgeHubTool]');
/**
 * Knowledge Hub MCP Tool
 * Main entry point for Knowledge Hub functionality
 * v5.0: Uses UnifiedMemoryCore instead of MemorySystem
 */

import { KnowledgeHub } from './core/KnowledgeHub.js';
import { JournalSystem } from '../../../journal/journalSystem.js';
import { KnowledgeHubRequestSchema } from './types.js';
import { generateDiff, formatDiff } from './utils/diffUtils.js';
import { getProjectPath } from '../../utils/projectPath.js';

export const knowledgeHubTool = {
  name: 'mcp_m7_knowledge_hub',
  description: 'Manage project knowledge base - centralized documentation system with versioning and auto-sync',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
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
        ],
        description: 'Action to perform'
      },
      document_id: {
        type: 'string',
        description: 'Document ID (for update, history, rollback)',
        optional: true
      },
      force: {
        type: 'boolean',
        description: 'Force operation (for init)',
        default: false
      },
      require_confirmation: {
        type: 'boolean',
        description: 'Require user confirmation for updates',
        default: true
      },
      version: {
        type: 'string',
        description: 'Version for rollback',
        optional: true
      },
      from_version: {
        type: 'string',
        description: 'Start version for diff',
        optional: true
      },
      to_version: {
        type: 'string',
        description: 'End version for diff',
        optional: true
      }
    },
    required: ['action']
  },
  
  handler: async (
    request: any,
    systems: { journal: JournalSystem }
  ) => {
    try {
      const params = KnowledgeHubRequestSchema.parse(request);
      const projectPath = getProjectPath();
      log.error(`📁 [knowledgeHub] Using project path: ${projectPath}`);
      
      const hub = new KnowledgeHub(
        projectPath,
        systems.journal
      );
      
      switch (params.action) {
        case 'init':
          return await handleInit(hub, params);
        
        case 'sync':
          return await handleSync(hub, params);
        
        case 'update':
          return await handleUpdate(hub, params);
        
        case 'migrate':
          return await handleMigrate(hub);
        
        case 'history':
          return await handleHistory(hub, params);
        
        case 'rollback':
          return await handleRollback(hub, params);
        
        case 'status':
          return await handleStatus(hub);
        
        case 'verify':
          return await handleVerify(hub);
        
        case 'diff':
          return await handleDiff(hub, params);
        
        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`,
            timestamp: new Date().toISOString()
          };
      }
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString()
      };
    }
  }
};

// ===== Action Handlers =====

async function handleInit(hub: KnowledgeHub, params: any) {
  const result = await hub.init(params.force);
  
  if (result.success) {
    return {
      ...result,
      message: formatSuccessMessage('Knowledge Hub initialized successfully!', [
        `📁 Created structure at: ${result.hub_path}`,
        `📄 Generated ${result.documents_created} documents`,
        result.documents_migrated 
          ? `📦 Migrated ${result.documents_migrated} existing documents`
          : null,
        '',
        '🎯 Next steps:',
        ...result.next_steps!.map(step => `  • ${step}`)
      ].filter(Boolean))
    };
  }
  
  return {
    ...result,
    message: `❌ ${result.error}`
  };
}

async function handleSync(hub: KnowledgeHub, params: any) {
  const result = await hub.sync(params.require_confirmation);
  
  return {
    ...result,
    message: result.success
      ? formatSuccessMessage('Sync complete!', [
          `✅ Updated: ${result.updated}`,
          `⏭️  Skipped: ${result.skipped}`,
          `❌ Failed: ${result.failed}`,
          '',
          result.updated > 0 
            ? '📝 Documents have been updated'
            : '✨ All documents are up-to-date'
        ])
      : '❌ Sync failed'
  };
}

async function handleUpdate(hub: KnowledgeHub, params: any) {
  if (!params.document_id) {
    return {
      success: false,
      error: 'document_id required for update action'
    };
  }
  
  const result = await hub.updateDocument(
    params.document_id,
    params.require_confirmation
  );
  
  return {
    ...result,
    message: result.updated
      ? `✅ Document ${params.document_id} updated`
      : result.requires_confirmation
      ? '⏳ Awaiting user confirmation'
      : result.message || '✅ No changes detected'
  };
}

async function handleMigrate(hub: KnowledgeHub) {
  const result = await hub.migrate();
  
  return {
    ...result,
    message: result.success
      ? formatSuccessMessage('Migration complete!', [
          `✅ Migrated ${result.migrated_count} documents`,
          result.backup_location
            ? `💾 Backup created at: ${result.backup_location}`
            : null,
          result.migrated_files && result.migrated_files.length > 0
            ? `\n📄 Migrated files:\n${result.migrated_files.map(f => 
                `  • ${f.original_path} → ${f.new_path}`
              ).join('\n')}`
            : null
        ].filter(Boolean))
      : `❌ Migration failed: ${result.message}`
  };
}

async function handleHistory(hub: KnowledgeHub, params: any) {
  if (!params.document_id) {
    return {
      success: false,
      error: 'document_id required for history action'
    };
  }
  
  const result = await hub.getHistory(params.document_id, 10);
  
  if (result.total_versions === 0) {
    return {
      ...result,
      message: `📋 No version history for ${params.document_id}`
    };
  }
  
  const versionsText = result.versions.map(v => 
    `  • v${v.version} - ${new Date(v.created_at).toLocaleString()} (${v.trigger})`
  ).join('\n');
  
  return {
    ...result,
    message: formatSuccessMessage(`Version History for ${params.document_id}`, [
      `Found ${result.total_versions} versions:\n`,
      versionsText,
      '',
      `💡 To rollback: @m7 knowledge_hub rollback --document_id=${params.document_id} --version=X.X.X`
    ])
  };
}

async function handleRollback(hub: KnowledgeHub, params: any) {
  if (!params.document_id || !params.version) {
    return {
      success: false,
      error: 'document_id and version required for rollback'
    };
  }
  
  const result = await hub.rollback(params.document_id, params.version);
  
  return {
    ...result,
    message: `✅ ${result.message}`
  };
}

async function handleStatus(hub: KnowledgeHub) {
  const result = await hub.getStatus();
  
  if (!result.initialized) {
    return {
      ...result,
      message: `📋 Knowledge Hub Status: Not Initialized\n\n💡 Run: @m7 knowledge_hub init`
    };
  }
  
  const documentsText = result.documents!.map(doc => {
    const status = doc.exists 
      ? (doc.up_to_date ? '✅' : '⚠️')
      : '❌';
    const version = doc.version ? `v${doc.version}` : 'N/A';
    const updated = doc.last_updated 
      ? new Date(doc.last_updated).toLocaleDateString()
      : 'Never';
    
    return `  ${status} ${doc.name.padEnd(30)} ${version.padEnd(8)} Updated: ${updated}`;
  }).join('\n');
  
  return {
    ...result,
    message: formatSuccessMessage('Knowledge Hub Status', [
      `📍 Location: ${result.hub_path}`,
      `🔄 Auto-sync: ${result.auto_sync_enabled ? 'Enabled' : 'Disabled'}`,
      '',
      '📄 Documents:',
      documentsText,
      '',
      '💡 Commands:',
      '  • @m7 knowledge_hub sync - Sync all documents',
      '  • @m7 knowledge_hub migrate - Migrate existing files',
      '  • @m7 knowledge_hub update --document_id=INDEX - Update specific document'
    ])
  };
}

async function handleVerify(hub: KnowledgeHub) {
  const result = await hub.getStatus();
  
  if (!result.initialized) {
    return {
      success: false,
      message: '❌ Knowledge Hub not initialized'
    };
  }
  
  const allExist = result.documents!.every(doc => doc.exists);
  const allUpToDate = result.documents!.every(doc => doc.up_to_date);
  
  if (allExist && allUpToDate) {
    return {
      success: true,
      message: formatSuccessMessage('Verification passed!', [
        '✅ All documents exist',
        '✅ All documents are up-to-date',
        '✅ Knowledge Hub is working correctly'
      ])
    };
  }
  
  const issues: string[] = [];
  
  result.documents!.forEach(doc => {
    if (!doc.exists) {
      issues.push(`❌ Missing: ${doc.name}`);
    } else if (!doc.up_to_date) {
      issues.push(`⚠️ Outdated: ${doc.name}`);
    }
  });
  
  return {
    success: false,
    message: formatSuccessMessage('Verification found issues:', [
      ...issues,
      '',
      '💡 Run @m7 knowledge_hub sync to fix issues'
    ])
  };
}

async function handleDiff(hub: KnowledgeHub, params: any) {
  if (!params.document_id) {
    return {
      success: false,
      error: 'document_id required for diff action'
    };
  }
  
  const fromVersion = params.from_version;
  const toVersion = params.to_version || 'latest';
  
  try {
    // Get version manager through hub
    const history = await hub.getHistory(params.document_id, 100);
    
    if (history.total_versions < 2) {
      return {
        success: false,
        message: `❌ Not enough versions to compare (found ${history.total_versions})`
      };
    }
    
    // Get versions to compare
    const versions = history.versions;
    let fromVer, toVer;
    
    if (fromVersion) {
      fromVer = versions.find(v => v.version === fromVersion);
      if (!fromVer) {
        return {
          success: false,
          error: `Version ${fromVersion} not found`
        };
      }
    } else {
      // Use second most recent
      fromVer = versions[1];
    }
    
    if (toVersion === 'latest') {
      toVer = versions[0];
    } else {
      toVer = versions.find(v => v.version === toVersion);
      if (!toVer) {
        return {
          success: false,
          error: `Version ${toVersion} not found`
        };
      }
    }
    
    // For now, return a simple comparison message
    // Full diff implementation would require loading version content
    return {
      success: true,
      message: formatSuccessMessage(`Version Comparison: ${params.document_id}`, [
        `**From:** v${fromVer.version} (${fromVer.created_at})`,
        `**To:** v${toVer.version} (${toVer.created_at})`,
        '',
        '📊 Changes:',
        ...toVer.changes.map(c => `  • ${c}`),
        '',
        '💡 To see detailed diff, versions must be loaded from storage.',
        '   Future enhancement: Full line-by-line diff view'
      ])
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Diff failed: ${error.message}`
    };
  }
}

// ===== Helper Functions =====

function formatSuccessMessage(title: string, lines: (string | null)[]): string {
  const cleanLines = lines.filter(Boolean);
  return `# ${title}\n\n${cleanLines.join('\n')}`;
}

