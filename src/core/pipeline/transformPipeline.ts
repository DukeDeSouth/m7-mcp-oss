/**
 * M7 Transform Pipeline v1.0
 * 
 * Composable middleware для tool calls.
 * Позволяет добавлять before/after обработку к любому инструменту.
 * 
 * Источник идеи: FastMCP (github.com/jlowin/fastmcp)
 * 
 * @version 1.0.0
 * @since M7 v3.10.4
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('[Pipeline]');

// ============================================================================
// Types
// ============================================================================

/**
 * Контекст выполнения инструмента
 */
export interface ToolContext {
  /** Имя инструмента */
  toolName: string;
  /** Аргументы */
  args: Record<string, unknown>;
  /** Результат (заполняется после выполнения) */
  result?: unknown;
  /** Ошибка (если была) */
  error?: Error;
  /** Время начала */
  startTime: number;
  /** Время завершения */
  endTime?: number;
  /** Метаданные для передачи между middleware */
  meta: Record<string, unknown>;
  /** Флаг отмены */
  cancelled: boolean;
}

/**
 * Middleware функция
 */
export type MiddlewareFn = (
  ctx: ToolContext,
  next: () => Promise<void>
) => Promise<void>;

/**
 * Зарегистрированный middleware
 */
interface RegisteredMiddleware {
  id: string;
  name: string;
  fn: MiddlewareFn;
  priority: number;
  /** Фильтр по имени инструмента (regex или строка) */
  toolFilter?: string | RegExp;
}

/**
 * Статистика pipeline
 */
export interface PipelineStats {
  totalCalls: number;
  totalErrors: number;
  totalCancelled: number;
  avgDurationMs: number;
  middlewareCount: number;
  byTool: Record<string, { calls: number; avgMs: number; errors: number }>;
}

// ============================================================================
// Transform Pipeline
// ============================================================================

export class TransformPipeline {
  private middlewares: RegisteredMiddleware[] = [];
  private idCounter = 0;
  private stats = {
    totalCalls: 0,
    totalErrors: 0,
    totalCancelled: 0,
    totalDurationMs: 0,
    byTool: new Map<string, { calls: number; totalMs: number; errors: number }>()
  };
  
  /**
   * Добавить middleware
   */
  use(
    name: string,
    fn: MiddlewareFn,
    options: { priority?: number; toolFilter?: string | RegExp } = {}
  ): string {
    const id = `mw_${++this.idCounter}`;
    
    this.middlewares.push({
      id,
      name,
      fn,
      priority: options.priority ?? 10,
      toolFilter: options.toolFilter
    });
    
    // Сортируем по приоритету
    this.middlewares.sort((a, b) => a.priority - b.priority);
    
    log.info(`Middleware "${name}" registered (priority: ${options.priority ?? 10})`);
    return id;
  }
  
  /**
   * Удалить middleware
   */
  remove(id: string): boolean {
    const idx = this.middlewares.findIndex(m => m.id === id);
    if (idx === -1) return false;
    
    const removed = this.middlewares.splice(idx, 1)[0];
    log.info(`Middleware "${removed.name}" removed`);
    return true;
  }
  
  /**
   * Выполнить инструмент через pipeline
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    const ctx: ToolContext = {
      toolName,
      args: { ...args },
      startTime: Date.now(),
      meta: {},
      cancelled: false
    };
    
    // Фильтруем middleware по toolFilter
    const applicable = this.middlewares.filter(m => {
      if (!m.toolFilter) return true;
      if (typeof m.toolFilter === 'string') return toolName === m.toolFilter;
      return m.toolFilter.test(toolName);
    });
    
    // Строим цепочку (onion model)
    let index = 0;
    
    const next = async (): Promise<void> => {
      if (ctx.cancelled) return;
      
      if (index < applicable.length) {
        const middleware = applicable[index++];
        try {
          await middleware.fn(ctx, next);
        } catch (err: any) {
          ctx.error = err;
          log.error(`Middleware "${middleware.name}" error:`, err.message);
          throw err;
        }
      } else {
        // Core handler
        try {
          ctx.result = await handler(ctx.args);
        } catch (err: any) {
          ctx.error = err;
          throw err;
        }
      }
    };
    
    try {
      await next();
    } catch (err: any) {
      this.stats.totalErrors++;
      this.updateToolStats(toolName, Date.now() - ctx.startTime, true);
      throw err;
    } finally {
      ctx.endTime = Date.now();
      this.stats.totalCalls++;
      
      if (ctx.cancelled) {
        this.stats.totalCancelled++;
      }
      
      const duration = ctx.endTime - ctx.startTime;
      this.stats.totalDurationMs += duration;
      this.updateToolStats(toolName, duration, false);
    }
    
    return ctx.result;
  }
  
  /**
   * Получить статистику
   */
  getStats(): PipelineStats {
    const byTool: Record<string, { calls: number; avgMs: number; errors: number }> = {};
    
    for (const [tool, data] of this.stats.byTool) {
      byTool[tool] = {
        calls: data.calls,
        avgMs: data.calls > 0 ? Math.round(data.totalMs / data.calls) : 0,
        errors: data.errors
      };
    }
    
    return {
      totalCalls: this.stats.totalCalls,
      totalErrors: this.stats.totalErrors,
      totalCancelled: this.stats.totalCancelled,
      avgDurationMs: this.stats.totalCalls > 0 
        ? Math.round(this.stats.totalDurationMs / this.stats.totalCalls) 
        : 0,
      middlewareCount: this.middlewares.length,
      byTool
    };
  }
  
  /**
   * Список middleware
   */
  listMiddlewares(): Array<{ id: string; name: string; priority: number }> {
    return this.middlewares.map(m => ({
      id: m.id,
      name: m.name,
      priority: m.priority
    }));
  }
  
  /**
   * Сбросить pipeline
   */
  reset(): void {
    this.middlewares = [];
    this.stats = {
      totalCalls: 0,
      totalErrors: 0,
      totalCancelled: 0,
      totalDurationMs: 0,
      byTool: new Map()
    };
  }
  
  private updateToolStats(tool: string, durationMs: number, isError: boolean): void {
    if (!this.stats.byTool.has(tool)) {
      this.stats.byTool.set(tool, { calls: 0, totalMs: 0, errors: 0 });
    }
    const entry = this.stats.byTool.get(tool)!;
    entry.calls++;
    entry.totalMs += durationMs;
    if (isError) entry.errors++;
  }
}

// ============================================================================
// Built-in Middlewares
// ============================================================================

/**
 * Логирующий middleware
 */
export function createLoggingMiddleware(): MiddlewareFn {
  return async (ctx, next) => {
    log.info(`→ ${ctx.toolName}`, ctx.args);
    await next();
    const duration = Date.now() - ctx.startTime;
    log.info(`← ${ctx.toolName} (${duration}ms)`);
  };
}

/**
 * Timing middleware — добавляет duration в meta
 */
export function createTimingMiddleware(): MiddlewareFn {
  return async (ctx, next) => {
    await next();
    ctx.meta.durationMs = Date.now() - ctx.startTime;
  };
}

/**
 * Rate limiter middleware
 */
export function createRateLimitMiddleware(
  maxCalls: number,
  windowMs: number
): MiddlewareFn {
  const calls: number[] = [];
  
  return async (ctx, next) => {
    const now = Date.now();
    
    // Удаляем старые вызовы
    while (calls.length > 0 && calls[0] < now - windowMs) {
      calls.shift();
    }
    
    if (calls.length >= maxCalls) {
      ctx.cancelled = true;
      throw new Error(`Rate limit exceeded: ${maxCalls} calls per ${windowMs}ms`);
    }
    
    calls.push(now);
    await next();
  };
}

/**
 * Validation middleware — проверяет аргументы
 */
export function createValidationMiddleware(
  validator: (toolName: string, args: Record<string, unknown>) => string | null
): MiddlewareFn {
  return async (ctx, next) => {
    const error = validator(ctx.toolName, ctx.args);
    if (error) {
      ctx.cancelled = true;
      throw new Error(`Validation failed for ${ctx.toolName}: ${error}`);
    }
    await next();
  };
}

/**
 * Cache middleware — кэширует результаты
 */
export function createCacheMiddleware(
  ttlMs: number = 60000
): MiddlewareFn {
  const cache = new Map<string, { result: unknown; expiresAt: number }>();
  
  return async (ctx, next) => {
    const key = `${ctx.toolName}:${JSON.stringify(ctx.args)}`;
    const cached = cache.get(key);
    
    if (cached && cached.expiresAt > Date.now()) {
      ctx.result = cached.result;
      ctx.meta.fromCache = true;
      return;
    }
    
    await next();
    
    if (!ctx.error) {
      cache.set(key, {
        result: ctx.result,
        expiresAt: Date.now() + ttlMs
      });
    }
  };
}

// ============================================================================
// Singleton
// ============================================================================

let pipeline: TransformPipeline | null = null;

export function getPipeline(): TransformPipeline {
  if (!pipeline) {
    pipeline = new TransformPipeline();
  }
  return pipeline;
}

export function resetPipeline(): void {
  pipeline = null;
}
