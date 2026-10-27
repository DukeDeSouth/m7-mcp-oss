import { createLogger } from '../utils/logger.js';
const log = createLogger('[zodToJsonSchema]');
/**
 * M7 MCP - Zod to JSON Schema Converter
 * 
 * Автоматическая генерация JSON Schema из Zod схем для MCP инструментов
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

// Простой тип для JSON Schema без зависимостей от @types/json-schema
export interface SimpleJSONSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

import { BoundedMap } from './boundedMap.js';

// Кэш для результатов конвертации (LRU, max 200 schemas)
const schemaCache = new BoundedMap<string, SimpleJSONSchema>(200);

/**
 * Конвертирует Zod схему в JSON Schema для MCP протокола
 * 
 * @param zodSchema - Zod схема для конвертации
 * @param options - Опции конвертации
 * @returns JSON Schema совместимый с MCP SDK
 */
export function zodToJsonSchemaForMCP(
  zodSchema: z.ZodTypeAny,
  options?: {
    cacheKey?: string;
    target?: 'openApi3' | 'jsonSchema7';
    $refStrategy?: 'none' | 'inline';
  }
): SimpleJSONSchema {
  const {
    cacheKey,
  } = options || {};

  // Проверка кэша
  if (cacheKey && schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey)!;
  }

  try {
    // Конвертация Zod → JSON Schema
    // Используем as any для обхода проблемы с рекурсивными типами Zod
    const jsonSchema = (zodToJsonSchema as any)(zodSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
      name: cacheKey || 'schema'
    }) as SimpleJSONSchema;

    // Кэширование результата
    if (cacheKey) {
      schemaCache.set(cacheKey, jsonSchema);
    }

    return jsonSchema;
  } catch (error) {
    // Fallback на упрощенную схему
    log.debug('M7] Zod to JSON Schema conversion failed, using fallback:', error);
    return generateFallbackSchema();
  }
}

/**
 * Генерирует упрощенную JSON Schema как fallback
 */
function generateFallbackSchema(): SimpleJSONSchema {
  // Упрощенная схема для fallback
  // Позволяет любые свойства, но валидация все равно будет через Zod
  return {
    type: 'object',
    properties: {},
    additionalProperties: true
  };
}

/**
 * Очищает кэш схем
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
}
