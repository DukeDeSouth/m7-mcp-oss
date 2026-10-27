#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';

// 🔇 DISABLE DEBUG LOGGING TO FIX RED INDICATOR
// MCP clients parse stderr as JSON, so console.error() breaks the protocol
const M7_DEBUG = process.env.M7_DEBUG === 'true';
const log = M7_DEBUG ? console.error : () => {};

// ─── v8.1: Graceful shutdown & pipe protection ──────────────────────────────
// When Cursor IDE closes the MCP client, the server process receives
// SIGPIPE or EPIPE on stdout write. Without handlers, Node.js crashes.
let _shutdownRequested = false;

function gracefulExit(): void {
  if (_shutdownRequested) return;
  _shutdownRequested = true;
  process.exit(0);
}

// Ignore SIGPIPE — broken pipe from client disconnect
process.on('SIGPIPE', () => { /* silent */ });

// Handle stdout/stderr write errors (EPIPE when Cursor closes pipe)
if (process.stdout && typeof process.stdout.on === 'function') {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') gracefulExit();
  });
}
if (process.stderr && typeof process.stderr.on === 'function') {
  process.stderr.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') gracefulExit();
  });
}

// Catch uncaught exceptions — exit cleanly on pipe errors, crash on real bugs
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    gracefulExit();
    return;
  }
  if (M7_DEBUG) {
    try { process.stderr.write(`[M7] Uncaught: ${err.message}\n`); } catch { /* pipe broken */ }
  }
  process.exit(1);
});
// ─── end v8.1 ───────────────────────────────────────────────────────────────

// Import core systems
import { MemorySystem } from './memory/memorySystem.js';
import { JournalSystem } from './journal/journalSystem.js';
import { TaskRouter } from './core/router.js';
import { TaskOrchestrator } from './core/orchestrator/taskOrchestrator.js';
import { ScopeGuard } from './core/guards/scopeGuard.js';
import { SchemaSystem } from './schema/schemaSystem.js';

// Import tools
import { analyzeTaskTool } from './core/tools/analyzeTask.js';
import { unifiedMemoryTool } from './core/tools/unified/memoryTool.js';
import { unifiedSessionTool } from './core/tools/unified/sessionTool.js';
import { unifiedValidationTool } from './core/tools/unified/validationTool.js';
import { createScopeTool } from './core/tools/scopeTool.js';
import { initProjectTool } from './core/tools/initProject.js';
import { checkErrorsTool } from './core/tools/checkErrors.js';
import { createStructureTool } from './core/tools/createStructure.js';
// [v9.0] Removed: enterpriseDashboardTool (file deleted), navigationTool (file deleted)
import { schemaTool } from './core/tools/schema.js';
import { projectIndexTool } from './core/tools/projectIndex/index.js';

// Import TSI System
import { TSISystem, TSI_MCP_TOOLS } from './tsi/index.js';

// Import critical v2.0 tools
import { consoleTool } from './core/tools/critical/console.js';
import { contractsTool } from './core/tools/critical/contracts.js';
// [v9.0] Removed: versioningTool (file deleted), locksTool (file deleted)
import { impactTool } from './core/tools/critical/impact.js';

// Import Hive Multiagent System
import { hiveCoordinatorTool } from './hive/tools/hiveCoordinator.js';
import { APIManager } from './hive/api/apiManager.js';
// Import Test Tool for debugging
import { testTool } from './test-tool.js';

// Import Knowledge Hub
import { knowledgeHubTool } from './core/tools/knowledgeHub/knowledgeHubTool.js';
import { safetyTool } from './core/tools/safetyTool.js';

// ═══ [v9.0] Import v3+ tools (17 missing tools restored) ═══
// V3 direct tool objects
import { telemetryTool } from './core/tools/v3/telemetry-tool.js';
import { styleGuardianTool } from './core/tools/v3/style-guardian-tool.js';
import { errorDatabaseTool } from './core/tools/v3/error-database-tool.js';
import { knowledgeGraphTool } from './core/tools/v3/knowledge-graph-tool.js';
import { archAdvisorTool } from './core/tools/v3/arch-advisor-tool.js';
import { crossSessionTool } from './core/tools/v3/cross-session-tool.js';
import { visualizerTool } from './core/tools/v3/visualizer-tool.js';
// Standalone tools (direct objects)
import { cycleTool } from './core/tools/cycleTool.js';
import { hiveHistoryTool } from './hive/tools/hiveHistory.js';
import { dcceTool } from './core/tools/dcce/dcceTool.js';
import { meshTool } from './mesh/tools/meshTool.js';

// Codex Martianus tools
import { repentanceTool } from './core/tools/repentanceTool.js';
import { litanyTool } from './core/tools/litanyTool.js';

// Factory tools
import { createDevOpsTool } from './core/tools/devopsTool.js';
import { createWarmupTool } from './core/tools/warmupTool.js';
import { createDoctorTool } from './core/tools/doctorTool.js';
import { resetWarmupManager } from './core/warmup/warmupManager.js';
import { createTaskTransferTool } from './core/tools/taskTransferTool.js';
import { createTaskGraphTool } from './core/tools/taskGraphTool.js';

// Import hint generator
import { generateIntelligentHints, addHintsToResponse } from './core/utils/hintGenerator.js';
// Import schema converter
import { extractZodSchema } from './core/utils/schemaConverter.js';
// Import project path utility
import { getProjectPath, getProjectPathDiagnostics, initFromMcpRoots, onProjectPathChange, bindMcpServerForRoots, ensureProjectPathResolved } from './core/utils/projectPath.js';
class M7MCPServer {
  private server: McpServer;
  private memory: MemorySystem;
  private journal: JournalSystem;
  private router: TaskRouter;
  private orchestrator: TaskOrchestrator;
  private scopeGuard: ScopeGuard;
  private schema: SchemaSystem;
  private apiManager: APIManager;
  private tsiSystem: TSISystem;
  private projectPath: string;
  private registeredToolNames: string[] = [];

  constructor() {
    this.server = new McpServer({
      name: '@m7/mcp-server',
      version: '2.0.0',
    });

    // Determine project path (user's workspace, not M7 installation directory)
    this.projectPath = getProjectPath();
    log('🏠 [M7 Server] Project Path:', this.projectPath);
    
    // Show diagnostics for debugging
    const diagnostics = getProjectPathDiagnostics();
    log('📊 [M7 Server] Path Resolution:',  {
      source: diagnostics.source,
      isM7Directory: diagnostics.isSelfDirectory
    });
    
    if (diagnostics.isSelfDirectory) {
      log('⚠️  [M7 Server] WARNING: Running from M7 installation directory!');
      log('💡 [M7 Server] Set M7_PROJECT_PATH environment variable to your project path.');
      log('📝 [M7 Server] Add to ~/.cursor/mcp.json: "M7_PROJECT_PATH": "/path/to/your/project"');
    }

    // v8.1: Graceful shutdown on signals and client disconnect
    process.on('SIGTERM', gracefulExit);
    process.on('SIGINT', gracefulExit);
    process.stdin.on('end', gracefulExit);
    process.stdin.on('close', gracefulExit);

    // Initialize core systems with project path
    this.memory = new MemorySystem(this.projectPath);
    this.journal = new JournalSystem(this.projectPath);
    this.schema = new SchemaSystem(this.journal, this.projectPath);
    this.router = new TaskRouter();
    this.orchestrator = new TaskOrchestrator(this.journal);
    this.scopeGuard = new ScopeGuard(this.orchestrator, this.journal);
    this.apiManager = this.initializeAPIManager();
    
    // Initialize TSI System
    this.tsiSystem = new TSISystem();
    log('✅ [M7 DEBUG] TSI System initialized');

    onProjectPathChange((oldPath, newPath) => {
      if (oldPath === newPath) return;
      log(`[M7 Server] Project path changed: ${oldPath ?? '(none)'} → ${newPath}`);
      this.projectPath = newPath;
      this.memory = new MemorySystem(newPath);
      this.journal = new JournalSystem(newPath);
      this.schema = new SchemaSystem(this.journal, newPath);
      this.orchestrator = new TaskOrchestrator(this.journal);
      this.scopeGuard = new ScopeGuard(this.orchestrator, this.journal);
      resetWarmupManager();
    });

    // Register all tools synchronously first
    this.setupTools();
    
    // Initialize TSI System asynchronously after registration
    this.initializeTSI().catch(err => log('[TSI Init Error]', err));
  }

  private initializeAPIManager(): APIManager {
    log('🔧 [M7 Server] Initializing singleton APIManager...');
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    
    if (!openaiKey) {
      throw new Error('❌ [M7 Server] OPENAI_API_KEY environment variable is required');
    }
    if (!anthropicKey) {
      throw new Error('❌ [M7 Server] ANTHROPIC_API_KEY environment variable is required');
    }
    
    log(`🔑 [M7 Server] Loading API Keys:`);
    log(`  OPENAI_API_KEY: ${openaiKey.substring(0,15)}...`);
    log(`  ANTHROPIC_API_KEY: ${anthropicKey.substring(0,15)}...`);
    
    const manager = new APIManager({ openai: openaiKey, anthropic: anthropicKey });
    log('✅ [M7 Server] Singleton APIManager created successfully');
    return manager;
  }

  private async initializeTSI() {
    log('🔧 [M7 DEBUG] Initializing TSI System...');
    await this.tsiSystem.initialize();
    log('✅ [M7 DEBUG] TSI System fully initialized');
  }

  private setupTools() {
    
    // 1. Analyze Task Tool
    this.registerTool(analyzeTaskTool, (request: any) => 
      analyzeTaskTool.handler(request, this.router, this.orchestrator, this.schema, this.server)
    );

    // 2. Memory Tool
    this.registerTool(unifiedMemoryTool, (request: any) => 
      unifiedMemoryTool.handler(request)
    );

    // 3. Session Tool
    this.registerTool(unifiedSessionTool, (request: any) => 
      unifiedSessionTool.handler(request, this.orchestrator)
    );

    // 4. Validation Tool
    this.registerTool(unifiedValidationTool, (request: any) => 
      unifiedValidationTool.handler(request, this.journal)
    );

    // 5. Scope Tool (requires factory function)
    const scopeTool = createScopeTool(this.scopeGuard, this.orchestrator);
    this.registerTool(scopeTool, (request: any) => scopeTool.handler(request));

    // 6. Init Project Tool
    this.registerTool(initProjectTool, (request: any) => 
      initProjectTool.handler(request, this.journal, this.schema, this.server)
    );

    // 7. Check Errors Tool
    this.registerTool(checkErrorsTool, (request: any) => 
      checkErrorsTool.handler(request, this.journal)
    );

    // 8. Create Structure Tool
    this.registerTool(createStructureTool, (request: any) => createStructureTool.handler(request, this.server));

    // [v9.0] Removed: enterpriseDashboardTool (file deleted)
    // [v9.0] Removed: navigationTool (file deleted)

    // 11. Schema Tool
    this.registerTool(schemaTool, async (request: any) => {
      const { action, component, changes, format } = request;
      
      switch (action) {
        case 'view': {
          const schema = await this.schema.loadSchema();
          if (!schema) {
            return { error: 'No schema found. Run init_project first.' };
          }
          
          if (component && component !== 'all') {
            return { 
              component,
              data: schema[component as keyof typeof schema] || {},
              format
            };
          }
          
          return { schema, format };
        }
        
        case 'update': {
          if (!changes) {
            return { error: 'Changes are required for update action' };
          }
          
          // v9.3: Auto-parse if AI sent double-encoded JSON string
          let parsedChanges = changes;
          if (typeof changes === 'string') {
            try {
              parsedChanges = JSON.parse(changes);
            } catch {
              return { error: 'Changes must be a valid JSON object, received unparseable string' };
            }
          }
          if (typeof parsedChanges !== 'object' || Array.isArray(parsedChanges) || parsedChanges === null) {
            return { error: `Changes must be a JSON object, received ${typeof parsedChanges}` };
          }
          
          if (component && component !== 'all') {
            await this.schema.updateSection(component as any, parsedChanges);
          } else {
            const current = await this.schema.loadSchema();
            if (!current) {
              return { error: 'No schema found. Initialize first.' };
            }
            await this.schema.saveSchema({ ...current, ...parsedChanges });
          }
          
          return { success: true, message: 'Schema updated successfully' };
        }
        
        case 'validate': {
          const result = await this.schema.validateSchema();
          return result;
        }
        
        case 'check_db': {
          const dbInfo = await this.schema.checkDatabaseExists();
          if (dbInfo.exists) {
            return {
              exists: true,
              database: dbInfo.name,
              type: dbInfo.type,
              message: `⚠️ Database already exists: ${dbInfo.name} (${dbInfo.type})`
            };
          }
          return { exists: false, message: 'No database configured yet' };
        }
        
        case 'sync': {
          // TODO: Implement sync with actual codebase
          return { message: 'Sync functionality will be implemented soon' };
        }
        
        case 'diff': {
          if (!changes) {
            return { error: 'Changes are required for diff action' };
          }
          const diff = await this.schema.generateDiff(changes);
          return { diff };
        }
        
        default:
          return { error: `Unknown action: ${action}` };
      }
    });

    // 12. Project Index Manager Tool
    try {
      this.registerTool(projectIndexTool, (request: any) => 
        projectIndexTool.handler(request, this.journal));
      log('✅ [M7 DEBUG] Project Index Manager registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] Project Index Manager registration failed:', error.message);
    }

    // 13-15. TSI System Tools
    log('🔧 [M7 DEBUG] Registering TSI System tools...');
    try {
      for (const tsiTool of TSI_MCP_TOOLS) {
        this.registerTool(tsiTool, async (request: any) => {
          // Wait for TSI initialization if not ready
          if (!(this.tsiSystem as any).initialized) {
            return {
              content: [{ type: 'text', text: 'TSI System is still initializing. Please try again in a moment.' }],
              isError: false
            };
          }
          return await tsiTool.handler(request, this.tsiSystem);
        });
        log(`✅ [M7 DEBUG] TSI Tool registered: ${tsiTool.name}`);
      }
      log('✅ [M7 DEBUG] All TSI System tools registered successfully!');
    } catch (error: any) {
      log('❌ [M7 DEBUG] TSI System tools registration failed:', error.message);
    }

    // Register critical v2.0 tools
    log('🔧 [M7 DEBUG] Registering critical v2.0 tools...');
    
    try {
      this.registerTool(consoleTool, (request: any) => 
        consoleTool.handler(request, { journal: this.journal }));
      log('✅ [M7 DEBUG] consoleTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] consoleTool registration failed:', error.message);
    }
    
    try {
      this.registerTool(contractsTool, (request: any) => 
        contractsTool.handler(request, { journal: this.journal, schema: this.schema }));
      log('✅ [M7 DEBUG] contractsTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] contractsTool registration failed:', error.message);
    }
    
    // [v9.0] Removed: versioningTool (file deleted)
    // [v9.0] Removed: locksTool (file deleted)
    
    try {
      this.registerTool(impactTool, (request: any) => 
        impactTool.handler(request, { journal: this.journal }));
      log('✅ [M7 DEBUG] impactTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] impactTool registration failed:', error.message);
    }
    
    // 16. Test Tool for MCP Debug
    log('🧪 [M7 DEBUG] About to register Test Tool...');
    try {
      this.registerTool(testTool, (request: any) => testTool.handler(request));
      log('✅ [M7 DEBUG] Test Tool registered successfully!');
    } catch (error: any) {
      log('❌ [M7 DEBUG] Test Tool registration failed:', error.message);
    }

    // 17. Hive Coordinator Tool
    log('🔍 [M7 DEBUG] About to register Hive Coordinator Tool...');
    try {
      this.registerTool(hiveCoordinatorTool, (request: any) => 
        hiveCoordinatorTool.handler(request, this.journal, this.apiManager));
      log('✅ [M7 DEBUG] Hive Coordinator Tool registered successfully!');
    } catch (error: any) {
      log('❌ [M7 DEBUG] Hive Coordinator Tool registration failed:', error.message);
    }

    // 18. Knowledge Hub Tool
    log('📚 [M7 DEBUG] About to register Knowledge Hub Tool...');
    try {
      this.registerTool(knowledgeHubTool, (request: any) => 
        knowledgeHubTool.handler(request, { journal: this.journal }));
      log('✅ [M7 DEBUG] Knowledge Hub Tool registered successfully!');
    } catch (error: any) {
      log('❌ [M7 DEBUG] Knowledge Hub Tool registration failed:', error.message);
    }

    // Safety Pipeline Tool
    try {
      this.registerTool(safetyTool, (request: any) => safetyTool.handler(request));
      log('✅ [M7 DEBUG] Safety Tool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] Safety Tool registration failed:', error.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // [v9.0] V3+ TOOLS — 17 restored tools
    // ═══════════════════════════════════════════════════════════════
    log('🔧 [M7 DEBUG] Registering v3+ tools...');

    // 19. Telemetry Tool
    try {
      this.registerTool(telemetryTool, (request: any) => telemetryTool.handler(request));
      log('✅ [M7 DEBUG] telemetryTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] telemetryTool registration failed:', error.message);
    }

    // 20. Style Guardian Tool
    try {
      this.registerTool(styleGuardianTool, (request: any) => styleGuardianTool.handler(request));
      log('✅ [M7 DEBUG] styleGuardianTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] styleGuardianTool registration failed:', error.message);
    }

    // 21. Error Database Tool
    try {
      this.registerTool(errorDatabaseTool, (request: any) => errorDatabaseTool.handler(request));
      log('✅ [M7 DEBUG] errorDatabaseTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] errorDatabaseTool registration failed:', error.message);
    }

    // 22. Knowledge Graph Tool
    try {
      this.registerTool(knowledgeGraphTool, (request: any) => knowledgeGraphTool.handler(request));
      log('✅ [M7 DEBUG] knowledgeGraphTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] knowledgeGraphTool registration failed:', error.message);
    }

    // 23. Arch Advisor Tool
    try {
      this.registerTool(archAdvisorTool, (request: any) => archAdvisorTool.handler(request));
      log('✅ [M7 DEBUG] archAdvisorTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] archAdvisorTool registration failed:', error.message);
    }

    // 24. Cross-Session Learning Tool
    try {
      this.registerTool(crossSessionTool, (request: any) => crossSessionTool.handler(request));
      log('✅ [M7 DEBUG] crossSessionTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] crossSessionTool registration failed:', error.message);
    }

    // 25. Context Visualizer Tool
    try {
      this.registerTool(visualizerTool, (request: any) => visualizerTool.handler(request));
      log('✅ [M7 DEBUG] visualizerTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] visualizerTool registration failed:', error.message);
    }

    // 27. Cycle Tool
    try {
      this.registerTool(cycleTool, (request: any) => cycleTool.handler(request));
      log('✅ [M7 DEBUG] cycleTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] cycleTool registration failed:', error.message);
    }

    // 28. Hive History Tool
    try {
      this.registerTool(hiveHistoryTool, (request: any) => hiveHistoryTool.handler(request));
      log('✅ [M7 DEBUG] hiveHistoryTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] hiveHistoryTool registration failed:', error.message);
    }

    // 29. DCCE Tool
    try {
      this.registerTool(dcceTool, (request: any) => dcceTool.handler(request));
      log('✅ [M7 DEBUG] dcceTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] dcceTool registration failed:', error.message);
    }

    // 30. Mesh Tool
    try {
      this.registerTool(meshTool, (request: any) => meshTool.handler(request));
      log('✅ [M7 DEBUG] meshTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] meshTool registration failed:', error.message);
    }

    // 31. DevOps Tool (factory)
    try {
      const devopsTool = createDevOpsTool();
      this.registerTool(devopsTool, (request: any) => devopsTool.handler(request));
      log('✅ [M7 DEBUG] devopsTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] devopsTool registration failed:', error.message);
    }

    // 32. Warmup Tool (factory — needs McpServer for roots)
    try {
      const warmupTool = createWarmupTool(this.server);
      this.registerTool(warmupTool, (request: any) => warmupTool.handler(request));
      log('✅ [M7 DEBUG] warmupTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] warmupTool registration failed:', error.message);
    }

    // 33. Doctor Tool (factory)
    try {
      const doctorTool = createDoctorTool(this.server);
      this.registerTool(doctorTool, (request: any) => doctorTool.handler(request));
      log('✅ [M7 DEBUG] doctorTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] doctorTool registration failed:', error.message);
    }

    // 34. Task Transfer Tool (factory — needs TaskOrchestrator)
    try {
      const taskTransferTool = createTaskTransferTool(this.orchestrator);
      this.registerTool(taskTransferTool, (request: any) => taskTransferTool.handler(request));
      log('✅ [M7 DEBUG] taskTransferTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] taskTransferTool registration failed:', error.message);
    }

    // 35. Task Graph Tool (factory)
    try {
      const taskGraphTool = createTaskGraphTool();
      this.registerTool(taskGraphTool, (request: any) => taskGraphTool.handler(request));
      log('✅ [M7 DEBUG] taskGraphTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] taskGraphTool registration failed:', error.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // CODEX MARTIANUS — Sacred Tools of the Prima Formularis
    // ═══════════════════════════════════════════════════════════════

    // 36. Repentance Tool (Litany of Unbinding)
    try {
      this.registerTool(repentanceTool, (request: any) => repentanceTool.handler(request));
      log('✅ [M7 DEBUG] repentanceTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] repentanceTool registration failed:', error.message);
    }

    // 37. Litany Tool (Litany of Ignition)
    try {
      this.registerTool(litanyTool, (request: any) => litanyTool.handler(request));
      log('✅ [M7 DEBUG] litanyTool registered');
    } catch (error: any) {
      log('❌ [M7 DEBUG] litanyTool registration failed:', error.message);
    }

    log('✅ [M7 DEBUG] All tools registration complete');

    // ═══════════════════════════════════════════════════════════════
    // MCP RESOURCES - Provide server status and information
    // ═══════════════════════════════════════════════════════════════

    log('[M7] 📚 Registering MCP Resources...');
    
    // Resource 1: M7 Server Status
    this.server.registerResource(
      'm7-status',
      'm7://status',
      {
        title: 'M7 Server Status',
        description: 'Current status and health of M7 MCP Server',
        mimeType: 'application/json'
      },
      async (uri: URL) => {
        const activeSessions = this.orchestrator.getAllActiveSessions();
        const pathDiagnostics = getProjectPathDiagnostics();
        
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              status: 'running',
              version: '2.0.0',
              tools: this.registeredToolNames.length,
              uptime: process.uptime(),
              memory: {
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
              },
              project_path: getProjectPath(),
              project_path_source: pathDiagnostics.source,
              active_sessions: activeSessions.length
            }, null, 2)
          }]
        };
      }
    );
    
    // Resource 2: Active M7 Session
    this.server.registerResource(
      'm7-session',
      'm7://session',
      {
        title: 'Active M7 Session',
        description: 'Information about currently active M7 sessions',
        mimeType: 'application/json'
      },
      async (uri: URL) => {
        const activeSessions = this.orchestrator.getAllActiveSessions();
        
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              active_sessions: activeSessions.length,
              sessions: activeSessions.map(s => ({
                id: s.id,
                route: s.route,
                phase: s.currentPhase,
                started: s.startTime
              })),
              last_activity: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    );
    
    // Resource 3: M7 Tools List
    this.server.registerResource(
      'm7-tools',
      'm7://tools',
      {
        title: 'M7 Tools List',
        description: 'Complete list of all M7 MCP tools',
        mimeType: 'application/json'
      },
      async (uri: URL) => {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              total: this.registeredToolNames.length,
              tools: this.registeredToolNames.map(name => name.replace(/^mcp_m7_/, ''))
            }, null, 2)
          }]
        };
      }
    );
    
    // Resource 4: M7 Memory Bank
    this.server.registerResource(
      'm7-memory',
      'm7://memory',
      {
        title: 'M7 Memory Bank Status',
        description: 'Current state of M7 Memory Bank system',
        mimeType: 'application/json'
      },
      async (uri: URL) => {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              levels: 5,
              files: [
                'activeContext.md',
                'progress.md',
                'systemPatterns.md',
                'techContext.md',
                'projectbrief.md',
                'productContext.md'
              ],
              path: `${this.projectPath}/memory-bank/`
            }, null, 2)
          }]
        };
      }
    );

    log('✅ [M7] MCP Resources registered successfully! (4 resources available)');
  }

  private registerTool(tool: any, handler: (request: any) => Promise<any>) {
    // Convert JSON Schema to Zod schema if needed
    const zodSchema = extractZodSchema(tool.inputSchema);
    
    log(`[M7 DEBUG] Registering tool: ${tool.name}`);
    log(`[M7 DEBUG] Tool schema keys:`, Object.keys(zodSchema));
    
    // Special debug for Hive tool
    if (tool.name.includes('hive')) {
      log(`🚀 [M7 DEBUG] HIVE TOOL DETECTED: ${tool.name}`);
      log(`🚀 [M7 DEBUG] HIVE HANDLER TYPE: ${typeof handler}`);
      log(`🚀 [M7 DEBUG] HIVE TOOL OBJECT:`, {
        name: tool.name,
        description: tool.description,
        hasHandler: typeof tool.handler === 'function'
      });
    }
    
    this.server.registerTool(
      tool.name,
      {
        title: tool.name.replace(/mcp_m7_/, '').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        description: tool.description,
        inputSchema: zodSchema
      },
      async (args: any) => {
        try {
          log(`[M7] Executing ${tool.name}`);
          const result = await handler(args);
          
          // Handle both direct response and wrapped response formats
          let response;
          if (result.content) {
            response = result;
          } else {
            // If handler returns unwrapped content, wrap it
            response = {
              content: [{
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
              }]
            };
          }
          
          // Intelligent Hints: Add context-aware hints
          if (!response.isError) {
            try {
              // Get current session if available
              const activeSessions = this.orchestrator.getAllActiveSessions();
              const currentSession = activeSessions.length > 0 ? activeSessions[0] : null;
              
              // Get recent errors
              const recentErrors = await this.journal.getErrorsByType();
              const errorStats = Object.entries(recentErrors)
                .map(([category, count]) => ({ category, count }))
                .sort((a, b) => b.count - a.count);
              
              // Generate hints
              const hints = generateIntelligentHints({
                phase: currentSession?.currentPhase,
                taskType: currentSession?.route,
                currentTool: tool.name,
                recentErrors: errorStats.slice(0, 3),
                sessionDuration: currentSession ? 
                  Date.now() - new Date(currentSession.startTime).getTime() : undefined
              });
              
              // Add hints to response
              response = addHintsToResponse(response, hints);
            } catch (hintError) {
              // Don't fail if hint generation fails
              log('[M7] Hint generation failed:', hintError);
            }
          }
          
          return response;
        } catch (error: any) {
          log(`[M7] Error in ${tool.name}:`, error);
          
          // Check if it's already a formatted error response
          if (error.content && error.isError) {
            return error;
          }
          
          return {
            content: [{
              type: 'text',
              text: `❌ Error in ${tool.name}: ${error.message || 'Unknown error'}`
            }],
            isError: true
          };
        }
      }
    );
    this.registeredToolNames.push(tool.name);
  }

  async run() {
    const transport = new StdioServerTransport();
    
    // v8.1: Handle transport errors (broken pipe, client disconnect)
    transport.onerror = (error: Error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
        gracefulExit();
        return;
      }
      log('[M7 MCP] Transport error:', error.message);
    };

    transport.onclose = () => {
      log('[M7 MCP] Transport closed');
      gracefulExit();
    };

    bindMcpServerForRoots(this.server);

    // v3.19: After client handshake, resolve workspace from MCP Roots.
    const underlying = (this.server as any).server;
    if (underlying) {
      const prevOnInit = underlying.oninitialized;
      underlying.oninitialized = async () => {
        if (prevOnInit) await prevOnInit();
        
        log('[M7 MCP] Client initialized, resolving workspace from MCP Roots...');
        const rootsPath = await initFromMcpRoots(this.server);
        if (rootsPath) {
          log(`[M7 MCP] Workspace resolved: ${rootsPath}`);
          this.projectPath = rootsPath;
        } else {
          const resolved = await ensureProjectPathResolved(this.server);
          this.projectPath = resolved;
          const diagnostics = getProjectPathDiagnostics();
          log(`[M7 MCP] Roots pending — resolved via ${diagnostics.source}: ${resolved}`);
        }
      };
    }
    
    // v8.1: Wrap connect in try-catch for pipe failures
    try {
      await this.server.connect(transport);
    } catch (err: any) {
      if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
        gracefulExit();
        return;
      }
      throw err;
    }
    
    log('[M7 MCP] Server running');
    log('[M7 MCP] Systems initialized');
    log('[M7 MCP] Waiting for Cursor to connect and request tools...');
  }
}

const server = new M7MCPServer();
server.run().catch(err => {
  // v8.1: Exit cleanly on pipe errors
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
    process.exit(0);
  }
  if (M7_DEBUG) {
    try { process.stderr.write(`[M7] Fatal: ${err.message}\n`); } catch { /* pipe broken */ }
  }
  process.exit(1);
});
