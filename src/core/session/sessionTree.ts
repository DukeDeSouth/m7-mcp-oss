/**
 * M7 Session Tree Branching v1.0
 * 
 * JSONL-формат сессии с parentId для поддержки ветвления.
 * Позволяет откат к Discovery и выбор другой Architecture без потери данных.
 * 
 * @version 1.0.0
 * @since M7 v3.10.3
 */

import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '../utils/logger.js';
import { getProjectPath } from '../utils/projectPath.js';
import { atomicWriteJSON, safeReadJSON } from '../utils/atomicWrite.js';

const log = createLogger('[SessionTree]');

// ============================================================================
// Types
// ============================================================================

export type SessionPhase = 
  | 'discovery'
  | 'architecture' 
  | 'solution'
  | 'impact'
  | 'simulation'
  | 'implementation'
  | 'validation';

/**
 * Одно сообщение/шаг в сессии
 */
export interface SessionNode {
  /** Уникальный ID узла */
  id: string;
  /** ID родительского узла (null = корень) */
  parentId: string | null;
  /** Фаза M7 */
  phase: SessionPhase;
  /** Содержание / описание шага */
  content: string;
  /** Timestamp создания */
  createdAt: number;
  /** ID ветки */
  branchId: string;
  /** Метаданные */
  meta?: Record<string, unknown>;
}

/**
 * Ветка сессии
 */
export interface SessionBranch {
  /** ID ветки */
  id: string;
  /** Имя ветки */
  name: string;
  /** ID узла-ответвления */
  forkNodeId: string;
  /** Timestamp создания */
  createdAt: number;
  /** Активна ли ветка */
  active: boolean;
}

/**
 * Полное дерево сессии
 */
export interface SessionTreeData {
  /** ID сессии */
  sessionId: string;
  /** Все узлы */
  nodes: SessionNode[];
  /** Все ветки */
  branches: SessionBranch[];
  /** Текущая активная ветка */
  activeBranchId: string;
  /** Создано */
  createdAt: number;
  /** Обновлено */
  updatedAt: number;
}

// ============================================================================
// Session Tree Manager
// ============================================================================

export class SessionTreeManager {
  private tree: SessionTreeData | null = null;
  private projectPath: string;
  private nodeCounter = 0;
  private branchCounter = 0;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
  }
  
  /**
   * Создать новую сессию
   */
  create(sessionId: string): SessionTreeData {
    const mainBranch: SessionBranch = {
      id: 'main',
      name: 'main',
      forkNodeId: '',
      createdAt: Date.now(),
      active: true
    };
    
    this.tree = {
      sessionId,
      nodes: [],
      branches: [mainBranch],
      activeBranchId: 'main',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    log.info(`Session tree created: ${sessionId}`);
    return this.tree;
  }
  
  /**
   * Загрузить дерево из файла
   */
  async load(sessionId: string): Promise<SessionTreeData | null> {
    const filePath = this.getTreePath(sessionId);
    
    try {
      const result = await safeReadJSON<SessionTreeData>(filePath);
      if (result.data) {
        this.tree = result.data;
        this.nodeCounter = result.data.nodes.length;
        this.branchCounter = result.data.branches.length;
        log.info(`Session tree loaded: ${sessionId} (${this.tree.nodes.length} nodes, ${this.tree.branches.length} branches)`);
        return this.tree;
      }
    } catch {}
    
    return null;
  }
  
  /**
   * Сохранить дерево
   */
  async save(): Promise<void> {
    if (!this.tree) return;
    
    const filePath = this.getTreePath(this.tree.sessionId);
    this.tree.updatedAt = Date.now();
    
    await atomicWriteJSON(filePath, this.tree);
    log.debug(`Session tree saved: ${this.tree.sessionId}`);
  }
  
  /**
   * Добавить узел в текущую ветку
   */
  addNode(phase: SessionPhase, content: string, meta?: Record<string, unknown>): SessionNode {
    if (!this.tree) throw new Error('No active session tree');
    
    const parentId = this.getCurrentTipId();
    
    const node: SessionNode = {
      id: `node_${++this.nodeCounter}_${Date.now()}`,
      parentId,
      phase,
      content,
      createdAt: Date.now(),
      branchId: this.tree.activeBranchId,
      meta
    };
    
    this.tree.nodes.push(node);
    this.tree.updatedAt = Date.now();
    
    log.debug(`Node added: ${node.id} (phase: ${phase}, branch: ${node.branchId})`);
    return node;
  }
  
  /**
   * Создать ветку от указанного узла
   */
  branch(forkNodeId: string, branchName?: string): SessionBranch {
    if (!this.tree) throw new Error('No active session tree');
    
    const forkNode = this.tree.nodes.find(n => n.id === forkNodeId);
    if (!forkNode) throw new Error(`Node not found: ${forkNodeId}`);
    
    const name = branchName || `branch_${++this.branchCounter}`;
    
    const branch: SessionBranch = {
      id: `branch_${Date.now()}_${this.branchCounter}`,
      name,
      forkNodeId,
      createdAt: Date.now(),
      active: true
    };
    
    // Деактивируем текущую ветку
    const currentBranch = this.tree.branches.find(b => b.id === this.tree!.activeBranchId);
    if (currentBranch) currentBranch.active = false;
    
    this.tree.branches.push(branch);
    this.tree.activeBranchId = branch.id;
    this.tree.updatedAt = Date.now();
    
    log.info(`Branch created: "${name}" from node ${forkNodeId} (phase: ${forkNode.phase})`);
    return branch;
  }
  
  /**
   * Форк: создать ветку от текущего узла
   */
  fork(branchName?: string): SessionBranch {
    const tipId = this.getCurrentTipId();
    if (!tipId) throw new Error('No nodes to fork from');
    return this.branch(tipId, branchName);
  }
  
  /**
   * Переключиться на другую ветку
   */
  switchBranch(branchId: string): boolean {
    if (!this.tree) return false;
    
    const branch = this.tree.branches.find(b => b.id === branchId);
    if (!branch) return false;
    
    // Деактивируем текущую
    const current = this.tree.branches.find(b => b.id === this.tree!.activeBranchId);
    if (current) current.active = false;
    
    branch.active = true;
    this.tree.activeBranchId = branchId;
    this.tree.updatedAt = Date.now();
    
    log.info(`Switched to branch: "${branch.name}"`);
    return true;
  }
  
  /**
   * Получить дерево в виде текстовой визуализации
   */
  visualize(): string {
    if (!this.tree) return 'No active session tree';
    
    const lines: string[] = [];
    lines.push(`Session: ${this.tree.sessionId}`);
    lines.push(`Branches: ${this.tree.branches.length}`);
    lines.push(`Nodes: ${this.tree.nodes.length}`);
    lines.push('');
    
    // Для каждой ветки рисуем путь
    for (const branch of this.tree.branches) {
      const isActive = branch.id === this.tree.activeBranchId;
      const marker = isActive ? '▶' : '○';
      lines.push(`${marker} Branch: "${branch.name}" ${isActive ? '(active)' : ''}`);
      
      // Получаем узлы этой ветки
      const branchNodes = this.getBranchNodes(branch.id);
      
      for (let i = 0; i < branchNodes.length; i++) {
        const node = branchNodes[i];
        const isLast = i === branchNodes.length - 1;
        const connector = isLast ? '└─' : '├─';
        const phaseIcon = this.getPhaseIcon(node.phase);
        const preview = node.content.substring(0, 50);
        lines.push(`  ${connector} ${phaseIcon} ${node.phase}: ${preview}`);
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Получить текущий путь (от корня до текущего tip)
   */
  getCurrentPath(): SessionNode[] {
    if (!this.tree) return [];
    
    const tipId = this.getCurrentTipId();
    if (!tipId) return [];
    
    return this.getPathToNode(tipId);
  }
  
  /**
   * Получить путь от корня до узла
   */
  getPathToNode(nodeId: string): SessionNode[] {
    if (!this.tree) return [];
    
    const pathNodes: SessionNode[] = [];
    let current = this.tree.nodes.find(n => n.id === nodeId);
    
    while (current) {
      pathNodes.unshift(current);
      if (!current.parentId) break;
      current = this.tree.nodes.find(n => n.id === current!.parentId);
    }
    
    return pathNodes;
  }
  
  /**
   * Получить все узлы ветки
   */
  getBranchNodes(branchId: string): SessionNode[] {
    if (!this.tree) return [];
    
    const branch = this.tree.branches.find(b => b.id === branchId);
    if (!branch) return [];
    
    // Для main ветки - все узлы с branchId "main"
    // Для других веток - путь от корня до fork point + узлы ветки
    const directNodes = this.tree.nodes.filter(n => n.branchId === branchId);
    
    if (branchId === 'main') return directNodes;
    
    // Путь до fork point
    const forkPath = branch.forkNodeId ? this.getPathToNode(branch.forkNodeId) : [];
    
    return [...forkPath, ...directNodes];
  }
  
  /**
   * Получить данные дерева
   */
  getTree(): SessionTreeData | null {
    return this.tree;
  }
  
  /**
   * Получить статистику дерева
   */
  getStats(): {
    sessionId: string | null;
    nodes: number;
    branches: number;
    activeBranch: string | null;
    phases: Record<string, number>;
    depth: number;
  } {
    if (!this.tree) {
      return {
        sessionId: null,
        nodes: 0,
        branches: 0,
        activeBranch: null,
        phases: {},
        depth: 0
      };
    }
    
    const phases: Record<string, number> = {};
    for (const node of this.tree.nodes) {
      phases[node.phase] = (phases[node.phase] || 0) + 1;
    }
    
    // Максимальная глубина
    let maxDepth = 0;
    for (const node of this.tree.nodes) {
      const pathLen = this.getPathToNode(node.id).length;
      maxDepth = Math.max(maxDepth, pathLen);
    }
    
    return {
      sessionId: this.tree.sessionId,
      nodes: this.tree.nodes.length,
      branches: this.tree.branches.length,
      activeBranch: this.tree.activeBranchId,
      phases,
      depth: maxDepth
    };
  }
  
  // ============================================================================
  // Private helpers
  // ============================================================================
  
  private getCurrentTipId(): string | null {
    if (!this.tree || this.tree.nodes.length === 0) return null;
    
    // Последний узел в текущей ветке
    const branchNodes = this.tree.nodes.filter(
      n => n.branchId === this.tree!.activeBranchId
    );
    
    if (branchNodes.length === 0) {
      // Если ветка пустая, tip = fork point
      const branch = this.tree.branches.find(b => b.id === this.tree!.activeBranchId);
      return branch?.forkNodeId || null;
    }
    
    return branchNodes[branchNodes.length - 1].id;
  }
  
  private getTreePath(sessionId: string): string {
    return path.join(this.projectPath, '.m7', 'sessions', `${sessionId}.json`);
  }
  
  private getPhaseIcon(phase: SessionPhase): string {
    const icons: Record<SessionPhase, string> = {
      discovery: '🔍',
      architecture: '🏗️',
      solution: '📋',
      impact: '💥',
      simulation: '🧪',
      implementation: '⚡',
      validation: '✅'
    };
    return icons[phase] || '•';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let treeManager: SessionTreeManager | null = null;

export function getSessionTreeManager(projectPath?: string): SessionTreeManager {
  if (!treeManager) {
    treeManager = new SessionTreeManager(projectPath);
  }
  return treeManager;
}

export function resetSessionTreeManager(): void {
  treeManager = null;
}
