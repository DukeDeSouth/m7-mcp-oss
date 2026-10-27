import { createLogger } from '../utils/logger.js';
const log = createLogger('[initProject]');
import { z } from 'zod';
import { JournalSystem } from '../../journal/journalSystem.js';
import { SchemaSystem } from '../../schema/schemaSystem.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { getProjectPath, applyProjectPath, ensureProjectPathResolved } from '../utils/projectPath.js';
import { createM7StructureInternal } from './createStructure.js';
// v5.0: Use UnifiedMemoryCore instead of MemorySystem
import { getMemoryCore, UnifiedMemoryCore } from '../../memory/auto/unified-memory-core.js';

/**
 * Result of Cold Start initialization
 */
export interface ColdStartResult {
  success: boolean;
  projectPath: string;
  projectName: string;
  filesCreated: string[];
  firstTask?: {
    folder: string;
    files: string[];
  };
  memoryInitialized?: boolean;
  error?: string;
}

const InitProjectRequestSchema = z.object({
  project_path: z.string().optional(),
  project_name: z.string().optional(),
  description: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  domain: z.string().optional(),
  force: z.boolean().default(false)
});

export const initProjectTool = {
  name: 'mcp_m7_init_project',
  description: 'Initialize complete M7 ecosystem for empty projects - creates Memory Bank, .cursorrules, project structure',
  inputSchema: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: 'Explicit path to project directory (defaults to MCP workspace / resolved project path)'
      },
      project_name: {
        type: 'string',
        description: 'Project name (optional - will auto-detect from directory)'
      },
      description: {
        type: 'string',
        description: 'Project description (optional)'
      },
      technologies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Expected technologies (React, Node.js, etc.)'
      },
      domain: {
        type: 'string',
        description: 'Business domain (e-commerce, social media, etc.)'
      },
      force: {
        type: 'boolean',
        description: 'Force initialization even if directory is not empty',
        default: false
      }
    }
  },
  handler: async (request: any, journal: JournalSystem, schema?: SchemaSystem, server?: unknown) => {
    const params = InitProjectRequestSchema.parse(request);
    const { project_path, project_name, description, technologies, domain, force } = params;

    try {
      let currentDir: string;
      if (project_path) {
        currentDir = applyProjectPath(project_path);
      } else {
        currentDir = await ensureProjectPathResolved(server);
      }
      log.error(`📁 [initProject] Using project path: ${currentDir}`);
      
      const isEmpty = await isDirectoryEmpty(currentDir);
      
      if (!isEmpty && !force) {
        return {
          content: [{
            type: 'text',
            text: `# 🚫 Directory Not Empty

**Current Directory:** \`${currentDir}\`

The directory contains files. M7 auto-initialization is designed for empty projects.

## Options:
1. **Move to empty directory** and run again
2. **Use force flag**: Add \`force: true\` to initialize anyway
3. **Manual setup**: Use individual M7 tools in existing project

## Safety First 🛡️
M7 methodology prioritizes careful analysis over quick fixes. 
Empty directory initialization ensures clean, intentional project setup.`
          }],
          isError: true
        };
      }

      // Auto-detect project name from directory
      const detectedName = project_name || path.basename(currentDir);
      
      // Initialize M7 ecosystem
      const initResult = await initializeM7Ecosystem({
        projectName: detectedName,
        description: description || `${detectedName} - M7 Methodology Project`,
        technologies: technologies || ['To be determined'],
        domain: domain || 'General',
        currentDir
      }, journal, schema);

      return {
        content: [{
          type: 'text',
          text: `# 🚀 M7 Ecosystem Initialized Successfully!

## 📁 Project: "${detectedName}"
**Location:** \`${currentDir}\`
**Domain:** ${domain || 'General'}
**Technologies:** ${(technologies || ['To be determined']).join(', ')}

## 🏗️ Created Structure:
${initResult.createdFiles.map(f => `- ✅ **${f.path}** - ${f.description}`).join('\n')}

## 🧠 Memory Systems:
- ✅ **Project Memory** (Level 5) - High-level project context
- ✅ **Memory Bank** - Complete methodological framework  
- ✅ **Journal Systems** - Error and pattern tracking
- ✅ **Fog of War** - Technical discovery tracking

## 📋 Ready to Use:
- **Discovery Phase**: Start with any task using \`@m7 analyze task\`
- **Memory Recall**: \`@m7 recall memory query="topic" depth=5\`
- **Pattern Storage**: \`@m7 store pattern\` for learnings
- **Project Updates**: \`@m7 update project memory\`

## 🎯 Next Steps:
1. **Define your first task**: \`@m7 analyze task "Your first feature"\`
2. **Update project details**: Add more specific technologies and features
3. **Follow M7 methodology**: Always start with Discovery → Architecture → Planning

## 💡 M7 Philosophy:
*"Architecture first, implementation second. Discovery prevents chaos."*

Welcome to systematic, enterprise-ready development! 🎉`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ **M7 initialization failed:** ${error instanceof Error ? error.message : 'Unknown error'}

Please check permissions and try again.`
        }],
        isError: true
      };
    }
  }
};

/**
 * Check if directory is empty or contains only hidden files
 * Exported for use in analyzeTask cold start detection
 */
export async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const files = await fs.readdir(dirPath);
    // Ignore common hidden files that don't indicate a "real" project
    const relevantFiles = files.filter(file => 
      !file.startsWith('.') || 
      ['package.json', 'README.md', 'tsconfig.json'].includes(file)
    );
    return relevantFiles.length === 0;
  } catch (error) {
    return true; // If can't read, assume empty
  }
}

/**
 * Check if directory needs M7 initialization
 * Returns true if directory is empty or lacks M7 structure
 */
export async function needsM7Init(dirPath: string): Promise<boolean> {
  try {
    // Check if directory is empty
    const isEmpty = await isDirectoryEmpty(dirPath);
    if (isEmpty) return true;
    
    // Check if M7 structure exists
    const hasMemoryBank = existsSync(path.join(dirPath, 'memory-bank'));
    const hasCursorRules = existsSync(path.join(dirPath, '.cursorrules'));
    
    // If no M7 structure, needs init
    return !hasMemoryBank && !hasCursorRules;
  } catch {
    return true;
  }
}

async function initializeM7Ecosystem(
  config: {
    projectName: string;
    description: string;
    technologies: string[];
    domain: string;
    currentDir: string;
  },
  journal: JournalSystem,
  schema?: SchemaSystem
) {
  const { projectName, description, technologies, domain, currentDir } = config;
  const createdFiles: Array<{path: string, description: string}> = [];

  // 1. Create PROJECT_SCHEMA.yaml using SchemaSystem
  if (schema) {
    await schema.initializeSchema(projectName, description);
    createdFiles.push({
      path: 'PROJECT_SCHEMA.yaml',
      description: 'Central project configuration and structure'
    });
  }

  // 2. Create Memory Bank structure
  await createMemoryBank(currentDir, projectName, description, technologies, domain, createdFiles);

  // 3. Initialize .cursorrules
  await createCursorRules(currentDir, projectName, createdFiles);

  // 4. Create basic project structure
  await createProjectStructure(currentDir, createdFiles);

  // 4.5. Create M7 Knowledge System (reference files + cursor rule)
  await createKnowledgeSystem(currentDir, projectName, description, technologies, domain, createdFiles);

  // 5. Initialize M7 Unified Memory System
  try {
    const memory = await getMemoryCore(currentDir);
    
    // Store project metadata at L2
    await memory.store(JSON.stringify({
      type: 'project_metadata',
      name: projectName,
      description,
      purpose: `${projectName} project following M7 methodology`,
      mainTechnologies: technologies,
      architecture: 'To be determined during Discovery phase',
      keyFeatures: ['Initial setup complete'],
      businessDomain: domain,
      lastUpdated: new Date().toISOString()
    }), {
      level: 'L2',
      source: 'documentation',
      contextKeys: ['project', 'metadata'],
      confidence: 1.0
    });

    // Store initial pattern at L3
    await memory.store(JSON.stringify({
      name: 'M7 Project Initialization',
      description: 'Automated setup of M7 methodology ecosystem',
      problem_context: 'New project setup with systematic methodology',
      solution_rationale: 'Provides complete framework for enterprise-ready development',
      success_criteria: ['Memory bank created', 'Rules configured', 'Structure established'],
      timestamp: new Date().toISOString()
    }), {
      level: 'L3',
      source: 'documentation',
      contextKeys: ['initialization', 'pattern'],
      confidence: 0.9
    });
  } catch (error) {
    log.warn('Unified Memory initialization skipped:', error);
    // Continue without memory - not critical for init
  }

  // 6. Log the initialization
  await journal.logFeature({
    name: 'M7 Ecosystem Initialization',
    description: `Complete M7 setup for ${projectName}`,
    implementation: `Automated initialization with memory bank, rules, and structure`,
    lessons: ['Automated setup reduces setup time', 'Systematic approach ensures completeness'],
    patterns: ['Automated initialization', 'Memory bank creation', 'Project structure'],
    complexity: 'light'
  });

  return { createdFiles };
}

async function createMemoryBank(
  currentDir: string, 
  projectName: string, 
  description: string,
  technologies: string[],
  domain: string,
  createdFiles: Array<{path: string, description: string}>
) {
  const memoryBankDir = path.join(currentDir, 'memory-bank');
  await fs.mkdir(memoryBankDir, { recursive: true });

  // Project Brief (Foundation)
  const projectBrief = `# Project Brief: ${projectName}

## 🎯 Project Overview
**Name:** ${projectName}
**Domain:** ${domain}
**Description:** ${description}

## 🔧 Technology Stack
${technologies.map(tech => `- ${tech}`).join('\n')}

## 📋 Core Requirements
- [x] M7 methodology implementation
- [ ] Architecture definition
- [ ] Feature requirements gathering
- [ ] Technical implementation

## 🚀 Success Criteria
- Enterprise-ready codebase
- Comprehensive documentation
- Full test coverage
- Performance benchmarks met

## 🛡️ Quality Standards
- Zero Critical risks in production
- Context7 MCP integration for all libraries
- Playwright MCP for validation
- 7-File methodology compliance

*Created: ${new Date().toISOString()}*
*Methodology: M7 IDEAL*`;

  await fs.writeFile(path.join(memoryBankDir, 'projectbrief.md'), projectBrief);
  createdFiles.push({path: 'memory-bank/projectbrief.md', description: 'Foundation document'});

  // Product Context
  const productContext = `# Product Context: ${projectName}

## 🎯 Why This Project Exists
${description}

This project was initialized with M7 methodology to ensure:
- Systematic development approach
- Enterprise-ready architecture
- Preventive quality measures
- Comprehensive documentation

## 🎨 User Experience Goals
- Intuitive and responsive interface
- High performance and reliability
- Accessibility compliance
- Cross-platform compatibility

## 🔧 Technical Philosophy
- **Discovery First**: Research before implementation
- **Architecture-Driven**: Structure before details
- **Test-Driven**: Quality before features
- **Performance-Aware**: Optimization throughout

## 📊 Success Metrics
- User satisfaction: >4.5/5
- Performance: <200ms response time
- Reliability: >99.9% uptime
- Test coverage: >95%

*Updated: ${new Date().toISOString()}*`;

  await fs.writeFile(path.join(memoryBankDir, 'productContext.md'), productContext);
  createdFiles.push({path: 'memory-bank/productContext.md', description: 'Product vision and goals'});

  // Active Context
  const activeContext = `# Active Context: ${projectName}

## 🎯 Current Focus
**Phase:** Project Initialization ✅
**Next:** Architecture Discovery & Planning

## 📋 Recent Changes
- M7 ecosystem initialization complete
- Memory bank established
- Basic project structure created

## 🔄 Active Decisions
1. **Methodology**: M7 IDEAL chosen for systematic approach
2. **Tools**: Context7 + Playwright MCP integration planned
3. **Structure**: 7-File system for all features/bugs

## 🎯 Immediate Next Steps
1. Define first feature or improvement
2. Run \`@m7 analyze task\` for proper routing
3. Follow Discovery → Architecture → Planning cycle

## 💡 Current Considerations
- Technology stack finalization needed
- Architecture patterns to be established
- Integration strategies to be defined

*Updated: ${new Date().toISOString()}*`;

  await fs.writeFile(path.join(memoryBankDir, 'activeContext.md'), activeContext);
  createdFiles.push({path: 'memory-bank/activeContext.md', description: 'Current work focus'});

  // System Patterns
  const systemPatterns = `# System Patterns: ${projectName}

## 🏗️ Architecture Decisions
*To be populated during Discovery phase*

## 🎨 Design Patterns
*To be established during implementation*

## 🔧 Technical Patterns
### M7 Methodology Integration
- **Discovery Phase**: Research-first approach
- **Context7 Integration**: Library documentation verification
- **Playwright Validation**: Real-world testing automation
- **7-File System**: Structured task management

### Quality Assurance
- Type-safety enforcement
- Comprehensive error handling
- Performance monitoring
- Automated testing strategies

## 🔗 Component Relationships
*Architecture mapping to be completed during planning*

## 📊 Performance Patterns
*Optimization strategies to be defined during implementation*

*Updated: ${new Date().toISOString()}*`;

  await fs.writeFile(path.join(memoryBankDir, 'systemPatterns.md'), systemPatterns);
  createdFiles.push({path: 'memory-bank/systemPatterns.md', description: 'Architecture and patterns'});

  // Tech Context
  const techContext = `# Technical Context: ${projectName}

## 🔧 Technology Stack
${technologies.map(tech => `- **${tech}**: Version and configuration TBD`).join('\n')}

## 🛠️ Development Environment
- **M7 MCP Server**: Methodology automation
- **Context7 MCP**: Library documentation
- **Playwright MCP**: Browser automation
- **IDE**: Cursor with M7 integration

## 📦 Dependencies Management
- All libraries verified through Context7
- Version compatibility checked
- Breaking changes monitored
- Performance impact assessed

## 🏗️ Build & Deployment
*Configuration to be established during setup*

## 🧪 Testing Strategy
- Unit tests: >95% coverage target
- Integration tests: Critical paths
- E2E tests: Playwright automation
- Performance tests: Benchmark tracking

## 🛡️ Security Considerations
*Security analysis during architecture phase*

*Updated: ${new Date().toISOString()}*`;

  await fs.writeFile(path.join(memoryBankDir, 'techContext.md'), techContext);
  createdFiles.push({path: 'memory-bank/techContext.md', description: 'Technical environment'});

  // Progress
  const progress = `# Progress: ${projectName}

## ✅ Completed
- [x] **M7 Ecosystem Initialization** (${new Date().toLocaleDateString()})
  - Memory bank structure created
  - .cursorrules configured  
  - Project memory initialized
  - Journal systems active

## 🔄 In Progress
*No active development yet*

## 📋 Planned
- [ ] **Architecture Discovery**
  - Technology stack finalization
  - System design patterns
  - Integration architecture
  
- [ ] **First Feature Implementation**
  - Requirements gathering
  - Technical design
  - Implementation with M7 cycle

## 🚫 Known Issues
*No issues yet - clean initialization*

## 📊 Metrics
- **Initialization Time**: ~30 seconds
- **Files Created**: ${createdFiles.length + 6} (memory bank + structure)
- **M7 Compliance**: 100% (initialization phase)

## 🎯 Success Indicators
- ✅ M7 methodology active
- ✅ Memory systems operational  
- ✅ Quality gates established
- ⏳ First feature development pending

*Updated: ${new Date().toISOString()}*`;

  await fs.writeFile(path.join(memoryBankDir, 'progress.md'), progress);
  createdFiles.push({path: 'memory-bank/progress.md', description: 'Project progress tracking'});
}

async function createCursorRules(
  currentDir: string,
  projectName: string,
  createdFiles: Array<{path: string, description: string}>
) {
  const cursorRules = `# 📚 ${projectName} - M7 Methodology Rules

## 🎯 Core Philosophy
This project follows M7 IDEAL methodology for systematic, enterprise-ready development.

**Key Principles:**
- **Discovery before Implementation** — protects against premature convergence
- **Architecture-First** — provides structure that prevents integration issues
- **Risk-Aware Progression** — critical risks are resolved before they compound
- **Context7 Integration** — verifies library docs to prevent version mismatches
- **Playwright Validation** — real-world browser testing for UI changes

## Tools Integration
- **M7 MCP Server** (\`@m7\`) — task analysis, planning, memory
- **Context7 MCP** (\`@context7\`) — library documentation verification
- **Playwright MCP** (\`@playwright\`) — browser automation and testing

## 7-Phase Documentation System
Each phase produces an artifact that serves as a memory bank for future tasks:

| # | File | What it protects against |
|---|------|--------------------------|
| 1 | **DISCOVERY_REPORT.md** | Incomplete understanding, missed root causes |
| 2 | **ARCHITECTURE_CONTEXT.md** | Integration blindspots |
| 3 | **SOLUTION_PLAN.md** | Premature coding without clear direction |
| 4 | **IMPACT_ANALYSIS.md** | Undetected regressions and edge cases |
| 5 | **IMPLEMENTATION_SIMULATION.md** | Cognitive rehearsal — surfaces unknowns |
| 6 | **RISK_MITIGATION.md** | Unresolved risks that compound |
| 7 | **IMPLEMENTATION_REPORT.md** | Lost learnings — captures patterns |

## Cognitive Safeguards

### Before code changes — best results achieved when:
1. Run \`@m7 analyze task "description"\` — provides structure and catches existing solutions
2. Critical risks are addressed — prevents compounding failures
3. Context7 check for new libraries — prevents version/API mismatches
4. Playwright validation for UI changes — catches visual regressions

### Development Flow:
1. **Discovery** (20-25% time) — research, root cause analysis
2. **Architecture** (10-15% time) — map current system
3. **Planning** (35-40% time) — iterative design optimization
4. **Implementation** (20-25% time) — follow simulation as guide
5. **Validation** (5-10% time) — test, measure, document

### Risk Awareness:
- 🔴 **Critical risks** — resolve before proceeding (protects against catastrophic failures)
- 🟡 **Major risks** — flag for explicit review
- 🟢 **Minor risks** — proceed with monitoring
- 📊 **Success metrics** — define and measure for each task

## Memory Management
- Use \`@m7 recall memory depth=X\` to access project knowledge
- Store patterns with \`@m7 store pattern\` for reuse
- Update project context regularly

## Project-Specific Patterns
*Populated as patterns emerge during development*

## Success Metrics
- **Prevented Failure Value (PFV)** — class of prevented damage
- **Risk Surface Reduction (RSR)** — uncertainties resolved before coding
- Time to solution, error reduction, performance impact, test coverage

## Continuous Improvement
- Review and update these rules based on project learnings
- Document successful patterns for reuse
- Refine methodology based on project needs

---
*Generated by M7 MCP v1.1.0*
*Project: ${projectName}*
*Created: ${new Date().toISOString()}*`;

  await fs.writeFile(path.join(currentDir, '.cursorrules'), cursorRules);
  createdFiles.push({path: '.cursorrules', description: 'Project-specific M7 methodology rules'});
}

async function createKnowledgeSystem(
  currentDir: string,
  projectName: string,
  description: string,
  technologies: string[],
  domain: string,
  createdFiles: Array<{path: string, description: string}>
) {
  // 1. Create .cursor/rules/m7-memory.mdc
  const cursorRulesDir = path.join(currentDir, '.cursor', 'rules');
  await fs.mkdir(cursorRulesDir, { recursive: true });

  const mdcContent = `---
description: M7 project knowledge system — reference files index
alwaysApply: true
---
# M7 Project Knowledge

Before starting a task, read the relevant reference file:

| File | Contains | When to read |
|------|----------|--------------|
| \`INDEX.md\` | Project map — modules, entry points, key systems | Any task — start here |
| \`MASTER_REFERENCE.md\` | Full architecture — all tools, deps, data files | Architecture work, new systems, deep changes |
| \`CODING_STANDARDS.md\` | Project conventions — tool structure, naming, error handling, anti-patterns | Writing or reviewing code |
| \`CYCLE_REGISTRY.md\` | Decision history — what was done, why, lessons learned, ADRs | Before making architectural decisions |

After completing a task, update the relevant file:
- Added a module/tool → update INDEX.md and MASTER_REFERENCE.md
- Made an architectural decision → append to CYCLE_REGISTRY.md
- Established a new pattern or convention → append to CODING_STANDARDS.md
`;

  await fs.writeFile(path.join(cursorRulesDir, 'm7-memory.mdc'), mdcContent);
  createdFiles.push({path: '.cursor/rules/m7-memory.mdc', description: 'M7 knowledge system — auto-loaded project memory'});

  // 2. Create INDEX.md
  const techList = technologies.length > 0 && technologies[0] !== 'To be determined'
    ? technologies.join(', ')
    : 'To be determined';

  const indexContent = `# ${projectName} — Index

> Project navigation map. Read before any task.
> Details: MASTER_REFERENCE.md | Patterns: CODING_STANDARDS.md | History: CYCLE_REGISTRY.md

## What is this

${description || `${projectName} — project following M7 methodology.`}

**Stack:** ${techList}
**Domain:** ${domain}

## Project Structure

\`\`\`
${projectName}/
├── INDEX.md              ← You are here
├── MASTER_REFERENCE.md   ← Full architecture
├── CODING_STANDARDS.md   ← Code conventions
├── CYCLE_REGISTRY.md     ← Decision history
├── .cursorrules          ← M7 methodology rules
├── memory-bank/          ← Project context (markdown)
├── docs/                 ← Documentation
│   ├── features/         ← Feature M7 cycles
│   └── debug/            ← Bug M7 cycles
└── .m7/                  ← M7 runtime data (git-ignored)
\`\`\`

## Known Issues

*None yet — clean initialization.*

*Initialized: ${new Date().toISOString()}*
`;

  await fs.writeFile(path.join(currentDir, 'INDEX.md'), indexContent);
  createdFiles.push({path: 'INDEX.md', description: 'Project navigation map'});

  // 3. Create MASTER_REFERENCE.md
  const masterRefContent = `# ${projectName} — Master Reference

## Identity
- **Project**: ${projectName}
- **Description**: ${description || 'M7 Methodology Project'}
- **Stack**: ${techList}
- **Domain**: ${domain}

## Architecture

*To be documented during Discovery and Architecture phases.*

## Key Dependencies

*To be populated as dependencies are added.*

## Data Files

| Path | Purpose |
|------|---------|
| \`.m7/memory/\` | Persisted memory (JSON) |
| \`.m7/errors.json\` | Error journal |
| \`.m7/features.json\` | Feature journal |
| \`memory-bank/\` | Markdown knowledge bank |
| \`config/\` | Configuration files |

*Initialized: ${new Date().toISOString()}*
`;

  await fs.writeFile(path.join(currentDir, 'MASTER_REFERENCE.md'), masterRefContent);
  createdFiles.push({path: 'MASTER_REFERENCE.md', description: 'Full architecture reference'});

  // 4. Create CODING_STANDARDS.md
  const standardsContent = `# ${projectName} — Coding Standards

> Project-specific conventions. Not generic best practices — rules for this project.

## Stack

${techList}

## Conventions

*To be populated as patterns emerge during development.*

## Anti-Patterns

*To be populated as issues are discovered.*

## Discovered Patterns

*Patterns stored via M7 will appear here automatically.*

*Initialized: ${new Date().toISOString()}*
`;

  await fs.writeFile(path.join(currentDir, 'CODING_STANDARDS.md'), standardsContent);
  createdFiles.push({path: 'CODING_STANDARDS.md', description: 'Project coding conventions'});

  // 5. Create CYCLE_REGISTRY.md
  const registryContent = `# ${projectName} — Cycle Registry

> Decision history: what was done, why, lessons learned. Updated after each task.

## Format

\`\`\`
### [date] Brief description
- **Decision**: what was decided
- **Why**: reasoning
- **Changed**: files/systems affected
- **Lesson**: takeaway (if any)
\`\`\`

---

## ${new Date().toISOString().split('T')[0]} — Project Initialization

- **Decision**: Initialize ${projectName} with M7 methodology
- **Why**: Systematic approach to development with built-in memory and quality gates
- **Changed**: Created project structure, memory bank, reference files, cursor rules
- **Lesson**: Starting point — all reference files need to be populated as the project evolves

*Initialized: ${new Date().toISOString()}*
`;

  await fs.writeFile(path.join(currentDir, 'CYCLE_REGISTRY.md'), registryContent);
  createdFiles.push({path: 'CYCLE_REGISTRY.md', description: 'Decision and cycle history'});
}

async function createProjectStructure(
  currentDir: string,
  createdFiles: Array<{path: string, description: string}>
) {
  // Create docs structure
  const docsDir = path.join(currentDir, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  
  const featuresDir = path.join(docsDir, 'features');
  await fs.mkdir(featuresDir, { recursive: true });
  
  const debugDir = path.join(docsDir, 'debug');
  await fs.mkdir(debugDir, { recursive: true });

  // Create .m7 directory for M7 system data (project-specific)
  const m7Dir = path.join(currentDir, '.m7');
  await fs.mkdir(m7Dir, { recursive: true });

  // Create README with M7 information (for humans)
  const readme = `# ${path.basename(currentDir)}

🚀 **M7 Methodology Project** - Systematic, Enterprise-Ready Development

## 🎯 Project Overview
This project follows the M7 IDEAL methodology for systematic feature development and debugging.

## 🔧 Getting Started
1. **Analyze any task**: \`@m7 analyze task "your task description"\`
2. **Follow the guidance**: M7 will route you through proper methodology
3. **Use Memory System**: \`@m7 recall memory\` to access project knowledge

## 📁 Structure
- \`memory-bank/\` - Project knowledge and context  
- \`docs/features/\` - Feature development documentation
- \`docs/debug/\` - Bug analysis and resolution
- \`.cursorrules\` - M7 methodology enforcement
- \`.m7/\` - M7 system data (auto-generated, project-specific)

## 🛠️ M7 Tools Available
- **Task Analysis**: \`@m7 analyze task\`
- **Memory Recall**: \`@m7 recall memory\`  
- **Pattern Storage**: \`@m7 store pattern\`
- **Project Updates**: \`@m7 update project memory\`
- **Visual Validation**: \`@m7 visual validate\`

## 🎯 Methodology
Follow the **Discovery → Architecture → Planning → Implementation** cycle for all work.

---
*Initialized with M7 MCP v3.4*`;

  await fs.writeFile(path.join(currentDir, 'README.md'), readme);
  createdFiles.push({path: 'README.md', description: 'Project documentation (for humans)'});

  // Create or update .gitignore to exclude .m7/ directory
  const gitignorePath = path.join(currentDir, '.gitignore');
  let gitignoreContent = '';
  
  try {
    const existingGitignore = await fs.readFile(gitignorePath, 'utf-8');
    gitignoreContent = existingGitignore;
  } catch {
    // File doesn't exist, will create new one
  }

  if (!gitignoreContent.includes('.m7/')) {
    gitignoreContent += '\n# M7 MCP System Data (project-specific)\n.m7/\n';
    await fs.writeFile(gitignorePath, gitignoreContent);
    createdFiles.push({path: '.gitignore', description: 'Updated to exclude .m7/ directory'});
  }

  // Add directory structure markers
  createdFiles.push({path: 'docs/features/', description: 'Feature development documentation'});
  createdFiles.push({path: 'docs/debug/', description: 'Bug analysis and resolution'});
  createdFiles.push({path: '.m7/', description: 'M7 system data (project-specific, git-ignored)'});
}

/**
 * Create INDEX.md for AI assistants
 * Contains structured information for AI navigation
 */
async function createAIIndex(
  currentDir: string,
  projectName: string,
  description: string,
  technologies: string[],
  domain: string,
  createdFiles: Array<{path: string, description: string}>
): Promise<void> {
  const indexContent = `# 📋 ${projectName} - AI Project Index

> **🤖 This file is for AI assistants.** For human documentation, see [README.md](./README.md)

---

## 📅 Last Updated: ${new Date().toISOString()}
## 🎯 Status: 🚧 Development

---

## 🎯 PROJECT OVERVIEW

**${projectName}** - ${description}

**Domain:** ${domain}
**Technologies:** ${technologies.join(', ')}

---

## 📁 PROJECT STRUCTURE

\`\`\`
${projectName}/
├── INDEX.md           ← AI navigation (you are here)
├── README.md          ← Human documentation
├── .cursorrules       ← M7 methodology rules
├── .gitignore         ← Git ignore patterns
├── .m7/               ← M7 system data (git-ignored)
├── memory-bank/       ← Project context and knowledge
│   ├── projectbrief.md
│   ├── productContext.md
│   ├── activeContext.md
│   ├── systemPatterns.md
│   ├── techContext.md
│   └── progress.md
└── docs/
    ├── features/      ← Feature development (M7 7-file structure)
    └── debug/         ← Bug analysis and resolution
\`\`\`

---

## 🔧 M7 WORKFLOW

### Starting a Task
\`\`\`
м7: описание задачи
\`\`\`
or
\`\`\`
@m7 analyze task "описание задачи"
\`\`\`

### Memory Operations
- **Search:** \`@m7 memory search query="topic"\`
- **Store Pattern:** \`@m7 store pattern\`
- **Update Project:** \`@m7 update project memory\`

### Navigation
- **Current Location:** \`@m7 navigate where_am_i\`
- **Show Roadmap:** \`@m7 navigate show_roadmap\`

---

## 📚 KEY FILES

| File | Purpose | Importance |
|------|---------|------------|
| \`INDEX.md\` | AI navigation and context | 🔴 Critical |
| \`README.md\` | Human documentation | 🟡 High |
| \`.cursorrules\` | M7 methodology enforcement | 🔴 Critical |
| \`memory-bank/activeContext.md\` | Current work focus | 🔴 Critical |
| \`memory-bank/progress.md\` | Task progress tracking | 🟡 High |

---

## ⚠️ IMPORTANT FOR AI

### Before ANY Task:
1. **Check this INDEX.md** for project structure
2. **Read activeContext.md** for current focus
3. **Use grep** before creating new functions
4. **Verify libraries** with Context7

### M7 7-File Methodology:
Every feature/bug gets 7 files in \`docs/features/\` or \`docs/debug/\`:
1. DISCOVERY_REPORT.md
2. ARCHITECTURE_CONTEXT.md
3. SOLUTION_PLAN.md
4. IMPACT_ANALYSIS.md
5. IMPLEMENTATION_SIMULATION.md
6. RISK_MITIGATION.md
7. IMPLEMENTATION_REPORT.md

### Anti-Patterns to Avoid:
- ❌ Creating duplicate functions without grep check
- ❌ Skipping Discovery phase
- ❌ Writing code before planning
- ❌ Ignoring existing patterns in memory-bank/

---

## 📊 PROJECT STATUS

### Completed ✅
- M7 ecosystem initialization

### In Progress 🔄
- Initial project setup

### Planned 📋
- First feature implementation

---

## 🔄 UPDATING THIS INDEX

This index should be updated when:
- New major components are added
- Project structure changes
- Technologies are updated
- Important patterns are discovered

\`\`\`
@m7 project index update
\`\`\`

---

*Generated by M7 MCP v3.4 - Cold Start System*
`;

  await fs.writeFile(path.join(currentDir, 'INDEX.md'), indexContent);
  createdFiles.push({path: 'INDEX.md', description: 'AI navigation index (for AI assistants)'});
}

/**
 * Create first M7 task structure
 */
async function createFirstTask(
  taskDescription: string | undefined,
  projectName: string
): Promise<{ folder: string; files: string[] } | null> {
  try {
    const result = await createM7StructureInternal({
      taskId: 'initial-project-setup',
      route: 'light',
      description: taskDescription || `Первоначальная настройка проекта ${projectName}`
    });
    
    if (result.success && result.folder && result.files) {
      return {
        folder: result.folder,
        files: result.files
      };
    }
    return null;
  } catch (error) {
    log.debug(`initProject] Failed to create first task: ${error}`);
    return null;
  }
}

/**
 * Internal function for Cold Start initialization
 * Called from analyzeTask when empty directory detected
 */
export async function initProjectInternal(params: {
  projectPath?: string;
  projectName?: string;
  description?: string;
  technologies?: string[];
  domain?: string;
  taskDescription?: string;
  journal?: JournalSystem;
  schema?: SchemaSystem;
}): Promise<ColdStartResult> {
  const currentDir = params.projectPath || getProjectPath();
  const projectName = params.projectName || path.basename(currentDir);
  const description = params.description || `${projectName} - M7 Methodology Project`;
  const technologies = params.technologies || ['To be determined'];
  const domain = params.domain || 'General';
  
  const createdFiles: Array<{path: string, description: string}> = [];
  
  try {
    log.error(`🚀 [Cold Start] Initializing M7 ecosystem in: ${currentDir}`);
    
    // 1. Create Memory Bank
    await createMemoryBank(currentDir, projectName, description, technologies, domain, createdFiles);
    
    // 2. Create .cursorrules
    await createCursorRules(currentDir, projectName, createdFiles);
    
    // 3. Create project structure (README.md, docs/, .m7/)
    await createProjectStructure(currentDir, createdFiles);
    
    // 4. Create INDEX.md for AI
    await createAIIndex(currentDir, projectName, description, technologies, domain, createdFiles);

    // 4.5. Create M7 Knowledge System (reference files + cursor rule)
    await createKnowledgeSystem(currentDir, projectName, description, technologies, domain, createdFiles);
    
    // 5. Initialize Unified Memory System
    try {
      const memory = await getMemoryCore(currentDir);
      
      // Store project metadata at L2
      await memory.store(JSON.stringify({
        type: 'project_metadata',
        name: projectName,
        description,
        purpose: `${projectName} project following M7 methodology`,
        mainTechnologies: technologies,
        architecture: 'To be determined during Discovery phase',
        keyFeatures: ['Initial setup complete'],
        businessDomain: domain,
        lastUpdated: new Date().toISOString()
      }), {
        level: 'L2',
        source: 'documentation',
        contextKeys: ['project', 'metadata'],
        confidence: 1.0
      });
      
      log.error(`✅ [Cold Start] Unified Memory initialized`);
      createdFiles.push({
        path: 'UnifiedMemory: L2 project indexed',
        description: 'Semantic memory for AI search'
      });
    } catch (e: any) {
      log.error(`⚠️ [Cold Start] Memory indexing skipped: ${e.message}`);
      // Don't fail the whole init if indexing fails
    }
    
    // 6. Log to journal if provided
    if (params.journal) {
      await params.journal.logFeature({
        name: 'M7 Cold Start Initialization',
        description: `Automatic M7 setup for ${projectName}`,
        implementation: `Cold Start detected empty directory and initialized M7 ecosystem`,
        lessons: ['Automated setup reduces onboarding time'],
        patterns: ['Cold Start', 'Auto-initialization'],
        complexity: 'light'
      });
    }
    
    // 7. Create first task
    const firstTask = await createFirstTask(params.taskDescription, projectName);
    
    log.error(`✅ [Cold Start] Initialization complete: ${createdFiles.length} files created`);
    
    return {
      success: true,
      projectPath: currentDir,
      projectName,
      filesCreated: createdFiles.map(f => f.path),
      firstTask: firstTask || undefined,
      memoryInitialized: true
    };
  } catch (error) {
    log.error(`❌ [Cold Start] Initialization failed: ${error}`);
    return {
      success: false,
      projectPath: currentDir,
      projectName,
      filesCreated: createdFiles.map(f => f.path),
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
} 