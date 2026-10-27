/**
 * M7 DevOps Registry
 * 
 * Управляет DevOps контекстом проекта.
 * Читает .m7/devops.yaml, хранит историю деплоев,
 * валидирует команды, интегрируется с warmup.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath } from '../utils/projectPath.js';
import {
  DevOpsConfig,
  Environment,
  DevOpsScript,
  DeploymentRecord,
  EnvironmentState,
  CommandValidation,
  DeployResult,
  ForbiddenCommand,
  DangerLevel,
  DEVOPS_CONFIG_PATH,
  DEVOPS_VERSION,
  DEVOPS_TEMPLATE,
  DEFAULT_DANGER_MESSAGES
} from '../types/devops.js';

const log = createLogger('[DevOpsRegistry]');

/**
 * DevOps Registry Manager
 */
export class DevOpsRegistry {
  private projectPath: string;
  private configPath: string;
  private config: DevOpsConfig | null = null;
  private initialized: boolean = false;
  
  constructor(projectPath?: string) {
    this.projectPath = projectPath || getProjectPath();
    this.configPath = path.join(this.projectPath, DEVOPS_CONFIG_PATH);
  }
  
  /**
   * Инициализирует registry
   */
  async initialize(): Promise<boolean> {
    if (this.initialized && this.config) {
      return true;
    }
    
    try {
      await this.loadConfig();
      this.initialized = true;
      return true;
    } catch (e: any) {
      log.debug(`DevOpsRegistry] Not initialized: ${e.message}`);
      return false;
    }
  }
  
  /**
   * Проверяет существует ли конфиг
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Загружает конфигурацию из JSON
   */
  async loadConfig(): Promise<DevOpsConfig> {
    const content = await fs.readFile(this.configPath, 'utf-8');
    this.config = JSON.parse(content) as DevOpsConfig;
    
    // Validate and set defaults
    if (!this.config.version) this.config.version = DEVOPS_VERSION;
    if (!this.config.scripts) this.config.scripts = {};
    if (!this.config.environments) this.config.environments = {};
    if (!this.config.forbidden) this.config.forbidden = [];
    if (!this.config.state) {
      this.config.state = {
        lastUpdated: new Date().toISOString(),
        currentDeployments: {},
        history: []
      };
    }
    
    return this.config;
  }
  
  /**
   * Сохраняет конфигурацию
   */
  async saveConfig(): Promise<void> {
    if (!this.config) return;
    
    this.config.state.lastUpdated = new Date().toISOString();
    
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    
    const content = JSON.stringify(this.config, null, 2);
    await fs.writeFile(this.configPath, content);
  }
  
  /**
   * Создаёт новый конфиг из шаблона
   */
  async createFromTemplate(projectName?: string): Promise<void> {
    const template = JSON.parse(JSON.stringify(DEVOPS_TEMPLATE)); // Deep copy
    
    if (projectName) {
      template.project.name = projectName;
    }
    
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(this.configPath, JSON.stringify(template, null, 2));
    await this.loadConfig();
  }
  
  /**
   * Получает все environments
   */
  getEnvironments(): Record<string, Environment> {
    return this.config?.environments || {};
  }
  
  /**
   * Получает environment по имени или алиасу
   */
  getEnvironment(nameOrAlias: string): Environment | null {
    if (!this.config?.environments) return null;
    
    const lower = nameOrAlias.toLowerCase();
    
    // Direct match
    if (this.config.environments[nameOrAlias]) {
      return this.config.environments[nameOrAlias];
    }
    
    // Alias match
    const aliases: Record<string, string[]> = {
      'production': ['prod', 'prd', 'live'],
      'staging': ['stage', 'stg', 'preprod'],
      'development': ['dev', 'develop']
    };
    
    for (const [envName, envAliases] of Object.entries(aliases)) {
      if (envAliases.includes(lower) && this.config.environments[envName]) {
        return this.config.environments[envName];
      }
    }
    
    // Partial match
    for (const [envName, env] of Object.entries(this.config.environments)) {
      if (envName.toLowerCase().includes(lower) || lower.includes(envName.toLowerCase())) {
        return env;
      }
    }
    
    return null;
  }
  
  /**
   * Resolves alias to actual environment name
   */
  resolveEnvironmentName(nameOrAlias: string): string | null {
    if (!this.config?.environments) return null;
    
    const lower = nameOrAlias.toLowerCase();
    
    // Direct match
    if (this.config.environments[nameOrAlias]) {
      return nameOrAlias;
    }
    
    // Alias match
    const aliases: Record<string, string[]> = {
      'production': ['prod', 'prd', 'live'],
      'staging': ['stage', 'stg', 'preprod'],
      'development': ['dev', 'develop']
    };
    
    for (const [envName, envAliases] of Object.entries(aliases)) {
      if (envAliases.includes(lower) && this.config.environments[envName]) {
        return envName;
      }
    }
    
    return null;
  }
  
  /**
   * Получает все скрипты
   */
  getScripts(): Record<string, DevOpsScript> {
    return this.config?.scripts || {};
  }
  
  /**
   * Получает текущее состояние environment
   */
  getCurrentDeployment(env: string): EnvironmentState | null {
    return this.config?.state?.currentDeployments?.[env] || null;
  }
  
  /**
   * Получает историю деплоев
   */
  getDeploymentHistory(limit: number = 10): DeploymentRecord[] {
    const history = this.config?.state?.history || [];
    return history.slice(-limit).reverse();
  }
  
  /**
   * Получает историю для конкретного environment
   */
  getEnvironmentHistory(env: string, limit: number = 5): DeploymentRecord[] {
    const history = this.config?.state?.history || [];
    return history
      .filter(d => d.environment === env)
      .slice(-limit)
      .reverse();
  }
  
  /**
   * Валидирует команду на запрещённые паттерны
   */
  validateCommand(command: string): CommandValidation {
    const result: CommandValidation = {
      valid: true,
      command,
      warnings: [],
      errors: [],
      requiresConfirmation: false
    };
    
    // Check forbidden patterns
    for (const forbidden of this.config?.forbidden || []) {
      if (command.toLowerCase().includes(forbidden.pattern.toLowerCase())) {
        result.valid = false;
        result.errors.push(`🚫 Запрещённая команда: ${forbidden.reason}`);
      }
    }
    
    // Detect environment from command
    for (const [envName, env] of Object.entries(this.config?.environments || {})) {
      if (command.includes(envName)) {
        result.environment = envName;
        
        if (env.requiresConfirmation) {
          result.requiresConfirmation = true;
          result.confirmationMessage = env.dangerMessage || DEFAULT_DANGER_MESSAGES[env.dangerLevel];
        }
        
        if (env.dangerLevel === 'high' || env.dangerLevel === 'critical') {
          result.warnings.push(DEFAULT_DANGER_MESSAGES[env.dangerLevel]);
        }
        
        break;
      }
    }
    
    return result;
  }
  
  /**
   * Проверяет на дубликат деплоя
   */
  isDuplicateDeployment(env: string, version: string): { isDuplicate: boolean; existingDeployment?: EnvironmentState } {
    const current = this.getCurrentDeployment(env);
    
    if (current && current.currentVersion === version) {
      const deployedAgo = Date.now() - new Date(current.deployedAt).getTime();
      const minutesAgo = Math.round(deployedAgo / 60000);
      
      return {
        isDuplicate: true,
        existingDeployment: {
          ...current,
          deployedBy: `${minutesAgo} мин назад`
        }
      };
    }
    
    return { isDuplicate: false };
  }
  
  /**
   * Записывает деплой
   */
  async recordDeployment(record: Omit<DeploymentRecord, 'id'>): Promise<DeploymentRecord> {
    if (!this.config) {
      throw new Error('DevOps Registry not initialized');
    }
    
    const deployment: DeploymentRecord = {
      ...record,
      id: `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
    
    // Add to history
    if (!this.config.state.history) {
      this.config.state.history = [];
    }
    this.config.state.history.push(deployment);
    
    // Keep only last 100 records
    if (this.config.state.history.length > 100) {
      this.config.state.history = this.config.state.history.slice(-100);
    }
    
    // Update current state if successful
    if (record.status === 'success') {
      if (!this.config.state.currentDeployments) {
        this.config.state.currentDeployments = {};
      }
      
      this.config.state.currentDeployments[record.environment] = {
        environment: record.environment,
        currentVersion: record.version,
        deployedAt: record.timestamp,
        deployedBy: 'ai-session'
      };
    }
    
    await this.saveConfig();
    
    return deployment;
  }
  
  /**
   * Генерирует отчёт для warmup
   */
  async generateWarmupReport(): Promise<string> {
    if (!this.config) {
      return '';
    }
    
    let report = `## 🚀 DevOps Configuration\n\n`;
    
    // Environments
    const envs = Object.entries(this.config.environments);
    if (envs.length > 0) {
      report += `### Environments\n\n`;
      report += `| Env | URL | Danger | Branch |\n`;
      report += `|-----|-----|--------|--------|\n`;
      
      for (const [name, env] of envs) {
        const dangerIcon = env.dangerLevel === 'critical' ? '🔴' :
                          env.dangerLevel === 'high' ? '🟠' :
                          env.dangerLevel === 'moderate' ? '🟡' : '🟢';
        report += `| **${name}** | ${env.url || 'N/A'} | ${dangerIcon} ${env.dangerLevel} | ${env.branch || '*'} |\n`;
      }
      report += `\n`;
    }
    
    // Current deployments
    const deployments = Object.entries(this.config.state?.currentDeployments || {});
    if (deployments.length > 0) {
      report += `### Current Deployments\n\n`;
      report += `| Environment | Version | Deployed |\n`;
      report += `|-------------|---------|----------|\n`;
      
      for (const [env, state] of deployments) {
        const date = new Date(state.deployedAt).toLocaleString();
        report += `| ${env} | **${state.currentVersion}** | ${date} |\n`;
      }
      report += `\n`;
    }
    
    // Scripts
    const scripts = Object.entries(this.config.scripts);
    if (scripts.length > 0) {
      report += `### Available Scripts\n\n`;
      for (const [name, script] of scripts) {
        report += `- **${name}**: \`${script.command}\``;
        if (script.description) report += ` — ${script.description}`;
        report += `\n`;
      }
      report += `\n`;
    }
    
    // Forbidden commands
    if (this.config.forbidden.length > 0) {
      report += `### ⚠️ Forbidden Commands\n\n`;
      for (const cmd of this.config.forbidden) {
        report += `- \`${cmd.pattern}\` — ${cmd.reason}\n`;
      }
      report += `\n`;
    }
    
    // Recent history
    const history = this.getDeploymentHistory(5);
    if (history.length > 0) {
      report += `### Recent Deployments\n\n`;
      for (const d of history) {
        const statusIcon = d.status === 'success' ? '✅' :
                          d.status === 'failed' ? '❌' :
                          d.status === 'in_progress' ? '⏳' : '↩️';
        const date = new Date(d.timestamp).toLocaleString();
        report += `- ${statusIcon} ${d.environment}: ${d.version} (${date})\n`;
      }
      report += `\n`;
    }
    
    return report;
  }
  
  /**
   * Получает команду для деплоя
   */
  getDeployCommand(env: string, version: string): string | null {
    const environment = this.getEnvironment(env);
    if (!environment?.deployCommand) return null;
    
    return environment.deployCommand
      .replace('{version}', version)
      .replace('{env}', env);
  }
  
  /**
   * Получает команду для rollback
   */
  getRollbackCommand(env: string): string | null {
    const environment = this.getEnvironment(env);
    return environment?.rollbackCommand || null;
  }
  
  /**
   * Обучает Registry новой команде из контекста
   * Возвращает объект для подтверждения пользователем
   */
  async learnCommand(
    command: string,
    environment?: string,
    description?: string
  ): Promise<{
    needsConfirmation: true;
    type: 'script' | 'environment';
    data: any;
    message: string;
  }> {
    // Detect if this looks like a deploy command
    const deployPatterns = [
      /deploy/i, /push/i, /release/i, /publish/i,
      /деплой/i, /выкат/i, /релиз/i
    ];
    
    const isDeployCommand = deployPatterns.some(p => p.test(command));
    
    // Try to detect environment from command
    let detectedEnv = environment;
    if (!detectedEnv) {
      const envPatterns = [
        { pattern: /prod|production|live/i, env: 'production' },
        { pattern: /staging|stage|preprod/i, env: 'staging' },
        { pattern: /dev|develop/i, env: 'development' }
      ];
      
      for (const { pattern, env } of envPatterns) {
        if (pattern.test(command)) {
          detectedEnv = env;
          break;
        }
      }
    }
    
    if (isDeployCommand && detectedEnv) {
      return {
        needsConfirmation: true,
        type: 'script',
        data: {
          name: `deploy-${detectedEnv}`,
          command,
          environment: detectedEnv,
          description: description || `Deploy to ${detectedEnv}`
        },
        message: `🎓 Обнаружена команда деплоя:\n` +
                 `  Команда: \`${command}\`\n` +
                 `  Environment: ${detectedEnv}\n\n` +
                 `Сохранить эту команду в DevOps Registry?`
      };
    }
    
    // Generic script
    return {
      needsConfirmation: true,
      type: 'script',
      data: {
        name: `script-${Date.now()}`,
        command,
        description: description || 'Learned from context'
      },
      message: `🎓 Обнаружена новая команда:\n` +
               `  Команда: \`${command}\`\n\n` +
               `Сохранить в DevOps Registry?`
    };
  }
  
  /**
   * Подтверждает и сохраняет изученную команду
   */
  async confirmLearned(
    type: 'script' | 'environment',
    data: any
  ): Promise<void> {
    if (!this.config) {
      throw new Error('DevOps Registry not initialized');
    }
    
    if (type === 'script') {
      const scriptName = data.name || `script-${Date.now()}`;
      this.config.scripts[scriptName] = {
        name: data.name,
        command: data.command,
        description: data.description
      };
      
      // If environment specified, update deploy command
      if (data.environment && this.config.environments[data.environment]) {
        this.config.environments[data.environment].deployCommand = data.command;
      }
    }
    
    await this.saveConfig();
    log.info(`Learned ${type}: ${data.name || data.command}`);
  }
  
  /**
   * Проверяет настроен ли DevOps для проекта
   */
  isConfigured(): boolean {
    return this.initialized && this.config !== null;
  }
  
  /**
   * Получает summary для быстрого обзора
   */
  getSummary(): {
    configured: boolean;
    environments: string[];
    scripts: string[];
    lastDeployment: DeploymentRecord | null;
  } {
    if (!this.config) {
      return {
        configured: false,
        environments: [],
        scripts: [],
        lastDeployment: null
      };
    }
    
    const history = this.config.state?.history || [];
    
    return {
      configured: true,
      environments: Object.keys(this.config.environments),
      scripts: Object.keys(this.config.scripts),
      lastDeployment: history.length > 0 ? history[history.length - 1] : null
    };
  }
}

// Singleton
let instance: DevOpsRegistry | null = null;

export function getDevOpsRegistry(projectPath?: string): DevOpsRegistry {
  if (!instance) {
    instance = new DevOpsRegistry(projectPath);
  }
  return instance;
}

export function resetDevOpsRegistry(): void {
  instance = null;
}
