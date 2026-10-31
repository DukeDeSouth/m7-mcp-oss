/**
 * M7 v3.3 - Health Check Module
 * 
 * Проверка состояния всех компонентов системы.
 * Только сообщает о состоянии — ничего не запускает на хосте.
 */

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
  const offline = (message: string): ComponentStatus => ({
    name: 'Vector Memory (ChromaDB)',
    status: 'offline',
    message,
    action: `optional: start ChromaDB at ${chromaUrl} or set CHROMA_URL; memory uses local JSON until then`,
  });
  
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
    return offline('Not healthy');
  } catch (error: any) {
    return offline(error.name === 'AbortError' ? 'Connection timeout' : 'Not running');
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
      action: '`export OPENAI_API_KEY=your_key`'
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
      action: '`export ANTHROPIC_API_KEY=your_key`'
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
// Main Health Check
// ============================================================================

/**
 * Проверить состояние всех компонентов системы
 */
export async function checkSystemHealth(options?: {
  skipCache?: boolean;
}): Promise<SystemHealth> {
  const { skipCache = false } = options || {};
  
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
${offlineComponents.map(c => `- **${c.name}**: ${c.action}`).join('\n')}
`;
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
