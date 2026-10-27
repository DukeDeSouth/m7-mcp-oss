import { createLogger } from '../utils/logger.js';
const log = createLogger('[schemaConverter]');
// JSON Schema to Zod converter for MCP tools

import { z } from 'zod';

/**
 * Convert JSON Schema to Zod schema
 * This is a simplified converter for MCP tool schemas
 */
export function jsonSchemaToZod(jsonSchema: any): any {
  if (!jsonSchema) return z.any();
  
  // Handle primitive types
  if (jsonSchema.type === 'string') {
    let schema: any = z.string();
    if (jsonSchema.description) {
      schema = schema.describe(jsonSchema.description);
    }
    if (jsonSchema.enum) {
      // @ts-ignore
      schema = z.enum(jsonSchema.enum);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default);
    }
    return schema;
  }
  
  if (jsonSchema.type === 'number') {
    let schema: any = z.number();
    if (jsonSchema.description) {
      schema = schema.describe(jsonSchema.description);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default);
    }
    return schema;
  }
  
  if (jsonSchema.type === 'boolean') {
    let schema: any = z.boolean();
    if (jsonSchema.description) {
      schema = schema.describe(jsonSchema.description);
    }
    if (jsonSchema.default !== undefined) {
      schema = schema.default(jsonSchema.default);
    }
    return schema;
  }
  
  if (jsonSchema.type === 'array') {
    const itemSchema = jsonSchemaToZod(jsonSchema.items || {});
    return z.array(itemSchema);
  }
  
  // Handle objects
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const shape: any = {};
    const required = jsonSchema.required || [];
    
    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      // Рекурсивно обрабатываем вложенные объекты
      let fieldSchema = jsonSchemaToZod(value);
      
      // Make field optional if:
      // 1. Not in required array OR
      // 2. Has optional: true property
      const isRequired = required.includes(key);
      const hasOptionalFlag = (value as any).optional === true;
      
      if (!isRequired || hasOptionalFlag) {
        fieldSchema = fieldSchema.optional();
      }
      
      shape[key] = fieldSchema;
    }
    
    return z.object(shape);
  }
  
  // Handle $ref (references to definitions) - для OpenAPI3
  if (jsonSchema.$ref) {
    // Если есть $ref, возвращаем any (definitions обрабатываются отдельно)
    // В будущем можно улучшить обработку $ref
    return z.any();
  }
  
  // Handle allOf, anyOf, oneOf
  if (jsonSchema.allOf || jsonSchema.anyOf || jsonSchema.oneOf) {
    // Для сложных комбинаций возвращаем any
    // В будущем можно улучшить обработку
    return z.any();
  }
  
  // Default to any
  return z.any();
}

/**
 * Extract Zod schema from tool inputSchema
 * Handles both Zod schemas and JSON schemas
 */
export function extractZodSchema(inputSchema: any): any {
  // If it's already a Zod schema (has _def property), extract shape
  if (inputSchema && inputSchema._def) {
    // For ZodObject, extract the shape for MCP SDK
    if (inputSchema._def.typeName === 'ZodObject') {
      const shape = inputSchema._def.shape();
      // Проверяем что все значения в shape являются валидными Zod схемами
      for (const [key, value] of Object.entries(shape)) {
        if (!value || typeof value !== 'object' || !(value as any)._def) {
          log.debug(`M7 DEBUG] extractZodSchema - Invalid Zod schema for field "${key}":`, value);
          // Заменяем на z.any() если схема невалидна
          shape[key] = z.any();
        }
      }
      return shape;
    }
    return inputSchema;
  }
  
  // If it's a JSON Schema, convert it
  if (inputSchema && inputSchema.type === 'object' && inputSchema.properties) {
    // Convert the full schema to get proper optional handling
    const zodObject = jsonSchemaToZod(inputSchema);
    
    // If it's a ZodObject, extract the shape for MCP SDK
    if (zodObject && zodObject._def && zodObject._def.typeName === 'ZodObject') {
      const shape = zodObject._def.shape();
      // Проверяем что все значения в shape являются валидными Zod схемами
      for (const [key, value] of Object.entries(shape)) {
        if (!value || typeof value !== 'object' || !(value as any)._def) {
          log.debug(`M7 DEBUG] extractZodSchema - Invalid Zod schema for field "${key}" after JSON→Zod conversion:`, value);
          log.debug(`M7 DEBUG] extractZodSchema - Original JSON Schema for "${key}":`, inputSchema.properties[key]);
          // Заменяем на z.any() если схема невалидна
          shape[key] = z.any();
        }
      }
      return shape;
    }
    
    return zodObject;
  }
  
  // If it's a plain object with Zod schemas as values, return as is
  if (inputSchema && typeof inputSchema === 'object') {
    // Check if values are Zod schemas
    const firstValue = Object.values(inputSchema)[0];
    if (firstValue && (firstValue as any)._def) {
      return inputSchema;
    }
  }
  
  // Default case - treat as JSON schema
  return jsonSchemaToZod(inputSchema);
}
