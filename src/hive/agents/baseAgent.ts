import { AgentType, AgentConfig, AgentProposal, AgentContext } from '../types/agent.js';
import { APIManager } from '../api/apiManager.js';

export abstract class BaseAgent {
  protected agentType: AgentType;
  protected apiManager: APIManager;
  
  constructor(agentType: AgentType, apiManager: APIManager) {
    this.agentType = agentType;
    this.apiManager = apiManager;
  }
  
  async analyzeTask(task: string, context: AgentContext): Promise<AgentProposal> {
    const prompt = this.buildTaskPrompt(task, context);
    const response = await this.apiManager.callAgent(this.agentType, prompt, context);
    
    if (!response.success) {
      throw new Error(`${this.agentType} agent failed: ${response.error}`);
    }
    
    return response.proposal!;
  }
  
  protected abstract buildTaskPrompt(task: string, context: AgentContext): string;
  
  protected buildBasePrompt(task: string, context: AgentContext): string {
    return `Analyze this task as a ${this.agentType} agent:

Task: ${task}

${context.project_context ? `Project Context: ${JSON.stringify(context.project_context, null, 2)}` : ''}
${context.existing_code ? `Existing Code:\n${context.existing_code}` : ''}
${context.constraints ? `Constraints: ${context.constraints.join(', ')}` : ''}
${context.preferences ? `Preferences: ${context.preferences.join(', ')}` : ''}

Provide your analysis focusing on your area of expertise.
For each conclusion, state your confidence level and the key assumption behind it.
If you are uncertain about something, say so explicitly — calibrated honesty is more valuable than false certainty.`;
  }
}
