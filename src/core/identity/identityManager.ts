/**
 * M7 Project Identity Manager
 * 
 * Manages Project Identity System (PIS) — persistent project constraints
 * that prevent AI from generating code in wrong framework/version.
 * 
 * Features:
 * - Load/save identity from .m7/identity.json
 * - Auto-detect identity from project files (package.json, composer.json, etc.)
 * - Record failures and successes for accumulated wisdom
 * - Generate identity section for warmup reports
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ProjectIdentity,
  ProjectType,
  AccumulatedWisdom,
  FailureRecord,
  SuccessRecord,
  IDENTITY_FILE,
  IDENTITY_VERSION,
  MAX_FAILURES_TO_KEEP,
  MAX_SUCCESSES_TO_KEEP,
  MAX_INSIGHTS_TO_KEEP
} from '../types/identity.js';

const log = createLogger('[IdentityManager]');

/**
 * Identity Manager
 */
export class IdentityManager {
  private projectPath: string;
  private identityPath: string;
  private identity: ProjectIdentity | null = null;
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.identityPath = path.join(projectPath, IDENTITY_FILE);
  }
  
  /**
   * Load identity from file
   */
  async loadIdentity(): Promise<ProjectIdentity | null> {
    try {
      const content = await fs.readFile(this.identityPath, 'utf-8');
      this.identity = JSON.parse(content);
      log.debug(`Identity loaded for: ${this.identity?.project.name}`);
      return this.identity;
    } catch {
      log.debug(`No identity file found at: ${this.identityPath}`);
      return null;
    }
  }
  
  /**
   * Save identity to file
   */
  async saveIdentity(identity: ProjectIdentity): Promise<void> {
    const dir = path.dirname(this.identityPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.identityPath, JSON.stringify(identity, null, 2));
    this.identity = identity;
    log.debug(`Identity saved for: ${identity.project.name}`);
  }
  
  /**
   * Get or detect identity
   */
  async getOrDetectIdentity(): Promise<ProjectIdentity> {
    const existing = await this.loadIdentity();
    if (existing) return existing;
    
    const detected = await this.detectIdentity();
    await this.saveIdentity(detected);
    return detected;
  }
  
  /**
   * Auto-detect identity from project files
   */
  async detectIdentity(): Promise<ProjectIdentity> {
    const projectName = path.basename(this.projectPath);
    log.debug(`Detecting identity for: ${projectName}`);
    
    // Try to detect from package.json (Node.js)
    const nodeIdentity = await this.detectNodeIdentity();
    if (nodeIdentity) return nodeIdentity;
    
    // Try composer.json (PHP)
    const phpIdentity = await this.detectPhpIdentity();
    if (phpIdentity) return phpIdentity;
    
    // Try Cargo.toml (Rust)
    const rustIdentity = await this.detectRustIdentity();
    if (rustIdentity) return rustIdentity;
    
    // Try go.mod (Go)
    const goIdentity = await this.detectGoIdentity();
    if (goIdentity) return goIdentity;
    
    // Try pyproject.toml / requirements.txt (Python)
    const pythonIdentity = await this.detectPythonIdentity();
    if (pythonIdentity) return pythonIdentity;
    
    // Default identity
    log.debug(`Could not detect specific identity, using defaults`);
    return {
      version: IDENTITY_VERSION,
      lastUpdated: new Date().toISOString(),
      project: {
        name: projectName,
        type: 'other'
      },
      constraints: {
        language: 'Unknown',
        framework: 'Unknown'
      },
      forbidden: [],
      codingRules: [],
      criticalFiles: []
    };
  }
  
  /**
   * Detect Node.js/TypeScript identity
   */
  private async detectNodeIdentity(): Promise<ProjectIdentity | null> {
    try {
      const pkgPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Detect framework and type
      let framework = 'Node.js';
      let type: ProjectType = 'other';
      
      // MCP Server detection
      if (deps['@modelcontextprotocol/sdk']) {
        framework = 'MCP SDK ' + (deps['@modelcontextprotocol/sdk'] || '');
        type = 'mcp-server';
      }
      // Frontend frameworks
      else if (deps['next']) { 
        framework = `Next.js ${deps['next']}`; 
        type = 'fullstack'; 
      }
      else if (deps['nuxt']) { 
        framework = `Nuxt ${deps['nuxt']}`; 
        type = 'fullstack'; 
      }
      else if (deps['react']) { 
        framework = `React ${deps['react']}`; 
        type = 'frontend'; 
      }
      else if (deps['vue']) { 
        framework = `Vue ${deps['vue']}`; 
        type = 'frontend'; 
      }
      else if (deps['svelte']) { 
        framework = `Svelte ${deps['svelte']}`; 
        type = 'frontend'; 
      }
      // Backend frameworks
      else if (deps['express']) { 
        framework = `Express ${deps['express']}`; 
        type = 'backend-api'; 
      }
      else if (deps['fastify']) { 
        framework = `Fastify ${deps['fastify']}`; 
        type = 'backend-api'; 
      }
      else if (deps['@nestjs/core']) { 
        framework = `NestJS ${deps['@nestjs/core']}`; 
        type = 'backend-api'; 
      }
      // Electron
      else if (deps['electron']) {
        framework = `Electron ${deps['electron']}`;
        type = 'fullstack';
      }
      
      const language = deps['typescript'] 
        ? `TypeScript ${deps['typescript']}` 
        : 'JavaScript';
      
      // Coding rules based on dependencies
      const codingRules: string[] = [];
      if (deps['typescript']) {
        codingRules.push('Use strict TypeScript types');
        codingRules.push('Avoid any type');
      }
      if (deps['eslint']) {
        codingRules.push('Follow ESLint rules');
      }
      if (deps['prettier']) {
        codingRules.push('Format with Prettier');
      }
      
      const forbidden: string[] = [];
      if (deps['typescript']) {
        forbidden.push('Using any type without justification');
        forbidden.push('Ignoring TypeScript errors');
      }
      
      // Critical files
      const criticalFiles: string[] = ['package.json'];
      if (deps['typescript']) criticalFiles.push('tsconfig.json');
      
      log.debug(`Detected Node.js identity: ${pkg.name}, ${language}, ${framework}`);
      
      return {
        version: IDENTITY_VERSION,
        lastUpdated: new Date().toISOString(),
        project: {
          name: pkg.name || path.basename(this.projectPath),
          type,
          description: pkg.description
        },
        constraints: {
          language,
          framework,
          runtime: 'Node.js'
        },
        forbidden,
        codingRules,
        criticalFiles
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Detect PHP identity
   */
  private async detectPhpIdentity(): Promise<ProjectIdentity | null> {
    try {
      const composerPath = path.join(this.projectPath, 'composer.json');
      const content = await fs.readFile(composerPath, 'utf-8');
      const composer = JSON.parse(content);
      const require = composer.require || {};
      
      // Detect PHP version
      const phpVersion = require['php'] || 'Unknown';
      const phpMajor = phpVersion.match(/(\d+)/)?.[1] || '8';
      
      // Detect framework
      let framework = 'PHP';
      if (require['slim/slim']) framework = `Slim ${require['slim/slim']}`;
      else if (require['laravel/framework']) framework = `Laravel ${require['laravel/framework']}`;
      else if (require['symfony/framework-bundle']) framework = 'Symfony';
      else if (require['yiisoft/yii2']) framework = 'Yii2';
      
      // PHP 8+ specific rules
      const codingRules: string[] = ['PSR-12 code style'];
      const forbidden: string[] = [];
      
      if (parseInt(phpMajor) >= 8) {
        codingRules.push('Use typed properties');
        codingRules.push('Use constructor property promotion');
        codingRules.push('Use match expressions instead of switch');
        codingRules.push('Use named arguments where appropriate');
        
        forbidden.push('PHP 7 syntax');
        forbidden.push('Untyped properties');
        forbidden.push('mysql_* functions');
      }
      
      log.debug(`Detected PHP identity: ${composer.name}, PHP ${phpVersion}, ${framework}`);
      
      return {
        version: IDENTITY_VERSION,
        lastUpdated: new Date().toISOString(),
        project: {
          name: composer.name || path.basename(this.projectPath),
          type: 'backend-api',
          description: composer.description
        },
        constraints: {
          language: `PHP ${phpVersion.replace('^', '').replace('>=', '')}`,
          framework
        },
        forbidden,
        codingRules,
        criticalFiles: ['composer.json', 'public/index.php']
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Detect Rust identity
   */
  private async detectRustIdentity(): Promise<ProjectIdentity | null> {
    try {
      const cargoPath = path.join(this.projectPath, 'Cargo.toml');
      const content = await fs.readFile(cargoPath, 'utf-8');
      
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const editionMatch = content.match(/edition\s*=\s*"([^"]+)"/);
      
      log.debug(`Detected Rust identity: ${nameMatch?.[1]}`);
      
      return {
        version: IDENTITY_VERSION,
        lastUpdated: new Date().toISOString(),
        project: {
          name: nameMatch?.[1] || path.basename(this.projectPath),
          type: 'cli'
        },
        constraints: {
          language: `Rust ${editionMatch?.[1] || '2021'}`,
          framework: 'Cargo'
        },
        forbidden: ['unsafe without justification', 'unwrap in production code'],
        codingRules: ['Use clippy', 'Document public APIs', 'Handle errors with Result'],
        criticalFiles: ['Cargo.toml', 'src/main.rs', 'src/lib.rs']
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Detect Go identity
   */
  private async detectGoIdentity(): Promise<ProjectIdentity | null> {
    try {
      const goModPath = path.join(this.projectPath, 'go.mod');
      const content = await fs.readFile(goModPath, 'utf-8');
      
      const moduleMatch = content.match(/module\s+(.+)/);
      const goVersionMatch = content.match(/go\s+(\d+\.\d+)/);
      
      log.debug(`Detected Go identity: ${moduleMatch?.[1]}`);
      
      return {
        version: IDENTITY_VERSION,
        lastUpdated: new Date().toISOString(),
        project: {
          name: moduleMatch?.[1]?.split('/').pop() || path.basename(this.projectPath),
          type: 'backend-api'
        },
        constraints: {
          language: `Go ${goVersionMatch?.[1] || '1.21'}`,
          framework: 'Go modules'
        },
        forbidden: ['Ignoring errors', 'Global variables'],
        codingRules: ['Use gofmt', 'Handle all errors', 'Use interfaces'],
        criticalFiles: ['go.mod', 'main.go']
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Detect Python identity
   */
  private async detectPythonIdentity(): Promise<ProjectIdentity | null> {
    // Try pyproject.toml first
    try {
      const pyprojectPath = path.join(this.projectPath, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const pythonMatch = content.match(/python\s*=\s*"([^"]+)"/);
      
      log.debug(`Detected Python identity from pyproject.toml: ${nameMatch?.[1]}`);
      
      return {
        version: IDENTITY_VERSION,
        lastUpdated: new Date().toISOString(),
        project: {
          name: nameMatch?.[1] || path.basename(this.projectPath),
          type: 'backend-api'
        },
        constraints: {
          language: `Python ${pythonMatch?.[1]?.replace('^', '') || '3.x'}`,
          framework: 'Python'
        },
        forbidden: ['Print debugging in production'],
        codingRules: ['Use type hints', 'Follow PEP 8', 'Use virtual environments'],
        criticalFiles: ['pyproject.toml', 'requirements.txt']
      };
    } catch {}
    
    // Try requirements.txt
    try {
      const reqPath = path.join(this.projectPath, 'requirements.txt');
      await fs.access(reqPath);
      
      log.debug(`Detected Python identity from requirements.txt`);
      
      return {
        version: IDENTITY_VERSION,
        lastUpdated: new Date().toISOString(),
        project: {
          name: path.basename(this.projectPath),
          type: 'backend-api'
        },
        constraints: {
          language: 'Python 3.x',
          framework: 'Python'
        },
        forbidden: [],
        codingRules: ['Use type hints', 'Follow PEP 8'],
        criticalFiles: ['requirements.txt']
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Record a failure for accumulated wisdom
   */
  async recordFailure(description: string, lesson: string, wasM7Used: boolean): Promise<void> {
    let identity = await this.loadIdentity();
    if (!identity) {
      identity = await this.detectIdentity();
    }
    
    if (!identity.accumulatedWisdom) {
      identity.accumulatedWisdom = { failures: [], successes: [], insights: [] };
    }
    
    identity.accumulatedWisdom.failures.push({
      date: new Date().toISOString(),
      description,
      lesson,
      wasM7Used
    });
    
    // Keep only recent failures
    identity.accumulatedWisdom.failures = identity.accumulatedWisdom.failures.slice(-MAX_FAILURES_TO_KEEP);
    identity.lastUpdated = new Date().toISOString();
    
    await this.saveIdentity(identity);
    log.debug(`Recorded failure: ${description}`);
  }
  
  /**
   * Record a success
   */
  async recordSuccess(description: string, m7Phases: string[]): Promise<void> {
    let identity = await this.loadIdentity();
    if (!identity) {
      identity = await this.detectIdentity();
    }
    
    if (!identity.accumulatedWisdom) {
      identity.accumulatedWisdom = { failures: [], successes: [], insights: [] };
    }
    
    identity.accumulatedWisdom.successes.push({
      date: new Date().toISOString(),
      description,
      m7Phases
    });
    
    // Keep only recent successes
    identity.accumulatedWisdom.successes = identity.accumulatedWisdom.successes.slice(-MAX_SUCCESSES_TO_KEEP);
    identity.lastUpdated = new Date().toISOString();
    
    await this.saveIdentity(identity);
    log.debug(`Recorded success: ${description}`);
  }
  
  /**
   * Add an insight
   */
  async addInsight(insight: string): Promise<void> {
    let identity = await this.loadIdentity();
    if (!identity) {
      identity = await this.detectIdentity();
    }
    
    if (!identity.accumulatedWisdom) {
      identity.accumulatedWisdom = { failures: [], successes: [], insights: [] };
    }
    
    if (!identity.accumulatedWisdom.insights.includes(insight)) {
      identity.accumulatedWisdom.insights.push(insight);
      identity.accumulatedWisdom.insights = identity.accumulatedWisdom.insights.slice(-MAX_INSIGHTS_TO_KEEP);
      identity.lastUpdated = new Date().toISOString();
      await this.saveIdentity(identity);
    }
  }
  
  /**
   * Generate identity section for warmup report
   */
  async generateSection(): Promise<string> {
    const identity = await this.loadIdentity() || await this.detectIdentity();
    
    let section = `## 🆔 Project Identity\n\n`;
    section += `| Constraint | Value |\n`;
    section += `|------------|-------|\n`;
    section += `| **Language** | ${identity.constraints.language} |\n`;
    section += `| **Framework** | ${identity.constraints.framework} |\n`;
    
    if (identity.constraints.database) {
      section += `| **Database** | ${identity.constraints.database} |\n`;
    }
    
    if (identity.constraints.runtime) {
      section += `| **Runtime** | ${identity.constraints.runtime} |\n`;
    }
    
    if (identity.constraints.migrations) {
      const m = identity.constraints.migrations;
      const statusIcon = m.status === 'completed' ? '✅' : '🔄';
      section += `| **Migration** | ${statusIcon} ${m.from} → ${m.to} |\n`;
    }
    
    section += `\n`;
    
    if (identity.forbidden.length > 0) {
      section += `### ⛔ FORBIDDEN in this project:\n`;
      for (const f of identity.forbidden) {
        section += `- ${f}\n`;
      }
      section += `\n`;
    }
    
    if (identity.codingRules.length > 0) {
      section += `### 📏 Coding Rules:\n`;
      for (const r of identity.codingRules) {
        section += `- ${r}\n`;
      }
      section += `\n`;
    }
    
    if (identity.criticalFiles.length > 0) {
      section += `### 📄 Critical Files:\n`;
      for (const f of identity.criticalFiles) {
        section += `- \`${f}\`\n`;
      }
      section += `\n`;
    }
    
    return section;
  }
  
  /**
   * Generate accumulated wisdom section for warmup report
   */
  async generateWisdomSection(): Promise<string> {
    const identity = await this.loadIdentity();
    if (!identity?.accumulatedWisdom) {
      return '';
    }
    
    const wisdom = identity.accumulatedWisdom;
    if (wisdom.failures.length === 0 && wisdom.successes.length === 0 && wisdom.insights.length === 0) {
      return '';
    }
    
    let section = `## 📚 Accumulated Wisdom\n\n`;
    section += `**История этого проекта:**\n\n`;
    
    // Show last 3 failures
    for (const f of wisdom.failures.slice(-3)) {
      const m7Icon = f.wasM7Used ? '🔄' : '❌';
      const dateShort = new Date(f.date).toLocaleDateString();
      section += `${m7Icon} **${dateShort}**: ${f.description}\n`;
      section += `   → Урок: ${f.lesson}\n\n`;
    }
    
    // Show last 2 successes
    for (const s of wisdom.successes.slice(-2)) {
      const dateShort = new Date(s.date).toLocaleDateString();
      section += `✅ **${dateShort}**: ${s.description}\n`;
      if (s.m7Phases.length > 0) {
        section += `   → Фазы M7: ${s.m7Phases.join(' → ')}\n\n`;
      }
    }
    
    // Show insights
    if (wisdom.insights.length > 0) {
      section += `**Инсайты:**\n`;
      for (const i of wisdom.insights.slice(-3)) {
        section += `- ${i}\n`;
      }
      section += `\n`;
    }
    
    // Add conclusion if there are failures without M7
    const nonM7Failures = wisdom.failures.filter(f => !f.wasM7Used);
    if (nonM7Failures.length >= 2) {
      section += `**⚠️ Вывод**: ${nonM7Failures.length} провалов без M7 — методология обязательна.\n\n`;
    }
    
    return section;
  }
}

/**
 * Factory function to get IdentityManager for a project
 */
export function getIdentityManager(projectPath: string): IdentityManager {
  return new IdentityManager(projectPath);
}
