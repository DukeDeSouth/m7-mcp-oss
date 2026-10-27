import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';

export class SecurityAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    return `${this.buildBasePrompt(task, context)}

As a Security Agent, focus on:
1. Identifying potential security vulnerabilities and threats
2. Recommending security best practices and defensive patterns
3. Analyzing access controls, authentication, and authorization
4. Evaluating data protection, privacy, and compliance requirements  
5. Providing security audit guidelines and risk mitigation strategies

Provide comprehensive security analysis with actionable recommendations.`;
  }
}

