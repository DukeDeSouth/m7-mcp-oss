import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';

export class ArchitectureAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    return `${this.buildBasePrompt(task, context)}

As an Architecture Agent, focus on:
1. Designing scalable system architecture and patterns
2. Identifying architectural trade-offs and technical decisions  
3. Planning modular, maintainable, and extensible structures
4. Evaluating integration points and data flows
5. Documenting architectural decisions and rationale

Provide detailed architectural analysis with system design recommendations.`;
  }
}

