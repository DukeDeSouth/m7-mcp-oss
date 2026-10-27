import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';

export class PerformanceAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    return `${this.buildBasePrompt(task, context)}

As a Performance Agent, focus on:
1. Analyzing performance bottlenecks and optimization opportunities
2. Recommending efficient algorithms, data structures, and patterns
3. Evaluating resource usage, scalability, and capacity planning
4. Identifying caching strategies, database optimization, and CDN usage
5. Providing performance metrics, benchmarking, and monitoring guidance

Provide detailed performance analysis with measurable optimization recommendations.`;
  }
}

