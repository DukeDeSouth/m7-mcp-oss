import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';

export class ImplementationAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    return `${this.buildBasePrompt(task, context)}

As an Implementation Agent, focus on:
1. Creating concrete implementation plans
2. Writing or planning production-ready code
3. Optimizing for performance and maintainability
4. Identifying technical dependencies and requirements
5. Estimating implementation time and complexity

Provide detailed implementation steps with code examples where possible.`;
  }
}
