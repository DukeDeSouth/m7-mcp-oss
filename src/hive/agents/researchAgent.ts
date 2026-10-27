import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';

export class ResearchAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    let prompt = `${this.buildBasePrompt(task, context)}

As a Research Agent, focus on:
1. Analyzing requirements thoroughly
2. Researching existing solutions and best practices
3. Identifying potential approaches and alternatives
4. Evaluating feasibility and complexity
5. Gathering relevant documentation and examples

Provide comprehensive research findings with detailed reasoning.`;

    // Phase 2: Context7 Integration
    if (context.context7_enabled) {
      prompt += `\n\n## 📚 Context7 Integration Enabled\n\n`;
      prompt += `You have access to Context7 MCP for live library documentation.\n\n`;
      
      // Extract library names
      const libraries = this.extractLibraries(task + (context.existing_code || ''));
      
      if (libraries.length > 0) {
        prompt += `### 🔍 Detected Libraries in Task:\n`;
        libraries.forEach(lib => {
          prompt += `- ${lib}\n`;
        });
        
        prompt += `\n### 📖 Context7 Query Instructions:\n`;
        prompt += `IMPORTANT: Before providing recommendations, you SHOULD:\n`;
        prompt += `1. Query @context7 for each detected library\n`;
        prompt += `2. Get latest documentation and best practices\n`;
        prompt += `3. Check for breaking changes in recent versions\n`;
        prompt += `4. Verify API changes and deprecations\n`;
        prompt += `5. Compare your training data with current docs\n\n`;
        
        prompt += `**Example Query:**\n`;
        prompt += `"@context7 resolve-library-id ${libraries[0]}"\n`;
        prompt += `Then: "@context7 get-library-docs /org/project best-practices"\n\n`;
      }
      
      // Add Context7 docs if provided
      if (context.context7_docs) {
        prompt += `\n## 📚 Context7 Documentation (Retrieved):\n\n`;
        prompt += context.context7_docs;
        prompt += `\n\n**Instructions:**\n`;
        prompt += `- Use this official documentation in your analysis\n`;
        prompt += `- Prioritize Context7 docs over your training data\n`;
        prompt += `- Reference specific sections when making recommendations\n`;
        prompt += `- Note any conflicts between your knowledge and official docs\n`;
      }
    }
    
    return prompt;
  }
  
  private extractLibraries(text: string): string[] {
    // Extract library/framework names
    const libPatterns = [
      /\b(react|vue|angular|svelte|solid|preact)\b/gi,
      /\b(next\.?js|nuxt|remix|gatsby|astro|vite)\b/gi,
      /\b(express|fastify|koa|hapi|nestjs)\b/gi,
      /\b(prisma|drizzle|typeorm|sequelize)\b/gi,
      /\b(tailwind|styled-components|emotion|chakra)\b/gi,
      /\b(redux|zustand|jotai|recoil|mobx)\b/gi,
      /\b(jest|vitest|playwright|cypress|testing-library)\b/gi,
      /\b(graphql|apollo|trpc|tanstack-query)\b/gi
    ];
    
    const matches = new Set<string>();
    
    for (const pattern of libPatterns) {
      const found = text.match(pattern);
      if (found) {
        found.forEach(lib => {
          const normalized = lib.toLowerCase().replace(/\./g, '');
          matches.add(normalized);
        });
      }
    }
    
    return Array.from(matches);
  }
}
