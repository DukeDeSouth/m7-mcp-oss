/**
 * M7 Task Graph Manager
 * 
 * Управляет графом задач — создание, связывание, поиск.
 * Хранит данные в .m7/task-graph.json
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TaskGraph,
  TaskNode,
  TaskLink,
  TaskMeta,
  TaskStatus,
  TaskLinkType,
  TaskGraphSearchResult,
  SubgraphOptions,
  TASK_GRAPH_PATH,
  TASK_META_FILENAME,
  TASK_GRAPH_VERSION
} from '../types/taskGraph.js';
import { TaskInterpretation } from '../types/interpretation.js';
import { getProjectPath } from '../utils/projectPath.js';

const log = createLogger('[TaskGraphManager]');

/**
 * Опции создания задачи
 */
export interface CreateTaskOptions {
  id: string;
  title: string;
  folder: string;
  sessionId?: string;
  interpretation?: TaskInterpretation;
  parentTaskId?: string;
}

/**
 * Менеджер графа задач
 */
export class TaskGraphManager {
  private graph: TaskGraph | null = null;
  private projectPath: string;
  private graphPath: string;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
    this.graphPath = path.join(this.projectPath, TASK_GRAPH_PATH);
  }
  
  /**
   * Инициализирует или загружает граф
   */
  async initialize(): Promise<void> {
    try {
      const exists = await this.fileExists(this.graphPath);
      
      if (exists) {
        const content = await fs.readFile(this.graphPath, 'utf-8');
        this.graph = JSON.parse(content);
        log.debug(`Task graph loaded: ${Object.keys(this.graph!.nodes).length} nodes, ${this.graph!.links.length} links`);
      } else {
        this.graph = this.createEmptyGraph();
        await this.save();
        log.debug('Created new task graph');
      }
    } catch (error: any) {
      log.error(`Failed to initialize task graph: ${error.message}`);
      this.graph = this.createEmptyGraph();
    }
  }
  
  /**
   * Создаёт пустой граф
   */
  private createEmptyGraph(): TaskGraph {
    return {
      version: TASK_GRAPH_VERSION,
      nodes: {},
      links: [],
      meta: {
        lastUpdated: new Date(),
        activeTasksCount: 0,
        completedTasksCount: 0
      }
    };
  }
  
  /**
   * Сохраняет граф в файл
   */
  private async save(): Promise<void> {
    if (!this.graph) return;
    
    // Обновляем метаданные
    this.graph.meta.lastUpdated = new Date();
    this.graph.meta.activeTasksCount = Object.values(this.graph.nodes)
      .filter(n => n.status === 'active').length;
    this.graph.meta.completedTasksCount = Object.values(this.graph.nodes)
      .filter(n => n.status === 'completed').length;
    
    // Создаём директорию если нужно
    const dir = path.dirname(this.graphPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Сохраняем с форматированием
    await fs.writeFile(
      this.graphPath, 
      JSON.stringify(this.graph, null, 2),
      'utf-8'
    );
    
    log.debug('Task graph saved');
  }
  
  /**
   * Создаёт новую задачу в графе
   */
  async createTask(options: CreateTaskOptions): Promise<TaskNode> {
    await this.ensureInitialized();
    
    const node: TaskNode = {
      id: options.id,
      title: options.title,
      status: 'active',
      route: 'heavy',  // Всегда HEAVY
      folder: options.folder,
      created: new Date(),
      meta: {
        sessionId: options.sessionId,
        interpretationConfidence: options.interpretation?.confidence
      }
    };
    
    this.graph!.nodes[options.id] = node;
    
    // Если есть родительская задача — создаём связь
    if (options.parentTaskId) {
      await this.createLink(options.parentTaskId, options.id, 'spawned', 'Created from parent task');
    }
    
    // Сохраняем TASK_META.json в папку задачи
    await this.saveTaskMeta(options);
    
    await this.save();
    
    log.debug(`Task created: ${options.id}`);
    return node;
  }
  
  /**
   * Сохраняет метаданные задачи в её папку
   */
  private async saveTaskMeta(options: CreateTaskOptions): Promise<void> {
    const metaPath = path.join(this.projectPath, options.folder, TASK_META_FILENAME);
    
    const meta: TaskMeta = {
      taskId: options.id,
      title: options.title,
      originalDescription: options.title,
      interpretation: options.interpretation ? {
        summary: options.interpretation.summary,
        assumptions: options.interpretation.assumptions,
        confidence: options.interpretation.confidence,
        generatedAt: options.interpretation.generatedAt
      } : undefined,
      discovery: options.interpretation ? {
        filesFound: options.interpretation.discoveredContext.filesFound.length,
        similarCodeMatches: options.interpretation.discoveredContext.similarCode.length,
        scanDurationMs: options.interpretation.discoveredContext.scanStats.scanDurationMs
      } : undefined,
      timestamps: {
        created: new Date(),
        lastActivity: new Date()
      }
    };
    
    try {
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      log.debug(`Task meta saved: ${metaPath}`);
    } catch (error: any) {
      log.warn(`Failed to save task meta: ${error.message}`);
    }
  }
  
  /**
   * Получает задачу по ID
   */
  async getTask(taskId: string): Promise<TaskNode | null> {
    await this.ensureInitialized();
    return this.graph!.nodes[taskId] || null;
  }
  
  /**
   * Обновляет статус задачи
   */
  async updateTaskStatus(
    taskId: string, 
    status: TaskStatus, 
    outcome?: string
  ): Promise<void> {
    await this.ensureInitialized();
    
    const node = this.graph!.nodes[taskId];
    if (!node) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    node.status = status;
    if (outcome) {
      node.outcome = outcome;
    }
    if (status === 'completed' || status === 'transferred' || status === 'cancelled') {
      node.completed = new Date();
    }
    
    await this.save();
    log.debug(`Task ${taskId} status updated to ${status}`);
  }
  
  /**
   * Создаёт связь между задачами
   */
  async createLink(
    fromId: string,
    toId: string,
    type: TaskLinkType,
    reason: string,
    strength?: number
  ): Promise<TaskLink> {
    await this.ensureInitialized();
    
    // Проверяем что задачи существуют
    if (!this.graph!.nodes[fromId]) {
      throw new Error(`Source task not found: ${fromId}`);
    }
    if (!this.graph!.nodes[toId]) {
      throw new Error(`Target task not found: ${toId}`);
    }
    
    const link: TaskLink = {
      from: fromId,
      to: toId,
      type,
      reason,
      strength,
      timestamp: new Date(),
      createdBy: 'system'
    };
    
    this.graph!.links.push(link);
    await this.save();
    
    log.debug(`Link created: ${fromId} --[${type}]--> ${toId}`);
    return link;
  }
  
  /**
   * Получает связи задачи
   */
  async getTaskLinks(taskId: string): Promise<{
    outgoing: TaskLink[];
    incoming: TaskLink[];
  }> {
    await this.ensureInitialized();
    
    return {
      outgoing: this.graph!.links.filter(l => l.from === taskId),
      incoming: this.graph!.links.filter(l => l.to === taskId)
    };
  }
  
  /**
   * Поиск задач по статусу
   */
  async findByStatus(status: TaskStatus): Promise<TaskNode[]> {
    await this.ensureInitialized();
    
    return Object.values(this.graph!.nodes)
      .filter(n => n.status === status);
  }
  
  /**
   * Поиск связанных задач (подграф)
   */
  async getSubgraph(options: SubgraphOptions): Promise<TaskGraphSearchResult> {
    const startTime = Date.now();
    await this.ensureInitialized();
    
    const visited = new Set<string>();
    const tasks: TaskNode[] = [];
    const links: TaskLink[] = [];
    
    const traverse = (nodeId: string, depth: number) => {
      if (depth < 0 || visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = this.graph!.nodes[nodeId];
      if (!node) return;
      
      // Фильтр по статусу
      if (!options.includeCompleted && 
          (node.status === 'completed' || node.status === 'cancelled')) {
        return;
      }
      
      tasks.push(node);
      
      // Обходим связи
      const nodeLinks = this.graph!.links.filter(l => 
        l.from === nodeId || l.to === nodeId
      );
      
      for (const link of nodeLinks) {
        // Фильтр по типу связи
        if (options.linkTypes && !options.linkTypes.includes(link.type)) {
          continue;
        }
        
        if (!links.find(l => l.from === link.from && l.to === link.to)) {
          links.push(link);
        }
        
        const nextId = link.from === nodeId ? link.to : link.from;
        traverse(nextId, depth - 1);
      }
    };
    
    traverse(options.centerId, options.depth);
    
    return {
      tasks,
      links,
      searchDurationMs: Date.now() - startTime
    };
  }
  
  /**
   * Получает активные задачи
   */
  async getActiveTasks(): Promise<TaskNode[]> {
    return this.findByStatus('active');
  }
  
  /**
   * Получает последние задачи
   */
  async getRecentTasks(limit: number = 10): Promise<TaskNode[]> {
    await this.ensureInitialized();
    
    return Object.values(this.graph!.nodes)
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
      .slice(0, limit);
  }
  
  /**
   * Получает статистику графа
   */
  async getStats(): Promise<{
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    transferredTasks: number;
    totalLinks: number;
    linksByType: Record<TaskLinkType, number>;
  }> {
    await this.ensureInitialized();
    
    const nodes = Object.values(this.graph!.nodes);
    const linksByType: Record<string, number> = {};
    
    for (const link of this.graph!.links) {
      linksByType[link.type] = (linksByType[link.type] || 0) + 1;
    }
    
    return {
      totalTasks: nodes.length,
      activeTasks: nodes.filter(n => n.status === 'active').length,
      completedTasks: nodes.filter(n => n.status === 'completed').length,
      transferredTasks: nodes.filter(n => n.status === 'transferred').length,
      totalLinks: this.graph!.links.length,
      linksByType: linksByType as Record<TaskLinkType, number>
    };
  }
  
  /**
   * Проверяет существование файла
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Убеждается что граф инициализирован
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.graph) {
      await this.initialize();
    }
  }
}

// Singleton instance
let managerInstance: TaskGraphManager | null = null;

/**
 * Получает singleton экземпляр менеджера
 */
export function getTaskGraphManager(projectPath?: string): TaskGraphManager {
  if (!managerInstance) {
    managerInstance = new TaskGraphManager(projectPath);
  }
  return managerInstance;
}
