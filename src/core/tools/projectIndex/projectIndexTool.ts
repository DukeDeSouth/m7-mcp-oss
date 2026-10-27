/**
 * Project Index MCP Tool
 * Автоматическое создание и обновление INDEX.md файла проекта
 * v5.0: Uses UnifiedMemoryCore instead of MemorySystem
 */

import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs/promises';
import { JournalSystem } from '../../../journal/journalSystem.js';
import { DefaultProjectScanner } from './projectScanner.js';
import { DefaultIndexGenerator } from './indexGenerator.js';
import { FileHashCache, FileChanges } from './fileHashCache.js';
import {
  ScanOptions,
  IndexGeneratorOptions,
  DEFAULT_INDEX_SECTIONS,
  DEFAULT_EXCLUDE_PATTERNS
} from './types.js';
import { getProjectPath } from '../../utils/projectPath.js';
import { createLogger } from '../../utils/logger.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../../memory/auto/unified-memory-core.js';

const log = createLogger('[ProjectIndex]');

const ProjectIndexRequestSchema = z.object({
  action: z.enum(['generate', 'update', 'scan', 'validate']),
  project_path: z.string().optional(),
  output_path: z.string().optional(),
  template: z.enum(['minimal', 'standard', 'comprehensive']).default('standard'),
  force: z.boolean().default(false),
  include_git: z.boolean().default(true),
  include_hidden: z.boolean().default(false),
  max_depth: z.number().min(1).max(10).default(3),
  exclude_patterns: z.array(z.string()).default([]),
  sections: z.array(z.string()).optional(),
  auto_update: z.boolean().default(false)
});

export const projectIndexTool = {
  name: 'mcp_m7_project_index',
  description: 'Automatically generate and manage PROJECT_INDEX.md file with comprehensive project information for AI assistants',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate', 'update', 'scan', 'validate'],
        description: 'Action to perform: generate new index, update existing, scan project info, or validate current index'
      },
      project_path: {
        type: 'string',
        description: 'Path to project root (optional - defaults to current directory)'
      },
      output_path: {
        type: 'string',
        description: 'Output path for INDEX.md (optional - defaults to PROJECT_INDEX.md in project root)'
      },
      template: {
        type: 'string',
        enum: ['minimal', 'standard', 'comprehensive'],
        description: 'Index template to use',
        default: 'standard'
      },
      force: {
        type: 'boolean',
        description: 'Force regeneration even if index exists',
        default: false
      },
      include_git: {
        type: 'boolean',
        description: 'Include Git repository information',
        default: true
      },
      include_hidden: {
        type: 'boolean',
        description: 'Include hidden files and directories',
        default: false
      },
      max_depth: {
        type: 'number',
        description: 'Maximum directory depth to scan (1-10)',
        minimum: 1,
        maximum: 10,
        default: 3
      },
      exclude_patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional patterns to exclude from scanning',
        default: []
      },
      sections: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific sections to include (optional - uses template defaults)'
      },
      auto_update: {
        type: 'boolean',
        description: 'Enable automatic updates when project changes',
        default: false
      }
    },
    required: ['action']
  },

  handler: async (request: any, journal: JournalSystem) => {
    try {
      const params = ProjectIndexRequestSchema.parse(request);
      const projectPath = params.project_path || getProjectPath();
      const outputPath = params.output_path || path.join(projectPath, 'PROJECT_INDEX.md');

      log.debug(`Using project path: ${projectPath}`);
      log.debug(`${params.action} action for project: ${projectPath}`);

      const scanner = new DefaultProjectScanner();
      const generator = new DefaultIndexGenerator();

      switch (params.action) {
        case 'generate':
          return await generateIndex(scanner, generator, projectPath, outputPath, params, journal);
        
        case 'update':
          return await updateIndex(scanner, generator, projectPath, outputPath, params, journal);
        
        case 'scan':
          return await scanProject(scanner, projectPath, params, journal);
        
        case 'validate':
          return await validateIndex(scanner, generator, projectPath, outputPath, journal);
        
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }

    } catch (error: any) {
      log.error('Error:', error);
      
      await journal.logError({
        error: error.message,
        context: JSON.stringify({ request }),
        category: 'logic',
        fixed: false
      });

      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
};

// Вспомогательные функции

async function generateIndex(
  scanner: DefaultProjectScanner,
  generator: DefaultIndexGenerator,
  projectPath: string,
  outputPath: string,
  params: any,
  journal: JournalSystem
) {
  // Проверяем, существует ли уже индекс
  if (!params.force) {
    try {
      await fs.access(outputPath);
      return {
        success: false,
        error: 'INDEX.md already exists. Use --force to overwrite or use update action.',
        existing_file: outputPath,
        suggestion: 'Use action: "update" to update existing index'
      };
    } catch (error) {
      // Файл не существует, можно создавать
    }
  }

  const scanOptions: ScanOptions = {
    includeHidden: params.include_hidden,
    maxDepth: params.max_depth,
    excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS, ...params.exclude_patterns],
    includeGitInfo: params.include_git,
    includePackageInfo: true,
    scanDocumentation: true,
    scanConfiguration: true
  };

  const generatorOptions: IndexGeneratorOptions = {
    template: params.template,
    sections: getSectionsForTemplate(params.template, params.sections),
    outputPath,
    autoUpdate: params.auto_update,
    includeMetrics: params.template === 'comprehensive'
  };

  log.debug('Scanning project...');
  const projectIndex = await scanner.scanProject(projectPath, scanOptions);

  log.debug('Validating project data...');
  const validation = await generator.validateIndex(projectIndex);

  log.debug('Generating INDEX.md...');
  const indexContent = await generator.generate(projectIndex, generatorOptions);

  log.debug('Saving to file...');
  await generator.saveToFile(indexContent, outputPath);

  // v5.0: Store in unified memory
  try {
    const memoryCore = await getMemoryCore();
    await memoryCore.store(
      JSON.stringify({
        pattern: 'project_index_generated',
        context: {
          projectPath,
          outputPath,
          generatedAt: new Date().toISOString(),
          validation: validation.score,
          sections: generatorOptions.sections.length
        },
        usage: 'Project index management',
        tags: ['project', 'index', 'documentation']
      }),
      {
        level: 'L2',
        source: 'code_analysis',
        contextKeys: ['project', 'index', path.basename(projectPath)],
        confidence: 1.0
      }
    );
  } catch (memError) {
    // Non-critical
  }

  // Логируем успешное создание
  log.info(`Successfully generated index for ${projectIndex.project.name} (score: ${validation.score})`);

  return {
    success: true,
    action: 'generate',
    output_path: outputPath,
    project_info: {
      name: projectIndex.project.name,
      version: projectIndex.project.version,
      tech_stack: projectIndex.project.techStack,
      status: projectIndex.project.status
    },
    validation: {
      score: validation.score,
      warnings: validation.warnings,
      suggestions: validation.suggestions
    },
    statistics: {
      documentation_files: projectIndex.documentation.length,
      configuration_files: projectIndex.configuration.length,
      directories: projectIndex.structure.directories.length,
      total_files: projectIndex.structure.totalFiles
    },
    generated_at: projectIndex.generatedAt,
    next_steps: [
      'Review the generated INDEX.md file',
      'Update any missing documentation mentioned in warnings',
      'Share the INDEX.md with your team',
      'Use @m7 project index update to keep it current'
    ]
  };
}

async function updateIndex(
  scanner: DefaultProjectScanner,
  generator: DefaultIndexGenerator,
  projectPath: string,
  outputPath: string,
  params: any,
  journal: JournalSystem
) {
  // Проверяем, существует ли индекс для обновления
  try {
    await fs.access(outputPath);
  } catch (error) {
    return {
      success: false,
      error: 'INDEX.md not found. Use action: "generate" to create new index.',
      suggestion: 'Use action: "generate" to create a new index file'
    };
  }

  // v3.9: Incremental update with file hash cache
  const hashCache = new FileHashCache(projectPath);
  await hashCache.load();
  
  const startTime = Date.now();
  
  // Check if we can do incremental update (cache exists and is fresh)
  const cacheStale = hashCache.isCacheStale(300000); // 5 min
  const cachedFileCount = hashCache.getCachedFileCount();
  
  if (!cacheStale && cachedFileCount > 0 && !params.force) {
    // Quick check: scan key files for changes
    const keyFiles = [
      path.join(projectPath, 'package.json'),
      path.join(projectPath, 'tsconfig.json'),
      path.join(projectPath, 'README.md'),
      path.join(projectPath, '.cursorrules')
    ];
    
    const changes = await hashCache.detectChanges(keyFiles);
    
    if (changes.added.length === 0 && changes.modified.length === 0 && changes.removed.length === 0) {
      const elapsed = Date.now() - startTime;
      log.debug(`✓ Incremental check: no changes detected (${elapsed}ms)`);
      
      return {
        success: true,
        action: 'update',
        changes_detected: false,
        message: 'No changes detected in project (incremental check)',
        performance: {
          mode: 'incremental',
          elapsed_ms: elapsed,
          files_checked: keyFiles.length,
          full_scan_skipped: true
        }
      };
    }
    
    log.debug(`Changes detected: +${changes.added.length} ~${changes.modified.length} -${changes.removed.length}`);
  }

  // Full rescan needed (cache stale, first run, or changes detected)
  log.debug(`Performing full rescan...`);
  
  // Читаем существующий индекс для сравнения
  const existingContent = await fs.readFile(outputPath, 'utf-8');
  
  // Генерируем новый индекс
  const result = await generateIndex(scanner, generator, projectPath, outputPath, 
    { ...params, force: true }, journal);

  if (!result.success) {
    return result;
  }

  // Сравниваем изменения
  const newContent = await fs.readFile(outputPath, 'utf-8');
  const hasChanges = existingContent !== newContent;
  
  // Update hash cache with scanned files
  const keyFilePaths = [
    path.join(projectPath, 'package.json'),
    path.join(projectPath, 'tsconfig.json'),
    path.join(projectPath, 'README.md'),
    path.join(projectPath, '.cursorrules'),
    path.join(projectPath, 'mcp.json')
  ];
  await hashCache.updateCache(keyFilePaths);
  
  const elapsed = Date.now() - startTime;

  return {
    ...result,
    action: 'update',
    changes_detected: hasChanges,
    message: hasChanges ? 'Index updated with new information' : 'No changes detected in project',
    performance: {
      mode: 'full_scan',
      elapsed_ms: elapsed,
      cache_updated: true
    }
  };
}

async function scanProject(
  scanner: DefaultProjectScanner,
  projectPath: string,
  params: any,
  journal: JournalSystem
) {
  const scanOptions: ScanOptions = {
    includeHidden: params.include_hidden,
    maxDepth: params.max_depth,
    excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS, ...params.exclude_patterns],
    includeGitInfo: params.include_git,
    includePackageInfo: true,
    scanDocumentation: true,
    scanConfiguration: true
  };

  log.debug('Scanning project information...');
  const projectIndex = await scanner.scanProject(projectPath, scanOptions);

  return {
    success: true,
    action: 'scan',
    project_info: projectIndex.project,
    deployment_info: projectIndex.deployment,
    git_info: projectIndex.git,
    structure: {
      directories: projectIndex.structure.directories.length,
      total_files: projectIndex.structure.totalFiles,
      key_files: projectIndex.structure.keyFiles
    },
    documentation: {
      total: projectIndex.documentation.length,
      missing_critical: projectIndex.documentation.filter(d => d.status === 'missing' && d.priority === 'critical').length,
      categories: [...new Set(projectIndex.documentation.map(d => d.category))]
    },
    configuration: {
      total: projectIndex.configuration.length,
      missing_critical: projectIndex.configuration.filter(c => c.status === 'missing' && c.critical).length
    },
    quick_start: projectIndex.quickStart,
    important_notes: projectIndex.importantNotes,
    scanned_at: projectIndex.generatedAt
  };
}

async function validateIndex(
  scanner: DefaultProjectScanner,
  generator: DefaultIndexGenerator,
  projectPath: string,
  outputPath: string,
  journal: JournalSystem
) {
  // Проверяем существование файла
  try {
    await fs.access(outputPath);
  } catch (error) {
    return {
      success: false,
      error: 'INDEX.md not found',
      suggestion: 'Use action: "generate" to create index file'
    };
  }

  // Сканируем текущее состояние проекта
  const scanOptions: ScanOptions = {
    includeHidden: false,
    maxDepth: 3,
    excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
    includeGitInfo: true,
    includePackageInfo: true,
    scanDocumentation: true,
    scanConfiguration: true
  };

  const projectIndex = await scanner.scanProject(projectPath, scanOptions);
  const validation = await generator.validateIndex(projectIndex);

  // Проверяем актуальность файла
  const indexStats = await fs.stat(outputPath);
  const daysSinceUpdate = Math.floor((Date.now() - indexStats.mtime.getTime()) / (1000 * 60 * 60 * 24));

  return {
    success: true,
    action: 'validate',
    validation: {
      is_valid: validation.isValid,
      score: validation.score,
      errors: validation.errors,
      warnings: validation.warnings,
      suggestions: validation.suggestions
    },
    file_info: {
      exists: true,
      last_modified: indexStats.mtime.toISOString(),
      days_since_update: daysSinceUpdate,
      needs_update: daysSinceUpdate > 7 || validation.score < 80
    },
    recommendations: [
      ...(daysSinceUpdate > 7 ? ['Index is older than 7 days, consider updating'] : []),
      ...(validation.score < 80 ? ['Validation score is low, review warnings and suggestions'] : []),
      ...validation.suggestions
    ]
  };
}

function getSectionsForTemplate(template: string, customSections?: string[]) {
  if (customSections && customSections.length > 0) {
    return DEFAULT_INDEX_SECTIONS.filter(section => 
      customSections.includes(section.id)
    );
  }

  switch (template) {
    case 'minimal':
      return DEFAULT_INDEX_SECTIONS.filter(section => 
        ['overview', 'quick_start', 'structure'].includes(section.id)
      );
    
    case 'comprehensive':
      return DEFAULT_INDEX_SECTIONS;
    
    case 'standard':
    default:
      return DEFAULT_INDEX_SECTIONS.filter(section => 
        !['tech_stack'].includes(section.id) || section.priority <= 7
      );
  }
}
