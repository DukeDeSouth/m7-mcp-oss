import { BaseAgent } from './baseAgent.js';
import { AgentContext } from '../types/agent.js';
import { 
  analyzeTaskForRisks, 
  generateSafetyReport, 
  generateContext7Instructions,
  checkDataFreshness,
  TECH_SAFETY_RULES 
} from '../config/techSafetyRules.js';

/**
 * TechSafety Agent - проверяет безопасность технологий для AI
 * Выявляет проблемные технологии и предлагает альтернативы
 */
export class TechSafetyAgent extends BaseAgent {
  protected buildTaskPrompt(task: string, context: AgentContext): string {
    // Анализируем задачу на наличие проблемных технологий
    const analysis = analyzeTaskForRisks(task);
    const safetyReport = generateSafetyReport(analysis.detectedTechnologies);
    const context7Instructions = generateContext7Instructions(analysis.detectedTechnologies);
    const freshnessCheck = checkDataFreshness();
    
    // Формируем список технологий для проверки через Context7
    const techsToCheck = analysis.detectedTechnologies
      .map(tech => tech.technology)
      .join(', ');
    
    let prompt = `${this.buildBasePrompt(task, context)}

As a Tech Safety Agent, your role is to ensure AI-compatible technology choices.

## 🚨 DATA FRESHNESS WARNING:
${freshnessCheck.message}
Your knowledge cutoff: April 2024
Current date: ${new Date().toLocaleDateString()}
Months outdated: ${freshnessCheck.monthsOld}

${freshnessCheck.isCritical ? '🔴 CRITICAL: Context7 verification is MANDATORY!' : '🟡 Context7 verification strongly recommended'}

## 🔍 Technology Risk Analysis (OUTDATED - VERIFY WITH CONTEXT7):
${safetyReport}

## 📊 Overall Risk Assessment: ${analysis.overallRisk.toUpperCase()}

${context7Instructions}

## 🎯 Your Focus Areas:
1. Identify technologies that commonly cause AI hallucinations
2. Suggest safer alternatives when high-risk tech is detected  
3. Provide clear migration paths from risky to safe technologies
4. Balance safety with project requirements
5. Educate about AI limitations with specific technologies

## 💡 Recommendations:
${analysis.recommendations.join('\n')}

## 🔄 Required Context7 Verification:
Before providing recommendations, you MUST:
1. Check @context7 for each detected technology
2. Compare your knowledge with current documentation
3. Update risk assessments based on latest versions
4. Verify if suggested alternatives are still relevant

## 📋 Your Analysis Should Include:

### 1. Technology Assessment (with version checking):
- List all technologies mentioned in the task
- Rate each technology's AI-safety (high/medium/low risk)
- Explain specific risks for each problematic technology

### 2. Alternative Solutions:
- For each high-risk technology, provide 2-3 alternatives
- Explain when to use each alternative
- Include migration complexity assessment

### 3. Best Practices:
- Provide specific guidelines for using detected technologies safely
- Include code patterns to avoid
- Suggest documentation and resources

### 4. Implementation Strategy:
- If risky tech must be used, provide risk mitigation strategies
- Suggest incremental approach to reduce complexity
- Recommend testing and validation approaches

### 5. Decision Matrix:
Create a simple decision matrix:
- Technology | Risk Level | Alternative | Migration Effort | Recommendation

Remember: 
1. Your training data is from April 2024 - ALWAYS verify with @context7
2. Technologies evolve - what was risky might be fixed now
3. New versions might have better AI compatibility
4. Your goal is not to block technologies, but ensure AI success
5. Sometimes older, stable versions are safer than bleeding edge

CRITICAL: If you cannot access Context7, clearly state that recommendations 
are based on potentially outdated information and should be verified.

Provide balanced, practical advice that considers both technical excellence 
and AI implementation success rates.`;
    
    // Phase 2: Add TSI patterns if available
    if (context.tsi_patterns && context.tsi_patterns.length > 0) {
      prompt += `\n\n## 🛡️ TSI Safety Patterns (M7 Knowledge Base):\n\n`;
      prompt += `M7 has loaded ${context.tsi_patterns.length} verified patterns for this task:\n\n`;
      
      // Group patterns by type
      const patterns = context.tsi_patterns.filter(p => p.type === 'pattern');
      const antipatterns = context.tsi_patterns.filter(p => p.type === 'antipattern');
      
      if (patterns.length > 0) {
        prompt += `### ✅ Recommended Patterns (${patterns.length}):\n`;
        patterns.slice(0, 5).forEach((pattern, i) => {
          prompt += `${i + 1}. **${pattern.name}** (${pattern.technology})\n`;
          prompt += `   - Category: ${pattern.category}\n`;
          prompt += `   - Confidence: ${(pattern.confidence * 100).toFixed(0)}%\n`;
          prompt += `   - Risk Score: ${pattern.riskScore}/100\n`;
          prompt += `   - Description: ${pattern.description}\n\n`;
        });
      }
      
      if (antipatterns.length > 0) {
        prompt += `### ❌ Antipatterns to Avoid (${antipatterns.length}):\n`;
        antipatterns.slice(0, 5).forEach((pattern, i) => {
          prompt += `${i + 1}. **${pattern.name}** (${pattern.technology})\n`;
          prompt += `   - Category: ${pattern.category}\n`;
          prompt += `   - Risk Score: ${pattern.riskScore}/100 ⚠️\n`;
          prompt += `   - Why Avoid: ${pattern.description}\n\n`;
        });
      }
      
      prompt += `\n**TSI Integration Instructions:**\n`;
      prompt += `- Reference these patterns in your analysis\n`;
      prompt += `- Flag any violations of recommended patterns\n`;
      prompt += `- Warn if antipatterns are detected in the task\n`;
      prompt += `- Use pattern confidence scores to prioritize recommendations\n`;
      prompt += `- Combine TSI patterns with Context7 documentation for comprehensive analysis\n`;
    }
    
    return prompt;
  }
}
