// Interactive template generators that encourage deep thinking

export interface TemplateContext {
  taskId: string;
  taskDescription: string;
  route: 'light' | 'medium' | 'heavy';
  originalRequest?: string;
  detectedPatterns?: string[];
}

export function generateInteractiveDiscovery(context: TemplateContext): string {
  const { taskId, taskDescription, route, originalRequest } = context;
  
  return `# 🔍 Discovery Report: Let's Understand What We're REALLY Building

## 🎯 The Request
**Exact words**: "${originalRequest || taskDescription}"

## 🤔 But What Does This REALLY Mean?

**Step 1: Break down the request**
- Key verb: "${extractVerb(taskDescription)}" 
  ↳ Does this mean CREATE NEW or MODIFY EXISTING? _____________
  
- Key noun: "${extractNoun(taskDescription)}"
  ↳ Is this a new concept or exists in another form? _____________

**Step 2: Check existing functionality**
${generateExistingCheckQuestions(taskDescription)}

**Step 3: Challenge your assumptions**
- I think the user wants: _____________
- But they might actually want: _____________
- Evidence for my interpretation: _____________
- Evidence AGAINST my interpretation: _____________

## 🔍 Deep Dive: Existing System Analysis (CRITICAL!)

**⚠️ RED FLAG CHECK**: Am I about to create something that already exists?

### Investigation Checklist:
- [ ] Searched codebase for: "${generateSearchTerms(taskDescription).join('", "')}"
- [ ] Found similar functionality in: _____________
- [ ] Can extend existing: YES / NO because _____________

### What I Found:
\`\`\`
[Paste your codebase_search results here]
\`\`\`

### Extension vs Creation Decision:
\`\`\`
EXTEND EXISTING <-----|-----> CREATE NEW
                      ^
                 [Mark where you are]
\`\`\`
**Justification**: _____________

## 🎨 Solution Design

### If EXTENDING existing:
- Target component: _____________
- Integration points: _____________
- Breaking changes: _____________

### If CREATING new:
- Why can't extend: _____________
- Unique requirements: _____________
- Future extensibility: _____________

## 🔬 Alternative Approaches (Think Outside the Box!)

Instead of thinking "Approach 1, 2, 3", let's think differently:

### The Obvious Solution:
What everyone would do first: _____________
Why this might be wrong: _____________

### The Clever Solution:
What uses existing code smartly: _____________
Trade-offs: _____________

### The Future-Proof Solution:
What sets us up for success: _____________
Extra effort required: _____________

## 📊 Evidence & Validation

**User said**: "${extractKeyPhrases(taskDescription).join('", "')}"
**This suggests**: _____________
**Counter-evidence**: _____________

## 🎯 Recommendation & Confidence

**My recommendation**: _____________
**Confidence level**: ___% 
**Biggest risk if I'm wrong**: _____________
**How to validate**: _____________

## ✅ Discovery Completed When:
- [ ] Found ALL existing similar code
- [ ] Made extend vs create decision with evidence
- [ ] Validated interpretation matches user intent
- [ ] Identified biggest risk and mitigation`;
}

export function generateInteractiveArchitecture(context: TemplateContext): string {
  const { taskId, taskDescription, route } = context;
  
  return `# 🏗️ Architecture Context: Mapping the Territory

## 🗺️ Current System Map

### Start with the User Journey:
**User action**: _____________
**Current flow**:
1. User does: _____________
2. System responds: _____________
3. Data flows through: _____________
4. Result shown at: _____________

### 🔍 Component Discovery Exercise

Instead of listing components, let's FIND them:

**Search 1**: Components that handle similar features
\`\`\`
@codebase_search "components that handle ${extractNoun(taskDescription)}"
Results: _____________
\`\`\`

**Search 2**: Data flow for related functionality  
\`\`\`
@codebase_search "how data flows for ${extractFeature(taskDescription)}"
Results: _____________
\`\`\`

**Search 3**: Integration points
\`\`\`
@grep_search "import.*${extractMainModule(taskDescription)}"
Results: _____________
\`\`\`

## 🧩 Integration Analysis

### Option A: Extend Existing Component
**Target**: _____________
**Current responsibility**: _____________
**New responsibility**: _____________
**Risk of breaking**: Low / Medium / High because _____________

### Option B: Create New Component  
**Justification**: _____________
**Dependencies needed**: _____________
**Who will consume it**: _____________
**Future extensibility**: _____________

### Option C: Hybrid Approach
**New parts**: _____________
**Reused parts**: _____________
**Connection points**: _____________

## 🚨 Dependency Deep Dive

### External Dependencies:
${route !== 'light' ? `
Run this check:
\`\`\`
@m7 check dependencies libraries=["${suggestLibraries(taskDescription).join('", "')}"]
\`\`\`
Results: _____________
` : 'List key libraries: _____________'}

### Internal Dependencies:
**Who depends on what I'm changing**: _____________
**What I'll depend on**: _____________
**Circular dependency risk**: _____________

## 🎯 Architecture Decision

**Final approach**: Extend / Create New / Hybrid
**Key insight that drove this decision**: _____________
**What could go wrong**: _____________
**How we'll know if it's working**: _____________`;
}

export function generateInteractiveSolutionPlan(context: TemplateContext): string {
  const { taskId, taskDescription, route } = context;
  
  return `# 📋 Solution Plan: From Idea to Implementation

## 🤔 Pre-Planning Reflection

**What success looks like**: _____________
**What failure looks like**: _____________
**The one thing we must get right**: _____________

## 🎯 Implementation Strategy

### The Smart Path (not just the obvious one):

#### Phase 1: Foundation (___% of effort)
**Why start here**: _____________
**Key deliverable**: _____________
**How we'll know it's working**: _____________

#### Phase 2: Core Logic (___% of effort)  
**Dependencies from Phase 1**: _____________
**Tricky parts**: _____________
**Fallback if stuck**: _____________

#### Phase 3: Integration (___% of effort)
**Connection points**: _____________
**Potential conflicts**: _____________
**Testing approach**: _____________

## 🧪 Validation Strategy

### Quick Win Test:
"If I do _____________, I should see _____________"

### Integration Test:
"When user does _____________, the system should _____________"

### Edge Case Test:
"What happens if _____________?"

## 🚨 Risk Radar

### Technical Risks:
1. **Biggest technical risk**: _____________
   - **Probability**: ___% 
   - **Impact if happens**: _____________
   - **Early warning sign**: _____________
   - **Mitigation**: _____________

### Requirements Risks:
1. **Most likely misunderstanding**: _____________
   - **How to validate now**: _____________
   - **Cost to fix later**: _____________

## 📊 Decision Points

### Point 1: After Phase 1
**Decision needed**: _____________
**Options**: A) _____________ B) _____________
**How to decide**: _____________

### Point 2: Before Integration
**Decision needed**: _____________
**Options**: A) _____________ B) _____________
**How to decide**: _____________

## ✅ Success Checklist
- [ ] User need correctly understood
- [ ] Existing code maximally reused
- [ ] No duplicate functionality created
- [ ] Clean integration achieved
- [ ] Tests prove it works
- [ ] Future changes easy`;
}

// Helper functions
function extractVerb(description: string): string {
  const verbs = description.match(/^(\w+)/i);
  return verbs ? verbs[1] : '[action]';
}

function extractNoun(description: string): string {
  const nouns = description.match(/(?:create|add|implement|build|fix)\s+(?:a\s+|an\s+|the\s+)?(\w+)/i);
  return nouns ? nouns[1] : '[feature]';
}

function extractFeature(description: string): string {
  // Extract the core feature being discussed
  const features = description.match(/(?:for|to|with)\s+(\w+(?:\s+\w+)?)/i);
  return features ? features[1] : extractNoun(description);
}

function extractMainModule(description: string): string {
  const noun = extractNoun(description);
  // Convert to likely module name (e.g., "authentication" -> "auth", "user profile" -> "user")
  return noun.toLowerCase().split(' ')[0];
}

function generateSearchTerms(description: string): string[] {
  const noun = extractNoun(description);
  const verb = extractVerb(description);
  const terms = [noun];
  
  // Add variations
  if (noun.endsWith('s')) terms.push(noun.slice(0, -1));
  if (noun.includes('_')) terms.push(noun.replace(/_/g, ' '));
  if (verb.toLowerCase() === 'add') terms.push('existing ' + noun);
  
  return [...new Set(terms)];
}

function generateExistingCheckQuestions(description: string): string {
  const noun = extractNoun(description);
  return `
- [ ] Searched for existing ${noun} components/modules
- [ ] Checked if current pages already handle ${noun}
- [ ] Looked for similar patterns in codebase
- [ ] Verified no partial implementation exists

**Specific searches to run**:
\`\`\`
@codebase_search "existing ${noun} implementation"
@grep_search "${noun.toLowerCase()}" include_pattern="*.ts"
@grep_search "class.*${noun}" include_pattern="*.ts"
\`\`\``;
}

function extractKeyPhrases(description: string): string[] {
  // Extract 2-3 word phrases that seem important
  const phrases = [];
  const words = description.split(' ');
  
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length > 3 && words[i+1].length > 3) {
      phrases.push(`${words[i]} ${words[i+1]}`);
    }
  }
  
  return phrases.slice(0, 3);
}

function suggestLibraries(description: string): string[] {
  const libraries = [];
  
  if (description.match(/auth/i)) libraries.push('jsonwebtoken', 'bcrypt');
  if (description.match(/database|data/i)) libraries.push('prisma', 'mongodb');
  if (description.match(/api|http/i)) libraries.push('axios', 'express');
  if (description.match(/ui|component|frontend/i)) libraries.push('react', 'vue');
  
  return libraries.length > 0 ? libraries : ['main-framework'];
} 