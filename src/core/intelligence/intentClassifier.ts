import { createLogger } from '../utils/logger.js';
const log = createLogger('[intentClassifier]');
/**
 * M7 v3.5 - LLM Intent Classifier with Pattern Selection
 * 
 * Замена regex-based intentDetector на GPT-4o-mini с structured outputs.
 * Использует Zod schema для валидации ответа.
 * 
 * v3.5: LLM сам выбирает patternsToScan и fileExtensions из списка доступных.
 * 
 * @author M7 AI Assistant
 * @version 3.5.0
 * @date 2026-01-22
 */

import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

// ============================================
// TYPES
// ============================================

export type Intent = 
  | 'LOGS'      // Проверить логи, подготовить отчёт
  | 'EXPLAIN'   // Объяснить, уточнить (без кода)
  | 'DIAGNOSE'  // Изучить, диагностировать проблему
  | 'DISCUSS'   // Продолжить обсуждение
  | 'PLAN'      // Подготовить план, архитектуру (без кода)
  | 'DOCS'      // Создать документацию
  | 'FIX'       // Исправить баг
  | 'IMPLEMENT' // Реализовать фичу
  | 'DEPLOY';   // Деплой на прод

export type Phase = 'DISCOVERY' | 'PLANNING' | 'IMPLEMENTATION' | 'DEPLOYMENT';

export type Route = 'light' | 'medium' | 'heavy' | 'decompose';

export type AgentType = 'research' | 'implementation' | 'architecture' | 
                        'security' | 'testing' | 'performance';

// ============================================
// AVAILABLE SCAN PATTERNS (v3.5)
// ============================================

export const AVAILABLE_PATTERNS = [
  'console-logs',           // console.log/warn/error/debug
  'todo-comments',          // TODO/FIXME/HACK/XXX
  'magic-numbers',          // Magic numbers in code
  'php7-to-php8',           // PHP7 → PHP8 migration
  'php-legacy',             // Legacy PHP patterns
  'commonjs-to-esm',        // CommonJS → ESM
  'var-to-const-let',       // var → const/let
  'callback-to-promise',    // Callbacks → async/await
  'javascript-to-typescript', // JS → TS migration
  'any-types',              // any type usage in TS
  'react-class-to-hooks',   // Class → Functional components
  'react-deprecated',       // Deprecated React APIs
  'react-string-refs',      // String refs → useRef
  'python2-to-python3',     // Python 2 → Python 3
  'css-vendor-prefixes',    // CSS vendor prefixes
  'sql-injection-risk',     // SQL injection patterns
] as const;

export type ScanPatternId = typeof AVAILABLE_PATTERNS[number];

// ============================================
// ZOD SCHEMA
// ============================================

export const ClassifiedIntentSchema = z.object({
  intent: z.enum(['LOGS', 'EXPLAIN', 'DIAGNOSE', 'DISCUSS', 'PLAN', 'DOCS', 'FIX', 'IMPLEMENT', 'DEPLOY']),
  phase: z.enum(['DISCOVERY', 'PLANNING', 'IMPLEMENTATION', 'DEPLOYMENT']),
  route: z.enum(['light', 'medium', 'heavy', 'decompose']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  allowCode: z.boolean(),
  suggestedAgents: z.array(z.enum(['research', 'implementation', 'architecture', 'security', 'testing', 'performance'])),
  estimatedFiles: z.number().int().min(0),
  estimatedMinutes: z.number().int().min(0),
  risks: z.array(z.string()),
  requiresFullCycle: z.boolean(),
  // v3.5: LLM выбирает паттерны для сканирования
  patternsToScan: z.array(z.enum([
    'console-logs', 'todo-comments', 'magic-numbers',
    'php7-to-php8', 'php-legacy',
    'commonjs-to-esm', 'var-to-const-let', 'callback-to-promise',
    'javascript-to-typescript', 'any-types',
    'react-class-to-hooks', 'react-deprecated', 'react-string-refs',
    'python2-to-python3', 'css-vendor-prefixes', 'sql-injection-risk'
  ])),
  fileExtensions: z.array(z.string()),
});

export type ClassifiedIntent = z.infer<typeof ClassifiedIntentSchema>;

// ============================================
// BACKWARDS COMPATIBILITY (for router.ts)
// ============================================

export interface DetectedIntent {
  intent: Intent;
  confidence: number;
  phase: Phase;
  allowCode: boolean;
  fullCycle: boolean;
  safetyCheck: boolean;
  aiCodingSafety: boolean;
  context7: boolean;
  grepFirst: boolean;
  matchedKeywords: string[];
  recommendedRoute: Route;
  // v3.5: LLM-selected patterns for scanning
  patternsToScan: ScanPatternId[];
  fileExtensions: string[];
}

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `Ты M7 Intent Classifier. Анализируй задачу пользователя и возвращай структурированный JSON.

## ИНТЕНТЫ:

| Intent | Описание | allowCode | Типичный route |
|--------|----------|-----------|----------------|
| LOGS | Проверить логи, подготовить отчёт | false | medium |
| EXPLAIN | Объяснить, уточнить что-то | false | light |
| DIAGNOSE | Изучить, диагностировать проблему | false | medium |
| DISCUSS | Продолжить обсуждение, уточнение | false | light |
| PLAN | Подготовить план, архитектуру | false | medium |
| DOCS | Создать или обновить документацию | false | medium |
| FIX | Исправить баг, ошибку | true | medium |
| IMPLEMENT | Реализовать фичу, написать код | true | medium |
| DEPLOY | Деплой на прод, релиз | true | heavy |

## ROUTES:

| Route | Файлов | Когда использовать |
|-------|--------|-------------------|
| light | 1-3 | Простые изменения: typo, rename, добавить import |
| medium | 3-10 | Новые фичи, рефакторинг, исправление багов |
| heavy | 10+ | Архитектурные изменения, новые системы, большой рефакторинг |
| decompose | много | Задача слишком большая, нужно разбить на подзадачи |

## AGENTS:

| Agent | Когда добавить |
|-------|---------------|
| research | Нужно изучить best practices, документацию |
| implementation | Нужно писать код |
| architecture | Архитектурные решения, дизайн системы |
| security | Работа с auth, permissions, sensitive data |
| testing | Нужны тесты, QA |
| performance | Оптимизация, метрики производительности |

## ДОСТУПНЫЕ ПАТТЕРНЫ ДЛЯ СКАНИРОВАНИЯ (patternsToScan):

| Pattern ID | Что ищет | Расширения |
|------------|----------|------------|
| console-logs | console.log/warn/error/debug/info | .js, .ts, .jsx, .tsx |
| todo-comments | TODO/FIXME/HACK/XXX комментарии | все |
| magic-numbers | Магические числа в коде | .js, .ts, .jsx, .tsx |
| php7-to-php8 | array(), mysql_*, each(), etc. | .php |
| php-legacy | Legacy PHP: $GLOBALS, global, extract | .php |
| commonjs-to-esm | require(), module.exports | .js, .cjs |
| var-to-const-let | var declarations | .js, .jsx |
| callback-to-promise | Callback patterns | .js, .ts, .jsx, .tsx |
| javascript-to-typescript | PropTypes, JSDoc, untyped functions | .js, .jsx |
| any-types | any type usage | .ts, .tsx |
| react-class-to-hooks | Class components, lifecycle methods | .jsx, .tsx, .js, .ts |
| react-deprecated | Deprecated React APIs | .jsx, .tsx, .js, .ts |
| react-string-refs | String refs, this.refs | .jsx, .tsx, .js, .ts |
| python2-to-python3 | print, xrange, iteritems | .py |
| css-vendor-prefixes | -webkit-, -moz-, etc. | .css, .scss, .less |
| sql-injection-risk | SQL injection patterns | .php, .js, .ts, .py |

## ПРАВИЛА КЛАССИФИКАЦИИ:

1. **Если задача упоминает:** "архитектуру", "систему", "переделать всё", "с нуля" → route: heavy
2. **Если задача упоминает:** "исправь", "починить", "баг", "ошибка" → intent: FIX
3. **Если явно просят:** "без кода", "только план", "не пиши код" → allowCode: false
4. **Если задача простая:** rename, typo, добавить import → route: light
5. **confidence** должен отражать твою реальную уверенность в классификации
6. **requiresFullCycle = true** если задача сложная, рискованная, или затрагивает много файлов
7. **suggestedAgents** — добавляй всех релевантных агентов для задачи
8. **risks** — перечисли потенциальные риски выполнения задачи
9. **estimatedFiles** — сколько файлов примерно будет затронуто
10. **estimatedMinutes** — сколько минут займёт выполнение
11. **patternsToScan** — ВЫБЕРИ паттерны из таблицы выше, которые релевантны для задачи. Пустой массив [] если не нужно сканирование.
12. **fileExtensions** — укажи расширения файлов для поиска (например [".ts", ".tsx"]). Пустой массив [] если не нужно сканирование.

## ПРИМЕРЫ:

Задача: "исправь баг в auth модуле"
→ intent: FIX, route: medium, patternsToScan: [], fileExtensions: []

Задача: "рефакторни все console.log на proper logging"
→ intent: FIX, route: medium, patternsToScan: ["console-logs"], fileExtensions: [".ts", ".js", ".tsx", ".jsx"]

Задача: "переведи проект с PHP7 на PHP8"
→ intent: IMPLEMENT, route: heavy, patternsToScan: ["php7-to-php8", "php-legacy"], fileExtensions: [".php"]

Задача: "конвертируй React классы в хуки"
→ intent: IMPLEMENT, route: heavy, patternsToScan: ["react-class-to-hooks", "react-deprecated"], fileExtensions: [".jsx", ".tsx"]

Задача: "объясни как работает auth"
→ intent: EXPLAIN, route: light, allowCode: false, patternsToScan: [], fileExtensions: []`;

// ============================================
// CLASSIFIER CLASS
// ============================================

export class IntentClassifier {
  private openai: OpenAI;
  private model: string = 'gpt-4o-mini';

  constructor(apiKey?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      maxRetries: 2,
      timeout: 30000, // 30 seconds
    });
  }

  /**
   * Классифицировать задачу через LLM
   */
  async classify(taskDescription: string): Promise<ClassifiedIntent> {
    const startTime = Date.now();
    
    try {
      log.debug(`IntentClassifier] Classifying: "${taskDescription.slice(0, 50)}..."`);
      
      const completion = await this.openai.chat.completions.parse({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: taskDescription }
        ],
        response_format: zodResponseFormat(ClassifiedIntentSchema, 'intent_classification'),
        temperature: 0.1, // Низкая температура для консистентности
        max_tokens: 500,
      });

      const latency = Date.now() - startTime;
      const message = completion.choices[0]?.message;
      
      if (message?.parsed) {
        log.debug(`IntentClassifier] ✅ Classified in ${latency}ms: intent=${message.parsed.intent}, route=${message.parsed.route}, confidence=${(message.parsed.confidence * 100).toFixed(0)}%`);
        return message.parsed;
      }
      
      if (message?.refusal) {
        log.debug(`IntentClassifier] ⚠️ Model refused: ${message.refusal}`);
        return this.getDefaultIntent('Model refused to classify');
      }

      log.debug(`IntentClassifier] ⚠️ No parsed response, using default`);
      return this.getDefaultIntent('No parsed response from model');
      
    } catch (error: any) {
      const latency = Date.now() - startTime;
      log.debug(`IntentClassifier] ❌ Error after ${latency}ms: ${error.message}`);
      return this.getDefaultIntent(error.message);
    }
  }

  /**
   * Default intent для fallback
   */
  private getDefaultIntent(reason: string): ClassifiedIntent {
    return {
      intent: 'EXPLAIN',
      phase: 'DISCOVERY',
      route: 'medium',
      confidence: 0.5,
      reasoning: `Fallback to default intent: ${reason}`,
      allowCode: false,
      suggestedAgents: ['research'],
      estimatedFiles: 1,
      estimatedMinutes: 30,
      risks: ['Classification failed, using default values'],
      requiresFullCycle: true,
      // v3.5: No pattern scanning in fallback
      patternsToScan: [],
      fileExtensions: [],
    };
  }

  /**
   * Конвертировать ClassifiedIntent в DetectedIntent для совместимости с router.ts
   */
  toDetectedIntent(classified: ClassifiedIntent): DetectedIntent {
    return {
      intent: classified.intent,
      confidence: classified.confidence,
      phase: classified.phase,
      allowCode: classified.allowCode,
      fullCycle: classified.requiresFullCycle,
      safetyCheck: true,      // Всегда true
      aiCodingSafety: true,   // Всегда true
      context7: true,         // Всегда true
      grepFirst: true,        // Всегда true
      matchedKeywords: [],    // Deprecated, оставляем пустым
      recommendedRoute: classified.route,
      // v3.5: LLM-selected patterns
      patternsToScan: classified.patternsToScan as ScanPatternId[],
      fileExtensions: classified.fileExtensions,
    };
  }
}

// ============================================
// SINGLETON & EXPORTS
// ============================================

let classifierInstance: IntentClassifier | null = null;

export function getIntentClassifier(): IntentClassifier {
  if (!classifierInstance) {
    classifierInstance = new IntentClassifier();
  }
  return classifierInstance;
}

/**
 * Основная функция классификации — возвращает полный ClassifiedIntent
 */
export async function classifyIntent(description: string): Promise<ClassifiedIntent> {
  return getIntentClassifier().classify(description);
}

/**
 * Совместимость с router.ts — возвращает DetectedIntent
 * ВНИМАНИЕ: Теперь async!
 */
export async function detectIntent(description: string): Promise<DetectedIntent> {
  const classifier = getIntentClassifier();
  const classified = await classifier.classify(description);
  return classifier.toDetectedIntent(classified);
}

// ============================================
// FORMATTING (совместимость с router.ts)
// ============================================

export function getIntentDescription(intent: DetectedIntent): string {
  const descriptions: Record<Intent, string> = {
    LOGS: 'Проверка логов и подготовка отчёта',
    EXPLAIN: 'Объяснение и уточнение',
    DIAGNOSE: 'Диагностика и изучение',
    DISCUSS: 'Продолжение обсуждения',
    PLAN: 'Подготовка плана и архитектуры',
    DOCS: 'Создание документации',
    FIX: 'Исправление ошибки',
    IMPLEMENT: 'Реализация функционала',
    DEPLOY: 'Деплой на продакшен'
  };
  
  const phaseEmoji: Record<Phase, string> = {
    DISCOVERY: '🔍',
    PLANNING: '📋',
    IMPLEMENTATION: '⚡',
    DEPLOYMENT: '🚀'
  };
  
  return `${phaseEmoji[intent.phase]} ${descriptions[intent.intent]}`;
}

export function formatIntentHeader(intent: DetectedIntent): string {
  const codeStatus = intent.allowCode ? '✅ Код разрешён' : '📝 Только анализ';
  
  return `
## 🎯 Определённый интент

| Параметр | Значение |
|----------|----------|
| **Интент** | ${getIntentDescription(intent)} |
| **Фаза** | ${intent.phase} |
| **Код** | ${codeStatus} |
| **Уверенность** | ${(intent.confidence * 100).toFixed(0)}% |

### ✅ Автоматически включено:
- Full Cycle (полный цикл M7)
- Safety Check (patterns/antipatterns)
- AI Coding Safety (понятный код)
- Context7 Verification
- Grep First (поиск перед созданием)
`;
}
