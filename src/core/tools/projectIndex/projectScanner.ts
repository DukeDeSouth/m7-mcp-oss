/**
 * Project Scanner
 * Сканирует проект и собирает информацию для INDEX.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('[ProjectScanner]');

import {
  ProjectScanner,
  ProjectIndex,
  ProjectInfo,
  DeploymentInfo,
  GitInfo,
  DocumentationFile,
  ConfigFile,
  ProjectStructure,
  DirectoryInfo,
  ScanOptions,
  DEFAULT_EXCLUDE_PATTERNS,
  CRITICAL_CONFIG_FILES,
  IMPORTANT_DIRECTORIES
} from './types.js';

const execAsync = promisify(exec);

export class DefaultProjectScanner implements ProjectScanner {
  
  async scanProject(rootPath: string, options: ScanOptions): Promise<ProjectIndex> {
    log.debug(`Scanning project at: ${rootPath}`);
    
    const [
      projectInfo,
      deploymentInfo,
      gitInfo,
      structure,
      documentation,
      configuration
    ] = await Promise.all([
      this.scanPackageInfo(rootPath),
      this.scanDeploymentInfo(rootPath),
      options.includeGitInfo ? this.scanGitInfo(rootPath) : Promise.resolve({} as GitInfo),
      this.scanStructure(rootPath, options),
      options.scanDocumentation ? this.scanDocumentation(rootPath) : Promise.resolve([]),
      options.scanConfiguration ? this.scanConfiguration(rootPath) : Promise.resolve([])
    ]);

    const quickStart = await this.generateQuickStart(rootPath, projectInfo);
    const importantNotes = await this.generateImportantNotes(rootPath, projectInfo);

    return {
      project: projectInfo,
      deployment: deploymentInfo,
      git: gitInfo,
      structure,
      documentation,
      configuration,
      quickStart,
      importantNotes,
      generatedAt: new Date().toISOString(),
      generatedBy: 'M7 Project Index Manager v1.0'
    };
  }

  async scanPackageInfo(rootPath: string): Promise<ProjectInfo> {
    try {
      const packageJsonPath = path.join(rootPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      const techStack = this.detectTechStack(packageJson);
      
      return {
        name: packageJson.name || path.basename(rootPath),
        version: packageJson.version || '1.0.0',
        description: packageJson.description || 'No description available',
        lastUpdated: new Date().toISOString().split('T')[0],
        status: this.detectProjectStatus(packageJson),
        techStack,
        domain: this.detectDomain(packageJson)
      };
    } catch (error) {
      log.warn('No package.json found, using defaults');
      return {
        name: path.basename(rootPath),
        version: '1.0.0',
        description: 'Project description not available',
        lastUpdated: new Date().toISOString().split('T')[0],
        status: 'development',
        techStack: []
      };
    }
  }

  async scanDeploymentInfo(rootPath: string): Promise<DeploymentInfo> {
    const deploymentInfo: DeploymentInfo = {};

    // Сканируем различные файлы деплоя
    const deployFiles = [
      'docker-compose.yml',
      'Dockerfile',
      'vercel.json',
      'netlify.toml',
      '.github/workflows',
      'deploy.sh',
      'package.json'
    ];

    for (const file of deployFiles) {
      try {
        const filePath = path.join(rootPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          const content = await fs.readFile(filePath, 'utf-8');
          this.extractDeploymentInfo(file, content, deploymentInfo);
        } else if (stats.isDirectory() && file === '.github/workflows') {
          // Сканируем GitHub Actions
          const workflows = await fs.readdir(filePath);
          if (workflows.length > 0) {
            deploymentInfo.method = 'GitHub Actions';
          }
        }
      } catch (error) {
        // Файл не найден, пропускаем
      }
    }

    return deploymentInfo;
  }

  async scanGitInfo(rootPath: string): Promise<GitInfo> {
    const gitInfo: GitInfo = {};

    try {
      // Получаем информацию о репозитории
      const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: rootPath });
      gitInfo.repository = remoteUrl.trim();

      // Текущая ветка
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: rootPath });
      gitInfo.branch = branch.trim();

      // Последний коммит
      const { stdout: lastCommit } = await execAsync('git log -1 --format="%h %s (%an, %ar)"', { cwd: rootPath });
      gitInfo.lastCommit = lastCommit.trim();

      // Список контрибьюторов
      const { stdout: contributors } = await execAsync('git shortlog -sn --all', { cwd: rootPath });
      gitInfo.contributors = contributors.split('\n')
        .filter(line => line.trim())
        .map(line => line.replace(/^\s*\d+\s+/, ''))
        .slice(0, 10); // Топ 10 контрибьюторов

    } catch (error) {
      log.warn('Git information not available');
    }

    return gitInfo;
  }

  async scanDocumentation(rootPath: string): Promise<DocumentationFile[]> {
    const docs: DocumentationFile[] = [];
    
    // Сканируем корневые документы
    const rootDocs = [
      { name: 'README.md', purpose: 'Project overview & quick start', category: 'core' as const, priority: 'critical' as const },
      { name: 'CHANGELOG.md', purpose: 'Version history & changes', category: 'core' as const, priority: 'high' as const },
      { name: 'CONTRIBUTING.md', purpose: 'Contribution guidelines', category: 'development' as const, priority: 'high' as const },
      { name: 'API_REFERENCE.md', purpose: 'API documentation', category: 'api' as const, priority: 'high' as const },
      { name: 'DEPLOYMENT_GUIDE.md', purpose: 'Deployment instructions', category: 'deployment' as const, priority: 'critical' as const },
      { name: 'DOCUMENTATION_INDEX.md', purpose: 'Documentation index', category: 'core' as const, priority: 'medium' as const }
    ];

    for (const doc of rootDocs) {
      const filePath = path.join(rootPath, doc.name);
      const status = await this.checkFileStatus(filePath);
      
      docs.push({
        path: doc.name,
        name: doc.name,
        status,
        purpose: doc.purpose,
        lastUpdated: status === 'current' ? await this.getFileLastModified(filePath) : undefined,
        priority: doc.priority,
        category: doc.category
      });
    }

    // Сканируем папку docs
    try {
      const docsDir = path.join(rootPath, 'docs');
      const docFiles = await this.scanDirectoryRecursively(docsDir, ['.md', '.txt']);
      
      for (const file of docFiles) {
        const relativePath = path.relative(rootPath, file);
        docs.push({
          path: relativePath,
          name: path.basename(file),
          status: 'current',
          purpose: this.guessPurposeFromPath(relativePath),
          lastUpdated: await this.getFileLastModified(file),
          priority: this.guessPriorityFromPath(relativePath),
          category: this.guessCategoryFromPath(relativePath)
        });
      }
    } catch (error) {
      // Папка docs не найдена
    }

    return docs;
  }

  async scanConfiguration(rootPath: string): Promise<ConfigFile[]> {
    const configs: ConfigFile[] = [];

    for (const configFile of CRITICAL_CONFIG_FILES) {
      const filePath = path.join(rootPath, configFile);
      const status = await this.checkFileStatus(filePath);
      
      configs.push({
        path: configFile,
        name: configFile,
        purpose: this.getConfigPurpose(configFile),
        status,
        critical: true
      });
    }

    // Сканируем дополнительные конфигурационные файлы
    const additionalConfigs = [
      '.gitignore',
      '.eslintrc.js',
      '.prettierrc',
      'jest.config.js',
      'webpack.config.js',
      'vite.config.js',
      'next.config.js'
    ];

    for (const configFile of additionalConfigs) {
      const filePath = path.join(rootPath, configFile);
      const status = await this.checkFileStatus(filePath);
      
      if (status === 'current') {
        configs.push({
          path: configFile,
          name: configFile,
          purpose: this.getConfigPurpose(configFile),
          status,
          critical: false
        });
      }
    }

    return configs;
  }

  async scanStructure(rootPath: string, options: ScanOptions): Promise<ProjectStructure> {
    const directories: DirectoryInfo[] = [];
    let totalFiles = 0;
    let totalDirectories = 0;

    try {
      const items = await fs.readdir(rootPath, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isDirectory()) {
          totalDirectories++;
          
          // Пропускаем исключенные директории
          if (this.shouldExclude(item.name, options.excludePatterns)) {
            continue;
          }

          const dirPath = path.join(rootPath, item.name);
          const fileCount = await this.countFilesInDirectory(dirPath, options.maxDepth - 1);
          totalFiles += fileCount;

          const dirInfo = IMPORTANT_DIRECTORIES.find(d => 
            item.name.match(new RegExp(d.pattern, 'i'))
          );

          directories.push({
            path: item.name,
            name: item.name,
            purpose: dirInfo?.purpose || 'Project directory',
            fileCount,
            importance: dirInfo?.importance || 'low'
          });
        } else {
          totalFiles++;
        }
      }
    } catch (error) {
      log.error('Error scanning structure:', error);
    }

    // Сортируем по важности и размеру
    directories.sort((a, b) => {
      const importanceOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const aImportance = importanceOrder[a.importance];
      const bImportance = importanceOrder[b.importance];
      
      if (aImportance !== bImportance) {
        return bImportance - aImportance;
      }
      return b.fileCount - a.fileCount;
    });

    return {
      directories,
      keyFiles: await this.findKeyFiles(rootPath),
      totalFiles,
      totalDirectories
    };
  }

  // Вспомогательные методы

  private detectTechStack(packageJson: any): string[] {
    const techStack: string[] = [];
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Фреймворки и библиотеки
    if (deps.react) techStack.push('React');
    if (deps.vue) techStack.push('Vue.js');
    if (deps.angular) techStack.push('Angular');
    if (deps.svelte) techStack.push('Svelte');
    if (deps.next) techStack.push('Next.js');
    if (deps.nuxt) techStack.push('Nuxt.js');
    
    // Backend
    if (deps.express) techStack.push('Express.js');
    if (deps.fastify) techStack.push('Fastify');
    if (deps.koa) techStack.push('Koa.js');
    
    // Базы данных
    if (deps.mongodb || deps.mongoose) techStack.push('MongoDB');
    if (deps.pg || deps.postgres) techStack.push('PostgreSQL');
    if (deps.mysql || deps.mysql2) techStack.push('MySQL');
    if (deps.sqlite3) techStack.push('SQLite');
    
    // Инструменты
    if (deps.typescript) techStack.push('TypeScript');
    if (deps.webpack) techStack.push('Webpack');
    if (deps.vite) techStack.push('Vite');
    if (deps.jest) techStack.push('Jest');
    if (deps.playwright) techStack.push('Playwright');
    
    // Если ничего не найдено, определяем по типу проекта
    if (techStack.length === 0) {
      if (packageJson.type === 'module' || deps['@types/node']) {
        techStack.push('Node.js');
      }
    }

    return techStack;
  }

  private detectProjectStatus(packageJson: any): 'development' | 'production' | 'maintenance' | 'archived' {
    if (packageJson.version?.startsWith('0.')) return 'development';
    if (packageJson.version?.includes('beta') || packageJson.version?.includes('alpha')) return 'development';
    return 'production';
  }

  private detectDomain(packageJson: any): string | undefined {
    const keywords = packageJson.keywords || [];
    const description = packageJson.description || '';
    
    // Простое определение домена по ключевым словам
    if (keywords.includes('ecommerce') || description.includes('shop')) return 'E-commerce';
    if (keywords.includes('blog') || description.includes('blog')) return 'Blog/CMS';
    if (keywords.includes('api') || description.includes('api')) return 'API/Backend';
    if (keywords.includes('dashboard') || description.includes('dashboard')) return 'Dashboard/Admin';
    
    return undefined;
  }

  private extractDeploymentInfo(fileName: string, content: string, deploymentInfo: DeploymentInfo): void {
    switch (fileName) {
      case 'docker-compose.yml':
      case 'Dockerfile':
        deploymentInfo.method = 'Docker';
        break;
      case 'vercel.json':
        deploymentInfo.method = 'Vercel';
        break;
      case 'netlify.toml':
        deploymentInfo.method = 'Netlify';
        break;
      case 'package.json':
        try {
          const pkg = JSON.parse(content);
          if (pkg.scripts?.deploy) {
            deploymentInfo.deployScript = pkg.scripts.deploy;
          }
        } catch (error) {
          // Ignore JSON parse errors
        }
        break;
    }
  }

  private async checkFileStatus(filePath: string): Promise<'current' | 'outdated' | 'missing'> {
    try {
      await fs.access(filePath);
      return 'current';
    } catch (error) {
      return 'missing';
    }
  }

  private async getFileLastModified(filePath: string): Promise<string> {
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime.toISOString().split('T')[0];
    } catch (error) {
      return 'unknown';
    }
  }

  private async scanDirectoryRecursively(dirPath: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        
        if (item.isDirectory()) {
          const subFiles = await this.scanDirectoryRecursively(fullPath, extensions);
          files.push(...subFiles);
        } else if (extensions.some(ext => item.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory not accessible
    }
    
    return files;
  }

  private guessPurposeFromPath(filePath: string): string {
    if (filePath.includes('api')) return 'API documentation';
    if (filePath.includes('guide')) return 'User guide';
    if (filePath.includes('tutorial')) return 'Tutorial';
    if (filePath.includes('reference')) return 'Reference documentation';
    if (filePath.includes('methodology')) return 'Development methodology';
    return 'Documentation';
  }

  private guessPriorityFromPath(filePath: string): 'critical' | 'high' | 'medium' | 'low' {
    if (filePath.includes('README') || filePath.includes('getting-started')) return 'critical';
    if (filePath.includes('api') || filePath.includes('deployment')) return 'high';
    if (filePath.includes('guide') || filePath.includes('tutorial')) return 'medium';
    return 'low';
  }

  private guessCategoryFromPath(filePath: string): 'core' | 'api' | 'deployment' | 'development' | 'user' | 'methodology' {
    if (filePath.includes('api')) return 'api';
    if (filePath.includes('deploy')) return 'deployment';
    if (filePath.includes('methodology')) return 'methodology';
    if (filePath.includes('development') || filePath.includes('contributing')) return 'development';
    if (filePath.includes('user') || filePath.includes('guide')) return 'user';
    return 'core';
  }

  private getConfigPurpose(fileName: string): string {
    const purposes: Record<string, string> = {
      'package.json': 'Node.js dependencies & scripts',
      'tsconfig.json': 'TypeScript configuration',
      'mcp.json': 'MCP server configuration',
      '.env': 'Environment variables',
      '.env.example': 'Environment variables template',
      'docker-compose.yml': 'Docker services configuration',
      'Dockerfile': 'Docker container configuration',
      '.cursorrules': 'Cursor AI rules',
      'README.md': 'Project documentation',
      '.gitignore': 'Git ignore patterns',
      '.eslintrc.js': 'ESLint configuration',
      '.prettierrc': 'Prettier configuration',
      'jest.config.js': 'Jest testing configuration',
      'webpack.config.js': 'Webpack build configuration',
      'vite.config.js': 'Vite build configuration',
      'next.config.js': 'Next.js configuration'
    };
    
    return purposes[fileName] || 'Configuration file';
  }

  private shouldExclude(name: string, excludePatterns: string[]): boolean {
    const allPatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];
    return allPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(name);
    });
  }

  private async countFilesInDirectory(dirPath: string, maxDepth: number): Promise<number> {
    if (maxDepth <= 0) return 0;
    
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      let count = 0;
      
      for (const item of items) {
        if (item.isFile()) {
          count++;
        } else if (item.isDirectory() && !this.shouldExclude(item.name, [])) {
          count += await this.countFilesInDirectory(
            path.join(dirPath, item.name), 
            maxDepth - 1
          );
        }
      }
      
      return count;
    } catch (error) {
      return 0;
    }
  }

  private async findKeyFiles(rootPath: string): Promise<string[]> {
    const keyFiles: string[] = [];
    const importantFiles = [
      'package.json',
      'README.md',
      'tsconfig.json',
      'mcp.json',
      '.cursorrules',
      'docker-compose.yml',
      'Dockerfile'
    ];

    for (const file of importantFiles) {
      try {
        await fs.access(path.join(rootPath, file));
        keyFiles.push(file);
      } catch (error) {
        // File doesn't exist
      }
    }

    return keyFiles;
  }

  private async generateQuickStart(rootPath: string, projectInfo: ProjectInfo): Promise<string[]> {
    const quickStart: string[] = [];
    
    // Проверяем package.json для npm/yarn команд
    try {
      const packageJsonPath = path.join(rootPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      if (packageJson.scripts) {
        if (packageJson.scripts.install || packageJson.scripts.setup) {
          quickStart.push('npm install');
        }
        if (packageJson.scripts.dev || packageJson.scripts.start) {
          quickStart.push('npm run dev');
        }
        if (packageJson.scripts.build) {
          quickStart.push('npm run build');
        }
        if (packageJson.scripts.test) {
          quickStart.push('npm test');
        }
      }
    } catch (error) {
      // No package.json
    }

    // Проверяем Docker
    try {
      await fs.access(path.join(rootPath, 'docker-compose.yml'));
      quickStart.push('docker-compose up');
    } catch (error) {
      try {
        await fs.access(path.join(rootPath, 'Dockerfile'));
        quickStart.push('docker build -t ' + projectInfo.name + ' .');
        quickStart.push('docker run -p 3000:3000 ' + projectInfo.name);
      } catch (error) {
        // No Docker files
      }
    }

    return quickStart.length > 0 ? quickStart : ['See README.md for setup instructions'];
  }

  private async generateImportantNotes(rootPath: string, projectInfo: ProjectInfo): Promise<string[]> {
    const notes: string[] = [];

    // Проверяем наличие .env файлов
    try {
      await fs.access(path.join(rootPath, '.env.example'));
      notes.push('Copy .env.example to .env and configure environment variables');
    } catch (error) {
      try {
        await fs.access(path.join(rootPath, '.env'));
        notes.push('Environment variables configured in .env file');
      } catch (error) {
        // No env files
      }
    }

    // Проверяем M7 MCP
    try {
      await fs.access(path.join(rootPath, 'mcp.json'));
      notes.push('M7 MCP server configured - use @m7 tools for development');
    } catch (error) {
      // No MCP
    }

    // Проверяем TypeScript
    if (projectInfo.techStack.includes('TypeScript')) {
      notes.push('TypeScript project - run npm run build to compile');
    }

    return notes;
  }
}
