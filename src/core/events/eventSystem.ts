/**
 * M7 Event System v1.0
 * 
 * Система хуков и событий для жизненного цикла M7.
 * Позволяет подписываться на события и расширять функциональность.
 * 
 * @version 1.0.0
 * @since M7 v3.10.2
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('[Events]');

// ============================================================================
// Event Types
// ============================================================================

/**
 * Все события M7
 */
export type M7Event =
  // Task lifecycle
  | 'task:analyzed'         // После анализа задачи
  | 'task:routed'           // После маршрутизации (LIGHT/HEAVY)
  | 'task:started'          // Начало выполнения
  | 'task:completed'        // Завершение задачи
  | 'task:failed'           // Ошибка задачи
  
  // Phase lifecycle
  | 'phase:entered'         // Вход в фазу M7
  | 'phase:completed'       // Завершение фазы
  | 'phase:skipped'         // Фаза пропущена
  
  // Hive events
  | 'hive:started'          // Запуск Hive
  | 'hive:agent:response'   // Ответ агента
  | 'hive:consensus'        // Достижение консенсуса
  | 'hive:conflict'         // Конфликт агентов
  | 'hive:completed'        // Завершение Hive
  
  // Memory events
  | 'memory:stored'         // Сохранение в память
  | 'memory:retrieved'      // Получение из памяти
  | 'memory:promoted'       // Промоция уровня
  | 'memory:invalidated'    // Инвалидация записи
  
  // Error events
  | 'error:captured'        // Захват ошибки
  | 'error:recovered'       // Восстановление
  
  // Session events
  | 'session:started'       // Начало сессии
  | 'session:completed'     // Завершение сессии
  
  // Warmup events
  | 'warmup:started'        // Начало warmup
  | 'warmup:completed'      // Завершение warmup
  
  // Doctor events
  | 'doctor:check:passed'   // Проверка пройдена
  | 'doctor:check:failed'   // Проверка провалена
  | 'doctor:fixed'          // Автоисправление
  
  // Custom events (для расширений)
  | `custom:${string}`;

/**
 * Контекст события
 */
export interface EventContext<T = unknown> {
  /** Тип события */
  event: M7Event;
  /** Timestamp */
  timestamp: number;
  /** ID сессии (если есть) */
  sessionId?: string;
  /** ID задачи (если есть) */
  taskId?: string;
  /** Данные события */
  data: T;
  /** Метаданные */
  meta?: Record<string, unknown>;
}

/**
 * Обработчик события
 */
export type EventHandler<T = unknown> = (
  context: EventContext<T>
) => void | Promise<void>;

/**
 * Зарегистрированный обработчик
 */
interface RegisteredHandler {
  handler: EventHandler;
  priority: number;
  once: boolean;
  id: string;
}

// ============================================================================
// Event Contexts for specific events
// ============================================================================

export interface TaskAnalyzedContext {
  description: string;
  intent: string;
  route: 'LIGHT' | 'HEAVY';
  confidence: number;
}

export interface PhaseContext {
  phase: 'discovery' | 'architecture' | 'planning' | 'implementation' | 'validation';
  taskId: string;
}

export interface HiveContext {
  task: string;
  agents: string[];
  mode: 'dynamic' | 'fixed' | 'planned';
}

export interface MemoryContext {
  recordId: string;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  content?: string;
}

export interface ErrorContext {
  error: Error;
  source: string;
  recovered: boolean;
}

// ============================================================================
// Event Emitter
// ============================================================================

class M7EventEmitter {
  private handlers = new Map<M7Event, RegisteredHandler[]>();
  private handlerCounter = 0;
  private paused = false;
  private queue: Array<{ event: M7Event; context: EventContext }> = [];
  
  /**
   * Подписаться на событие
   */
  on<T = unknown>(
    event: M7Event,
    handler: EventHandler<T>,
    options: { priority?: number; once?: boolean } = {}
  ): string {
    const id = `handler_${++this.handlerCounter}`;
    const registered: RegisteredHandler = {
      handler: handler as EventHandler,
      priority: options.priority ?? 10,
      once: options.once ?? false,
      id
    };
    
    const existing = this.handlers.get(event) || [];
    existing.push(registered);
    // Sort by priority (lower = earlier)
    existing.sort((a, b) => a.priority - b.priority);
    this.handlers.set(event, existing);
    
    log.debug(`Handler ${id} registered for ${event} (priority: ${registered.priority})`);
    
    return id;
  }
  
  /**
   * Подписаться на событие (один раз)
   */
  once<T = unknown>(
    event: M7Event,
    handler: EventHandler<T>,
    priority?: number
  ): string {
    return this.on(event, handler, { priority, once: true });
  }
  
  /**
   * Отписаться от события
   */
  off(event: M7Event, handlerId: string): boolean {
    const existing = this.handlers.get(event);
    if (!existing) return false;
    
    const index = existing.findIndex(h => h.id === handlerId);
    if (index === -1) return false;
    
    existing.splice(index, 1);
    log.debug(`Handler ${handlerId} removed from ${event}`);
    return true;
  }
  
  /**
   * Отписать все обработчики события
   */
  offAll(event: M7Event): void {
    this.handlers.delete(event);
    log.debug(`All handlers removed for ${event}`);
  }
  
  /**
   * Эмитировать событие
   */
  async emit<T = unknown>(
    event: M7Event,
    data: T,
    options: { sessionId?: string; taskId?: string; meta?: Record<string, unknown> } = {}
  ): Promise<void> {
    const context: EventContext<T> = {
      event,
      timestamp: Date.now(),
      sessionId: options.sessionId,
      taskId: options.taskId,
      data,
      meta: options.meta
    };
    
    if (this.paused) {
      this.queue.push({ event, context: context as EventContext });
      log.debug(`Event ${event} queued (emitter paused)`);
      return;
    }
    
    await this.processEvent(event, context as EventContext);
  }
  
  /**
   * Синхронный emit (для критичных по производительности мест)
   */
  emitSync<T = unknown>(
    event: M7Event,
    data: T,
    options: { sessionId?: string; taskId?: string; meta?: Record<string, unknown> } = {}
  ): void {
    const context: EventContext<T> = {
      event,
      timestamp: Date.now(),
      sessionId: options.sessionId,
      taskId: options.taskId,
      data,
      meta: options.meta
    };
    
    if (this.paused) {
      this.queue.push({ event, context: context as EventContext });
      return;
    }
    
    // Fire and forget
    this.processEvent(event, context as EventContext).catch(err => {
      log.error(`Error in sync emit for ${event}:`, err);
    });
  }
  
  /**
   * Обработать событие
   */
  private async processEvent(event: M7Event, context: EventContext): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.length === 0) {
      log.debug(`No handlers for ${event}`);
      return;
    }
    
    log.debug(`Emitting ${event} to ${handlers.length} handler(s)`);
    
    const toRemove: string[] = [];
    
    for (const registered of handlers) {
      try {
        await registered.handler(context);
        
        if (registered.once) {
          toRemove.push(registered.id);
        }
      } catch (err) {
        log.error(`Handler ${registered.id} failed for ${event}:`, err);
      }
    }
    
    // Remove once handlers
    for (const id of toRemove) {
      this.off(event, id);
    }
  }
  
  /**
   * Приостановить эмиссию (события буферизуются)
   */
  pause(): void {
    this.paused = true;
    log.debug('Event emitter paused');
  }
  
  /**
   * Возобновить эмиссию (обработать очередь)
   */
  async resume(): Promise<void> {
    this.paused = false;
    log.debug(`Event emitter resumed, processing ${this.queue.length} queued events`);
    
    const queued = [...this.queue];
    this.queue = [];
    
    for (const { event, context } of queued) {
      await this.processEvent(event, context);
    }
  }
  
  /**
   * Получить список обработчиков
   */
  getHandlers(event: M7Event): string[] {
    return (this.handlers.get(event) || []).map(h => h.id);
  }
  
  /**
   * Получить статистику
   */
  getStats(): { events: number; handlers: number; queued: number } {
    let totalHandlers = 0;
    for (const handlers of this.handlers.values()) {
      totalHandlers += handlers.length;
    }
    
    return {
      events: this.handlers.size,
      handlers: totalHandlers,
      queued: this.queue.length
    };
  }
  
  /**
   * Сбросить все обработчики
   */
  reset(): void {
    this.handlers.clear();
    this.queue = [];
    this.paused = false;
    log.info('Event emitter reset');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let emitter: M7EventEmitter | null = null;

export function getEventEmitter(): M7EventEmitter {
  if (!emitter) {
    emitter = new M7EventEmitter();
  }
  return emitter;
}

export function resetEventEmitter(): void {
  if (emitter) {
    emitter.reset();
  }
  emitter = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Подписаться на событие
 */
export function on<T = unknown>(
  event: M7Event,
  handler: EventHandler<T>,
  priority?: number
): string {
  return getEventEmitter().on(event, handler, { priority });
}

/**
 * Подписаться на событие (один раз)
 */
export function once<T = unknown>(
  event: M7Event,
  handler: EventHandler<T>,
  priority?: number
): string {
  return getEventEmitter().once(event, handler, priority);
}

/**
 * Отписаться от события
 */
export function off(event: M7Event, handlerId: string): boolean {
  return getEventEmitter().off(event, handlerId);
}

/**
 * Эмитировать событие
 */
export async function emit<T = unknown>(
  event: M7Event,
  data: T,
  options?: { sessionId?: string; taskId?: string; meta?: Record<string, unknown> }
): Promise<void> {
  return getEventEmitter().emit(event, data, options);
}

/**
 * Синхронный emit
 */
export function emitSync<T = unknown>(
  event: M7Event,
  data: T,
  options?: { sessionId?: string; taskId?: string; meta?: Record<string, unknown> }
): void {
  return getEventEmitter().emitSync(event, data, options);
}

// ============================================================================
// Built-in Handlers (optional)
// ============================================================================

/**
 * Логирующий обработчик (для отладки)
 */
export function enableEventLogging(): string[] {
  const events: M7Event[] = [
    'task:analyzed',
    'task:completed',
    'task:failed',
    'hive:started',
    'hive:completed',
    'error:captured'
  ];
  
  const ids: string[] = [];
  
  for (const event of events) {
    const id = on(event, (ctx) => {
      log.info(`[EVENT] ${ctx.event}`, ctx.data);
    }, 100); // Low priority
    ids.push(id);
  }
  
  return ids;
}

/**
 * Метрики обработчик
 */
export function enableEventMetrics(): {
  getMetrics: () => Record<M7Event, number>;
  handlerIds: string[];
} {
  const metrics: Record<string, number> = {};
  const handlerIds: string[] = [];
  
  const allEvents: M7Event[] = [
    'task:analyzed', 'task:completed', 'task:failed',
    'phase:entered', 'phase:completed',
    'hive:started', 'hive:completed',
    'memory:stored', 'memory:promoted',
    'error:captured'
  ];
  
  for (const event of allEvents) {
    const id = on(event, () => {
      metrics[event] = (metrics[event] || 0) + 1;
    }, 100);
    handlerIds.push(id);
  }
  
  return {
    getMetrics: () => metrics as Record<M7Event, number>,
    handlerIds
  };
}
