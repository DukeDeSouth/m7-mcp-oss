import { createLogger } from '../utils/logger.js';
const log = createLogger('[healthCheck]');
/**
 * M7 v3.3 - Health Check Module
 * 
 * Проверка состояния всех компонентов системы
 * и автоматический запуск Docker при необходимости
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface ComponentStatus {
  name: string;
  status: 'online' | 'offline' | 'degraded';
  message?: string;
  action?: string;
}

export interface SystemHealth {
  components: ComponentStatus[];
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  dockerStartAttempted?: boolean;
  dockerStartSuccess?: boolean;
  checkDuration: number;
}

// ============================================================================
// Cache
// ============================================================================

let cachedHealth: SystemHealth | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 60 секунд

// ============================================================================
// Component Checks
// ============================================================================

/**
 * Проверка ChromaDB (Vector Memory)
 */
async function checkChromaDB(): Promise<ComponentStatus> {
  const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    // ChromaDB v2 API uses /api/v2/heartbeat
    const response = await fetch(`${chromaUrl}/api/v2/heartbeat`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      return { name: 'Vector Memory (ChromaDB)', status: 'online' };
    }
    return { 
      name: 'Vector Memory (ChromaDB)', 
      status: 'offline',
      message: 'Not healthy',
      action: 'docker compose up -d'
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { 
        name: 'Vector Memory (ChromaDB)', 
        status: 'offline',
        message: 'Connection timeout',
        action: 'docker compose up -d'
      };
    }
    return { 
      name: 'Vector Memory (ChromaDB)', 
      status: 'offline',
      message: 'Not running',
      action: 'docker compose up -d'
    };
  }
}

/**
 * Проверка OpenAI API
 */
function checkOpenAI(): ComponentStatus {
  if (!process.env.OPENAI_API_KEY) {
    return { 
      name: 'OpenAI API', 
      status: 'offline', 
      message: 'API key not set',
      action: 'export OPENAI_API_KEY=your_key'
    };
  }
  return { name: 'OpenAI API', status: 'online' };
}

/**
 * Проверка Anthropic API
 */
function checkAnthropic(): ComponentStatus {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { 
      name: 'Anthropic API', 
      status: 'offline', 
      message: 'API key not set',
      action: 'export ANTHROPIC_API_KEY=your_key'
    };
  }
  return { name: 'Anthropic API', status: 'online' };
}

/**
 * Проверка M7 Core
 */
function checkM7Core(): ComponentStatus {
  return { name: 'M7 Core', status: 'online' };
}

// ============================================================================
// Docker Auto-Start
// ============================================================================

/**
 * Попытаться автоматически запустить Docker
 */
export async function tryStartDocker(): Promise<boolean> {
  try {
    // Найти docker-compose.yml
    const possiblePaths = [
      path.join(process.cwd(), 'docker-compose.yml'),
      path.join(process.cwd(), 'docker-compose.yaml'),
      path.join(process.cwd(), 'compose.yml'),
      path.join(process.cwd(), 'compose.yaml'),
    ];
    
    let composeFile: string | null = null;
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        composeFile = p;
        break;
      }
    }
    
    if (!composeFile) {
      log.debug('M7 Health] No docker-compose file found, skipping auto-start');
      return false;
    }
    
    // Проверить запущен ли Docker daemon
    try {
      await execAsync('docker info', { timeout: 5000 });
    } catch {
      log.debug('M7 Health] Docker daemon not running');
      return false;
    }
    
    // Попробовать запустить
    log.debug('M7 Health] Attempting to start Docker containers...');
    const composeDir = path.dirname(composeFile);
    
    await execAsync('docker compose up -d', { 
      timeout: 30000,
      cwd: composeDir
    });
    
    // Подождать пока ChromaDB станет доступен (до 15 секунд)
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`${chromaUrl}/api/v2/heartbeat`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        
        if (response.ok) {
          log.debug('M7 Health] ✅ Docker containers started successfully!');
          return true;
        }
      } catch {
        // Продолжаем ждать
      }
    }
    
    log.debug('M7 Health] ⚠️ Docker started but ChromaDB not responding');
    return false;
    
  } catch (error: any) {
    log.debug(`M7 Health] Failed to start Docker: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Main Health Check
// ============================================================================

/**
 * Проверить состояние всех компонентов системы
 */
export async function checkSystemHealth(options?: {
  autoStartDocker?: boolean;
  skipCache?: boolean;
}): Promise<SystemHealth> {
  const { autoStartDocker = true, skipCache = false } = options || {};
  
  // Проверить кеш
  if (!skipCache && cachedHealth && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return cachedHealth;
  }
  
  const startTime = Date.now();
  
  // Собрать статусы компонентов
  const components: ComponentStatus[] = [
    checkM7Core(),
    await checkChromaDB(),
    checkOpenAI(),
    checkAnthropic(),
  ];
  
  let dockerStartAttempted = false;
  let dockerStartSuccess = false;
  
  // Если ChromaDB offline и autoStartDocker включен — попробовать запустить
  const chromaStatus = components.find(c => c.name.includes('ChromaDB'));
  if (chromaStatus?.status === 'offline' && autoStartDocker) {
    dockerStartAttempted = true;
    dockerStartSuccess = await tryStartDocker();
    
    // Если успешно запустили — обновить статус
    if (dockerStartSuccess) {
      const idx = components.findIndex(c => c.name.includes('ChromaDB'));
      if (idx !== -1) {
        components[idx] = { 
          name: 'Vector Memory (ChromaDB)', 
          status: 'online',
          message: 'Auto-started'
        };
      }
    }
  }
  
  // Определить общий статус
  const offlineCount = components.filter(c => c.status === 'offline').length;
  const degradedCount = components.filter(c => c.status === 'degraded').length;
  
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (offlineCount === 0 && degradedCount === 0) {
    overallStatus = 'healthy';
  } else if (offlineCount > 1) {
    overallStatus = 'unhealthy';
  } else {
    overallStatus = 'degraded';
  }
  
  const health: SystemHealth = {
    components,
    overallStatus,
    dockerStartAttempted,
    dockerStartSuccess,
    checkDuration: Date.now() - startTime,
  };
  
  // Сохранить в кеш
  cachedHealth = health;
  cacheTimestamp = Date.now();
  
  return health;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Форматировать статус системы для отображения в ответе M7
 */
export function formatHealthStatus(health: SystemHealth): string {
  const statusEmoji: Record<string, string> = {
    online: '✅',
    offline: '❌',
    degraded: '⚠️'
  };
  
  const overallEmoji: Record<string, string> = {
    healthy: '🟢',
    degraded: '🟡',
    unhealthy: '🔴'
  };

  // Если всё healthy — компактный вывод
  if (health.overallStatus === 'healthy') {
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 **System Status:** ${overallEmoji[health.overallStatus]} All systems operational
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  // Если есть проблемы — подробный вывод
  let result = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 **System Status:** ${overallEmoji[health.overallStatus]} ${health.overallStatus.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Component | Status |
|-----------|--------|
${health.components.map(c => 
  `| ${c.name} | ${statusEmoji[c.status]} ${c.message ? c.message : c.status} |`
).join('\n')}
`;

  // Добавить инструкции если что-то сломано
  const offlineComponents = health.components.filter(c => c.status === 'offline' && c.action);
  if (offlineComponents.length > 0) {
    result += `
### 🛠️ To fix:
${offlineComponents.map(c => `- **${c.name}**: \`${c.action}\``).join('\n')}
`;
  }

  // Информация о попытке auto-start
  if (health.dockerStartAttempted) {
    if (health.dockerStartSuccess) {
      result += `
💡 *Docker was auto-started successfully*
`;
    } else {
      result += `
⚠️ *Docker auto-start attempted but failed. Please start manually.*
`;
    }
  }

  return result;
}

/**
 * Сбросить кеш (для тестирования)
 */
export function clearHealthCache(): void {
  cachedHealth = null;
  cacheTimestamp = 0;
}
