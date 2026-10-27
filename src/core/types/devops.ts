/**
 * M7 DevOps Registry Types
 * 
 * Типы для DevOps контекста проекта.
 * Хранит environments, scripts, deployment history.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

/**
 * Уровень опасности environment
 */
export type DangerLevel = 'safe' | 'moderate' | 'high' | 'critical';

/**
 * Статус деплоя
 */
export type DeploymentStatus = 'success' | 'failed' | 'in_progress' | 'rolled_back';

/**
 * Скрипт проекта
 */
export interface DevOpsScript {
  name: string;
  command: string;
  args?: string[];
  description?: string;
  dangerous?: boolean;
}

/**
 * Environment конфигурация
 */
export interface Environment {
  name: string;
  url?: string;
  cluster?: string;
  namespace?: string;
  branch?: string;
  dangerLevel: DangerLevel;
  requiresConfirmation: boolean;
  deployCommand?: string;
  rollbackCommand?: string;
  statusCommand?: string;
  dangerMessage?: string;
}

/**
 * Запись о деплое
 */
export interface DeploymentRecord {
  id: string;
  environment: string;
  service?: string;
  version: string;
  timestamp: string;
  status: DeploymentStatus;
  command: string;
  duration?: number;
  error?: string;
}

/**
 * Текущее состояние environment
 */
export interface EnvironmentState {
  environment: string;
  currentVersion: string;
  deployedAt: string;
  deployedBy: string;
}

/**
 * Запрещённая команда
 */
export interface ForbiddenCommand {
  pattern: string;
  reason: string;
}

/**
 * DevOps Registry конфигурация
 */
export interface DevOpsConfig {
  version: number;
  project: {
    name: string;
    repository?: string;
  };
  
  scripts: Record<string, DevOpsScript>;
  environments: Record<string, Environment>;
  
  forbidden: ForbiddenCommand[];
  
  state: {
    lastUpdated: string;
    currentDeployments: Record<string, EnvironmentState>;
    history: DeploymentRecord[];
  };
}

/**
 * Результат валидации команды
 */
export interface CommandValidation {
  valid: boolean;
  command: string;
  environment?: string;
  warnings: string[];
  errors: string[];
  requiresConfirmation: boolean;
  confirmationMessage?: string;
}

/**
 * Результат деплоя
 */
export interface DeployResult {
  success: boolean;
  deploymentId: string;
  environment: string;
  version: string;
  command: string;
  output?: string;
  error?: string;
  duration: number;
}

/**
 * Константы
 */
export const DEVOPS_CONFIG_PATH = '.m7/devops.json';
export const DEVOPS_VERSION = 1;

export const DEFAULT_DANGER_MESSAGES: Record<DangerLevel, string> = {
  safe: '',
  moderate: '⚠️ Проверьте изменения перед деплоем',
  high: '🔴 ВНИМАНИЕ: Это важный environment, будьте осторожны',
  critical: '🚨 КРИТИЧНО: Production deployment требует подтверждения!'
};

/**
 * Шаблон devops.json
 */
export const DEVOPS_TEMPLATE: DevOpsConfig = {
  version: 1,
  project: {
    name: 'my-project',
    repository: 'github.com/company/my-project'
  },
  scripts: {
    deploy: {
      name: 'deploy',
      command: './scripts/deploy.sh',
      args: ['env', 'version'],
      description: 'Deploy to environment'
    },
    rollback: {
      name: 'rollback',
      command: './scripts/rollback.sh',
      args: ['env'],
      description: 'Rollback to previous version'
    },
    status: {
      name: 'status',
      command: './scripts/status.sh',
      args: ['env'],
      description: 'Check environment status'
    }
  },
  environments: {
    development: {
      name: 'development',
      url: 'https://dev.myapp.com',
      dangerLevel: 'safe',
      requiresConfirmation: false,
      deployCommand: './scripts/deploy.sh dev {version}'
    },
    staging: {
      name: 'staging',
      url: 'https://staging.myapp.com',
      cluster: 'staging-cluster',
      namespace: 'staging',
      branch: 'develop',
      dangerLevel: 'moderate',
      requiresConfirmation: false,
      deployCommand: './scripts/deploy.sh staging {version}'
    },
    production: {
      name: 'production',
      url: 'https://myapp.com',
      cluster: 'prod-cluster',
      namespace: 'production',
      branch: 'main',
      dangerLevel: 'critical',
      requiresConfirmation: true,
      deployCommand: './scripts/deploy.sh production {version}',
      rollbackCommand: './scripts/rollback.sh production',
      dangerMessage: '🚨 PRODUCTION: Требуется подтверждение!'
    }
  },
  forbidden: [
    { pattern: 'rm -rf /', reason: 'Удаление корневой директории' },
    { pattern: 'kubectl delete namespace production', reason: 'Удаление production namespace' },
    { pattern: 'drop database', reason: 'Удаление базы данных' }
  ],
  state: {
    lastUpdated: '',
    currentDeployments: {},
    history: []
  }
};
