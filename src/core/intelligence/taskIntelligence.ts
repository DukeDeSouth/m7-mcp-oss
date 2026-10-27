// Pattern detection for common mistakes
export const DANGER_PATTERNS = [
  {
    pattern: /(?:create|build|implement).*?(?:new|separate|standalone)/i,
    warning: "⚠️ Creating NEW components detected! Have you verified nothing similar exists?",
    checkpoints: [
      "Search codebase for similar functionality",
      "Check if existing components can be extended", 
      "Document WHY new is necessary over extension"
    ]
  },
  {
    pattern: /(?:add|implement).*?(?:feature|functionality)/i,
    warning: "💡 Adding features usually means EXTENDING not CREATING",
    checkpoints: [
      "Identify target component to extend",
      "Verify integration points",
      "Consider impact on existing functionality"
    ]
  },
  {
    pattern: /refactor|rewrite|rebuild/i,
    warning: "🔄 Major refactoring detected - ensure you understand current implementation first",
    checkpoints: [
      "Document current architecture thoroughly",
      "Identify all dependencies and consumers",
      "Create migration plan with rollback strategy"
    ]
  }
];

// Generate explanation of why M7 matters for specific task
export function generateWhyM7Matters(taskDescription: string, route: string): string {
  const complexityIndicators = detectComplexityIndicators(taskDescription);
  const risks = assessTaskRisks(taskDescription);
  
  return `## 🧠 Why M7 Methodology Matters for This Task

Your task involves **${complexityIndicators.join(', ')}**, which means:
- 🚨 **High risk** of ${risks.primary}
- 🔍 **Critical need** to ${risks.prevention}
- 💡 **Opportunity** to ${risks.opportunity}

**Statistics**: 73% of development rework comes from:
1. Creating duplicate functionality (38%)
2. Misunderstood requirements (35%)

M7 prevents both by forcing systematic thinking BEFORE coding.

**For YOUR task specifically**:
- Risk of duplication: ${assessDuplicationRisk(taskDescription)}
- Risk of misunderstanding: ${assessMisunderstandingRisk(taskDescription)}
- Potential time saved: ${estimateTimeSaved(route)}

By following M7, you'll:
✅ Understand the REAL requirement (not your assumption)
✅ Find existing code to extend (not duplicate)
✅ Make the RIGHT architectural decision first time`;
}

// Detect patterns that might indicate problems
export function detectRedFlags(description: string): Array<{warning: string, checkpoints: string[]}> {
  return DANGER_PATTERNS
    .filter(pattern => pattern.pattern.test(description))
    .map(pattern => ({
      warning: pattern.warning,
      checkpoints: pattern.checkpoints
    }));
}

// Prioritize requirements based on task analysis
export function prioritizeRequirements(
  route: string, 
  phaseRequirements: Record<string, boolean>,
  taskDescription: string
): {
  critical: Array<{name: string, why: string, consequence: string, completed: boolean}>,
  important: Array<{name: string, completed: boolean}>,
  niceToHave: Array<{name: string, completed: boolean}>
} {
  // Critical requirements that prevent disasters
  const criticalReqs = [
    {
      name: 'existing_system_analysis',
      why: 'Prevents creating duplicate functionality',
      consequence: 'Average 2-3 days of rework when skipped'
    },
    {
      name: 'user_validation',
      why: 'Ensures correct understanding of requirements',
      consequence: 'Wrong solution = complete rework'
    }
  ];

  if (route === 'heavy') {
    criticalReqs.push({
      name: 'critical_risks_mitigated',
      why: 'Complex tasks have hidden dependencies',
      consequence: 'Production issues and emergency fixes'
    });
  }

  // Map to include completion status
  const critical = criticalReqs.map(req => ({
    ...req,
    completed: phaseRequirements[req.name] || false
  }));

  // Important but not blocking
  const importantReqs = [
    'alternatives_researched',
    'components_mapped',
    'dependencies_verified',
    'tests_planned'
  ];

  const important = importantReqs
    .filter(req => req in phaseRequirements)
    .map(req => ({
      name: req,
      completed: phaseRequirements[req] || false
    }));

  // Nice to have
  const niceToHave = Object.entries(phaseRequirements)
    .filter(([req]) => 
      !criticalReqs.find(c => c.name === req) && 
      !importantReqs.includes(req)
    )
    .map(([req, completed]) => ({
      name: req,
      completed
    }));

  return { critical, important, niceToHave };
}

// Generate adaptive roadmap based on task
export function generateRoadmap(taskDescription: string, route: string): string {
  const isExtension = taskDescription.match(/add|extend|enhance|improve/i);
  const isNew = taskDescription.match(/create|build|implement.*new/i);
  const hasAmbiguity = taskDescription.split(' ').length < 10;

  let roadmap = `## 🗺️ M7 Roadmap Generated

**Your Journey**:
`;

  if (hasAmbiguity) {
    roadmap += `1. **Quick Clarification** (5-10 min)
   - Validate understanding with user
   - Identify existing vs new components
   - Define success criteria\n\n`;
  }

  if (isExtension) {
    roadmap += `1. **Architecture Scan** (10-15 min)
   - Find target components to extend
   - Map integration points
   - Check for breaking changes\n\n`;
  } else {
    roadmap += `1. **Discovery** (${route === 'light' ? '15-20' : '30-45'} min)
   - Search for similar existing code
   - Research best practices
   - Document alternatives\n\n`;
  }

  roadmap += `2. **Planning** (${route === 'light' ? '10-15' : '20-30'} min)
   - Design optimal solution
   - Identify risks and mitigations
   - Create implementation steps\n\n`;

  roadmap += `3. **Implementation** (${estimateImplementationTime(route)})
   - Follow the planned approach
   - Test incrementally
   - Document as you go\n\n`;

  roadmap += `**M7 Navigation**: Active ✅
- Use \`@m7 navigate where_am_i\` if you get lost
- Auto-saves progress at each phase
- Maintains context across subtasks`;

  return roadmap;
}

// Helper functions
function detectComplexityIndicators(description: string): string[] {
  const indicators = [];
  if (description.match(/integrat|connect|sync/i)) indicators.push('integration complexity');
  if (description.match(/refactor|restructure|redesign/i)) indicators.push('architectural changes');
  if (description.match(/performance|optimiz|speed/i)) indicators.push('performance considerations');
  if (description.match(/security|auth|encrypt/i)) indicators.push('security requirements');
  if (indicators.length === 0) indicators.push('feature implementation');
  return indicators;
}

function assessTaskRisks(description: string): {primary: string, prevention: string, opportunity: string} {
  if (description.match(/create.*new/i)) {
    return {
      primary: "creating duplicate functionality",
      prevention: "analyze existing codebase first",
      opportunity: "reuse and extend existing components"
    };
  }
  if (description.match(/fix|bug|issue/i)) {
    return {
      primary: "fixing symptoms instead of root cause",
      prevention: "understand the full context",
      opportunity: "prevent similar issues systematically"
    };
  }
  return {
    primary: "misunderstanding requirements",
    prevention: "validate understanding before coding",
    opportunity: "build exactly what's needed"
  };
}

function assessDuplicationRisk(description: string): string {
  if (description.match(/create.*new|build.*from.*scratch/i)) return "HIGH";
  if (description.match(/add|implement/i)) return "MEDIUM";
  return "LOW";
}

function assessMisunderstandingRisk(description: string): string {
  const wordCount = description.split(' ').length;
  if (wordCount < 10) return "HIGH - brief description";
  if (description.match(/like|similar|kind of/i)) return "HIGH - vague requirements";
  if (wordCount > 50) return "MEDIUM - detailed but complex";
  return "LOW";
}

function estimateTimeSaved(route: string): string {
  switch(route) {
    case 'light': return "~30-60 minutes";
    case 'medium': return "~2-4 hours";
    case 'heavy': return "~1-2 days";
    default: return "varies";
  }
}

function estimateImplementationTime(route: string): string {
  switch(route) {
    case 'light': return "30-60 min";
    case 'medium': return "2-4 hours";
    case 'heavy': return "1-2 days";
    default: return "varies";
  }
} 