import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';

export class TestingAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    return `${this.buildBasePrompt(task, context)}

As a Testing Agent, focus on:
1. Creating comprehensive test strategies and test plans
2. Identifying edge cases, boundary conditions, and error scenarios
3. Designing unit, integration, and end-to-end test suites
4. Evaluating test coverage, quality metrics, and testing tools
5. Recommending automated testing frameworks and CI/CD integration

Provide detailed testing analysis with practical test implementation guidance.`;
  }
}

