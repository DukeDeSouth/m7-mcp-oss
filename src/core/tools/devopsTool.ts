/**
 * M7 DevOps Tool
 * 
 * MCP tool для управления DevOps конфигурацией проекта.
 * Позволяет AI безопасно работать с деплоями.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { DevOpsRegistry, getDevOpsRegistry } from '../devops/devopsRegistry.js';
import { 
  DevOpsConfig, 
  CommandValidation, 
  DeploymentRecord,
  DEFAULT_DANGER_MESSAGES 
} from '../types/devops.js';

const log = createLogger('[DevOpsTool]');

/**
 * Schema для DevOps Tool
 */
export const DevOpsToolSchema = z.object({
  action: z.enum([
    'status',        // Текущий статус DevOps конфига
    'environments',  // Список environments
    'deploy',        // Инициировать деплой (с валидацией)
    'validate',      // Проверить команду на безопасность
    'history',       // История деплоев
    'learn',         // Обучить новой команде
    'wizard',        // Запустить wizard настройки
    'confirm'        // Подтвердить действие (деплой/обучение)
  ]).describe('Действие'),
  
  environment: z.string().optional()
    .describe('Environment (prod, staging, dev)'),
  
  version: z.string().optional()
    .describe('Версия для деплоя'),
  
  command: z.string().optional()
    .describe('Команда для валидации или обучения'),
  
  description: z.string().optional()
    .describe('Описание команды при обучении'),
  
  confirmed: z.boolean().optional()
    .describe('Подтверждение опасного действия'),
  
  limit: z.number().optional()
    .describe('Лимит записей для history')
});

export type DevOpsToolArgs = z.infer<typeof DevOpsToolSchema>;

/**
 * Результат работы tool
 */
interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  suggestion?: string;
}

/**
 * Обработчик DevOps Tool
 */
export async function handleDevOpsTool(args: DevOpsToolArgs): Promise<ToolResult> {
  const registry = getDevOpsRegistry();
  
  try {
    switch (args.action) {
      case 'status':
        return await handleStatus(registry);
        
      case 'environments':
        return await handleEnvironments(registry);
        
      case 'deploy':
        return await handleDeploy(registry, args);
        
      case 'validate':
        return await handleValidate(registry, args);
        
      case 'history':
        return await handleHistory(registry, args);
        
      case 'learn':
        return await handleLearn(registry, args);
        
      case 'wizard':
        return await handleWizard(registry);
        
      case 'confirm':
        return await handleConfirm(registry, args);
        
      default:
        return {
          success: false,
          error: `Неизвестное действие: ${args.action}`
        };
    }
  } catch (error: any) {
    log.error(`DevOpsTool error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Status: текущее состояние DevOps
 */
async function handleStatus(registry: DevOpsRegistry): Promise<ToolResult> {
  const exists = await registry.exists();
  
  if (!exists) {
    return {
      success: true,
      data: {
        configured: false,
        message: '⚠️ DevOps не настроен для этого проекта'
      },
      suggestion: 'Используйте action="wizard" для настройки DevOps'
    };
  }
  
  await registry.initialize();
  const summary = registry.getSummary();
  
  return {
    success: true,
    data: {
      configured: true,
      environments: summary.environments,
      scripts: summary.scripts,
      lastDeployment: summary.lastDeployment
    },
    message: `✅ DevOps настроен: ${summary.environments.length} environments, ${summary.scripts.length} scripts`
  };
}

/**
 * Environments: список сред
 */
async function handleEnvironments(registry: DevOpsRegistry): Promise<ToolResult> {
  const initialized = await registry.initialize();
  
  if (!initialized) {
    return {
      success: false,
      error: 'DevOps не настроен',
      suggestion: 'Используйте action="wizard" для настройки'
    };
  }
  
  const environments = registry.getEnvironments();
  const envList = Object.entries(environments).map(([name, env]) => ({
    name,
    url: env.url,
    dangerLevel: env.dangerLevel,
    branch: env.branch,
    requiresConfirmation: env.requiresConfirmation,
    deployCommand: env.deployCommand ? '✓' : '✗'
  }));
  
  return {
    success: true,
    data: { environments: envList },
    message: `Найдено ${envList.length} environments`
  };
}

/**
 * Deploy: инициировать деплой
 */
async function handleDeploy(
  registry: DevOpsRegistry, 
  args: DevOpsToolArgs
): Promise<ToolResult> {
  // 1. Проверка конфига
  const initialized = await registry.initialize();
  if (!initialized) {
    return {
      success: false,
      error: '🚫 DevOps не настроен — деплой заблокирован',
      suggestion: 'Используйте action="wizard" для настройки DevOps перед деплоем'
    };
  }
  
  // 2. Проверка environment
  if (!args.environment) {
    return {
      success: false,
      error: 'Не указан environment',
      suggestion: 'Укажите environment: "prod", "staging", "dev"'
    };
  }
  
  const envName = registry.resolveEnvironmentName(args.environment);
  if (!envName) {
    const available = Object.keys(registry.getEnvironments());
    return {
      success: false,
      error: `Environment "${args.environment}" не найден`,
      data: { available },
      suggestion: `Доступные environments: ${available.join(', ')}`
    };
  }
  
  const env = registry.getEnvironment(envName);
  if (!env) {
    return {
      success: false,
      error: `Environment "${envName}" не настроен`
    };
  }
  
  // 3. Получить команду деплоя
  const version = args.version || 'latest';
  const deployCommand = registry.getDeployCommand(envName, version);
  
  if (!deployCommand) {
    return {
      success: false,
      error: `Команда деплоя не настроена для ${envName}`,
      suggestion: 'Добавьте deployCommand в конфигурацию environment'
    };
  }
  
  // 4. Валидация команды
  const validation = registry.validateCommand(deployCommand);
  
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.join('\n'),
      data: { blocked: true, command: deployCommand }
    };
  }
  
  // 5. Проверка на дубликат
  const duplicate = registry.isDuplicateDeployment(envName, version);
  if (duplicate.isDuplicate && !args.confirmed) {
    return {
      success: false,
      requiresConfirmation: true,
      confirmationMessage: `⚠️ Версия "${version}" уже задеплоена на ${envName} (${duplicate.existingDeployment?.deployedBy}).\n\nПовторить деплой?`,
      data: { 
        duplicate: true, 
        existing: duplicate.existingDeployment,
        command: deployCommand
      }
    };
  }
  
  // 6. Требуется подтверждение для опасных сред
  if (env.requiresConfirmation && !args.confirmed) {
    const dangerMsg = env.dangerMessage || DEFAULT_DANGER_MESSAGES[env.dangerLevel];
    return {
      success: false,
      requiresConfirmation: true,
      confirmationMessage: `${dangerMsg}\n\n📋 Деплой на ${envName}:\n  Версия: ${version}\n  Команда: \`${deployCommand}\`\n\nПодтвердить?`,
      data: {
        environment: envName,
        version,
        command: deployCommand,
        dangerLevel: env.dangerLevel
      }
    };
  }
  
  // 7. Всё готово — возвращаем команду для выполнения
  return {
    success: true,
    data: {
      action: 'execute',
      environment: envName,
      version,
      command: deployCommand,
      warnings: validation.warnings
    },
    message: `✅ Деплой на ${envName} готов к выполнению:\n\`${deployCommand}\`\n\n⚠️ После выполнения используйте action="confirm" для записи в историю`
  };
}

/**
 * Validate: проверка команды
 */
async function handleValidate(
  registry: DevOpsRegistry, 
  args: DevOpsToolArgs
): Promise<ToolResult> {
  if (!args.command) {
    return {
      success: false,
      error: 'Не указана команда для валидации'
    };
  }
  
  await registry.initialize();
  const validation = registry.validateCommand(args.command);
  
  return {
    success: true,
    data: validation,
    message: validation.valid 
      ? `✅ Команда безопасна${validation.warnings.length > 0 ? ` (${validation.warnings.length} предупреждений)` : ''}`
      : `🚫 Команда заблокирована: ${validation.errors.join(', ')}`
  };
}

/**
 * History: история деплоев
 */
async function handleHistory(
  registry: DevOpsRegistry, 
  args: DevOpsToolArgs
): Promise<ToolResult> {
  const initialized = await registry.initialize();
  if (!initialized) {
    return {
      success: false,
      error: 'DevOps не настроен'
    };
  }
  
  const limit = args.limit || 10;
  const history = args.environment 
    ? registry.getEnvironmentHistory(args.environment, limit)
    : registry.getDeploymentHistory(limit);
  
  return {
    success: true,
    data: { history },
    message: `Найдено ${history.length} записей`
  };
}

/**
 * Learn: обучение новой команде
 */
async function handleLearn(
  registry: DevOpsRegistry, 
  args: DevOpsToolArgs
): Promise<ToolResult> {
  if (!args.command) {
    return {
      success: false,
      error: 'Не указана команда для обучения'
    };
  }
  
  await registry.initialize();
  
  // Если конфиг не существует, сначала создать
  const exists = await registry.exists();
  if (!exists) {
    return {
      success: false,
      error: 'DevOps не настроен',
      suggestion: 'Сначала запустите action="wizard" для создания базового конфига'
    };
  }
  
  const learned = await registry.learnCommand(
    args.command,
    args.environment,
    args.description
  );
  
  return {
    success: true,
    requiresConfirmation: true,
    confirmationMessage: learned.message,
    data: learned.data,
    suggestion: 'Подтвердите: action="confirm", confirmed=true'
  };
}

/**
 * Wizard: интерактивная настройка
 */
async function handleWizard(registry: DevOpsRegistry): Promise<ToolResult> {
  const exists = await registry.exists();
  
  if (exists) {
    return {
      success: true,
      message: '✅ DevOps уже настроен',
      suggestion: 'Используйте action="status" для просмотра конфигурации'
    };
  }
  
  // Создаём базовый конфиг из шаблона
  await registry.createFromTemplate();
  
  return {
    success: true,
    message: `🎉 DevOps Registry создан!\n\n` +
             `📁 Конфиг: .m7/devops.json\n\n` +
             `📝 Следующие шаги:\n` +
             `1. Отредактируйте environments под ваш проект\n` +
             `2. Добавьте реальные команды деплоя\n` +
             `3. Настройте forbidden patterns\n\n` +
             `Или используйте action="learn" для обучения из контекста`,
    data: {
      configPath: '.m7/devops.json',
      created: true
    }
  };
}

/**
 * Confirm: подтверждение действия
 */
async function handleConfirm(
  registry: DevOpsRegistry, 
  args: DevOpsToolArgs
): Promise<ToolResult> {
  const initialized = await registry.initialize();
  if (!initialized) {
    return {
      success: false,
      error: 'DevOps не настроен'
    };
  }
  
  // Запись успешного деплоя
  if (args.environment && args.version) {
    const command = registry.getDeployCommand(
      registry.resolveEnvironmentName(args.environment) || args.environment,
      args.version
    );
    
    const record = await registry.recordDeployment({
      environment: args.environment,
      version: args.version,
      timestamp: new Date().toISOString(),
      status: 'success',
      command: command || args.command || 'unknown'
    });
    
    return {
      success: true,
      data: { deployment: record },
      message: `✅ Деплой записан в историю: ${record.id}`
    };
  }
  
  return {
    success: false,
    error: 'Укажите environment и version для подтверждения деплоя'
  };
}

/**
 * Создаёт tool для регистрации в MCP server
 */
export function createDevOpsTool() {
  return {
    name: 'mcp_m7_devops',
    description: 'DevOps registry: управление средами, валидация команд, история деплоев',
    inputSchema: DevOpsToolSchema,
    handler: handleDevOpsTool
  };
}
