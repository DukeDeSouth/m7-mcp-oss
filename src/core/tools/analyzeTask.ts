import { createLogger } from '../utils/logger.js';
const log = createLogger('[analyzeTask]');
import { z } from 'zod';
import { TaskRouter } from '../router.js';
import { TaskOrchestrator } from '../orchestrator/taskOrchestrator.js';
import { SchemaSystem } from '../../schema/schemaSystem.js';
import { 
  generateWhyM7Matters, 
  detectRedFlags, 
  prioritizeRequirements,
  generateRoadmap 
} from '../intelligence/taskIntelligence.js';
import { scanAndCheckImports } from '../utils/importScanner.js';
// v5.0: Use UnifiedMemoryCore instead of legacy memory systems
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
import { getContextProvider } from '../../context/index.js';
import { getCrossSessionLearning } from '../../cross-session/index.js';
import { createM7StructureInternal } from './createStructure.js';
import { checkSystemHealth, formatHealthStatus } from '../health/index.js';
import { needsM7Init, initProjectInternal, ColdStartResult } from './initProject.js';
import { getProjectPath, ensureProjectPathResolved } from '../utils/projectPath.js';
import { scanProjectScope, ScopeContext } from '../scope/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import { classifyIntent, ClassifiedIntent, ScanPatternId } from '../intelligence/intentClassifier.js';

// v3.6: Architecture Context
import { getArchitectureContextAnalyzer, ArchitectureContext } from '../architecture/index.js';

// v4.0: M7 Evolution imports
import { isFeatureEnabled, getInterpretationSettings } from '../config/featureFlags.js';
import { getInterpretationGenerator, InterpretationInput, TaskInterpretation } from '../interpretation/index.js';
import { getTaskGraphManager } from '../task-graph/index.js';
import { getTransferManager, ScopeCheckInput, ScopeAlert } from '../task-transfer/index.js';
import { handleWarmupTool } from './warmupTool.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Enhanced request schema with orchestration
const AnalyzeTaskRequestSchema = z.object({
  task_description: z.string(),
  context: z.any().optional(),
  override_token: z.string().optional(),
  create_session: z.boolean().default(true),
  reuse_session: z.boolean().default(true) // NEW: try to reuse existing session
});

export const analyzeTaskTool = {
  name: 'mcp_m7_analyze_task',
  description: 'Analyze task complexity and route appropriately with chaos detection, baseline audit and orchestration',
  inputSchema: {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Description of the task to analyze'
      },
      context: {
        type: 'object',
        description: 'Additional context about the project',
        optional: true
      },
      override_token: {
        type: 'string',
        description: 'Emergency override token for chaotic requests',
        optional: true
      },
      create_session: {
        type: 'boolean',
        description: 'Create orchestrated M7 session (default: true)',
        default: true
      },
      reuse_session: {
        type: 'boolean',
        description: 'Try to reuse existing session for similar task (default: true)',
        default: true
      }
    },
    required: ['task_description']
  },
  handler: async (request: any, router: TaskRouter, orchestrator?: TaskOrchestrator, schema?: SchemaSystem, server?: McpServer) => {
    const params = AnalyzeTaskRequestSchema.parse(request);
    const { task_description, context, override_token, create_session, reuse_session } = params;

    // v4.0 Early Intent Detection - Quick commands bypass full analysis
    // "прогрей м7", "warmup" → direct call to warmup tool
    const warmupPatterns = [/прогрей\s*м7/i, /warmup/i, /warm\s*up/i, /прогре[йв]\s*м7/i, /^прогрей$/i];
    if (warmupPatterns.some(p => p.test(task_description.trim()))) {
      log.debug(`M7 v4.0] Warmup command detected, executing directly`);
      const warmupResult = await handleWarmupTool({ 
        action: 'warmup', 
        scope: 'full', 
        force: false,
        success: true  // default
      }, server);
      return {
        content: [{
          type: 'text',
          text: warmupResult
        }]
      };
    }
    
    // "compliance", "статистика циклов" → compliance stats
    const compliancePatterns = [/compliance/i, /статистика\s*циклов/i, /compliance\s*stats/i];
    if (compliancePatterns.some(p => p.test(task_description.trim()))) {
      log.debug(`M7 v4.0] Compliance command detected, executing directly`);
      const complianceResult = await handleWarmupTool({ 
        action: 'compliance',
        force: false,
        success: true
      }, server);
      return {
        content: [{
          type: 'text',
          text: complianceResult
        }]
      };
    }

    // v4.0: "акстись", "опомнись" → AKSTIS runtime correction
    const akstisPatterns = [
      /^акстись$/i,
      /акстись/i,
      /опомнись/i,
      /вернись.*к.*м7/i,
      /come.*back.*m7/i,
      /return.*to.*m7/i
    ];
    if (akstisPatterns.some(p => p.test(task_description.trim()))) {
      log.debug(`M7 v4.0] AKSTIS command detected — returning to M7`);
      const akstisResult = await handleWarmupTool({
        action: 'akstis',
        force: false,
        success: true
      }, server);
      return {
        content: [{
          type: 'text',
          text: akstisResult
        }]
      };
    }

    // v4.1: "цикл м7", "новый цикл м7" → Start M7 Cycle Orchestrator
    const cyclePatterns = [
      /^м7$/i,
      /новый\s*цикл\s*м7/i,
      /запусти\s*м7/i,
      /цикл\s*м7/i,
      /в\s*новом\s*цикле\s*м7/i,
      /m7\s*cycle/i,
      /start\s*m7/i,
      /new\s*m7\s*cycle/i
    ];
    
    // Check if it's a cycle intent with actual task
    const cycleMatch = cyclePatterns.some(p => p.test(task_description.trim()));
    if (cycleMatch) {
      log.debug(`M7 v4.1] Cycle intent detected, redirecting to mcp_m7_cycle`);
      
      // Extract actual task from description (remove cycle prefix)
      let actualTask = task_description.trim();
      const prefixPatterns = [
        /^м7\s*/i,
        /^новый\s*цикл\s*м7\s*/i,
        /^запусти\s*м7\s*/i,
        /^цикл\s*м7\s*/i,
        /^в\s*новом\s*цикле\s*м7\s*/i,
        /^m7\s*cycle\s*/i,
        /^start\s*m7\s*/i,
        /^new\s*m7\s*cycle\s*/i
      ];
      
      for (const p of prefixPatterns) {
        actualTask = actualTask.replace(p, '').trim();
      }
      
      // If no task after prefix, use original description
      if (!actualTask || actualTask.length < 5) {
        actualTask = task_description;
      }
      
      // Dynamic import to avoid circular dependencies
      const { cycleTool } = await import('./cycleTool.js');
      return cycleTool.handler({ task_description: actualTask });
    }

    const projectPath = await ensureProjectPathResolved(server);

    // v5.0: Auto Context Injection via UnifiedMemoryCore
    interface EnrichedContext {
      projectInfo: { name: string; technologies: string[] };
      relevantChunks: Array<{ source: string; score: number; language?: string; content: string }>;
      tokenCount: number;
      searchDuration: number;
    }
    let enrichedContext: EnrichedContext | null = null;
    try {
      const memoryCore = await getMemoryCore();
      const searchResults = await memoryCore.cascadeSearch(task_description, { limit: 5 });
      if (searchResults.length > 0) {
        enrichedContext = {
          projectInfo: { name: 'Current Project', technologies: [] },
          relevantChunks: searchResults.map(r => ({
            source: r.record.id,
            score: r.score,
            content: r.record.content
          })),
          tokenCount: searchResults.reduce((sum, r) => sum + r.record.content.length / 4, 0),
          searchDuration: 0
        };
        log.debug(`M7 v5.0] Auto-injected ${searchResults.length} context chunks`);
      }
    } catch (e: any) {
      log.debug(`M7 v5.0] Context injection skipped: ${e.message}`);
    }

    // v3.1 Time & Models Context
    let currentContextHeader = '';
    try {
      const contextProvider = getContextProvider();
      const ctx = await contextProvider.getContext();
      currentContextHeader = ctx.header;
      log.debug(`M7 v3.1] Context injected: ${ctx.formattedTime}, models: ${ctx.models.openai.length} OpenAI, ${ctx.models.anthropic.length} Anthropic`);
    } catch (e: any) {
      log.debug(`M7 v3.1] Context provider error: ${e.message}`);
    }

    // v3.3 System Health Check
    let healthStatus = '';
    try {
      const health = await checkSystemHealth();
      healthStatus = formatHealthStatus(health);
      if (health.overallStatus !== 'healthy') {
        log.debug(`M7 v3.3] System health: ${health.overallStatus} (${health.components.filter(c => c.status !== 'online').map(c => c.name).join(', ')})`);
      }
    } catch (e: any) {
      log.debug(`M7 v3.3] Health check error: ${e.message}`);
    }

    // v3.9 Cross-Session Learning - Inject accumulated knowledge
    let crossSessionContext = '';
    try {
      const crossSession = getCrossSessionLearning();
      await crossSession.initialize();
      
      // Get relevant knowledge for this task
      const knowledge = await crossSession.getRelevantKnowledge(task_description, 5);
      
      if (knowledge.insights.length > 0 || knowledge.heuristics.length > 0) {
        crossSessionContext = await crossSession.formatContextForPrompt(task_description);
        log.debug(`M7 v3.9] ✓ Cross-Session Learning: ${knowledge.insights.length} insights, ${knowledge.heuristics.length} heuristics injected`);
      }
    } catch (e: any) {
      log.debug(`M7 v3.9] Cross-Session Learning skipped: ${e.message}`);
    }

    // v3.4 Cold Start Detection - Auto-initialize empty projects
    let coldStartResult: ColdStartResult | null = null;
    try {
      const needsInit = await needsM7Init(projectPath);
      
      if (needsInit) {
        log.debug(`M7 v3.4] Cold Start detected: initializing ${projectPath}`);
        coldStartResult = await initProjectInternal({
          projectPath,
          taskDescription: task_description,
          // v5.0: Memory will be initialized internally via getMemoryCore()
        });
        
        if (coldStartResult.success) {
          log.debug(`M7 v3.4] Cold Start complete: ${coldStartResult.filesCreated.length} files created`);
        } else {
          log.debug(`M7 v3.4] Cold Start failed: ${coldStartResult.error}`);
        }
      }
    } catch (e: any) {
      log.debug(`M7 v3.4] Cold Start check error: ${e.message}`);
    }

    // v3.5.1 Smart Scope Scanner with LLM Pattern Selection
    let scopeContext: ScopeContext | null = null;
    let classifiedIntent: ClassifiedIntent | null = null;
    try {
      // v3.5.1: Сначала классифицируем intent — LLM сам выбирает паттерны
      log.debug(`M7 v3.5.1] Classifying intent to get LLM-selected patterns...`);
      classifiedIntent = await classifyIntent(task_description);
      
      const llmPatterns = classifiedIntent.patternsToScan as ScanPatternId[];
      const llmExtensions = classifiedIntent.fileExtensions;
      
      // v3.5.1: Если LLM не выбрал паттерны — сканирование не нужно
      if (llmPatterns.length === 0 && llmExtensions.length === 0) {
        log.debug(`M7 v3.5.1] LLM selected no patterns — skipping scope scan (task type: ${classifiedIntent.intent})`);
        // Не создаём scopeContext — scanner не нужен для этой задачи
      } else {
        log.debug(`M7 v3.5.1] LLM selected patterns: ${llmPatterns.join(', ')}`);
        log.debug(`M7 v3.5.1] LLM selected extensions: ${llmExtensions.join(', ')}`);
        
        // Сканируем ТОЛЬКО если LLM выбрал паттерны
        log.debug(`M7 v3.5.1] Scanning project scope...`);
        scopeContext = await scanProjectScope(
          projectPath, 
          task_description, 
          undefined,  // options
          llmPatterns,
          llmExtensions
        );
        
        if (scopeContext.fileStats.matchingPattern > 0) {
          log.debug(`M7 v3.5.1] Scope scan: ${scopeContext.fileStats.matchingPattern} matching files, ${scopeContext.patterns.length} patterns in ${scopeContext.scanDurationMs}ms`);
          log.debug(`M7 v3.5.1] Recommendation: route=${scopeContext.recommendation.suggestedRoute}, files=${scopeContext.recommendation.suggestedFiles}`);
        } else {
          log.debug(`M7 v3.5.1] Scope scan: no matching files found (${scopeContext.scanDurationMs}ms)`);
        }
      }
    } catch (e: any) {
      log.debug(`M7 v3.5.1] Scope scan skipped: ${e.message}`);
    }

    try {
      // Check project schema for existing database or API info
      let schemaWarnings: string[] = [];
      if (schema) {
        const projectSchema = await schema.loadSchema();
        
        // Check if task mentions database operations
        if (task_description.toLowerCase().includes('database') ||
            task_description.toLowerCase().includes('table') ||
            task_description.toLowerCase().includes('schema') ||
            task_description.toLowerCase().includes('db')) {
          
          const dbInfo = await schema.checkDatabaseExists();
          if (dbInfo.exists) {
            schemaWarnings.push(`⚠️ **Existing Database Detected**: ${dbInfo.name} (${dbInfo.type})`);
            schemaWarnings.push(`📌 Make sure to use the existing database structure!`);
          }
        }
        
        // Check if task mentions API operations
        if (task_description.toLowerCase().includes('api') ||
            task_description.toLowerCase().includes('endpoint') ||
            task_description.toLowerCase().includes('route')) {
          
          const apiEndpoints = await schema.getApiEndpoints();
          if (apiEndpoints) {
            schemaWarnings.push(`⚠️ **Existing API Structure Detected**`);
            schemaWarnings.push(`📌 Check PROJECT_SCHEMA.yaml for existing endpoints`);
          }
        }
      }
      // Context7 Auto-Check: Scan for unverified imports if task involves coding
      if (task_description.toLowerCase().includes('implement') || 
          task_description.toLowerCase().includes('code') ||
          task_description.toLowerCase().includes('create') ||
          task_description.toLowerCase().includes('build')) {
        
        // Check if there's code content in the task description
        const hasCodeContent = task_description.includes('import') || 
                              task_description.includes('require') ||
                              task_description.includes('from ');
        
        if (hasCodeContent) {
          const importCheck = await scanAndCheckImports(task_description);
          
          if (importCheck.hasUncheckedImports) {
            return {
              content: [{
                type: 'text',
                text: `# 📚 Context7 Verification Recommended

## Unverified libraries detected:
${importCheck.uncheckedLibraries.map(lib => `- ⚠️ ${lib}`).join('\n')}

## Recommended actions:
${importCheck.suggestions.join('\n')}

**Context7 verification protects against:**
- Using outdated APIs
- Version mismatches
- Hallucinated code patterns
- Hidden bugs

Please verify all libraries before proceeding with task analysis.`
              }],
              isError: true
            };
          }
        }
      }
      
      // v3.6: Architecture Context Analysis
      let architectureContext: ArchitectureContext | null = null;
      let architectureContextSection = '';
      try {
        const analyzer = getArchitectureContextAnalyzer();
        architectureContext = await analyzer.analyze(task_description, projectPath);
        
        if (architectureContext.existingImplementations.length > 0) {
          log.debug(`M7 v3.6] Architecture context: ${architectureContext.existingImplementations.length} similar implementations found in ${architectureContext.analysisTimeMs}ms`);
          architectureContextSection = formatArchitectureContext(architectureContext);
        }
      } catch (e: any) {
        log.debug(`M7 v3.6] Architecture context skipped: ${e.message}`);
      }
      
      // v4.0: Generate Task Interpretation (after Discovery)
      let interpretation: TaskInterpretation | null = null;
      let interpretationSection = '';
      if (isFeatureEnabled('autoInterpretation')) {
        try {
          const interpSettings = getInterpretationSettings();
          const generator = getInterpretationGenerator({
            outputFormat: interpSettings.outputFormat,
            includeDiscoveryDetails: interpSettings.includeDiscoveryDetails,
            maxFilesInOutput: interpSettings.maxFilesInOutput,
            maxSimilarCodeInOutput: interpSettings.maxSimilarCodeInOutput
          });
          
          const interpInput: InterpretationInput = {
            taskId: `task_${Date.now()}`,
            taskDescription: task_description,
            scopeContext: scopeContext,
            architectureContext: architectureContext,
            crossSessionInsights: crossSessionContext ? [crossSessionContext] : [],
            schemaWarnings: schemaWarnings,
            intentClassification: classifiedIntent ? {
              intent: classifiedIntent.intent,
              confidence: classifiedIntent.confidence,
              allowCode: classifiedIntent.allowCode
            } : undefined
          };
          
          const interpResult = await generator.generate(interpInput);
          
          if (interpResult.success && interpResult.interpretation) {
            interpretation = interpResult.interpretation;
            interpretationSection = generator.formatForOutput(interpretation);
            log.debug(`M7 v4.0] ✓ Interpretation generated: confidence=${(interpretation.confidence * 100).toFixed(0)}%, ${interpResult.durationMs}ms`);
          }
        } catch (e: any) {
          log.debug(`M7 v4.0] Interpretation skipped: ${e.message}`);
        }
      }
      
      // v4.0: Check for Scope Alert
      let scopeAlert: ScopeAlert | null = null;
      let scopeAlertSection = '';
      if (isFeatureEnabled('scopeAlerts') && scopeContext) {
        try {
          const transferManager = getTransferManager();
          const scopeCheckInput: ScopeCheckInput = {
            taskId: `task_${Date.now()}`,
            taskDescription: task_description,
            initialFilesEstimate: 3, // Default estimate
            currentScopeContext: scopeContext,
            criticalRisksCount: 0 // Will be updated after analysis
          };
          
          scopeAlert = await transferManager.checkScopeAlert(scopeCheckInput);
          
          if (scopeAlert) {
            scopeAlertSection = transferManager.formatAlertForOutput(scopeAlert);
            log.debug(`M7 v4.0] ⚠️ Scope alert: ${scopeAlert.type}, multiplier=${scopeAlert.metrics.multiplier.toFixed(1)}x`);
          }
        } catch (e: any) {
          log.debug(`M7 v4.0] Scope alert check skipped: ${e.message}`);
        }
      }
      
      // Analyze task using existing router (v3.5: include scopeContext)
      const analysisContext = scopeContext 
        ? { ...context, scopeContext } 
        : context;
      const analysis = await router.analyzeTask(task_description, analysisContext, override_token);

      // Smart session management
      let session = null;
      let sessionAction = 'none';
      
      if (create_session && orchestrator && analysis.route !== 'decompose') {
        // Check for existing sessions first
        await orchestrator.ready();
        const existingSessions = orchestrator.getAllActiveSessions();
        
        if (reuse_session && existingSessions.length > 0) {
          // Find a compatible session (same route, not completed)
          const compatibleSession = existingSessions.find(s => 
            s.route === analysis.route && 
            s.currentPhase !== 'completed' &&
            !s.canProceedToCode // Only reuse if still in progress
          );
          
          if (compatibleSession) {
            session = compatibleSession;
            sessionAction = 'reused';
          }
        }
        
        // Create new session only if no compatible session found
        if (!session) {
          try {
            session = await orchestrator.startTask(task_description, analysis.route);
            sessionAction = 'created';
          } catch (error) {
            log.error('Failed to create orchestrated session:', error);
            // Continue without session - don't fail the analysis
          }
        }
      }

      // v3.3: Auto-create M7 structure when new session is created
      let structureResult: { folder: string; files: string[]; success: boolean; error?: string } | null = null;
      if (session && sessionAction === 'created') {
        try {
          // Extract clean task ID from session ID (remove 'task_' prefix and timestamp suffix)
          const cleanTaskId = session.id
            .replace(/^task_/, '')
            .replace(/_\d+$/, ''); // Remove trailing timestamp
          
          const result = await createM7StructureInternal({
            taskId: cleanTaskId,
            route: analysis.route as 'light' | 'medium' | 'heavy',
            description: task_description
          }, server);
          
          if (result.success && result.folder && result.files) {
            structureResult = {
              success: true,
              folder: result.folder,
              files: result.files
            };
            log.debug(`📁 [M7 v3.3] Auto-created structure: ${result.folder} (${result.files.length} files)`);
          } else {
            log.debug(`⚠️ [M7 v3.3] Failed to create structure: ${result.error}`);
          }
        } catch (error: any) {
          log.debug(`⚠️ [M7 v3.3] Structure creation error: ${error.message}`);
        }
      }
      
      // v4.0: Register task in Task Graph
      if (isFeatureEnabled('taskGraph') && session && sessionAction === 'created' && structureResult?.success) {
        try {
          const graphManager = getTaskGraphManager();
          await graphManager.initialize();
          
          await graphManager.createTask({
            id: session.id,
            title: task_description.slice(0, 100),
            folder: structureResult.folder,
            sessionId: session.id,
            interpretation: interpretation || undefined
          });
          
          log.debug(`M7 v4.0] ✓ Task registered in graph: ${session.id}`);
        } catch (e: any) {
          log.debug(`M7 v4.0] Task graph registration skipped: ${e.message}`);
        }
      }

      const routeEmoji = analysis.route === 'light' ? '🟢' : analysis.route === 'medium' ? '🟡' : '🔴';
      const canProceedEmoji = analysis.canProceed ? '✅' : '🚫';

      // Enhanced visibility features
      const whyM7Matters = generateWhyM7Matters(task_description, analysis.route);
      const redFlags = detectRedFlags(task_description);
      const roadmap = generateRoadmap(task_description, analysis.route);
      
      // Get prioritized requirements if session exists
      let prioritizedRequirements = null;
      if (session) {
        prioritizedRequirements = prioritizeRequirements(
          analysis.route,
          session.phaseRequirements,
          task_description
        );
      }

      // Format enriched context section if available
      const contextSection = enrichedContext && enrichedContext.relevantChunks.length > 0 
        ? `## 🧠 Project Context (Auto-Injected)
**Project:** ${enrichedContext.projectInfo.name}
**Technologies:** ${enrichedContext.projectInfo.technologies.join(', ') || 'Detecting...'}
**Relevant files found:** ${enrichedContext.relevantChunks.length} (${enrichedContext.searchDuration}ms)

<details>
<summary>📁 Click to view relevant code</summary>

${enrichedContext.relevantChunks.slice(0, 3).map(chunk => 
`**${chunk.source}** (${(chunk.score * 100).toFixed(0)}% match)
\`\`\`${chunk.language || ''}
${chunk.content.slice(0, 500)}${chunk.content.length > 500 ? '\n... (truncated)' : ''}
\`\`\``
).join('\n\n')}
</details>

` : '';

      // v3.2: Get intent header from analysis
      const intentHeader = analysis.intentHeader || '';

      // v3.5: Format Scope Scanner section
      const scopeScannerSection = analysis.scopeContext && analysis.scopeContext.fileStats.matchingPattern > 0
        ? `## 📊 Scope Scanner Results ${analysis.routeAdjusted ? '⚠️' : '✅'}

| Метрика | Значение |
|---------|----------|
| **Файлов в проекте** | ${analysis.scopeContext.fileStats.total} |
| **Релевантных файлов** | **${analysis.scopeContext.fileStats.matchingPattern}** |
| **Время сканирования** | ${analysis.scopeContext.scanDurationMs}ms |
${analysis.routeAdjusted ? `| **Route изменён** | ${analysis.originalRoute} → **${analysis.route}** ⚠️ |` : ''}

${analysis.scopeContext.patterns.length > 0 ? `### 🔍 Обнаруженные паттерны:
${analysis.scopeContext.patterns.slice(0, 5).map(p => 
  `- **${p.pattern}**: ${p.count} совпадений в ${p.files} файлах${p.examples.length > 0 ? ` (\`${p.examples[0].slice(0, 30)}\`)` : ''}`
).join('\n')}
` : ''}
${analysis.scopeContext.recommendation.reasoning}

` : '';

      // Format Cold Start section
      const coldStartSection = coldStartResult?.success ? `
## 🚀 Cold Start - Проект Инициализирован!

**Путь:** \`${coldStartResult.projectPath}\`
**Проект:** ${coldStartResult.projectName}
**Создано файлов:** ${coldStartResult.filesCreated.length}

### 📁 Созданная структура:
${coldStartResult.filesCreated.slice(0, 10).map(f => `- ✅ ${f}`).join('\n')}
${coldStartResult.filesCreated.length > 10 ? `\n*...и ещё ${coldStartResult.filesCreated.length - 10} файлов*` : ''}

${coldStartResult.memoryInitialized ? `### 🧠 M7 Unified Memory:
- **Статус:** ✅ Инициализирована
- **Уровни:** L0-L4 готовы

*Теперь AI может использовать семантическую память проекта!*` : ''}

${coldStartResult.firstTask ? `### 🎯 Первый таск создан:
**Папка:** \`${coldStartResult.firstTask.folder}\`
**Файлы:** ${coldStartResult.firstTask.files.length} файлов M7

💡 **Начните с:** DISCOVERY_REPORT.md` : ''}

---
` : (coldStartResult && !coldStartResult.success ? `
## ⚠️ Cold Start - Ошибка инициализации

**Ошибка:** ${coldStartResult.error}

Попробуйте вручную: \`@m7 init_project\`

---
` : '');

      // v3.17: Side-effect — update activeContext.md for project memory
      updateActiveContext(
        task_description, 
        analysis.route, 
        session?.currentPhase || 'DISCOVERY'
      ).catch(() => {});

      return {
        content: [{
          type: 'text',
          text: `# 🎯 M7 Task Analysis Complete
${healthStatus}
${coldStartSection}${currentContextHeader}
${intentHeader}
${interpretationSection ? `\n${interpretationSection}\n` : ''}${scopeAlertSection ? `\n${scopeAlertSection}\n` : ''}${scopeScannerSection}${architectureContextSection}${contextSection}${crossSessionContext}${schemaWarnings.length > 0 ? `## 📋 Project Schema Warnings\n${schemaWarnings.join('\n')}\n\n` : ''}${whyM7Matters}

${redFlags.length > 0 ? `
## ⚠️ Pattern Detection Alert

${redFlags.map(flag => `
### ${flag.warning}

**Recommended checks (protects against common failures):**
${flag.checkpoints.map((checkpoint, i) => `${i + 1}. ${checkpoint}`).join('\n')}

**Acknowledge**: [ ] I have completed all checks above
`).join('\n')}
` : ''}

## ${routeEmoji} Route: ${analysis.route.toUpperCase()}
**Confidence:** ${(analysis.confidence * 100).toFixed(1)}%
**Reasoning:** ${analysis.reasoning}

## 📊 Analysis Details:
- **Estimated Files:** ${analysis.estimatedFiles}
- **Suggested Approach:** ${analysis.suggestedApproach}
- **Can Proceed:** ${canProceedEmoji} ${analysis.canProceed ? 'Yes' : 'No'}

${session ? `
## 🎼 M7 Orchestration Session ${sessionAction === 'reused' ? 'Reused' : 'Created'}
**Session ID:** \`${session.id}\`
**Current Phase:** ${session.currentPhase.toUpperCase()}
**Started:** ${session.startTime.toLocaleString()}

${sessionAction === 'reused' ? `
🔄 **Reusing existing session** - continuing where you left off!
` : ''}
${structureResult?.success ? `
## 📁 M7 Structure Auto-Created
**Folder:** ${structureResult.folder}
**Files created:**
${structureResult.files.slice(0, 7).map(f => '- ✅ ' + f).join('\n')}

💡 **Start with:** DISCOVERY_REPORT.md
` : ''}

### 🚦 Code Access Status: ${session.canProceedToCode ? '✅ UNLOCKED' : '🚫 BLOCKED'}
${session.canProceedToCode ? 
  '*All requirements satisfied - ready for implementation!*' : 
  '*Complete M7 requirements before coding*'}

${!session.canProceedToCode && prioritizedRequirements ? `
## 📋 Requirements Prioritized for Your Task

### 🔴 CRITICAL (prevents disasters):
${prioritizedRequirements.critical.map(req => `
**${req.name.replace(/_/g, ' ')}** ${req.completed ? '✅' : '⏳'}
Why critical: ${req.why}
If skipped: ${req.consequence}
`).join('\n')}

### 🟡 IMPORTANT (should complete):
<details>
<summary>Click to expand ${prioritizedRequirements.important.length} requirements</summary>

${prioritizedRequirements.important.map(req => 
  `- ${req.name.replace(/_/g, ' ')} ${req.completed ? '✅' : '⏳'}`
).join('\n')}
</details>

### 🟢 NICE TO HAVE:
<details>
<summary>${prioritizedRequirements.niceToHave.length} additional requirements</summary>

${prioritizedRequirements.niceToHave.map(req => 
  `- ${req.name.replace(/_/g, ' ')} ${req.completed ? '✅' : '⏳'}`
).join('\n')}
</details>

💡 **Pro tip**: Focus on RED requirements first. They prevent 80% of rework.

### 🎯 Quick Actions:
- Mark requirement complete: \`@m7 mark complete session_id="${session.id}" requirement="existing_system_analysis"\`
- Check full status: \`@m7 session status session_id="${session.id}"\`
` : !session.canProceedToCode ? `
### ⏳ Still Required (${Object.entries(session.phaseRequirements).filter(([_, completed]) => !completed).length} remaining):
${Object.entries(session.phaseRequirements)
  .filter(([_, completed]) => !completed)
  .slice(0, 3)
  .map(([req, _]) => `- ${req.replace(/_/g, ' ')}`)
  .join('\n')}
${Object.entries(session.phaseRequirements).filter(([_, completed]) => !completed).length > 3 ? '\n*...and others*' : ''}
` : `
### 🎉 Ready for Implementation!
All M7 requirements satisfied. You can now proceed with coding.
`}
` : `
## ⚠️ Operating Without Orchestration
Running in legacy mode. For full M7 enforcement, enable orchestration.
`}

## 🛡️ Risk Assessment:
${analysis.risks.map(risk => {
  const emoji = risk.severity === 'critical' ? '🔴' : risk.severity === 'major' ? '🟡' : '🟢';
  return `${emoji} **${risk.severity.toUpperCase()}**: ${risk.description}${risk.mitigation ? `\n  → Mitigation: ${risk.mitigation}` : ''}`;
}).join('\n')}

${roadmap}

## 🎯 Next Steps:
${analysis.nextSteps ? analysis.nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n') : '1. Start with Discovery phase - use @m7 create structure\n2. Follow the roadmap above\n3. Use @m7 navigate where_am_i if you get lost'}

## 📋 M7 Methodology Compliance:
${analysis.canProceed ? '✅ No unmitigated critical risks' : '❌ Critical risks detected — resolving them protects against compounding failures'}
${analysis.risks.filter(r => r.severity === 'major').length === 0 ? '✅ No major risks' : `⚠️ ${analysis.risks.filter(r => r.severity === 'major').length} major risks identified`}
${analysis.route === 'light' ? '✅ Task scope manageable' : analysis.route === 'medium' ? '⚠️ Medium complexity task' : '🔴 High complexity task - extra caution required'}

${session && !session.canProceedToCode ? `
## 💡 Why this matters:
Each phase protects against a specific class of mistakes. DISCOVERY prevents incomplete understanding, IMPACT catches regressions before they compound.
` : ''}

*M7 Analysis completed - ${new Date().toLocaleString()}*`
        }]
      };
    } catch (error: any) {
      // Handle specific M7 errors with helpful guidance
      if (error.name === 'ChaosDetectedError') {
        return {
          content: [{
            type: 'text',
            text: `# 🚨 M7 Chaos Detection Alert

## 🛑 Chaotic Request Blocked
**Reason:** ${error.message}

## 🎯 Suggested Improvements:
${error.suggestions.map((suggestion: string) => `- ${suggestion}`).join('\n')}

${error.canRequestOverride ? `
## 🆘 Emergency Override Available
If this is a genuine production emergency, you can request an override:
\`@m7 request override reason="production emergency description"\`

**Warning:** Overrides are logged and should only be used for critical situations.
` : `
## 🛡️ Override Not Available
This request pattern is too chaotic for emergency override. Please:
1. Provide more specific task description
2. Include context about what you're trying to achieve
3. Break down complex requests into smaller, focused tasks
`}

## 💡 M7 Philosophy:
*"Systematic thinking prevents technical debt. Every urgent fix creates two new problems."*

Try again with a more structured approach to your task description.`
          }],
          isError: true
        };
      }

      if (error.name === 'CriticalRiskError') {
        return {
          content: [{
            type: 'text',
            text: `# 🚨 Critical Risk Enforcement

## 🛑 ${error.message}

## 🔴 Unmitigated Critical Risks:
${error.risks.map((risk: any) => `- **${risk.description}**${risk.mitigation ? `\n  → Suggested: ${risk.mitigation}` : ''}`).join('\n')}

## 🛡️ M7 Risk Safeguard

Critical risks compound during implementation. Resolving them now protects against costly rework later.

## 🎯 Recommended Path:
1. Create mitigation plans for each critical risk
2. Implement or verify mitigation measures  
3. Re-run analysis after risk mitigation
4. Proceed with implementation once risks are addressed

## 💡 M7 Principle:
*"Resolving critical risks early prevents exponentially more expensive failures in production."*

Address these risks first, then re-analyze the task.`
          }],
          isError: true
        };
      }

      // Generic error handling
      return {
        content: [{
          type: 'text',
          text: `❌ **Task analysis failed:** ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }
};

/**
 * v3.17: Update activeContext.md with current task info.
 * Non-blocking — errors are logged but don't affect main flow.
 */
async function updateActiveContext(taskDescription: string, route: string, phase: string): Promise<void> {
  try {
    const projectPath = getProjectPath();
    const activeContextPath = path.join(projectPath, 'memory-bank', 'activeContext.md');
    
    const timestamp = new Date().toISOString();
    const content = `# Active Context

## Current Focus
**Task:** ${taskDescription.substring(0, 200)}
**Route:** ${route.toUpperCase()}
**Phase:** ${phase}
**Updated:** ${timestamp}

## Recent Activity
- ${timestamp.split('T')[0]}: ${taskDescription.substring(0, 100)}

*Auto-updated by M7 analyzeTask*
`;
    await fs.writeFile(activeContextPath, content, 'utf-8');
  } catch (err) {
    log.debug('activeContext.md update failed (non-critical):', err);
  }
}

/**
 * v3.6: Format Architecture Context section for output
 */
function formatArchitectureContext(ctx: ArchitectureContext): string {
  if (ctx.existingImplementations.length === 0) return '';
  
  let output = `## 🔍 Architecture Context (Auto-Discovered)\n\n`;
  output += `| Метрика | Значение |\n`;
  output += `|---------|----------|\n`;
  output += `| **Ключевые слова** | ${ctx.keywords.join(', ')} |\n`;
  output += `| **Найдено совпадений** | ${ctx.existingImplementations.length} |\n`;
  output += `| **Время анализа** | ${ctx.analysisTimeMs}ms |\n\n`;
  
  output += `### 📁 Похожий код в проекте:\n\n`;
  
  for (const impl of ctx.existingImplementations.slice(0, 3)) {
    output += `**${impl.file}:${impl.line}** `;
    output += `(${(impl.relevance * 100).toFixed(0)}% релевантность, keyword: \`${impl.keyword}\`)\n`;
    output += '```typescript\n' + impl.snippet.trim().slice(0, 200) + '\n```\n\n';
  }
  
  if (ctx.warnings.length > 0) {
    output += `### ⚠️ Предупреждения:\n\n`;
    ctx.warnings.forEach(w => output += `> ${w}\n\n`);
  }
  
  if (ctx.recommendation.extendExisting) {
    output += `### 💡 Рекомендация: Расширить существующее\n`;
    output += ctx.recommendation.reasoning + '\n\n';
    if (ctx.recommendation.suggestedFiles.length > 0) {
      output += `**Файлы для изучения:**\n`;
      ctx.recommendation.suggestedFiles.forEach(f => output += `- \`${f}\`\n`);
      output += '\n';
    }
  }
  
  return output;
} 