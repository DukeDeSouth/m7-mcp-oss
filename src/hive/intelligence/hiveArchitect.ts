/**
 * M7 Hive v2.0 - Hive Architect
 * 
 * Uses Claude Opus 4.5 to dynamically generate optimal team of experts
 * for any given task. No fixed agent types - fully dynamic.
 * 
 * @version 3.7.0
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { DynamicAgent, ArchitectResponse, AgentDomain } from './types.js';
import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[HiveArchitect]');
import { getAnthropic, getClientPool } from '../api/clientPool.js';
// v5.1: Use robust JSON parser for LLM responses
import { robustParse } from '../utils/json/index.js';

// Architect uses Claude Opus 4.6 — Opus 4.7 not yet available via API for all tiers
const ARCHITECT_MODEL = 'claude-opus-4-6';
const MIN_AGENTS = 2;

/**
 * Hive Architect - Creates optimal team of experts for any task
 * 
 * Uses ClientPool for connection reuse.
 */
export class HiveArchitect {
  private client: Anthropic;
  
  constructor(anthropicKey?: string) {
    // Use ClientPool if initialized, otherwise create direct client
    if (getClientPool().isInitialized() && getClientPool().hasAnthropic()) {
      this.client = getAnthropic('architect');
      log.debug(`[Hive Architect] 🔄 Using pooled Anthropic client`);
    } else if (anthropicKey) {
      this.client = new Anthropic({
        apiKey: anthropicKey,
        maxRetries: 3,
        timeout: 120000
      });
      log.debug(`[Hive Architect] 🔑 Created direct Anthropic client`);
    } else {
      throw new Error('Anthropic API key required when ClientPool not initialized');
    }
  }
  
  /**
   * Create teams for multiple tasks in a single API call (batch mode)
   * 
   * @param tasks - Array of task descriptions
   * @returns Map of task description to team configuration
   */
  async createTeamBatch(tasks: string[]): Promise<Map<string, ArchitectResponse>> {
    const startTime = Date.now();
    const results = new Map<string, ArchitectResponse>();
    
    if (tasks.length === 0) return results;
    
    // For single task, use regular method
    if (tasks.length === 1) {
      const team = await this.createTeam(tasks[0]);
      results.set(tasks[0], team);
      return results;
    }
    
    log.info(`[Hive Architect] 🏗️ Batch creating teams for ${tasks.length} tasks`);
    
    try {
      const prompt = this.buildBatchPrompt(tasks);
      
      const response = await this.client.messages.create({
        model: ARCHITECT_MODEL,
        max_tokens: 4000, // More tokens for batch
        temperature: 0.3,
        system: this.getBatchSystemPrompt(),
        messages: [
          { role: 'user', content: prompt }
        ]
      });
      
      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = this.parseBatchResponse(content, tasks);
      
      for (const [taskDesc, team] of parsed) {
        // Ensure minimum agents
        if (team.agents.length < MIN_AGENTS) {
          team.agents = this.ensureMinimumAgents(team.agents, taskDesc);
        }
        results.set(taskDesc, team);
      }
      
      const latency = Date.now() - startTime;
      log.debug(`[Hive Architect] ✅ Batch created ${results.size} teams in ${latency}ms`);
      
      return results;
      
    } catch (error: any) {
      log.debug(`[Hive Architect] ❌ Batch failed: ${error.message}, falling back to individual calls`);
      
      // Fallback: create teams individually
      for (const task of tasks) {
        try {
          const team = await this.createTeam(task);
          results.set(task, team);
        } catch (e) {
          results.set(task, this.createFallbackTeam(task));
        }
      }
      
      return results;
    }
  }
  
  private getBatchSystemPrompt(): string {
    return `You are the Hive Architect - a meta-intelligence that designs optimal expert teams.

You will receive MULTIPLE tasks and must create a team for EACH task.

## Output Format

Respond with valid JSON array:
[
  {
    "task_index": 0,
    "agents": [
      {
        "role": "Specific Role Name",
        "expertise": "Area of knowledge",
        "focus": "Focus for THIS task",
        "perspective": "Unique angle",
        "domain": "coding|reasoning|security|architecture|data|language|math|general"
      }
    ],
    "reasoning": "Why this team",
    "complexity": "simple|medium|complex|expert",
    "executionMode": "parallel|sequential|debate"
  },
  // ... more teams for each task
]

## Rules
- Create MINIMUM 2 experts per task
- Use SPECIFIC role names (not generic)
- Match domain to task requirements
- Each task gets its own team - do NOT reuse agents across tasks`;
  }
  
  private buildBatchPrompt(tasks: string[]): string {
    let prompt = `## Tasks to Analyze\n\n`;
    
    tasks.forEach((task, index) => {
      prompt += `### Task ${index}\n${task}\n\n`;
    });
    
    prompt += `## Instructions\n\nCreate an optimal team of experts for EACH task above.\nReturn a JSON array with one team configuration per task.\nUse task_index to match teams to tasks.`;
    
    return prompt;
  }
  
  private parseBatchResponse(content: string, tasks: string[]): Map<string, ArchitectResponse> {
    const results = new Map<string, ArchitectResponse>();
    
    try {
      // v5.1: Use robust JSON parser for batch response (array)
      const result = robustParse(content);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'No JSON array found in batch response');
      }
      
      const parsed = result.data;
      
      if (!Array.isArray(parsed)) {
        throw new Error('Expected JSON array');
      }
      
      for (const teamConfig of parsed) {
        const taskIndex = teamConfig.task_index;
        if (taskIndex === undefined || taskIndex >= tasks.length) continue;
        
        const taskDesc = tasks[taskIndex];
        
        const agents: DynamicAgent[] = (teamConfig.agents || []).map((a: any, idx: number) => ({
          id: randomUUID(),
          role: a.role || `Expert ${idx + 1}`,
          expertise: a.expertise || 'General',
          focus: a.focus || 'Task analysis',
          perspective: a.perspective || 'Professional perspective',
          domain: this.validateDomain(a.domain),
          secondaryDomains: []
        }));
        
        results.set(taskDesc, {
          agents,
          reasoning: teamConfig.reasoning || 'Team created',
          complexity: this.validateComplexity(teamConfig.complexity),
          executionMode: this.validateExecutionMode(teamConfig.executionMode)
        });
      }
      
      // Fill missing tasks with fallback teams
      for (let i = 0; i < tasks.length; i++) {
        if (!results.has(tasks[i])) {
          results.set(tasks[i], this.createFallbackTeam(tasks[i]));
        }
      }
      
      return results;
      
    } catch (error: any) {
      log.warn(`[Hive Architect] Failed to parse batch response: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create a team of dynamic agents for the given task
   */
  async createTeam(task: string, context?: Record<string, any>): Promise<ArchitectResponse> {
    const startTime = Date.now();
    log.info(`[Hive Architect] 🏗️ Creating team for task: ${task.substring(0, 100)}...`);
    
    try {
      const prompt = this.buildArchitectPrompt(task, context);
      
      const response = await this.client.messages.create({
        model: ARCHITECT_MODEL,
        max_tokens: 4096,
        temperature: 0.3,  // Slightly creative but consistent
        system: this.getSystemPrompt(),
        messages: [
          { role: 'user', content: prompt }
        ]
      });
      
      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = this.parseResponse(content);
      
      // Ensure minimum agents
      if (parsed.agents.length < MIN_AGENTS) {
        log.warn(`[Hive Architect] Only ${parsed.agents.length} agents created, adding defaults`);
        parsed.agents = this.ensureMinimumAgents(parsed.agents, task);
      }
      
      const latency = Date.now() - startTime;
      log.info(`[Hive Architect] ✅ Created team of ${parsed.agents.length} experts in ${latency}ms`);
      log.info(`[Hive Architect] 👥 Team: ${parsed.agents.map(a => a.role).join(', ')}`);
      
      return parsed;
      
    } catch (error: any) {
      // Use console.error for visibility in MCP logs
      log.debug(`[Hive Architect] ❌ Failed to create team: ${error.message}`);
      log.debug(`[Hive Architect] ❌ Error type: ${error.constructor.name}`);
      if (error.status) {
        log.debug(`[Hive Architect] ❌ HTTP Status: ${error.status}`);
      }
      if (error.error) {
        log.debug(`[Hive Architect] ❌ API Error:`, error.error);
      }
      
      // Fallback to default team
      return this.createFallbackTeam(task);
    }
  }
  
  private getSystemPrompt(): string {
    return `You are the Hive Architect - a meta-intelligence that designs expert teams for complex tasks.

Your role is to analyze a task and create a team of specialists who together can analyze it thoroughly and honestly.

## Your Expertise

You understand:
- Which types of experts are needed for different problem domains
- How to compose teams that complement each other
- What perspectives are needed for a calibrated, honest assessment
- How to avoid redundancy while ensuring coverage

## Team Composition Rules

1. **MINIMUM 2 experts** - Every task needs at least 2 perspectives
2. **NO MAXIMUM** - Create as many experts as the task genuinely requires
3. **COMPLEMENTARY PERSPECTIVES** - Each expert must cover a different aspect of the problem
4. **TASK-APPROPRIATE** - Match experts to the actual task, not generic categories
5. **SPECIFIC ROLES** - "API Security Expert" not "Security Agent"
6. **CALIBRATION** - Experts should be chosen to cover potential blind spots, not to force disagreement

## Domain Classification

Each expert must have a primary domain for model selection:
- reasoning: Complex analysis, logic, strategy
- coding: Code generation, debugging, implementation
- math: Calculations, algorithms, optimization
- data: Data analysis, statistics, ML
- language: Writing, documentation, communication
- security: Security analysis, vulnerabilities, compliance
- architecture: System design, patterns, structure
- general: Multi-purpose tasks

## Output Format

Respond with valid JSON only:
{
  "agents": [
    {
      "role": "Specific Role Name",
      "expertise": "Area of deep knowledge",
      "focus": "What to focus on for THIS task",
      "perspective": "What aspect of the problem this expert covers",
      "domain": "primary_domain"
    }
  ],
  "reasoning": "Why this team composition covers the problem well",
  "complexity": "simple|medium|complex|expert",
  "executionMode": "parallel|sequential|debate"
}`;
  }
  
  private buildArchitectPrompt(task: string, context?: Record<string, any>): string {
    let prompt = `## Task to Analyze

${task}

## Instructions

Create an optimal team of experts to solve this task comprehensively.

Consider:
1. What domains of expertise are required?
2. What unique perspectives would improve the solution?
3. Are there any specialized skills needed?
4. Would debate/critique improve the outcome?

Create experts with SPECIFIC roles relevant to THIS task.
Do NOT use generic names like "Research Agent" or "Implementation Agent".

Examples of good role names:
- "React Performance Optimizer" (not "Performance Agent")
- "PostgreSQL Security Auditor" (not "Security Agent")  
- "E-commerce UX Specialist" (not "UX Agent")
- "Финтех API Архитектор" (not "Architecture Agent")

Use the language of the task for role names when appropriate.`;

    if (context) {
      prompt += `\n\n## Additional Context\n${JSON.stringify(context, null, 2)}`;
    }
    
    return prompt;
  }
  
  private parseResponse(content: string): ArchitectResponse {
    // v5.1: Use robust JSON parser with extraction, repair, and recovery
    const result = robustParse(content);
    
    if (!result.success || !result.data) {
      log.warn(`[Hive Architect] Failed to parse response: ${result.error}`);
      throw new Error(result.error || 'JSON parse failed');
    }
    
    const parsed = result.data as any;
    
    // Validate and transform agents
    const agents: DynamicAgent[] = (parsed.agents || []).map((a: any, index: number) => ({
      id: randomUUID(),
      role: a.role || `Expert ${index + 1}`,
      expertise: a.expertise || 'General',
      focus: a.focus || 'Task analysis',
      perspective: a.perspective || 'Professional perspective',
      domain: this.validateDomain(a.domain),
      secondaryDomains: a.secondaryDomains?.map((d: string) => this.validateDomain(d)) || []
    }));
    
    return {
      agents,
      reasoning: parsed.reasoning || 'Team created for task',
      complexity: this.validateComplexity(parsed.complexity),
      executionMode: this.validateExecutionMode(parsed.executionMode)
    };
  }
  
  private validateDomain(domain: string): AgentDomain {
    const validDomains: AgentDomain[] = [
      'reasoning', 'coding', 'math', 'data', 
      'language', 'security', 'architecture', 'general'
    ];
    
    const normalized = (domain || 'general').toLowerCase() as AgentDomain;
    return validDomains.includes(normalized) ? normalized : 'general';
  }
  
  private validateComplexity(complexity: string): ArchitectResponse['complexity'] {
    const valid = ['simple', 'medium', 'complex', 'expert'];
    return valid.includes(complexity) ? complexity as any : 'medium';
  }
  
  private validateExecutionMode(mode: string): ArchitectResponse['executionMode'] {
    const valid = ['parallel', 'sequential', 'debate'];
    return valid.includes(mode) ? mode as any : 'parallel';
  }
  
  private ensureMinimumAgents(agents: DynamicAgent[], task: string): DynamicAgent[] {
    if (agents.length >= MIN_AGENTS) return agents;
    
    // Add default analysts
    const defaults: DynamicAgent[] = [
      {
        id: randomUUID(),
        role: 'Task Analyst',
        expertise: 'Problem decomposition and analysis',
        focus: 'Understanding requirements and constraints',
        perspective: 'Analytical perspective',
        domain: 'reasoning'
      },
      {
        id: randomUUID(),
        role: 'Solution Implementer',
        expertise: 'Practical implementation',
        focus: 'Converting analysis to actionable steps',
        perspective: 'Practical perspective',
        domain: 'coding'
      }
    ];
    
    while (agents.length < MIN_AGENTS) {
      agents.push(defaults[agents.length]);
    }
    
    return agents;
  }
  
  private createFallbackTeam(task: string): ArchitectResponse {
    log.warn('[Hive Architect] Using fallback team');
    
    // Detect task type for better defaults
    const taskLower = task.toLowerCase();
    const agents: DynamicAgent[] = [];
    
    // Always add analyst
    agents.push({
      id: randomUUID(),
      role: 'Strategic Analyst',
      expertise: 'Problem analysis and strategy',
      focus: 'Analyzing the core problem',
      perspective: 'Strategic overview',
      domain: 'reasoning'
    });
    
    // Add domain-specific expert
    if (taskLower.includes('code') || taskLower.includes('implement') || 
        taskLower.includes('develop') || taskLower.includes('build')) {
      agents.push({
        id: randomUUID(),
        role: 'Software Engineer',
        expertise: 'Software development and architecture',
        focus: 'Implementation approach',
        perspective: 'Engineering best practices',
        domain: 'coding'
      });
    } else if (taskLower.includes('security') || taskLower.includes('vulnerab')) {
      agents.push({
        id: randomUUID(),
        role: 'Security Specialist',
        expertise: 'Security analysis and compliance',
        focus: 'Security implications',
        perspective: 'Security-first approach',
        domain: 'security'
      });
    } else if (taskLower.includes('design') || taskLower.includes('architect')) {
      agents.push({
        id: randomUUID(),
        role: 'System Architect',
        expertise: 'System design and architecture',
        focus: 'Architectural decisions',
        perspective: 'Scalability and maintainability',
        domain: 'architecture'
      });
    } else {
      agents.push({
        id: randomUUID(),
        role: 'Domain Expert',
        expertise: 'Domain knowledge',
        focus: 'Domain-specific considerations',
        perspective: 'Expert perspective',
        domain: 'general'
      });
    }
    
    return {
      agents,
      reasoning: 'Fallback team created due to Architect failure',
      complexity: 'medium',
      executionMode: 'parallel'
    };
  }
}

/**
 * Create Hive Architect instance
 */
export function createHiveArchitect(anthropicKey: string): HiveArchitect {
  return new HiveArchitect(anthropicKey);
}
