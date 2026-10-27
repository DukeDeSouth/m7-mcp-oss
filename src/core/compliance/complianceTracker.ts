/**
 * M7 Compliance Tracker
 * 
 * Отслеживает соблюдение M7 полных циклов.
 * Хранит статистику для behavioral anchoring.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath } from '../utils/projectPath.js';
import {
  ComplianceConfig,
  ComplianceStats,
  ComplianceTrend,
  DayRecord,
  TaskRecord,
  M7Policy,
  COMPLIANCE_FILE,
  COMPLIANCE_VERSION,
  MAX_HISTORY_DAYS,
  DEFAULT_M7_POLICY
} from '../types/compliance.js';

const log = createLogger('[ComplianceTracker]');

/**
 * Compliance Tracker
 */
export class ComplianceTracker {
  private projectPath: string;
  private configPath: string;
  private config: ComplianceConfig | null = null;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
    this.configPath = path.join(this.projectPath, COMPLIANCE_FILE);
  }
  
  /**
   * Инициализация
   */
  async initialize(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(content);
      
      // Проверка версии
      if (this.config!.version !== COMPLIANCE_VERSION) {
        await this.migrate();
      }
      
      // Очистка старых записей
      await this.cleanupOldRecords();
      
    } catch {
      // Создаём новый конфиг
      this.config = {
        version: COMPLIANCE_VERSION,
        records: [],
        todayTasks: []
      };
      await this.save();
    }
  }
  
  /**
   * Миграция старой версии
   */
  private async migrate(): Promise<void> {
    // Пока просто пересоздаём
    this.config = {
      version: COMPLIANCE_VERSION,
      records: [],
      todayTasks: []
    };
    await this.save();
  }
  
  /**
   * Очистка старых записей
   */
  private async cleanupOldRecords(): Promise<void> {
    if (!this.config) return;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_HISTORY_DAYS);
    const cutoff = cutoffDate.toISOString().split('T')[0];
    
    this.config.records = this.config.records.filter(r => r.date >= cutoff);
    
    // Проверить что today записи относятся к сегодня
    const today = new Date().toISOString().split('T')[0];
    const firstTask = this.config.todayTasks[0];
    if (firstTask && !firstTask.timestamp.startsWith(today)) {
      // Агрегировать вчерашние задачи в history
      await this.aggregateYesterday();
    }
    
    await this.save();
  }
  
  /**
   * Агрегировать вчерашние задачи в историю
   */
  private async aggregateYesterday(): Promise<void> {
    if (!this.config || this.config.todayTasks.length === 0) return;
    
    const tasks = this.config.todayTasks;
    const date = tasks[0].timestamp.split('T')[0];
    
    const dayRecord: DayRecord = {
      date,
      totalTasks: tasks.length,
      fullCycleTasks: tasks.filter(t => t.isFullCycle).length,
      successfulTasks: tasks.filter(t => t.success).length,
      avgDuration: tasks.reduce((sum, t) => sum + (t.duration || 0), 0) / tasks.length
    };
    
    this.config.records.push(dayRecord);
    this.config.todayTasks = [];
    
    await this.save();
  }
  
  /**
   * Сохранение конфига
   */
  private async save(): Promise<void> {
    if (!this.config) return;
    
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }
  
  /**
   * Записать задачу
   */
  async recordTask(
    isFullCycle: boolean, 
    success: boolean = true,
    duration?: number,
    phases?: string[]
  ): Promise<void> {
    if (!this.config) await this.initialize();
    
    const record: TaskRecord = {
      id: `task_${Date.now()}`,
      timestamp: new Date().toISOString(),
      isFullCycle,
      success,
      duration,
      phases
    };
    
    this.config!.todayTasks.push(record);
    await this.save();
    
    log.debug(`Compliance] Recorded task: fullCycle=${isFullCycle}, success=${success}`);
  }
  
  /**
   * Получить статистику за сегодня
   */
  getTodayStats(): { tasks: number; fullCycle: number; rate: number } {
    if (!this.config) {
      return { tasks: 0, fullCycle: 0, rate: 0 };
    }
    
    const tasks = this.config.todayTasks;
    const total = tasks.length;
    const fullCycle = tasks.filter(t => t.isFullCycle).length;
    
    return {
      tasks: total,
      fullCycle,
      rate: total > 0 ? Math.round((fullCycle / total) * 100) : 0
    };
  }
  
  /**
   * Получить статистику за последние N дней
   */
  getStats(days: number = 7): ComplianceStats {
    if (!this.config) {
      return this.getEmptyStats();
    }
    
    const today = this.getTodayStats();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().split('T')[0];
    
    const recentRecords = this.config.records.filter(r => r.date >= cutoff);
    
    // Агрегаты за период
    const totalTasks = recentRecords.reduce((sum, r) => sum + r.totalTasks, 0) + today.tasks;
    const fullCycleTasks = recentRecords.reduce((sum, r) => sum + r.fullCycleTasks, 0) + today.fullCycle;
    const successfulTasks = recentRecords.reduce((sum, r) => sum + r.successfulTasks, 0);
    
    // Тренд
    const trend = this.calculateTrend(recentRecords);
    
    return {
      version: COMPLIANCE_VERSION,
      lastUpdated: new Date().toISOString(),
      today,
      history: recentRecords,
      last7Days: {
        tasks: totalTasks,
        fullCycle: fullCycleTasks,
        rate: totalTasks > 0 ? Math.round((fullCycleTasks / totalTasks) * 100) : 0,
        successRate: totalTasks > 0 ? Math.round((successfulTasks / totalTasks) * 100) : 0
      },
      trend
    };
  }
  
  /**
   * Расчёт тренда
   */
  private calculateTrend(records: DayRecord[]): ComplianceTrend {
    if (records.length < 3) return 'unknown';
    
    // Сравниваем первую и вторую половину периода
    const mid = Math.floor(records.length / 2);
    const firstHalf = records.slice(0, mid);
    const secondHalf = records.slice(mid);
    
    const firstRate = this.calculateRate(firstHalf);
    const secondRate = this.calculateRate(secondHalf);
    
    const diff = secondRate - firstRate;
    
    if (diff > 10) return 'improving';
    if (diff < -10) return 'declining';
    return 'stable';
  }
  
  /**
   * Расчёт rate для набора записей
   */
  private calculateRate(records: DayRecord[]): number {
    const total = records.reduce((sum, r) => sum + r.totalTasks, 0);
    const fullCycle = records.reduce((sum, r) => sum + r.fullCycleTasks, 0);
    return total > 0 ? (fullCycle / total) * 100 : 0;
  }
  
  /**
   * Пустая статистика
   */
  private getEmptyStats(): ComplianceStats {
    return {
      version: COMPLIANCE_VERSION,
      lastUpdated: new Date().toISOString(),
      today: { tasks: 0, fullCycle: 0, rate: 0 },
      history: [],
      last7Days: { tasks: 0, fullCycle: 0, rate: 0, successRate: 0 },
      trend: 'unknown'
    };
  }
  
  /**
   * Получить M7 Policy с текущей статистикой
   */
  async getPolicy(): Promise<M7Policy> {
    if (!this.config) await this.initialize();
    
    const stats = this.getStats(7);
    
    const trendEmoji = stats.trend === 'improving' ? '📈' :
                       stats.trend === 'declining' ? '📉' : '➡️';
    
    const trendText = stats.trend === 'improving' ? 'улучшается' :
                      stats.trend === 'declining' ? 'снижается' : 'стабильно';
    
    let statsMessage = '';
    if (stats.last7Days.tasks > 0) {
      statsMessage = `${trendEmoji} За 7 дней: ${stats.last7Days.rate}% full-cycle (${trendText})`;
    } else {
      statsMessage = '📊 Нет данных за последние 7 дней';
    }
    
    return {
      ...DEFAULT_M7_POLICY,
      currentStats: {
        rate: stats.last7Days.rate,
        trend: stats.trend,
        message: statsMessage
      }
    };
  }
  
  /**
   * Генерация policy section для warmup
   */
  async generatePolicySection(): Promise<string> {
    const policy = await this.getPolicy();
    
    let section = `## ⚡ M7 Operating Policy\n\n`;
    section += policy.shortText + '\n\n';
    
    if (policy.currentStats) {
      section += `**Статистика**: ${policy.currentStats.message}\n\n`;
    }
    
    return section;
  }
}

// Singleton
let instance: ComplianceTracker | null = null;

export function getComplianceTracker(projectPath?: string): ComplianceTracker {
  if (!instance) {
    instance = new ComplianceTracker(projectPath);
  }
  return instance;
}

export function resetComplianceTracker(): void {
  instance = null;
}
