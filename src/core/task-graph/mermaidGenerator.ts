/**
 * M7 Mermaid Diagram Generator
 * 
 * Генерирует Mermaid диаграммы из Task Graph
 * для визуализации связей между задачами.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { TaskNode, TaskLink, TaskGraphSearchResult, TaskStatus, TaskLinkType } from '../types/taskGraph.js';

/**
 * Опции генерации диаграммы
 */
export interface MermaidOptions {
  /** Направление графа: TD (сверху-вниз), LR (слева-направо) */
  direction: 'TD' | 'LR' | 'BT' | 'RL';
  
  /** Показывать даты */
  showDates: boolean;
  
  /** Показывать статус */
  showStatus: boolean;
  
  /** Максимальная длина названия */
  maxTitleLength: number;
  
  /** Тема (цвета) */
  theme: 'default' | 'forest' | 'dark';
}

const DEFAULT_OPTIONS: MermaidOptions = {
  direction: 'TD',
  showDates: false,
  showStatus: true,
  maxTitleLength: 30,
  theme: 'default'
};

/**
 * Цвета для статусов
 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  active: '#90EE90',      // Light green
  completed: '#87CEEB',   // Light blue  
  transferred: '#FFD700', // Gold
  cancelled: '#D3D3D3'    // Light gray
};

/**
 * Стили стрелок для типов связей
 */
const LINK_STYLES: Record<TaskLinkType, { label: string; style: string }> = {
  spawned: { label: 'spawned', style: '-->' },
  transferred: { label: 'transferred', style: '==>' },
  related: { label: 'related', style: '-.->' },
  parent: { label: 'parent', style: '-->' },
  blocks: { label: 'blocks', style: '--x' },
  depends_on: { label: 'depends', style: '-.->'}
};

/**
 * Генератор Mermaid диаграмм
 */
export class MermaidGenerator {
  private options: MermaidOptions;
  
  constructor(options?: Partial<MermaidOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }
  
  /**
   * Генерирует Mermaid диаграмму из результата поиска подграфа
   */
  generateFromSearchResult(result: TaskGraphSearchResult): string {
    return this.generate(result.tasks, result.links);
  }
  
  /**
   * Генерирует Mermaid диаграмму
   */
  generate(nodes: TaskNode[], links: TaskLink[]): string {
    if (nodes.length === 0) {
      return '```mermaid\ngraph TD\n    empty[No tasks found]\n```';
    }
    
    const lines: string[] = [];
    
    // Header
    lines.push('```mermaid');
    lines.push(`graph ${this.options.direction}`);
    lines.push('');
    
    // Nodes
    lines.push('    %% Nodes');
    for (const node of nodes) {
      const nodeId = this.sanitizeId(node.id);
      const label = this.formatNodeLabel(node);
      const shape = this.getNodeShape(node.status);
      
      lines.push(`    ${nodeId}${shape.open}${label}${shape.close}`);
    }
    lines.push('');
    
    // Links
    if (links.length > 0) {
      lines.push('    %% Links');
      for (const link of links) {
        const fromId = this.sanitizeId(link.from);
        const toId = this.sanitizeId(link.to);
        const style = LINK_STYLES[link.type] || LINK_STYLES.related;
        
        lines.push(`    ${fromId} ${style.style}|${style.label}| ${toId}`);
      }
      lines.push('');
    }
    
    // Styles
    lines.push('    %% Styles');
    for (const node of nodes) {
      const nodeId = this.sanitizeId(node.id);
      const color = STATUS_COLORS[node.status];
      lines.push(`    style ${nodeId} fill:${color}`);
    }
    
    lines.push('```');
    
    return lines.join('\n');
  }
  
  /**
   * Генерирует легенду
   */
  generateLegend(): string {
    const lines: string[] = [];
    
    lines.push('```mermaid');
    lines.push('graph LR');
    lines.push('    subgraph Legend');
    lines.push('    active[Active]');
    lines.push('    completed[Completed]');
    lines.push('    transferred[Transferred]');
    lines.push('    cancelled[Cancelled]');
    lines.push('    end');
    lines.push('');
    lines.push('    style active fill:#90EE90');
    lines.push('    style completed fill:#87CEEB');
    lines.push('    style transferred fill:#FFD700');
    lines.push('    style cancelled fill:#D3D3D3');
    lines.push('```');
    
    return lines.join('\n');
  }
  
  /**
   * Генерирует простую диаграмму для одной задачи с её связями
   */
  generateTaskView(
    task: TaskNode, 
    outgoingLinks: TaskLink[], 
    incomingLinks: TaskLink[],
    relatedTasks: TaskNode[]
  ): string {
    const lines: string[] = [];
    
    lines.push('```mermaid');
    lines.push('graph TD');
    lines.push('');
    
    // Central task
    const taskId = this.sanitizeId(task.id);
    const taskLabel = this.formatNodeLabel(task);
    lines.push(`    ${taskId}[["${taskLabel}"]]`);
    lines.push(`    style ${taskId} fill:${STATUS_COLORS[task.status]},stroke:#333,stroke-width:3px`);
    lines.push('');
    
    // Related tasks and links
    for (const related of relatedTasks) {
      const relatedId = this.sanitizeId(related.id);
      const relatedLabel = this.formatNodeLabel(related);
      lines.push(`    ${relatedId}[${relatedLabel}]`);
      lines.push(`    style ${relatedId} fill:${STATUS_COLORS[related.status]}`);
    }
    lines.push('');
    
    // Outgoing links
    for (const link of outgoingLinks) {
      const toId = this.sanitizeId(link.to);
      const style = LINK_STYLES[link.type] || LINK_STYLES.related;
      lines.push(`    ${taskId} ${style.style}|${style.label}| ${toId}`);
    }
    
    // Incoming links
    for (const link of incomingLinks) {
      const fromId = this.sanitizeId(link.from);
      const style = LINK_STYLES[link.type] || LINK_STYLES.related;
      lines.push(`    ${fromId} ${style.style}|${style.label}| ${taskId}`);
    }
    
    lines.push('```');
    
    return lines.join('\n');
  }
  
  /**
   * Генерирует статистическую диаграмму (pie chart)
   */
  generateStatsChart(stats: {
    active: number;
    completed: number;
    transferred: number;
    cancelled: number;
  }): string {
    const total = stats.active + stats.completed + stats.transferred + stats.cancelled;
    
    if (total === 0) {
      return '```mermaid\npie title Task Status\n    "No tasks" : 1\n```';
    }
    
    const lines: string[] = [];
    
    lines.push('```mermaid');
    lines.push('pie title Task Status Distribution');
    
    if (stats.active > 0) lines.push(`    "Active" : ${stats.active}`);
    if (stats.completed > 0) lines.push(`    "Completed" : ${stats.completed}`);
    if (stats.transferred > 0) lines.push(`    "Transferred" : ${stats.transferred}`);
    if (stats.cancelled > 0) lines.push(`    "Cancelled" : ${stats.cancelled}`);
    
    lines.push('```');
    
    return lines.join('\n');
  }
  
  /**
   * Форматирует label узла
   */
  private formatNodeLabel(node: TaskNode): string {
    let label = node.title;
    
    // Truncate if too long
    if (label.length > this.options.maxTitleLength) {
      label = label.slice(0, this.options.maxTitleLength - 3) + '...';
    }
    
    // Add status emoji
    if (this.options.showStatus) {
      const statusEmoji = this.getStatusEmoji(node.status);
      label = `${statusEmoji} ${label}`;
    }
    
    // Escape special characters
    label = label.replace(/"/g, "'").replace(/[[\]]/g, '');
    
    return label;
  }
  
  /**
   * Возвращает форму узла по статусу
   */
  private getNodeShape(status: TaskStatus): { open: string; close: string } {
    switch (status) {
      case 'active':
        return { open: '([', close: '])' };  // Stadium shape
      case 'completed':
        return { open: '[[', close: ']]' };  // Subroutine shape
      case 'transferred':
        return { open: '{{', close: '}}' };  // Hexagon
      case 'cancelled':
        return { open: '(', close: ')' };    // Rounded
      default:
        return { open: '[', close: ']' };    // Rectangle
    }
  }
  
  /**
   * Возвращает emoji для статуса
   */
  private getStatusEmoji(status: TaskStatus): string {
    switch (status) {
      case 'active': return '🟢';
      case 'completed': return '✅';
      case 'transferred': return '➡️';
      case 'cancelled': return '❌';
      default: return '⚪';
    }
  }
  
  /**
   * Очищает ID для использования в Mermaid
   */
  private sanitizeId(id: string): string {
    return id
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50);
  }
}

// Singleton
let generatorInstance: MermaidGenerator | null = null;

export function getMermaidGenerator(options?: Partial<MermaidOptions>): MermaidGenerator {
  if (!generatorInstance || options) {
    generatorInstance = new MermaidGenerator(options);
  }
  return generatorInstance;
}
