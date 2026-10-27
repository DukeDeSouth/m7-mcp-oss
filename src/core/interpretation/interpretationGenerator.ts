/**
 * M7 Interpretation Generator
 * 
 * Генерирует интерпретацию задачи на основе данных Discovery фазы.
 * Интерпретация = резюме того, что AI нашёл и как понял задачу.
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import {
  TaskInterpretation,
  InterpretationResult,
  InterpretationOptions,
  DiscoveredContext,
  DEFAULT_INTERPRETATION_OPTIONS,
  InterpretationSource
} from '../types/interpretation.js';
import { ScopeContext } from '../scope/types.js';
import { ArchitectureContext } from '../architecture/types.js';

const log = createLogger('[InterpretationGenerator]');

/**
 * Входные данные для генерации интерпретации
 */
export interface InterpretationInput {
  /** ID задачи */
  taskId: string;
  
  /** Оригинальное описание задачи */
  taskDescription: string;
  
  /** Результат Scope Scanner */
  scopeContext?: ScopeContext | null;
  
  /** Результат Architecture Context */
  architectureContext?: ArchitectureContext | null;
  
  /** Инсайты из Cross-Session Learning */
  crossSessionInsights?: string[];
  
  /** Предупреждения из Project Schema */
  schemaWarnings?: string[];
  
  /** Результат Intent Classification */
  intentClassification?: {
    intent: string;
    confidence: number;
    allowCode: boolean;
  };
}

/**
 * Генератор интерпретаций
 */
export class InterpretationGenerator {
  private options: InterpretationOptions;
  
  constructor(options?: Partial<InterpretationOptions>) {
    this.options = { ...DEFAULT_INTERPRETATION_OPTIONS, ...options };
  }
  
  /**
   * Генерирует интерпретацию на основе Discovery данных
   */
  async generate(input: InterpretationInput): Promise<InterpretationResult> {
    const startTime = Date.now();
    
    try {
      log.debug(`Generating interpretation for task: ${input.taskId}`);
      
      // Собираем контекст из всех источников
      const discoveredContext = this.buildDiscoveredContext(input);
      
      // Определяем источники информации
      const sources = this.determineSources(input);
      
      // Генерируем предположения на основе найденного
      const assumptions = this.generateAssumptions(input, discoveredContext);
      
      // Генерируем рекомендуемый подход
      const suggestedApproach = this.generateSuggestedApproach(input, discoveredContext);
      
      // Выявляем риски
      const identifiedRisks = this.identifyRisks(input, discoveredContext);
      
      // Вычисляем уверенность
      const confidence = this.calculateConfidence(input, discoveredContext);
      
      // Генерируем резюме
      const summary = this.generateSummary(input, discoveredContext, confidence);
      
      // Генерируем детальное понимание
      const detailedUnderstanding = this.generateDetailedUnderstanding(input, discoveredContext);
      
      const interpretation: TaskInterpretation = {
        id: `interp_${input.taskId}_${Date.now()}`,
        taskId: input.taskId,
        summary,
        detailedUnderstanding,
        discoveredContext,
        assumptions,
        suggestedApproach,
        identifiedRisks,
        confidence,
        basedOn: sources,
        generatedAt: new Date(),
        version: 1
      };
      
      const durationMs = Date.now() - startTime;
      log.debug(`Interpretation generated in ${durationMs}ms, confidence: ${(confidence * 100).toFixed(0)}%`);
      
      return {
        success: true,
        interpretation,
        durationMs
      };
      
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      log.error(`Interpretation generation failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        durationMs
      };
    }
  }
  
  /**
   * Собирает контекст из всех Discovery источников
   */
  private buildDiscoveredContext(input: InterpretationInput): DiscoveredContext {
    const filesFound = input.scopeContext?.patterns
      ?.flatMap(p => p.examples.map(ex => ({
        path: ex,
        relevance: 0.8,
        reason: `Matched pattern: ${p.pattern}`
      })))
      .slice(0, this.options.maxFilesInOutput) || [];
    
    const similarCode = input.architectureContext?.existingImplementations
      ?.map(impl => ({
        file: impl.file,
        line: impl.line,
        snippet: impl.snippet.slice(0, 200),
        keyword: impl.keyword,
        relevance: impl.relevance
      }))
      .slice(0, this.options.maxSimilarCodeInOutput) || [];
    
    return {
      filesFound,
      similarCode,
      pastInsights: input.crossSessionInsights || [],
      architectureContext: input.architectureContext?.recommendation?.reasoning || null,
      schemaWarnings: input.schemaWarnings || [],
      scanStats: {
        totalFilesScanned: input.scopeContext?.fileStats.total || 0,
        matchingFiles: input.scopeContext?.fileStats.matchingPattern || 0,
        scanDurationMs: input.scopeContext?.scanDurationMs || 0
      }
    };
  }
  
  /**
   * Определяет какие источники были использованы
   */
  private determineSources(input: InterpretationInput): InterpretationSource[] {
    const sources: InterpretationSource[] = [];
    
    if (input.scopeContext && input.scopeContext.fileStats.matchingPattern > 0) {
      sources.push('scope_scanner');
    }
    
    if (input.architectureContext && input.architectureContext.existingImplementations.length > 0) {
      sources.push('architecture_context');
    }
    
    if (input.crossSessionInsights && input.crossSessionInsights.length > 0) {
      sources.push('cross_session');
    }
    
    if (input.schemaWarnings && input.schemaWarnings.length > 0) {
      sources.push('project_schema');
    }
    
    if (input.intentClassification) {
      sources.push('intent_classifier');
    }
    
    return sources;
  }
  
  /**
   * Генерирует предположения на основе найденного контекста
   */
  private generateAssumptions(input: InterpretationInput, context: DiscoveredContext): string[] {
    const assumptions: string[] = [];
    
    // На основе найденных файлов
    if (context.filesFound.length > 0) {
      assumptions.push(
        `Задача затрагивает ${context.filesFound.length} файлов в проекте`
      );
    }
    
    // На основе похожего кода
    if (context.similarCode.length > 0) {
      assumptions.push(
        `В проекте уже есть похожая реализация (${context.similarCode[0].file})`
      );
      assumptions.push(
        `Рекомендуется использовать существующие паттерны`
      );
    }
    
    // На основе прошлых инсайтов
    if (context.pastInsights.length > 0) {
      assumptions.push(
        `Учтён опыт из ${context.pastInsights.length} прошлых сессий`
      );
    }
    
    // На основе intent
    if (input.intentClassification) {
      if (!input.intentClassification.allowCode) {
        assumptions.push(
          `Задача требует анализа/планирования без кода`
        );
      }
    }
    
    // На основе schema warnings
    if (context.schemaWarnings.length > 0) {
      assumptions.push(
        `Обнаружены предупреждения из Project Schema`
      );
    }
    
    return assumptions;
  }
  
  /**
   * Генерирует рекомендуемый подход
   */
  private generateSuggestedApproach(input: InterpretationInput, context: DiscoveredContext): string {
    const parts: string[] = [];
    
    // Если есть похожий код
    if (context.similarCode.length > 0) {
      parts.push(
        `Изучить существующую реализацию в ${context.similarCode[0].file}`
      );
      parts.push(
        `Расширить или адаптировать существующий паттерн`
      );
    } else {
      parts.push(
        `Создать новую реализацию следуя архитектуре проекта`
      );
    }
    
    // Если много файлов
    if (context.filesFound.length > 5) {
      parts.push(
        `Разбить задачу на этапы по модулям`
      );
    }
    
    // Если есть прошлые инсайты
    if (context.pastInsights.length > 0) {
      parts.push(
        `Учесть уроки из прошлых сессий`
      );
    }
    
    return parts.join('. ') + '.';
  }
  
  /**
   * Выявляет риски на основе Discovery
   */
  private identifyRisks(input: InterpretationInput, context: DiscoveredContext): string[] {
    const risks: string[] = [];
    
    // Много файлов = риск большого scope
    if (context.filesFound.length > 10) {
      risks.push(
        `Большой scope: ${context.filesFound.length} файлов могут быть затронуты`
      );
    }
    
    // Нет похожего кода = риск неконсистентности
    if (context.similarCode.length === 0 && context.filesFound.length > 0) {
      risks.push(
        `Нет существующих паттернов — риск неконсистентной реализации`
      );
    }
    
    // Schema warnings
    if (context.schemaWarnings.length > 0) {
      risks.push(
        `Предупреждения из Project Schema: ${context.schemaWarnings[0]}`
      );
    }
    
    // Нет данных вообще
    if (context.filesFound.length === 0 && context.similarCode.length === 0) {
      risks.push(
        `Недостаточно контекста — требуется дополнительное исследование`
      );
    }
    
    return risks;
  }
  
  /**
   * Вычисляет уверенность в интерпретации
   */
  private calculateConfidence(input: InterpretationInput, context: DiscoveredContext): number {
    let confidence = 0.5; // Базовая уверенность
    
    // +0.15 за найденные файлы
    if (context.filesFound.length > 0) {
      confidence += 0.15;
    }
    
    // +0.15 за похожий код
    if (context.similarCode.length > 0) {
      confidence += 0.15;
    }
    
    // +0.1 за прошлые инсайты
    if (context.pastInsights.length > 0) {
      confidence += 0.1;
    }
    
    // +0.1 за intent classification
    if (input.intentClassification && input.intentClassification.confidence > 0.7) {
      confidence += 0.1;
    }
    
    // -0.1 за warnings
    if (context.schemaWarnings.length > 0) {
      confidence -= 0.05;
    }
    
    return Math.min(0.95, Math.max(0.3, confidence));
  }
  
  /**
   * Генерирует краткое резюме
   */
  private generateSummary(
    input: InterpretationInput, 
    context: DiscoveredContext,
    confidence: number
  ): string {
    const parts: string[] = [];
    
    // Что за задача
    if (input.intentClassification) {
      parts.push(`Задача типа "${input.intentClassification.intent}"`);
    }
    
    // Что нашли
    if (context.filesFound.length > 0) {
      parts.push(`затрагивает ${context.filesFound.length} файлов`);
    }
    
    // Есть ли похожее
    if (context.similarCode.length > 0) {
      parts.push(`есть похожая реализация`);
    }
    
    // Уверенность
    const confText = confidence > 0.8 ? 'высокая' : confidence > 0.6 ? 'средняя' : 'низкая';
    parts.push(`уверенность ${confText}`);
    
    return parts.join(', ') + '.';
  }
  
  /**
   * Генерирует детальное понимание
   */
  private generateDetailedUnderstanding(
    input: InterpretationInput,
    context: DiscoveredContext
  ): string {
    const lines: string[] = [];
    
    lines.push(`Задача: "${input.taskDescription}"`);
    lines.push('');
    
    if (context.filesFound.length > 0) {
      lines.push(`Обнаружено ${context.filesFound.length} релевантных файлов в проекте.`);
      lines.push(`Основные файлы: ${context.filesFound.slice(0, 3).map(f => f.path).join(', ')}`);
      lines.push('');
    }
    
    if (context.similarCode.length > 0) {
      lines.push(`Найден похожий код в ${context.similarCode[0].file}:${context.similarCode[0].line}`);
      lines.push(`Ключевое слово: ${context.similarCode[0].keyword}`);
      lines.push('');
    }
    
    if (context.architectureContext) {
      lines.push(`Архитектурный контекст: ${context.architectureContext}`);
      lines.push('');
    }
    
    if (context.pastInsights.length > 0) {
      lines.push(`Релевантные инсайты из прошлых сессий:`);
      context.pastInsights.slice(0, 2).forEach(insight => {
        lines.push(`- ${insight}`);
      });
    }
    
    return lines.join('\n');
  }
  
  /**
   * Форматирует интерпретацию для вывода пользователю
   */
  formatForOutput(interpretation: TaskInterpretation): string {
    const lines: string[] = [];
    
    lines.push(`## 🧠 Моё понимание задачи`);
    lines.push('');
    lines.push(`**Резюме:** ${interpretation.summary}`);
    lines.push(`**Confidence:** ${(interpretation.confidence * 100).toFixed(0)}%`);
    lines.push('');
    
    // Что нашёл (компактно)
    const ctx = interpretation.discoveredContext;
    if (ctx.filesFound.length > 0 || ctx.similarCode.length > 0) {
      lines.push(`**Что нашёл:**`);
      if (ctx.filesFound.length > 0) {
        lines.push(`- ${ctx.filesFound.length} релевантных файлов`);
      }
      if (ctx.similarCode.length > 0) {
        lines.push(`- Похожий код в \`${ctx.similarCode[0].file}\``);
      }
      if (ctx.pastInsights.length > 0) {
        lines.push(`- ${ctx.pastInsights.length} инсайтов из прошлых сессий`);
      }
      lines.push('');
    }
    
    // Предположения
    if (interpretation.assumptions.length > 0) {
      lines.push(`**Мои предположения:**`);
      interpretation.assumptions.forEach(a => {
        lines.push(`- ${a}`);
      });
      lines.push('');
    }
    
    // Риски (если есть)
    if (interpretation.identifiedRisks.length > 0) {
      lines.push(`**⚠️ Обнаруженные риски:**`);
      interpretation.identifiedRisks.forEach(r => {
        lines.push(`- ${r}`);
      });
      lines.push('');
    }
    
    // Детали в collapsible (если hybrid format)
    if (this.options.outputFormat === 'hybrid' && this.options.includeDiscoveryDetails) {
      lines.push('<details>');
      lines.push('<summary>📊 Детали Discovery (клик для раскрытия)</summary>');
      lines.push('');
      lines.push('| Метрика | Значение |');
      lines.push('|---------|----------|');
      lines.push(`| Файлов просканировано | ${ctx.scanStats.totalFilesScanned} |`);
      lines.push(`| Релевантных файлов | ${ctx.scanStats.matchingFiles} |`);
      lines.push(`| Время сканирования | ${ctx.scanStats.scanDurationMs}ms |`);
      lines.push(`| Источники | ${interpretation.basedOn.join(', ')} |`);
      lines.push('');
      
      if (ctx.similarCode.length > 0) {
        lines.push('**Похожий код:**');
        ctx.similarCode.slice(0, 2).forEach(sc => {
          lines.push(`- \`${sc.file}:${sc.line}\` (${sc.keyword})`);
        });
        lines.push('');
      }
      
      lines.push('</details>');
      lines.push('');
    }
    
    lines.push(`⚠️ **Если я понял неправильно, уточните задачу.**`);
    
    return lines.join('\n');
  }
}

// Singleton instance
let generatorInstance: InterpretationGenerator | null = null;

/**
 * Получает singleton экземпляр генератора
 */
export function getInterpretationGenerator(options?: Partial<InterpretationOptions>): InterpretationGenerator {
  if (!generatorInstance || options) {
    generatorInstance = new InterpretationGenerator(options);
  }
  return generatorInstance;
}
