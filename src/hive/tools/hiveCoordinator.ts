import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[HiveCoordinator]');

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { HiveOrchestrator } from '../orchestrator/hiveOrchestrator.js';
import { DynamicHiveOrchestrator } from '../orchestrator/dynamicOrchestrator.js';
import { PlannerOrchestrator } from '../orchestrator/plannerOrchestrator.js';
import { APIManager } from '../api/apiManager.js';
import { HiveTask, HiveMode } from '../types/task.js';
import { DynamicHiveResult } from '../intelligence/types.js';
import { PlannerResult } from '../planner/types.js';
import { JournalSystem } from '../../journal/journalSystem.js';
// v5.0: Use UnifiedMemoryCore instead of legacy memory systems
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';
// v5.1: Use robust JSON parser
import { quickParse } from '../utils/json/index.js';
// v7.1: Project path for saving reports
import { getProjectPath } from '../../core/utils/projectPath.js';

// ============================================================================
// v7.1: Save Hive reports to docs/hive/ as .md files
// ============================================================================

/**
 * Save the full Hive report to a Markdown file.
 * File goes to docs/hive/ in the project root (via getProjectPath).
 */
function saveHiveReport(taskId: string, taskDescription: string, content: string): string | null {
  try {
    const projectRoot = getProjectPath();
    const hiveDir = path.join(projectRoot, 'docs', 'hive');
    fs.mkdirSync(hiveDir, { recursive: true });
    
    // Generate filename: YYYY-MM-DD_slug.md
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // 2026-02-07
    const timeStr = now.toISOString().slice(11, 16).replace(':', ''); // 1423
    
    const slug = taskDescription
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '');
    
    const filename = `${dateStr}_${timeStr}_${slug}.md`;
    const filepath = path.join(hiveDir, filename);
    
    fs.writeFileSync(filepath, content, 'utf-8');
    
    log.debug(`📄 [MCP Hive] Report saved: ${filepath}`);
    return filepath;
  } catch (err: any) {
    log.debug(`⚠️ [MCP Hive] Failed to save report: ${err.message}`);
    return null;
  }
}

// Helper function to create semantic task ID from description
function generateSemanticTaskId(taskDescription: string): string {
  const slug = taskDescription
    .toLowerCase()
    .trim()
    .replace(/[^\u0040-\u1FFF\u2C00-\uD7FF\w\s-]/g, '') // Keep Latin, Cyrillic, spaces, hyphens
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/--+/g, '-')     // Replace multiple hyphens with single
    .slice(0, 40)             // Limit length
    .replace(/^-+|-+$/g, ''); // Trim leading/trailing hyphens
  
  // Add unique suffix to avoid collisions
  const shortId = Date.now().toString().slice(-6);
  return `hive_${slug}_${shortId}`;
}

const HiveCoordinatorRequestSchema = z.object({
  task: z.string().describe('Task description for multiagent analysis'),
  mode: z.enum(['dynamic', 'fixed', 'planned']).default('dynamic').describe(
    'Execution mode: "dynamic" (AI team, default), "planned" (CNP auction-based, v3.8.0+), or "fixed" (legacy)'
  ),
  agents: z.array(z.enum(['research', 'implementation', 'architecture', 'security', 'testing', 'performance', 'techsafety']))
    .optional()
    .describe('Which agents to involve (only used in "fixed" mode, auto-selected if not specified)'),
  debate_mode: z.boolean().default(true).describe('Enable agent debates for consensus'),
  max_rounds: z.number().default(3).describe('Maximum debate rounds before fallback'),
  priority: z.enum(['speed', 'quality', 'consensus']).default('quality').describe('Optimization priority'),
  // Planner options (v3.8.0+)
  plannerOptions: z.object({
    maxSubtasks: z.number().optional().describe('Maximum subtasks to create (default: 8)'),
    auctionTimeoutMs: z.number().optional().describe('Auction timeout in ms (default: 5000)'),
    gatekeepers: z.array(z.enum(['style', 'arch', 'security', 'test'])).optional().describe('Gatekeepers to enable'),
    parallelAuctions: z.boolean().optional().describe('Run auctions in parallel (default: true)')
  }).optional().describe('Options for planned mode (v3.8.0+)')
});

export const hiveCoordinatorTool = {
  name: 'mcp_m7_hive_coordinator',
  description: `Orchestrate multiagent collaboration for complex tasks using M7 Hive system.

v3.8.0 Features:
- DYNAMIC MODE (default): AI creates optimal expert team for each task
- PLANNED MODE (new): CNP auction-based coordination with task decomposition
- MODEL SELECTION: Best model chosen per agent based on LiveBench benchmarks
- SELF-LEARNING: System improves over time based on results
- GATEKEEPERS: Style, Architecture, Security validation

Use mode="dynamic" for quick expert analysis (default).
Use mode="planned" for complex tasks requiring decomposition and validation.
Use mode="fixed" for legacy behavior with predefined agents.`,
  inputSchema: HiveCoordinatorRequestSchema,
  
  handler: async (
    request: any,
    journal: JournalSystem,
    apiManager: APIManager
  ) => {
    const mode: HiveMode = request.mode || 'dynamic';
    log.debug(`🚀 [MCP Hive] Handler called in ${mode.toUpperCase()} mode`);
    log.debug('📋 [MCP Hive] Task:', request.task.substring(0, 100));
    
    try {
      // v5.0: Auto Context Injection via UnifiedMemoryCore
      interface EnrichedContext {
        projectInfo: { name: string; technologies: string[] };
        relevantChunks: Array<{ source: string; score: number; content: string }>;
      }
      let enrichedContext: EnrichedContext | null = null;
      try {
        const memoryCore = await getMemoryCore();
        const searchResults = await memoryCore.cascadeSearch(request.task, { limit: 5 });
        if (searchResults.length > 0) {
          enrichedContext = {
            projectInfo: { name: 'Current Project', technologies: [] },
            relevantChunks: searchResults.map(r => ({
              source: r.record.id,
              score: r.score,
              content: r.record.content
            }))
          };
          log.debug(`🧠 [MCP Hive] Auto-injected ${searchResults.length} context chunks`);
        }
      } catch (e: any) {
        log.debug(`⚠️ [MCP Hive] Context injection skipped: ${e.message}`);
      }
      
      // v8.0: Mesh Context Injection — tell Hive about other M7 instances
      let meshContextBlock = '';
      try {
        const { getMeshManager } = await import('../../mesh/MeshManager.js');
        const mesh = getMeshManager();
        if (mesh.isActive()) {
          const peerContexts = mesh.getAllPeerContexts();
          if (peerContexts.length > 0) {
            const peerLines = peerContexts.map(p => {
              const ctxSummary = p.contexts.slice(0, 3).map(c => 
                `    [${c.context_type}] ${c.content.slice(0, 150)}`
              ).join('\n');
              return `  - Instance ${p.instance_id.slice(0, 12)}... (PID ${p.pid})\n` +
                `    Role: ${p.server_role || 'none'} | Project: ${p.project_root}\n` +
                (ctxSummary ? `${ctxSummary}` : '    (no context published)');
            }).join('\n');
            meshContextBlock = `\n\n--- MESH CONTEXT: ${peerContexts.length} other M7 instance(s) active ---\n${peerLines}\n--- END MESH CONTEXT ---`;
            log.debug(`🔗 [MCP Hive] Injected mesh context from ${peerContexts.length} peer(s)`);
          }
        }
      } catch {
        // Mesh not available or not initialized — skip silently
      }

      const taskId = generateSemanticTaskId(request.task);
      const enrichedTaskDescription = enrichedContext && enrichedContext.relevantChunks.length > 0
        ? `${request.task}${meshContextBlock}

--- PROJECT CONTEXT (Auto-Injected) ---
Project: ${enrichedContext.projectInfo.name}
Technologies: ${enrichedContext.projectInfo.technologies.join(', ')}

Relevant code context:
${enrichedContext.relevantChunks.slice(0, 3).map(chunk => 
  `// ${chunk.source}\n${chunk.content.slice(0, 300)}...`
).join('\n\n')}
--- END PROJECT CONTEXT ---`
        : request.task + meshContextBlock;
      
      // ===============================================
      // DYNAMIC MODE (v3.7.0+) - Default
      // ===============================================
      if (mode === 'dynamic') {
        log.debug('🧬 [MCP Hive] Using DYNAMIC orchestrator with AI-generated team');
        
        // Get API keys from environment (same source as APIManager uses)
        const openaiKey = process.env.OPENAI_API_KEY || '';
        const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
        
        log.debug(`🔑 [MCP Hive] OpenAI key: ${openaiKey ? 'present' : 'MISSING'}`);
        log.debug(`🔑 [MCP Hive] Anthropic key: ${anthropicKey ? 'present (' + anthropicKey.substring(0, 15) + '...)' : 'MISSING'}`);
        
        if (!anthropicKey) {
          log.debug('⚠️ [MCP Hive] ANTHROPIC_API_KEY not set, Architect will use fallback');
        }
        
        const dynamicOrchestrator = new DynamicHiveOrchestrator(
          { openai: openaiKey, anthropic: anthropicKey },
          journal
        );
        
        const hiveTask: HiveTask = {
          id: taskId,
          description: enrichedTaskDescription,
          context: request.context,
          debate_mode: request.debate_mode ?? true,
          max_rounds: request.max_rounds ?? 3,
          priority: request.priority ?? 'quality',
          mode: 'dynamic'
        };
        
        const result = await dynamicOrchestrator.coordinateTask(hiveTask);
        
        log.debug(`✅ [MCP Hive] Dynamic coordination complete: ${result.team.length} experts, $${result.metrics.totalCost.toFixed(4)}`);
        
        // Add debug info to response
        const debugInfo = `
---

## 🔧 Debug Info

- OpenAI Key: ${openaiKey ? '✅ Present' : '❌ MISSING'}
- Anthropic Key: ${anthropicKey ? '✅ Present (' + anthropicKey.substring(0, 15) + '...)' : '❌ MISSING'}
- Architect Latency: ${result.metrics.architectLatencyMs}ms
- Team Size: ${result.team.length}
- Is Fallback: ${result.team.some(a => a.role === 'Strategic Analyst') ? 'YES (fallback team)' : 'NO (dynamic team)'}
`;
        
        // v7.2: Save full report to file, return compact summary to chat
        const fullReport = formatDynamicHiveResponse(result) + debugInfo;
        const savedPath = saveHiveReport(taskId, request.task, fullReport);
        
        // Return compact summary (~3-5KB) so user can actually SEE it in Cursor chat
        const compactSummary = formatCompactSummary(result, savedPath);
        
        return {
          content: [
            {
              type: 'text',
              text: compactSummary
            }
          ]
        };
      }
      
      // ===============================================
      // PLANNED MODE (v3.8.0+) - CNP Auction-based
      // ===============================================
      if (mode === 'planned') {
        log.debug('📋 [MCP Hive] ===== PLANNED MODE START =====');
        log.debug(`📋 [MCP Hive] Task: ${request.task.substring(0, 100)}`);
        log.debug(`📋 [MCP Hive] Options: ${JSON.stringify(request.plannerOptions)}`);
        
        const openaiKey = process.env.OPENAI_API_KEY || '';
        const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
        
        log.debug(`🔑 [MCP Hive] OpenAI key: ${openaiKey ? 'present' : 'MISSING'}`);
        log.debug(`🔑 [MCP Hive] Anthropic key: ${anthropicKey ? 'present' : 'MISSING'}`);
        
        const plannerOrchestrator = new PlannerOrchestrator(
          { openai: openaiKey, anthropic: anthropicKey },
          journal,
          {
            maxSubtasks: request.plannerOptions?.maxSubtasks,
            auctionTimeoutMs: request.plannerOptions?.auctionTimeoutMs,
            parallelAuctions: request.plannerOptions?.parallelAuctions,
            gatekeepers: request.plannerOptions?.gatekeepers?.map((g: string) => ({
              type: g as 'style' | 'arch' | 'security' | 'test',
              enabled: true,
              blocking: g === 'security'
            }))
          }
        );
        
        const hiveTask: HiveTask = {
          id: taskId,
          description: enrichedTaskDescription,
          context: request.context,
          debate_mode: request.debate_mode ?? true,
          max_rounds: request.max_rounds ?? 3,
          priority: request.priority ?? 'quality',
          mode: 'planned',
          plannerOptions: request.plannerOptions
        };
        
        log.debug(`📋 [MCP Hive] Calling coordinateTask...`);
        const result = await plannerOrchestrator.coordinateTask(hiveTask);
        
        log.debug(`✅ [MCP Hive] Planned coordination complete: ${result.tasks.length} tasks, ${result.results.length} executed, success=${result.success}`);
        
        // v7.1: Save report to docs/hive/
        const plannedReport = formatPlannerResponse(result);
        const plannedPath = saveHiveReport(taskId, request.task, plannedReport);
        const plannedNote = plannedPath 
          ? `\n---\n📄 **Report saved**: \`${plannedPath}\`` 
          : '';
        
        return {
          content: [
            {
              type: 'text',
              text: plannedReport + plannedNote
            }
          ]
        };
      }
      
      // ===============================================
      // FIXED MODE (Legacy) - Predefined agents
      // ===============================================
      log.debug('📦 [MCP Hive] Using FIXED orchestrator with predefined agents');
      
      const orchestrator = new HiveOrchestrator(apiManager, journal);
      
      const hiveTask: HiveTask = {
        id: taskId,
        description: enrichedTaskDescription,
        context: request.context,
        agents: request.agents,
        debate_mode: request.debate_mode ?? true,
        max_rounds: request.max_rounds ?? 3,
        priority: request.priority ?? 'quality',
        mode: 'fixed'
      };
      
      const result = await orchestrator.coordinateTask(hiveTask);
      
      log.debug(`✅ [MCP Hive] Fixed coordination complete: ${result.agents_used.join(', ')}`);
      
      // v7.1: Save report to docs/hive/
      const fixedReport = formatHiveResponse(result);
      const fixedPath = saveHiveReport(taskId, request.task, fixedReport);
      const fixedNote = fixedPath 
        ? `\n---\n📄 **Report saved**: \`${fixedPath}\`` 
        : '';
      
      return {
        content: [
          {
            type: 'text',
            text: fixedReport + fixedNote
          }
        ]
      };
      
    } catch (error: any) {
      log.debug('💥 [MCP Hive] Coordination error:', error);
      
      return {
        content: [
          {
            type: 'text', 
            text: `# 🚨 M7 Hive Coordination Failed

**Error**: ${error.message}

**Mode**: ${request.mode || 'dynamic'}

**Stack**: ${error.stack}

---
💡 Verify OpenAI and Anthropic API keys are valid
📌 Try mode="fixed" if dynamic mode fails

**MCP Integration Debug**: This error occurred in the MCP tool handler`
          }
        ]
      };
    }
  }
};

function formatProposal(proposal: string): string {
  // v5.1: Use robust JSON parser
  const result = quickParse(proposal);
  if (result.success && result.data && typeof result.data === 'object') {
    return (result.data as any).proposal || proposal;
  }
  return proposal;
}

function formatReasoning(reasoning: string): string {
  // v5.1: Use robust JSON parser
  const result = quickParse(reasoning);
  if (result.success && result.data && typeof result.data === 'object') {
    return (result.data as any).reasoning || reasoning;
  }
  return reasoning;
}

function formatImplementationSteps(solution: any): string {
  try {
    // Try to get steps from JSON proposal first
    if (typeof solution.proposal === 'string') {
      // v5.1: Use robust JSON parser
      const result = quickParse(solution.proposal);
      if (result.success && result.data && typeof result.data === 'object') {
        const jsonProposal = result.data as any;
        if (jsonProposal.implementation_steps?.length > 0) {
          return `
### ⚡ Implementation Steps:
${jsonProposal.implementation_steps.map((step: string, i: number) => `${i + 1}. ${step}`).join('\n')}`;
        }
      }
    }
    
    // Fallback to direct array
    if (solution.implementation_steps?.length > 0) {
      return `
### ⚡ Implementation Steps:
${solution.implementation_steps.map((step: string, i: number) => `${i + 1}. ${step}`).join('\n')}`;
    }
    
    return '';
  } catch {
    return '';
  }
}

function formatRequirements(solution: any): string {
  try {
    // Try to get requirements from JSON proposal first
    if (typeof solution.proposal === 'string') {
      // v5.1: Use robust JSON parser
      const result = quickParse(solution.proposal);
      if (result.success && result.data && typeof result.data === 'object') {
        const jsonProposal = result.data as any;
        if (jsonProposal.requirements?.length > 0) {
          return `
### 📋 Requirements:
${jsonProposal.requirements.map((req: string) => `- ${req}`).join('\n')}`;
        }
      }
    }
    
    // Fallback to direct array
    if (solution.requirements?.length > 0) {
      return `
### 📋 Requirements:
${solution.requirements.map((req: string) => `- ${req}`).join('\n')}`;
    }
    
    return '';
  } catch {
    return '';
  }
}

/**
 * Format compact summary for inline chat display (~3-5KB).
 * Full report goes to docs/hive/ file.
 * v7.2: Solves the problem of Cursor hiding large MCP outputs.
 */
function formatCompactSummary(result: DynamicHiveResult, savedPath: string | null): string {
  // Team list (short)
  const teamShort = result.team.map(a => `**${a.role}**`).join(' · ');
  
  // Parse synthesis JSON for consensus/disagreements
  let consensusPoints: string[] = [];
  let disagreements: string[] = [];
  let openQuestions: string[] = [];
  let synthesisText = '';
  
  try {
    // synthesis.content may contain a JSON code block
    const content = result.synthesis.content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    const parsed = JSON.parse(jsonStr);
    
    synthesisText = parsed.synthesis || '';
    consensusPoints = (parsed.consensus_points || []).slice(0, 5);
    disagreements = (parsed.disagreements || []).slice(0, 3).map((d: any) => 
      typeof d === 'string' ? d : d.topic || JSON.stringify(d).substring(0, 150)
    );
    openQuestions = (parsed.open_questions || []).slice(0, 3);
  } catch {
    // Fallback: use raw synthesis text
    synthesisText = result.synthesis.content.substring(0, 500);
  }
  
  // Debate summary (compact)
  let debateCompact = '';
  if (result.debate) {
    const d = result.debate;
    const convergedIcon = d.converged ? '✅' : '❌';
    const convScore = (d.convergenceScore * 100).toFixed(0);
    
    // Count all verdicts across rounds
    const allVerdicts: Record<string, number> = {};
    for (const round of d.rounds) {
      const r = round as any;
      for (const c of (r.critiques || [])) {
        allVerdicts[c.verdict] = (allVerdicts[c.verdict] || 0) + 1;
      }
    }
    const verdictStr = Object.entries(allVerdicts)
      .map(([v, n]) => {
        const icon = v === 'CONFIRM' ? '✅' : v === 'REFINE' ? '🔧' : v === 'CONTEST' ? '⚔️' : '❓';
        return `${icon}${v}: ${n}`;
      }).join(' · ');
    
    debateCompact = `\n### 🗣️ Дебаты\n${d.totalRounds} раунд(ов) · ${convergedIcon} сходимость ${convScore}% · ${verdictStr}\n`;
  }
  
  // Metrics (one line)
  const cost = `$${result.metrics.totalCost.toFixed(2)}`;
  const time = `${(result.metrics.totalLatencyMs / 1000).toFixed(0)}s`;
  const agents = result.team.length;
  
  // Build compact output (Russian UI, English data)
  let output = `# 🧬 Hive — анализ завершён\n\n`;
  output += `**${agents} экспертов** · ${cost} · ${time}\n`;
  output += `${teamShort}\n`;
  
  // Synthesis (truncated)
  if (synthesisText) {
    output += `\n### Итог\n${synthesisText.substring(0, 600)}${synthesisText.length > 600 ? '...' : ''}\n`;
  }
  
  // Consensus
  if (consensusPoints.length > 0) {
    output += `\n### Консенсус (${consensusPoints.length})\n`;
    output += consensusPoints.map(p => `- ${p.substring(0, 150)}${p.length > 150 ? '...' : ''}`).join('\n');
    output += '\n';
  }
  
  // Disagreements
  if (disagreements.length > 0) {
    output += `\n### Разногласия\n`;
    output += disagreements.map(d => `- ${d.substring(0, 150)}${d.length > 150 ? '...' : ''}`).join('\n');
    output += '\n';
  }
  
  // Debate
  output += debateCompact;
  
  // Open questions
  if (openQuestions.length > 0) {
    output += `\n### Открытые вопросы\n`;
    output += openQuestions.map(q => `- ${q.substring(0, 120)}${q.length > 120 ? '...' : ''}`).join('\n');
    output += '\n';
  }
  
  // File reference
  if (savedPath) {
    const relativePath = savedPath.includes('/docs/hive/') 
      ? 'docs/hive/' + savedPath.split('/docs/hive/')[1]
      : savedPath;
    output += `\n---\n📄 Полный отчёт: \`${relativePath}\`\n`;
    output += `💡 \`mcp_m7_hive_history load\` — загрузить отчёт в чат\n`;
  }
  
  return output;
}

/**
 * Format debate details for output (v7.0)
 * Shows full critique content: who critiqued whom, verdicts, reasoning, and how proposals changed.
 */
function formatDebateSummary(debate: NonNullable<DynamicHiveResult['debate']>): string {
  const convergedIcon = debate.converged ? '✅' : '❌';
  const convScore = (debate.convergenceScore * 100).toFixed(0);
  
  let output = `---

## 🗣️ Debate (${debate.totalRounds} round${debate.totalRounds > 1 ? 's' : ''})

**Converged**: ${convergedIcon} (${convScore}%) | **Stopped**: ${debate.stoppedReason} | **Cost**: $${debate.totalCost.toFixed(4)} | **Latency**: ${(debate.totalLatencyMs / 1000).toFixed(1)}s
`;

  for (const round of debate.rounds) {
    const r = round as any;
    const critiques = r.critiques || [];
    const convPct = (r.convergenceScore * 100).toFixed(0);
    
    output += `\n### Round ${r.roundNumber} — convergence ${convPct}% (${r.convergenceDirection})\n\n`;
    
    // Critiques table
    if (critiques.length > 0) {
      output += `#### Critiques\n\n`;
      output += `| Critic | → Target | Verdict | Reasoning |\n`;
      output += `|--------|----------|---------|----------|\n`;
      
      for (const c of critiques) {
        const criticName = c.criticAgent?.role || 'Unknown';
        const targetName = c.targetAgent?.role || 'Unknown';
        const verdict = c.verdict || '?';
        // Truncate reasoning for table readability
        const reasoning = (c.reasoning || '').substring(0, 200).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const suggestion = c.suggestedChanges 
          ? ` _Suggestion: ${c.suggestedChanges.substring(0, 100).replace(/\|/g, '\\|').replace(/\n/g, ' ')}_` 
          : '';
        
        const verdictIcon = verdict === 'CONFIRM' ? '✅' : verdict === 'REFINE' ? '🔧' : verdict === 'CONTEST' ? '⚔️' : '❓';
        
        output += `| ${criticName} | ${targetName} | ${verdictIcon} ${verdict} | ${reasoning}${suggestion} |\n`;
      }
      output += `\n`;
    }
    
    // Show what changed in proposals
    const refined = r.refinedProposals || [];
    if (refined.length > 0) {
      output += `#### Refined Positions\n\n`;
      for (const p of refined) {
        const agent = p.agent;
        const conf = typeof p.confidence === 'number' ? (p.confidence * 100).toFixed(0) : '?';
        const proposalPreview = (p.proposal || '').substring(0, 300);
        output += `**${agent?.role || 'Agent'}** (confidence: ${conf}%)\n`;
        output += `${proposalPreview}${proposalPreview.length >= 300 ? '...' : ''}\n\n`;
      }
    }
  }

  return output;
}

/**
 * Format response for DYNAMIC mode (v3.7.0+)
 */
function formatDynamicHiveResponse(result: DynamicHiveResult): string {
  const teamList = result.team.map(agent => 
    `- **${agent.role}** (${agent.domain}): ${agent.expertise}`
  ).join('\n');
  
  const proposalsList = result.proposals.map(p => `
### ${p.agent.role}
**Model**: ${p.model} (${p.provider})
**Confidence**: ${(p.confidence * 100).toFixed(1)}%
**Focus**: ${p.agent.focus}

${p.proposal}

**Reasoning**: ${p.reasoning}
${p.implementationSteps.length > 0 ? `\n**Steps**: ${p.implementationSteps.join(', ')}` : ''}
${p.risks.length > 0 ? `\n**Risks**: ${p.risks.join(', ')}` : ''}
`).join('\n---\n');
  
  return `# 🧬 M7 Hive v2.0 - Dynamic Intelligence

## 🎯 Task Complete

**Task ID**: ${result.taskId}
**Success**: ${result.success ? '✅' : '❌'}
**Mode**: DYNAMIC (AI-generated team)

---

## 👥 Expert Team Created

${teamList}

---

## 🏆 Synthesized Solution

**Confidence**: ${(result.synthesis.confidence * 100).toFixed(1)}%
**Contributing Experts**: ${result.synthesis.contributingAgents.length}

${result.synthesis.content}

---

## 📊 Expert Proposals

${proposalsList}

---

## 📈 Performance Metrics

| Metric | Value |
|--------|-------|
| Total Tokens | ${result.metrics.totalTokens.toLocaleString()} |
| Total Cost | $${result.metrics.totalCost.toFixed(4)} |
| Total Latency | ${result.metrics.totalLatencyMs.toLocaleString()}ms |
| Architect Time | ${result.metrics.architectLatencyMs.toLocaleString()}ms |
| Synthesis Time | ${result.metrics.synthesisLatencyMs.toLocaleString()}ms |
${result.metrics.debateRounds ? `| Debate Rounds | ${result.metrics.debateRounds} |
| Debate Cost | $${(result.metrics.debateCost ?? 0).toFixed(4)} |
| Debate Latency | ${(result.metrics.debateLatencyMs ?? 0).toLocaleString()}ms |` : ''}

${result.debate ? formatDebateSummary(result.debate) : ''}

---

## 💡 Recommendations

${result.recommendations.map(r => `- ${r}`).join('\n')}

---

*M7 Hive v2.0 - Dynamic Intelligence with Self-Learning* 🧠`;
}

/**
 * Format response for PLANNED mode (v3.8.0+)
 */
function formatPlannerResponse(result: PlannerResult): string {
  const tasksList = result.tasks
    .filter(t => t.type !== 'goal')
    .map(t => `- **${t.description.substring(0, 60)}${t.description.length > 60 ? '...' : ''}** [${t.state}]`)
    .join('\n');
  
  const awardsList = result.awards.map(a => 
    `- Task ${a.taskId.substring(0, 20)}... → **${a.winnerRole}** (score: ${a.scoreBreakdown.total.toFixed(2)})`
  ).join('\n');
  
  const validationSummary = result.validations.length > 0
    ? result.validations.map(v => 
        `- ${v.gatekeeper}: ${v.passed ? '✅ PASSED' : '❌ FAILED'} (${v.issues.length} issues)`
      ).join('\n')
    : '- No validations performed';
  
  const successRate = result.results.length > 0
    ? (result.results.filter(r => r.success).length / result.results.length * 100).toFixed(0)
    : '0';
  
  return `# 📋 M7 Hive v3.0 - Planner/Supervisor

## 🎯 Goal Complete

**Goal ID**: ${result.goalId}
**Success**: ${result.success ? '✅' : '❌'}
**Mode**: PLANNED (CNP Auction-based)

---

## 📝 Task Decomposition

**Total Tasks**: ${result.tasks.length}
**Executed**: ${result.results.length}
**Success Rate**: ${successRate}%

${tasksList}

---

## 🏆 Auction Awards

${awardsList || '- No auctions performed'}

---

## 🛡️ Gatekeeper Validations

${validationSummary}

---

## 📊 Synthesized Result

**Confidence**: ${(result.synthesis.confidence * 100).toFixed(1)}%
**Contributing Tasks**: ${result.synthesis.contributingTasks.length}

${result.synthesis.content.substring(0, 2000)}${result.synthesis.content.length > 2000 ? '\n\n[...truncated]' : ''}

---

## 📈 Performance Metrics

| Metric | Value |
|--------|-------|
| Total Tokens | ${result.metrics.totalTokens.toLocaleString()} |
| Total Cost | $${result.metrics.totalCost.toFixed(4)} |
| Total Latency | ${result.metrics.totalLatencyMs.toLocaleString()}ms |
| Planning | ${result.metrics.planningLatencyMs.toLocaleString()}ms |
| Auctions | ${result.metrics.auctionLatencyMs.toLocaleString()}ms |
| Execution | ${result.metrics.executionLatencyMs.toLocaleString()}ms |
| Validation | ${result.metrics.validationLatencyMs.toLocaleString()}ms |

---

*M7 Hive v3.0 - Planner/Supervisor with CNP Auctions* 📋`;
}

/**
 * Format response for FIXED mode (legacy)
 */
function formatHiveResponse(result: any): string {
  return `# 🤖 M7 Hive Coordination Complete (Fixed Mode)

## 🎯 Task Results

**Task ID**: ${result.task_id}
**Success**: ${result.success ? '✅' : '❌'}
**Execution Time**: ${result.execution_time}ms
**Total Cost**: $${result.total_cost.toFixed(4)}
**Agents Used**: ${result.agents_used.join(', ')}
${result.fallback_used ? '**Fallback Used**: ⚠️ Yes' : ''}

## 🐛 **DEBUG INFO**
- **MCP Handler Called**: ✅ YES (you see this message)
- **Orchestrator Initialized**: ✅ YES  
- **Agent Selection**: ${result.agents_used.join(', ')}
- **Fallback Status**: ${result.fallback_used || 'unknown'}
- **Expected Agents**: ${JSON.stringify((result as any).original_agents || 'unknown')}
- **Result Object Keys**: ${Object.keys(result).join(', ')}

---

## 🏆 Selected Solution

**From Agent**: ${result.selected_solution.agentId}
**Confidence**: ${(result.selected_solution.confidence * 100).toFixed(1)}%

### 📋 Proposal:
${formatProposal(result.selected_solution.proposal)}

### 💭 Reasoning:
${formatReasoning(result.selected_solution.reasoning)}

${formatImplementationSteps(result.selected_solution)}

${formatRequirements(result.selected_solution)}

${result.selected_solution.risks?.length > 0 ? `
### ⚠️ Identified Risks:
${result.selected_solution.risks.map((risk: string) => `- ${risk}`).join('\n')}
` : ''}

---

## 📊 All Agent Proposals

${result.all_proposals.map((proposal: any) => `
### ${proposal.agentId.toUpperCase()} Agent (${(proposal.confidence * 100).toFixed(1)}% confidence)
**Proposal**: ${proposal.proposal}
**Reasoning**: ${proposal.reasoning}
`).join('\n')}

---

## 💡 Recommendations

${result.recommendations?.map((rec: string) => `- ${rec}`).join('\n') || 'No specific recommendations'}

---

## 📈 Performance Metrics

- **Multiagent Coordination**: ${result.success ? 'Success' : 'Failed'}
- **Agent Consensus**: ${result.all_proposals.length > 1 ? 'Multiple perspectives' : 'Single agent'}
- **Cost Efficiency**: $${result.total_cost.toFixed(4)} per solution

---
*M7 Hive v1.0 - Collective Intelligence for Development* 🧠`;
}
