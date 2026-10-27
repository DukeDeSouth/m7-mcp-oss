/**
 * M7 v3.9 Error Formatter
 * 
 * Форматирование ошибок валидации Zod с примерами и подсказками.
 * v3.9.0: Оптимизация через template literals + structured errors.
 * 
 * @version 3.9.0
 * @date 2026-01-26
 */

import { z } from 'zod';

// ============================================
// TYPES
// ============================================

export interface MCPResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface FormatErrorOptions {
  showExamples?: boolean;
  showSchema?: boolean;
  toolName?: string;
}

/** v3.9: Structured error for better processing */
export interface StructuredError {
  field: string;
  expected: string;
  received: string;
  message: string;
  code: string;
}

// ============================================
// MAIN FORMATTER
// ============================================

/**
 * Форматирует Zod ошибку в понятное сообщение
 * v3.9: Использует template literals вместо string concatenation
 */
export function formatZodError(
  error: z.ZodError,
  toolName?: string,
  options: FormatErrorOptions = {}
): MCPResponse {
  const { showExamples = true, showSchema = true } = options;
  
  // v3.9: Parse to structured errors first
  const structuredErrors = parseToStructuredErrors(error);
  
  // v3.9: Build message using template literals
  const header = toolName 
    ? `# ❌ Validation Error in ${toolName}\n\n`
    : `# ❌ Validation Error\n\n`;
  
  const errorBlocks = structuredErrors.map((err, index) => 
    formatErrorBlock(err, index, showSchema)
  ).join('');
  
  const exampleBlock = showExamples 
    ? `\n## 💡 Example:\n\n${formatExample(error, toolName)}`
    : '';
  
  return {
    content: [{
      type: 'text',
      text: `${header}${errorBlocks}${exampleBlock}`
    }],
    isError: true
  };
}

/**
 * v3.9: Быстрое форматирование простой ошибки (без примеров)
 */
export function formatQuickError(message: string, toolName?: string): MCPResponse {
  const text = toolName
    ? `# ❌ Error in ${toolName}\n\n${message}`
    : `# ❌ Error\n\n${message}`;
  
  return {
    content: [{ type: 'text', text }],
    isError: true
  };
}

/**
 * v3.9: Форматирование успешного результата
 */
export function formatSuccess(message: string, toolName?: string): MCPResponse {
  const text = toolName
    ? `# ✅ ${toolName}\n\n${message}`
    : `# ✅ Success\n\n${message}`;
  
  return {
    content: [{ type: 'text', text }],
    isError: false
  };
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * v3.9: Parse Zod errors to structured format
 */
function parseToStructuredErrors(error: z.ZodError): StructuredError[] {
  return error.errors.map(err => ({
    field: err.path.length > 0 ? err.path.join('.') : 'root',
    expected: getExpectedType(err),
    received: getReceivedType(err),
    message: err.message,
    code: err.code
  }));
}

/**
 * v3.9: Format single error block using template literal
 */
function formatErrorBlock(err: StructuredError, index: number, showSchema: boolean): string {
  const schemaBlock = showSchema && err.code === 'invalid_type'
    ? `**Expected Structure:**\n${formatExpectedStructure(err.field)}\n`
    : '';
  
  const messageBlock = err.message
    ? `**Message:** ${err.message}\n\n`
    : '';
  
  return `## Error ${index + 1}: ${err.field}

**Expected:** ${err.expected}
**Received:** ${err.received}

${messageBlock}${schemaBlock}`;
}

function getExpectedType(error: z.ZodIssue): string {
  if (error.code === 'invalid_type') {
    return error.expected || 'unknown';
  }
  if (error.code === 'invalid_enum_value') {
    const options = (error as any).options;
    return options ? `one of: ${options.join(', ')}` : 'enum values';
  }
  return error.code || 'unknown';
}

function getReceivedType(error: z.ZodIssue): string {
  if (error.code === 'invalid_type') {
    return error.received || 'unknown';
  }
  return 'invalid value';
}

// v3.9: Pre-defined structure templates
const STRUCTURE_TEMPLATES: Record<string, string> = {
  pattern: `\`\`\`json
{
  "pattern": {
    "name": "string (required)",
    "description": "string (required)",
    "category": "string (optional)",
    "code": "string (optional)",
    "tags": ["string"] (optional)
  }
}
\`\`\``,
  project: `\`\`\`json
{
  "project": {
    "name": "string (optional)",
    "description": "string (optional)",
    "purpose": "string (optional)"
  }
}
\`\`\``,
  metrics: `\`\`\`json
{
  "metrics": {
    "time_to_solution": "number (optional)",
    "lines_changed": "number (optional)"
  }
}
\`\`\``
};

/**
 * v3.9: Optimized structure lookup using pre-defined templates
 */
function formatExpectedStructure(fieldPath: string): string {
  // Check exact match first
  if (STRUCTURE_TEMPLATES[fieldPath]) {
    return STRUCTURE_TEMPLATES[fieldPath];
  }
  
  // Check partial match
  for (const [key, template] of Object.entries(STRUCTURE_TEMPLATES)) {
    if (fieldPath.includes(key)) {
      return template;
    }
  }
  
  return 'Object with appropriate structure';
}

// v3.9: Pre-defined example templates
const EXAMPLE_TEMPLATES: Record<string, string> = {
  pattern: `\`\`\`json
{
  "action": "store_pattern",
  "pattern": {
    "name": "Pattern Name",
    "description": "Pattern description"
  }
}
\`\`\``,
  project: `\`\`\`json
{
  "action": "update_project",
  "project": {
    "name": "Project Name",
    "description": "Project description"
  }
}
\`\`\``,
  default: `\`\`\`json
{
  "action": "action_name",
  // ... other required fields
}
\`\`\``
};

/**
 * v3.9: Optimized example formatting with pre-defined templates
 */
function formatExample(error: z.ZodError, toolName?: string): string {
  const firstError = error.errors[0];
  const fieldPath = firstError?.path.length > 0 ? String(firstError.path[0]) : '';
  
  return EXAMPLE_TEMPLATES[fieldPath] || EXAMPLE_TEMPLATES.default;
}
