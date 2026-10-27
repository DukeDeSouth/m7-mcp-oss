import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[ProjectRegistry]');
/**
 * M7 v3.0 - Project Registry
 * 
 * Реестр проектов с персистентным хранением
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProjectInfo, ProjectConfig, DEFAULT_PROJECT_CONFIG } from './types.js';

/**
 * Реестр проектов
 */
export class ProjectRegistry {
  private projects: Map<string, ProjectInfo> = new Map();
  private configs: Map<string, ProjectConfig> = new Map();
  private configPath: string;
  private loaded = false;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.m7', 'projects.json');
  }

  /**
   * Загрузить реестр из файла
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });

      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data);

      if (parsed.projects) {
        for (const p of parsed.projects) {
          this.projects.set(p.id, {
            ...p,
            lastAccessed: new Date(p.lastAccessed),
            lastIndexed: p.lastIndexed ? new Date(p.lastIndexed) : null,
          });
        }
      }

      if (parsed.configs) {
        for (const [id, config] of Object.entries(parsed.configs)) {
          this.configs.set(id, config as ProjectConfig);
        }
      }

      this.loaded = true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.debug('ProjectRegistry] Failed to load:', error.message);
      }
      this.loaded = true;
    }
  }

  /**
   * Сохранить реестр в файл
   */
  async save(): Promise<void> {
    const data = {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      projects: Array.from(this.projects.values()),
      configs: Object.fromEntries(this.configs),
    };

    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2));
  }

  /**
   * Зарегистрировать проект
   */
  async register(projectPath: string): Promise<ProjectInfo> {
    await this.load();

    const normalizedPath = path.resolve(projectPath);
    const id = this.generateProjectId(normalizedPath);

    // Проверить, существует ли уже
    const existing = this.projects.get(id);
    if (existing && existing.path === normalizedPath) {
      // Обновить lastAccessed
      existing.lastAccessed = new Date();
      await this.save();
      return existing;
    }

    // Определить технологии проекта
    const technologies = await this.detectTechnologies(normalizedPath);

    const project: ProjectInfo = {
      id,
      path: normalizedPath,
      collectionName: `m7_${id}`,
      displayName: path.basename(normalizedPath),
      lastAccessed: new Date(),
      lastIndexed: null,
      fileCount: 0,
      chunkCount: 0,
      technologies,
      indexStatus: 'none',
    };

    this.projects.set(id, project);
    this.configs.set(id, { ...DEFAULT_PROJECT_CONFIG });

    await this.save();
    return project;
  }

  /**
   * Получить проект по пути
   */
  async getByPath(projectPath: string): Promise<ProjectInfo | null> {
    await this.load();

    const normalizedPath = path.resolve(projectPath);

    for (const project of this.projects.values()) {
      if (project.path === normalizedPath) {
        return project;
      }
    }

    return null;
  }

  /**
   * Получить проект по ID
   */
  async getById(id: string): Promise<ProjectInfo | null> {
    await this.load();
    return this.projects.get(id) || null;
  }

  /**
   * Получить или создать проект
   */
  async getOrCreate(projectPath: string): Promise<ProjectInfo> {
    const existing = await this.getByPath(projectPath);
    if (existing) {
      // Обновить lastAccessed
      existing.lastAccessed = new Date();
      await this.save();
      return existing;
    }
    return this.register(projectPath);
  }

  /**
   * Список всех проектов
   */
  async list(): Promise<ProjectInfo[]> {
    await this.load();
    return Array.from(this.projects.values())
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
  }

  /**
   * Список часто используемых проектов
   */
  async getFrequent(limit: number = 5): Promise<ProjectInfo[]> {
    const all = await this.list();
    return all.slice(0, limit);
  }

  /**
   * Обновить lastAccessed
   */
  async updateLastAccessed(id: string): Promise<void> {
    await this.load();
    const project = this.projects.get(id);
    if (project) {
      project.lastAccessed = new Date();
      await this.save();
    }
  }

  /**
   * Обновить статус индексации
   */
  async updateIndexStatus(
    id: string,
    status: ProjectInfo['indexStatus'],
    stats?: { fileCount?: number; chunkCount?: number }
  ): Promise<void> {
    await this.load();
    const project = this.projects.get(id);
    if (project) {
      project.indexStatus = status;
      project.lastIndexed = new Date();
      if (stats?.fileCount !== undefined) project.fileCount = stats.fileCount;
      if (stats?.chunkCount !== undefined) project.chunkCount = stats.chunkCount;
      await this.save();
    }
  }

  /**
   * Получить конфиг проекта
   */
  async getConfig(id: string): Promise<ProjectConfig> {
    await this.load();
    return this.configs.get(id) || { ...DEFAULT_PROJECT_CONFIG };
  }

  /**
   * Обновить конфиг проекта
   */
  async updateConfig(id: string, config: Partial<ProjectConfig>): Promise<void> {
    await this.load();
    const existing = this.configs.get(id) || { ...DEFAULT_PROJECT_CONFIG };
    this.configs.set(id, { ...existing, ...config });
    await this.save();
  }

  /**
   * Удалить проект из реестра
   */
  async remove(id: string): Promise<boolean> {
    await this.load();
    const deleted = this.projects.delete(id);
    this.configs.delete(id);
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  /**
   * Генерировать ID проекта из пути
   */
  private generateProjectId(projectPath: string): string {
    const name = path.basename(projectPath);
    // Sanitize: lowercase, replace non-alphanumeric with underscore
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32);
  }

  /**
   * Определить технологии проекта
   */
  private async detectTechnologies(projectPath: string): Promise<string[]> {
    const technologies: string[] = [];

    try {
      // Проверить package.json
      const packageJsonPath = path.join(projectPath, 'package.json');
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        if (deps.react || deps['react-dom']) technologies.push('React');
        if (deps.next) technologies.push('Next.js');
        if (deps.vue) technologies.push('Vue');
        if (deps.angular || deps['@angular/core']) technologies.push('Angular');
        if (deps.express) technologies.push('Express');
        if (deps.fastify) technologies.push('Fastify');
        if (deps.prisma || deps['@prisma/client']) technologies.push('Prisma');
        if (deps.typeorm) technologies.push('TypeORM');
        if (deps.mongoose) technologies.push('MongoDB');
        if (deps.typescript) technologies.push('TypeScript');
        if (deps.tailwindcss) technologies.push('Tailwind');
      } catch {
        // Нет package.json
      }

      // Проверить наличие конфигов
      const configs = [
        { file: 'tsconfig.json', tech: 'TypeScript' },
        { file: 'tailwind.config.js', tech: 'Tailwind' },
        { file: 'tailwind.config.ts', tech: 'Tailwind' },
        { file: 'prisma/schema.prisma', tech: 'Prisma' },
        { file: 'docker-compose.yml', tech: 'Docker' },
        { file: 'Dockerfile', tech: 'Docker' },
        { file: '.env', tech: 'dotenv' },
      ];

      for (const { file, tech } of configs) {
        try {
          await fs.access(path.join(projectPath, file));
          if (!technologies.includes(tech)) {
            technologies.push(tech);
          }
        } catch {
          // Файл не существует
        }
      }
    } catch {
      // Ошибка при детекции
    }

    return technologies;
  }
}

/**
 * Глобальный экземпляр реестра
 */
let globalRegistry: ProjectRegistry | null = null;

export function getProjectRegistry(): ProjectRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProjectRegistry();
  }
  return globalRegistry;
}

