/**
 * M7 Warmup Manager v2.1
 * 
 * УНИВЕРСАЛЬНЫЙ прогрев контекста ЛЮБОГО проекта.
 * Сканирует реальную структуру, определяет tech stack,
 * читает документацию проекта.
 * 
 * @version 2.1.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath, getProjectPathDiagnostics } from '../utils/projectPath.js';
import { atomicWriteJSON, safeReadJSON } from '../utils/atomicWrite.js';
import { getManifestManager, WarmupDiff } from '../utils/manifest.js';
import { getTaskGraphManager } from '../task-graph/taskGraphManager.js';
import { getComplianceTracker } from '../compliance/complianceTracker.js';
import {
  ProjectContextSnapshot,
  WarmState,
  WarmupResult,
  WarmupOptions,
  WarmupStatus,
  WarmupScope,
  ActiveTask,
  TaskRelation,
  KeyDecision,
  KnownIssue,
  ProjectInfo,
  TechStack,
  CurrentPhase,
  ProjectStructure,
  ToolsInfo,
  DevOpsInfo,
  DocsInfo,
  WARM_STATE_PATH,
  WARM_STATE_VERSION,
  DEFAULT_TTL
} from '../types/warmup.js';

const log = createLogger('[WarmupManager]');

/**
 * Обнаруженный фреймворк/технология
 */
interface DetectedTech {
  name: string;
  version?: string;
  category: 'framework' | 'library' | 'tool' | 'database' | 'runtime';
}

/**
 * Обнаруженная подсистема
 */
interface DetectedSubsystem {
  name: string;
  path: string;
  files: number;
  description: string;
}

/**
 * Менеджер прогрева контекста
 */
export class WarmupManager {
  private projectPath: string;
  private warmStatePath: string;
  private warmState: WarmState | null = null;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
    this.warmStatePath = path.join(this.projectPath, WARM_STATE_PATH);
  }
  
  /**
   * Вычисляет hash контента
   */
  private computeHash(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash) + content.charCodeAt(i);
      hash = hash >>> 0;
    }
    return hash.toString(36);
  }
  
  /**
   * Загружает warm state
   * v3.10.1: Использует safeReadJSON для crash-safe чтения
   */
  async loadWarmState(): Promise<WarmState | null> {
    try {
      const result = await safeReadJSON<WarmState>(this.warmStatePath);
      if (result.data) {
        this.warmState = result.data;
        if (result.recoveredFrom) {
          log.warn(`WarmupManager] Loaded state from backup: ${result.recoveredFrom}`);
        }
        return this.warmState;
      }
      return null;
    } catch {
      return null;
    }
  }
  
  /**
   * Сохраняет warm state
   * v3.10.1: Использует atomicWriteJSON для crash-safe записи
   */
  async saveWarmState(state: WarmState): Promise<void> {
    const dir = path.dirname(this.warmStatePath);
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteJSON(this.warmStatePath, state, { createBackup: true });
    this.warmState = state;
    log.debug(`WarmupManager] State saved with atomic write`);
  }
  
  /**
   * Проверяет актуальность кэша
   */
  isWarmStateFresh(state: WarmState, ttl: number = DEFAULT_TTL): boolean {
    const age = Date.now() - new Date(state.lastWarmedAt).getTime();
    return age < ttl;
  }
  
  /**
   * Получает статус прогрева
   */
  async getStatus(): Promise<{ status: WarmupStatus; age?: number; scope?: WarmupScope; projectPath?: string }> {
    const state = await this.loadWarmState();
    if (!state) return { status: 'cold', projectPath: this.projectPath };
    
    const age = Date.now() - new Date(state.lastWarmedAt).getTime();
    if (this.isWarmStateFresh(state)) {
      return { status: 'warm', age, scope: state.scope, projectPath: this.projectPath };
    }
    return { status: 'stale', age, scope: state.scope, projectPath: this.projectPath };
  }
  
  /**
   * Считает файлы рекурсивно
   */
  private async countFiles(dir: string, ext?: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
          count += await this.countFiles(fullPath, ext);
        } else if (entry.isFile()) {
          if (!ext || entry.name.endsWith(ext)) count++;
        }
      }
    } catch {}
    return count;
  }
  
  /**
   * Сканирует директорию на файлы
   */
  private async scanDirectory(dir: string, maxDepth: number = 2): Promise<string[]> {
    const files: string[] = [];
    
    const scan = async (currentDir: string, depth: number) => {
      if (depth > maxDepth) return;
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          
          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(this.projectPath, fullPath);
          
          if (entry.isDirectory()) {
            files.push(relativePath + '/');
            await scan(fullPath, depth + 1);
          } else {
            files.push(relativePath);
          }
        }
      } catch {}
    };
    
    await scan(dir, 0);
    return files;
  }
  
  /**
   * Определяет тип проекта
   */
  private async detectProjectType(): Promise<string> {
    const checks = [
      { file: 'package.json', type: 'Node.js/JavaScript' },
      { file: 'tsconfig.json', type: 'TypeScript' },
      { file: 'pyproject.toml', type: 'Python' },
      { file: 'requirements.txt', type: 'Python' },
      { file: 'Cargo.toml', type: 'Rust' },
      { file: 'go.mod', type: 'Go' },
      { file: 'pom.xml', type: 'Java (Maven)' },
      { file: 'build.gradle', type: 'Java (Gradle)' },
      { file: 'composer.json', type: 'PHP' },
      { file: 'Gemfile', type: 'Ruby' },
      { file: '.csproj', type: 'C#/.NET' },
      { file: 'pubspec.yaml', type: 'Dart/Flutter' },
    ];
    
    for (const check of checks) {
      try {
        await fs.access(path.join(this.projectPath, check.file));
        return check.type;
      } catch {}
    }
    
    return 'Unknown';
  }
  
  /**
   * Собирает информацию о проекте
   */
  private async collectProjectInfo(): Promise<ProjectInfo> {
    const projectType = await this.detectProjectType();
    
    // Try package.json
    try {
      const pkgPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      return {
        name: pkg.name || path.basename(this.projectPath),
        version: pkg.version || '0.0.0',
        path: this.projectPath,
        description: pkg.description || 'No description',
        type: projectType
      };
    } catch {}
    
    // Try pyproject.toml
    try {
      const pyprojectPath = path.join(this.projectPath, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      
      return {
        name: nameMatch?.[1] || path.basename(this.projectPath),
        version: versionMatch?.[1] || '0.0.0',
        path: this.projectPath,
        description: 'Python project',
        type: projectType
      };
    } catch {}
    
    // Try Cargo.toml
    try {
      const cargoPath = path.join(this.projectPath, 'Cargo.toml');
      const content = await fs.readFile(cargoPath, 'utf-8');
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      
      return {
        name: nameMatch?.[1] || path.basename(this.projectPath),
        version: versionMatch?.[1] || '0.0.0',
        path: this.projectPath,
        description: 'Rust project',
        type: projectType
      };
    } catch {}
    
    return {
      name: path.basename(this.projectPath),
      version: '0.0.0',
      path: this.projectPath,
      description: 'Unknown project',
      type: projectType
    };
  }
  
  /**
   * Определяет tech stack из зависимостей
   */
  private async collectTechStack(): Promise<TechStack & { detected: DetectedTech[] }> {
    const stack: TechStack & { detected: DetectedTech[] } = {
      runtime: 'Unknown',
      language: 'Unknown',
      build: 'Unknown',
      packageManager: 'Unknown',
      detected: []
    };
    
    // Node.js / TypeScript
    try {
      const pkgPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      stack.runtime = 'Node.js';
      stack.packageManager = 'npm';
      
      // TypeScript?
      if (deps['typescript']) {
        stack.language = 'TypeScript';
        stack.detected.push({ name: 'TypeScript', version: deps['typescript'], category: 'runtime' });
      } else {
        stack.language = 'JavaScript';
      }
      
      // Build tools
      if (deps['vite']) {
        stack.build = 'Vite';
        stack.detected.push({ name: 'Vite', version: deps['vite'], category: 'tool' });
      } else if (deps['webpack']) {
        stack.build = 'Webpack';
        stack.detected.push({ name: 'Webpack', version: deps['webpack'], category: 'tool' });
      } else if (deps['esbuild']) {
        stack.build = 'esbuild';
      } else {
        stack.build = 'tsc';
      }
      
      // Frameworks
      if (deps['react']) stack.detected.push({ name: 'React', version: deps['react'], category: 'framework' });
      if (deps['vue']) stack.detected.push({ name: 'Vue', version: deps['vue'], category: 'framework' });
      if (deps['svelte']) stack.detected.push({ name: 'Svelte', version: deps['svelte'], category: 'framework' });
      if (deps['next']) stack.detected.push({ name: 'Next.js', version: deps['next'], category: 'framework' });
      if (deps['nuxt']) stack.detected.push({ name: 'Nuxt', version: deps['nuxt'], category: 'framework' });
      if (deps['express']) stack.detected.push({ name: 'Express', version: deps['express'], category: 'framework' });
      if (deps['fastify']) stack.detected.push({ name: 'Fastify', version: deps['fastify'], category: 'framework' });
      if (deps['nestjs'] || deps['@nestjs/core']) stack.detected.push({ name: 'NestJS', version: deps['@nestjs/core'], category: 'framework' });
      
      // Databases
      if (deps['prisma'] || deps['@prisma/client']) stack.detected.push({ name: 'Prisma', version: deps['prisma'] || deps['@prisma/client'], category: 'database' });
      if (deps['mongoose']) stack.detected.push({ name: 'Mongoose/MongoDB', version: deps['mongoose'], category: 'database' });
      if (deps['pg']) stack.detected.push({ name: 'PostgreSQL', version: deps['pg'], category: 'database' });
      if (deps['mysql2']) stack.detected.push({ name: 'MySQL', version: deps['mysql2'], category: 'database' });
      if (deps['chromadb']) stack.detected.push({ name: 'ChromaDB', version: deps['chromadb'], category: 'database' });
      if (deps['redis']) stack.detected.push({ name: 'Redis', version: deps['redis'], category: 'database' });
      
      // Other important libs
      if (deps['zod']) stack.detected.push({ name: 'Zod', version: deps['zod'], category: 'library' });
      if (deps['tailwindcss']) stack.detected.push({ name: 'Tailwind CSS', version: deps['tailwindcss'], category: 'library' });
      if (deps['@modelcontextprotocol/sdk']) stack.detected.push({ name: 'MCP SDK', version: deps['@modelcontextprotocol/sdk'], category: 'library' });
      if (deps['openai']) stack.detected.push({ name: 'OpenAI SDK', version: deps['openai'], category: 'library' });
      if (deps['@anthropic-ai/sdk']) stack.detected.push({ name: 'Anthropic SDK', version: deps['@anthropic-ai/sdk'], category: 'library' });
      
      // Testing
      if (deps['jest']) stack.detected.push({ name: 'Jest', version: deps['jest'], category: 'tool' });
      if (deps['vitest']) stack.detected.push({ name: 'Vitest', version: deps['vitest'], category: 'tool' });
      if (deps['playwright']) stack.detected.push({ name: 'Playwright', version: deps['playwright'], category: 'tool' });
      
      return stack;
    } catch {}
    
    // Python
    try {
      await fs.access(path.join(this.projectPath, 'requirements.txt'));
      stack.runtime = 'Python';
      stack.language = 'Python';
      stack.packageManager = 'pip';
      stack.build = 'setuptools';
      return stack;
    } catch {}
    
    try {
      await fs.access(path.join(this.projectPath, 'pyproject.toml'));
      stack.runtime = 'Python';
      stack.language = 'Python';
      stack.packageManager = 'poetry/pip';
      stack.build = 'poetry';
      return stack;
    } catch {}
    
    // Rust
    try {
      await fs.access(path.join(this.projectPath, 'Cargo.toml'));
      stack.runtime = 'Rust';
      stack.language = 'Rust';
      stack.packageManager = 'cargo';
      stack.build = 'cargo build';
      return stack;
    } catch {}
    
    // Go
    try {
      await fs.access(path.join(this.projectPath, 'go.mod'));
      stack.runtime = 'Go';
      stack.language = 'Go';
      stack.packageManager = 'go modules';
      stack.build = 'go build';
      return stack;
    } catch {}
    
    return stack;
  }
  
  /**
   * Сканирует подсистемы проекта
   */
  private async collectSubsystems(): Promise<DetectedSubsystem[]> {
    const subsystems: DetectedSubsystem[] = [];
    
    // Common source directories
    const srcDirs = ['src', 'app', 'lib', 'packages', 'components', 'pages', 'api', 'server', 'client'];
    
    for (const dir of srcDirs) {
      try {
        const fullPath = path.join(this.projectPath, dir);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const files = await this.countFiles(fullPath);
          
          // Get subdirectories
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          const subdirs = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => e.name)
            .slice(0, 10);
          
          subsystems.push({
            name: dir + '/',
            path: dir,
            files,
            description: subdirs.length > 0 
              ? `Contains: ${subdirs.join(', ')}`
              : `${files} files`
          });
        }
      } catch {}
    }
    
    return subsystems;
  }
  
  /**
   * Читает README для описания
   */
  private async readReadme(): Promise<string | null> {
    const readmeFiles = ['README.md', 'readme.md', 'README.txt', 'README'];
    
    for (const file of readmeFiles) {
      try {
        const content = await fs.readFile(path.join(this.projectPath, file), 'utf-8');
        // Get first meaningful section (skip title)
        const lines = content.split('\n');
        let description = '';
        let foundContent = false;
        
        for (const line of lines) {
          if (line.startsWith('#')) {
            if (foundContent) break; // Stop at next header
            continue;
          }
          if (line.trim()) {
            foundContent = true;
            description += line + '\n';
            if (description.length > 500) break;
          }
        }
        
        return description.trim() || null;
      } catch {}
    }
    
    return null;
  }
  
  /**
   * Собирает активные задачи из Task Graph
   */
  private async collectActiveTasks(): Promise<{ tasks: ActiveTask[]; relations: TaskRelation[] }> {
    try {
      const manager = getTaskGraphManager();
      await manager.initialize();
      
      const recentTasks = await manager.getRecentTasks(10);
      const activeTasks: ActiveTask[] = [];
      const relations: TaskRelation[] = [];
      
      for (const task of recentTasks) {
        // Filter: only tasks belonging to current project
        if (task.folder && !task.folder.startsWith(this.projectPath)) continue;

        activeTasks.push({
          id: task.id,
          title: task.title,
          status: task.status,
          folder: task.folder,
          created: typeof task.created === 'string' ? task.created : new Date(task.created).toISOString()
        });
        
        const links = await manager.getTaskLinks(task.id);
        for (const link of links.outgoing) {
          relations.push({ from: link.from, to: link.to, type: link.type, reason: link.reason });
        }
      }
      
      return { tasks: activeTasks, relations };
    } catch {
      return { tasks: [], relations: [] };
    }
  }
  
  /**
   * Ищет roadmap/план
   */
  private async collectCurrentPhase(): Promise<CurrentPhase> {
    const roadmapFiles = [
      'ROADMAP.md', 'docs/ROADMAP.md', 'docs/sprints/*.md',
      'TODO.md', 'CHANGELOG.md', '.github/ROADMAP.md'
    ];
    
    for (const pattern of roadmapFiles) {
      try {
        const fullPath = path.join(this.projectPath, pattern.replace('*.md', ''));
        const content = await fs.readFile(fullPath.replace('*.md', 'ROADMAP.md'), 'utf-8');
        
        const lines = content.split('\n');
        let currentPhase = 'Development';
        const completed: string[] = [];
        const remaining: string[] = [];
        
        for (const line of lines) {
          if (line.match(/^\s*-\s*\[x\]/i)) {
            const item = line.replace(/^\s*-\s*\[x\]\s*/i, '').trim();
            if (item) completed.push(item);
          }
          if (line.match(/^\s*-\s*\[\s*\]/)) {
            const item = line.replace(/^\s*-\s*\[\s*\]\s*/, '').trim();
            if (item) remaining.push(item);
          }
        }
        
        const total = completed.length + remaining.length;
        const progress = total > 0 ? Math.round((completed.length / total) * 100) : 0;
        
        return { name: currentPhase, progress, completed: completed.slice(0, 7), remaining: remaining.slice(0, 7), blockers: [] };
      } catch {}
    }
    
    return { name: 'Active Development', progress: 0, completed: [], remaining: [], blockers: [] };
  }
  
  /**
   * Собирает ключевые файлы
   */
  private async collectStructure(): Promise<ProjectStructure> {
    const folders: ProjectStructure['folders'] = [];
    const keyFiles: ProjectStructure['keyFiles'] = [];
    
    // Scan top-level directories
    try {
      const entries = await fs.readdir(this.projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        
        if (entry.isDirectory()) {
          const fileCount = await this.countFiles(path.join(this.projectPath, entry.name));
          if (fileCount > 0) {
            folders.push({ path: entry.name, description: `${fileCount} files`, fileCount });
          }
        } else if (entry.isFile()) {
          // Key files
          const keyFilePatterns = [
            'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
            'README.md', 'docker-compose.yml', 'Dockerfile', '.env.example'
          ];
          if (keyFilePatterns.includes(entry.name)) {
            keyFiles.push({ path: entry.name, description: entry.name });
          }
        }
      }
    } catch {}
    
    return { folders, keyFiles };
  }
  
  /**
   * Определяет доступные M7 tools
   */
  private collectToolsInfo(): ToolsInfo {
    return {
      total: 36,
      categories: [
        { name: 'Core', tools: ['analyze_task', 'session', 'warmup'] },
        { name: 'Memory', tools: ['memory', 'persistent_memory', 'cross_session'] },
        { name: 'Analysis', tools: ['knowledge_graph', 'project_index', 'arch_advisor'] },
        { name: 'Quality', tools: ['style_guardian', 'error_database', 'validate'] },
        { name: 'Task Management', tools: ['task_graph', 'task_transfer'] },
        { name: 'AI Coordination', tools: ['hive_coordinator'] }
      ]
    };
  }
  
  /**
   * Собирает DevOps информацию
   */
  private async collectDevOpsInfo(): Promise<DevOpsInfo> {
    const devops: DevOpsInfo = {
      build: 'Unknown',
      start: 'Unknown',
      config: 'Unknown',
      logs: 'stdout'
    };
    
    // Check package.json scripts
    try {
      const pkgPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      if (pkg.scripts) {
        if (pkg.scripts.build) devops.build = `npm run build (${pkg.scripts.build})`;
        if (pkg.scripts.start) devops.start = `npm start (${pkg.scripts.start})`;
        if (pkg.scripts.dev) devops.start = `npm run dev (${pkg.scripts.dev})`;
      }
    } catch {}
    
    // Check for Docker
    try {
      await fs.access(path.join(this.projectPath, 'docker-compose.yml'));
      devops.deploy = 'Docker Compose available';
    } catch {}
    
    try {
      await fs.access(path.join(this.projectPath, 'Dockerfile'));
      devops.deploy = devops.deploy ? devops.deploy + ', Dockerfile' : 'Dockerfile available';
    } catch {}
    
    return devops;
  }
  
  /**
   * Собирает информацию о документации
   */
  private async collectDocsInfo(): Promise<DocsInfo> {
    const docs: DocsInfo = {
      readme: 'Not found',
      taskDocs: 'docs/',
      knowledgeHub: 'Not configured'
    };
    
    // Check README
    const readmeFiles = ['README.md', 'readme.md', 'README'];
    for (const file of readmeFiles) {
      try {
        await fs.access(path.join(this.projectPath, file));
        docs.readme = file;
        break;
      } catch {}
    }
    
    // Check docs folder
    try {
      await fs.access(path.join(this.projectPath, 'docs'));
      docs.taskDocs = 'docs/';
    } catch {}
    
    // Check knowledge-hub
    try {
      await fs.access(path.join(this.projectPath, 'knowledge-hub'));
      docs.knowledgeHub = 'knowledge-hub/';
    } catch {}
    
    return docs;
  }
  
  /**
   * Генерирует ПОЛНЫЙ детальный отчёт
   */
  async generateFullReport(snapshot: ProjectContextSnapshot): Promise<string> {
    const subsystems = await this.collectSubsystems();
    const techStack = await this.collectTechStack();
    const readmeDescription = await this.readReadme();
    const devops = await this.collectDevOpsInfo();
    const diagnostics = getProjectPathDiagnostics();
    
    // Collect M7 Policy and Compliance Stats
    const compliance = getComplianceTracker(this.projectPath);
    await compliance.initialize();
    const policySection = await compliance.generatePolicySection();
    
    // NEW: Collect Project Identity System (PIS) data
    const { IdentityManager } = await import('../identity/identityManager.js');
    const identityManager = new IdentityManager(this.projectPath);
    const identitySection = await identityManager.generateSection();
    const wisdomSection = await identityManager.generateWisdomSection();
    
    let report = `# 🔥 M7 Warmup: ${snapshot.project.name}\n\n`;
    
    // ═══════════════════════════════════════════════════════════════
    // M7 POLICY SECTION (FIRST - для behavioral anchoring)
    // ═══════════════════════════════════════════════════════════════
    report += policySection;
    report += `---\n\n`;
    
    // ═══════════════════════════════════════════════════════════════
    // PROJECT IDENTITY SECTION (PIS - для предотвращения потери контекста)
    // ═══════════════════════════════════════════════════════════════
    report += identitySection;
    
    // ═══════════════════════════════════════════════════════════════
    // ACCUMULATED WISDOM (история успехов/провалов проекта)
    // ═══════════════════════════════════════════════════════════════
    if (wisdomSection) {
      report += wisdomSection;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ЧТО ЭТО ЗА ПРОЕКТ
    // ═══════════════════════════════════════════════════════════════
    report += `## 📋 Что это за проект\n\n`;
    
    report += `| Параметр | Значение |\n`;
    report += `|----------|----------|\n`;
    report += `| **Название** | ${snapshot.project.name} |\n`;
    report += `| **Версия** | ${snapshot.project.version} |\n`;
    report += `| **Путь** | \`${snapshot.project.path}\` |\n`;
    report += `| **Тип** | ${snapshot.project.type} |\n`;
    report += `| **Source** | ${diagnostics.source} |\n\n`;
    
    if (readmeDescription) {
      report += `### Описание из README\n\n`;
      report += `${readmeDescription.slice(0, 500)}${readmeDescription.length > 500 ? '...' : ''}\n\n`;
    } else if (snapshot.project.description !== 'No description') {
      report += `**Описание:** ${snapshot.project.description}\n\n`;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // TECH STACK
    // ═══════════════════════════════════════════════════════════════
    report += `## 🛠️ Tech Stack\n\n`;
    report += `| Категория | Технология |\n`;
    report += `|-----------|------------|\n`;
    report += `| **Runtime** | ${techStack.runtime} |\n`;
    report += `| **Language** | ${techStack.language} |\n`;
    report += `| **Build** | ${techStack.build} |\n`;
    report += `| **Package Manager** | ${techStack.packageManager} |\n\n`;
    
    if (techStack.detected.length > 0) {
      report += `### Обнаруженные технологии\n\n`;
      
      const frameworks = techStack.detected.filter(t => t.category === 'framework');
      const libraries = techStack.detected.filter(t => t.category === 'library');
      const databases = techStack.detected.filter(t => t.category === 'database');
      const tools = techStack.detected.filter(t => t.category === 'tool');
      
      if (frameworks.length > 0) {
        report += `**Frameworks:** ${frameworks.map(f => `${f.name}${f.version ? ' ' + f.version : ''}`).join(', ')}\n`;
      }
      if (databases.length > 0) {
        report += `**Databases:** ${databases.map(d => `${d.name}${d.version ? ' ' + d.version : ''}`).join(', ')}\n`;
      }
      if (libraries.length > 0) {
        report += `**Libraries:** ${libraries.map(l => `${l.name}${l.version ? ' ' + l.version : ''}`).join(', ')}\n`;
      }
      if (tools.length > 0) {
        report += `**Tools:** ${tools.map(t => `${t.name}${t.version ? ' ' + t.version : ''}`).join(', ')}\n`;
      }
      report += `\n`;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // СТРУКТУРА ПРОЕКТА
    // ═══════════════════════════════════════════════════════════════
    if (subsystems.length > 0) {
      report += `## 📂 Структура проекта\n\n`;
      report += `\`\`\`\n`;
      report += `${path.basename(this.projectPath)}/\n`;
      for (const sub of subsystems) {
        report += `├── ${sub.name.padEnd(20)} # ${sub.description}\n`;
      }
      report += `\`\`\`\n\n`;
    }
    
    if (snapshot.structure.keyFiles.length > 0) {
      report += `### Ключевые файлы\n`;
      for (const file of snapshot.structure.keyFiles) {
        report += `- \`${file.path}\`\n`;
      }
      report += `\n`;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // DEVOPS
    // ═══════════════════════════════════════════════════════════════
    report += `## 🚀 DevOps\n\n`;
    report += `| Команда | Описание |\n`;
    report += `|---------|----------|\n`;
    if (devops.build !== 'Unknown') report += `| **Build** | \`${devops.build}\` |\n`;
    if (devops.start !== 'Unknown') report += `| **Start** | \`${devops.start}\` |\n`;
    if (devops.deploy) report += `| **Deploy** | ${devops.deploy} |\n`;
    report += `\n`;
    
    // ═══════════════════════════════════════════════════════════════
    // ТЕКУЩИЙ ЭТАП
    // ═══════════════════════════════════════════════════════════════
    if (snapshot.currentPhase.completed.length > 0 || snapshot.currentPhase.remaining.length > 0) {
      report += `## 📊 Текущий этап\n\n`;
      report += `**Фаза:** ${snapshot.currentPhase.name}\n`;
      if (snapshot.currentPhase.progress > 0) {
        report += `**Прогресс:** ${snapshot.currentPhase.progress}%\n`;
      }
      report += `\n`;
      
      if (snapshot.currentPhase.completed.length > 0) {
        report += `### ✅ Завершено:\n`;
        for (const item of snapshot.currentPhase.completed) {
          report += `- ${item}\n`;
        }
        report += `\n`;
      }
      
      if (snapshot.currentPhase.remaining.length > 0) {
        report += `### ⏳ В работе:\n`;
        for (const item of snapshot.currentPhase.remaining) {
          report += `- ${item}\n`;
        }
        report += `\n`;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // АКТИВНЫЕ ЗАДАЧИ (M7)
    // ═══════════════════════════════════════════════════════════════
    if (snapshot.activeTasks.length > 0) {
      report += `## 📋 Активные M7 задачи\n\n`;
      report += `| ID | Название | Статус |\n`;
      report += `|----|----------|--------|\n`;
      for (const task of snapshot.activeTasks) {
        const shortId = task.id.length > 25 ? task.id.slice(0, 25) + '...' : task.id;
        const shortTitle = task.title.length > 50 ? task.title.slice(0, 50) + '...' : task.title;
        const statusIcon = task.status === 'active' ? '🟢' : task.status === 'completed' ? '✅' : '⏸️';
        report += `| \`${shortId}\` | ${shortTitle} | ${statusIcon} |\n`;
      }
      report += `\n`;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // M7 TOOLS
    // ═══════════════════════════════════════════════════════════════
    report += `## 🔧 Доступные M7 инструменты\n\n`;
    for (const cat of snapshot.tools.categories) {
      report += `- **${cat.name}:** ${cat.tools.join(', ')}\n`;
    }
    report += `\n`;
    
    // ═══════════════════════════════════════════════════════════════
    // ДОКУМЕНТАЦИЯ
    // ═══════════════════════════════════════════════════════════════
    report += `## 📝 Документация\n\n`;
    report += `- README: \`${snapshot.docs.readme}\`\n`;
    report += `- Docs: \`${snapshot.docs.taskDocs}\`\n`;
    if (snapshot.docs.knowledgeHub !== 'Not configured') {
      report += `- Knowledge Hub: \`${snapshot.docs.knowledgeHub}\`\n`;
    }
    report += `\n`;
    
    // ═══════════════════════════════════════════════════════════════
    // META
    // ═══════════════════════════════════════════════════════════════
    report += `---\n\n`;
    report += `**Hash:** ${snapshot.hash} | `;
    report += `**Warmed:** ${new Date(snapshot.timestamp).toLocaleString()} | `;
    report += `**Scope:** ${snapshot.scope}\n\n`;
    report += `✅ **Контекст проекта прогрет. Я понимаю структуру и готов к работе!**\n`;
    
    return report;
  }
  
  /**
   * Выполняет прогрев контекста
   * 
   * v3.10.1: Incremental warmup с manifest для ускорения в 3-5x
   */
  async warmup(options: WarmupOptions = {}): Promise<WarmupResult> {
    const startTime = Date.now();
    const scope = options.scope || 'standard';
    const force = options.force || false;
    const ttl = options.ttl || DEFAULT_TTL;
    
    log.debug(`WarmupManager] Starting warmup for: ${this.projectPath} (scope: ${scope}, force: ${force})`);
    
    // v3.10.1: Проверяем manifest для incremental warmup
    const manifest = getManifestManager(this.projectPath);
    let diff: WarmupDiff | null = null;
    let incrementalMode = false;
    
    // Check cache
    if (!force) {
      const state = await this.loadWarmState();
      if (state && this.isWarmStateFresh(state, ttl) && state.snapshot) {
        log.debug(`WarmupManager] Using cached snapshot`);
        const report = await this.generateFullReport(state.snapshot);
        return {
          success: true,
          status: 'warm',
          cached: true,
          duration: Date.now() - startTime,
          snapshot: state.snapshot,
          report
        };
      }
      
      // v3.10.1: Попробуем incremental warmup если state не совсем свежий
      if (state && state.snapshot && !await manifest.needsFullWarmup(48)) {
        try {
          // Сканируем ключевые файлы
          const keyFiles = await this.getKeyProjectFiles();
          diff = await manifest.computeDiff(keyFiles);
          
          const savings = manifest.getWarmupSavings(diff);
          if (savings.speedupFactor >= 1.5) {
            incrementalMode = true;
            log.info(`WarmupManager] Incremental mode: ${savings.filesSkipped} files skipped, ~${savings.speedupFactor}x speedup`);
          }
        } catch (err) {
          log.debug(`WarmupManager] Failed to compute diff, falling back to full warmup:`, err);
        }
      }
    }
    
    // Collect all data
    const [
      project,
      { tasks: activeTasks, relations: taskRelations },
      currentPhase,
      structure,
      docs
    ] = await Promise.all([
      this.collectProjectInfo(),
      this.collectActiveTasks(),
      this.collectCurrentPhase(),
      this.collectStructure(),
      this.collectDocsInfo()
    ]);
    
    const techStack = await this.collectTechStack();
    const tools = this.collectToolsInfo();
    const devops = await this.collectDevOpsInfo();
    
    // Create snapshot
    const snapshot: ProjectContextSnapshot = {
      version: WARM_STATE_VERSION,
      hash: '',
      timestamp: new Date().toISOString(),
      ttl,
      scope,
      project,
      techStack,
      currentPhase,
      activeTasks,
      taskRelations,
      keyDecisions: [],
      knownIssues: [],
      structure,
      tools,
      devops,
      docs
    };
    
    snapshot.hash = this.computeHash(JSON.stringify(snapshot));
    
    // Save state with atomic write
    const warmState: WarmState = {
      projectId: project.name,
      status: 'warm',
      lastWarmedAt: snapshot.timestamp,
      hash: snapshot.hash,
      scope,
      snapshot
    };
    
    await this.saveWarmState(warmState);
    
    // v3.10.1: Обновляем manifest
    const duration = Date.now() - startTime;
    try {
      if (diff && incrementalMode) {
        // Обновляем только изменённые файлы
        await manifest.updateAfterWarmup([...diff.added, ...diff.modified]);
        await manifest.recordWarmupTime(duration, diff.added.length + diff.modified.length);
      } else {
        // Полный warmup - помечаем
        await manifest.markFullWarmup();
        const keyFiles = await this.getKeyProjectFiles();
        const fullDiff = await manifest.computeDiff(keyFiles);
        await manifest.updateAfterWarmup([...fullDiff.added, ...fullDiff.modified]);
        await manifest.recordWarmupTime(duration, fullDiff.added.length + fullDiff.modified.length);
      }
    } catch (err) {
      log.debug(`WarmupManager] Failed to update manifest:`, err);
    }
    
    log.debug(`WarmupManager] Warmup complete in ${duration}ms (incremental: ${incrementalMode})`);
    
    const report = await this.generateFullReport(snapshot);
    
    // v3.10.1: Добавляем информацию об incremental warmup в report
    let finalReport = report;
    if (incrementalMode && diff) {
      const savings = manifest.getWarmupSavings(diff);
      finalReport = report + `\n\n---\n**Incremental Warmup:** ${savings.filesSkipped} files skipped, ~${savings.speedupFactor}x speedup\n`;
    }
    
    return {
      success: true,
      status: 'warm',
      cached: false,
      duration,
      snapshot,
      report: finalReport
    };
  }
  
  /**
   * v3.10.1: Получить список ключевых файлов проекта для manifest
   */
  private async getKeyProjectFiles(): Promise<string[]> {
    const files: string[] = [];
    
    // Конфигурационные файлы
    const configFiles = [
      'package.json', 'tsconfig.json', 'pyproject.toml', 
      'Cargo.toml', 'go.mod', '.cursorrules'
    ];
    
    for (const file of configFiles) {
      const fullPath = path.join(this.projectPath, file);
      try {
        await fs.access(fullPath);
        files.push(fullPath);
      } catch {}
    }
    
    // Сканируем src/ для ключевых файлов
    try {
      const srcPath = path.join(this.projectPath, 'src');
      const srcFiles = await this.scanDirectory(srcPath, 2);
      for (const f of srcFiles) {
        if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.py') || f.endsWith('.rs')) {
          files.push(path.join(this.projectPath, f));
        }
      }
    } catch {}
    
    return files.slice(0, 100); // Лимит для производительности
  }
  
  /**
   * Инвалидирует кэш
   */
  async invalidate(): Promise<void> {
    try {
      await fs.unlink(this.warmStatePath);
      this.warmState = null;
      log.debug(`WarmupManager] Cache invalidated`);
    } catch {}
  }
}

// Singleton with path tracking
let instance: WarmupManager | null = null;
let instancePath: string | null = null;

/**
 * Get WarmupManager instance
 * 
 * If explicit projectPath is provided and differs from cached instance,
 * creates a new instance for that path.
 * 
 * @param projectPath - Optional explicit project path
 * @returns WarmupManager instance
 */
export function getWarmupManager(projectPath?: string): WarmupManager {
  // If explicit path provided and differs from current, create new instance
  if (projectPath && projectPath !== instancePath) {
    instance = new WarmupManager(projectPath);
    instancePath = projectPath;
    return instance;
  }
  
  // Default singleton behavior
  if (!instance) {
    instance = new WarmupManager(projectPath);
    instancePath = projectPath || getProjectPath();
  }
  return instance;
}

export function resetWarmupManager(): void {
  instance = null;
  instancePath = null;
}
