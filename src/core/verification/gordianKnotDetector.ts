import { createLogger } from '../utils/logger.js';
const log = createLogger('[gordianKnotDetector]');
/**
 * M7 v3.2 - Gordian Knot Detector
 * 
 * Обнаружение "гордиевых узлов" в коде — сложных запутанных мест,
 * которые мешают AI понимать и работать с кодом.
 * 
 * Severity:
 * - CRITICAL → Блокировать реализацию
 * - MAJOR → Предупредить, предложить рефакторинг
 * - MINOR → Логировать в tech debt
 */

import { getKnowledgeGraph } from '../../knowledge-graph/index.js';
import { getArchitecturalAdvisor } from '../../arch-advisor/index.js';
import { getProjectPath } from '../utils/projectPath.js';

/**
 * Severity уровни
 */
export type KnotSeverity = 'critical' | 'major' | 'minor';

/**
 * Тип гордиева узла
 */
export type KnotType =
  | 'circular_dependency'   // Циклические зависимости
  | 'god_object'           // Слишком большой класс/модуль
  | 'code_duplication'     // Дублирование кода
  | 'deep_nesting'         // Глубокая вложенность
  | 'long_function'        // Слишком длинная функция
  | 'many_params'          // Много параметров
  | 'implicit_dependency'  // Неявные зависимости
  | 'tight_coupling'       // Сильная связность
  | 'naming_issue'         // Проблемы с именованием
  | 'missing_types';       // Отсутствие типов (any)

/**
 * Описание гордиева узла
 */
export interface GordianKnot {
  type: KnotType;
  severity: KnotSeverity;
  file: string;
  line?: number;
  description: string;
  suggestion: string;
  effort: 'low' | 'medium' | 'high';  // Усилия на исправление
}

/**
 * Результат обнаружения
 */
export interface KnotDetectionResult {
  hasKnots: boolean;
  critical: GordianKnot[];
  major: GordianKnot[];
  minor: GordianKnot[];
  canProceed: boolean;  // false если есть critical
  summary: string;
}

/**
 * Правила обнаружения
 */
interface DetectionRule {
  type: KnotType;
  severity: KnotSeverity;
  description: string;
  suggestion: string;
  effort: 'low' | 'medium' | 'high';
}

const CRITICAL_RULES: DetectionRule[] = [
  {
    type: 'circular_dependency',
    severity: 'critical',
    description: 'Циклическая зависимость между модулями',
    suggestion: 'Извлеките общие типы в отдельный модуль или используйте dependency injection',
    effort: 'medium'
  },
  {
    type: 'god_object',
    severity: 'critical',
    description: 'God Object: класс/модуль слишком большой (>15 методов или >500 строк)',
    suggestion: 'Разделите на несколько специализированных модулей по принципу Single Responsibility',
    effort: 'high'
  },
  {
    type: 'code_duplication',
    severity: 'critical',
    description: 'Дублирование кода >80%',
    suggestion: 'Извлеките общую логику в переиспользуемую функцию/компонент',
    effort: 'medium'
  }
];

const MAJOR_RULES: DetectionRule[] = [
  {
    type: 'deep_nesting',
    severity: 'major',
    description: 'Глубокая вложенность (>4 уровня)',
    suggestion: 'Используйте early returns, extract functions или guard clauses',
    effort: 'low'
  },
  {
    type: 'long_function',
    severity: 'major',
    description: 'Функция слишком длинная (>100 строк)',
    suggestion: 'Разбейте на несколько функций с ясными именами',
    effort: 'medium'
  },
  {
    type: 'many_params',
    severity: 'major',
    description: 'Слишком много параметров (>5)',
    suggestion: 'Используйте объект параметров или разделите функцию',
    effort: 'low'
  },
  {
    type: 'implicit_dependency',
    severity: 'major',
    description: 'Неявные зависимости через глобальные переменные',
    suggestion: 'Передавайте зависимости явно через параметры или DI',
    effort: 'medium'
  },
  {
    type: 'tight_coupling',
    severity: 'major',
    description: 'Сильная связность между модулями',
    suggestion: 'Введите интерфейсы/абстракции между модулями',
    effort: 'high'
  }
];

const MINOR_RULES: DetectionRule[] = [
  {
    type: 'naming_issue',
    severity: 'minor',
    description: 'Проблемы с именованием (неинформативные имена)',
    suggestion: 'Используйте descriptive names, избегайте аббревиатур',
    effort: 'low'
  },
  {
    type: 'missing_types',
    severity: 'minor',
    description: 'Отсутствие типов (any)',
    suggestion: 'Добавьте явные типы для лучшей читаемости и безопасности',
    effort: 'low'
  }
];

/**
 * Gordian Knot Detector
 */
export class GordianKnotDetector {
  
  /**
   * Обнаружить все узлы в проекте или указанных файлах
   */
  async detect(files?: string[]): Promise<KnotDetectionResult> {
    const knots: GordianKnot[] = [];
    
    // 1. Проверка через Knowledge Graph (циклы, зависимости)
    await this.detectFromGraph(knots);
    
    // 2. Проверка через Arch Advisor (god objects, etc.)
    await this.detectFromArchAdvisor(knots);
    
    // 3. Категоризация
    const critical = knots.filter(k => k.severity === 'critical');
    const major = knots.filter(k => k.severity === 'major');
    const minor = knots.filter(k => k.severity === 'minor');
    
    return {
      hasKnots: knots.length > 0,
      critical,
      major,
      minor,
      canProceed: critical.length === 0,
      summary: this.buildSummary(critical, major, minor)
    };
  }
  
  /**
   * Обнаружение через Knowledge Graph
   */
  private async detectFromGraph(knots: GordianKnot[]): Promise<void> {
    try {
      const graph = getKnowledgeGraph();
      
      // Проверить построен ли граф
      if (!graph.built) {
        log.debug('GordianKnotDetector] Graph not built, skipping graph-based detection');
        return;
      }
      
      // 1. Циклические зависимости
      const cycles = graph.detectCycles();
      
      if (cycles && cycles.length > 0) {
        for (const cycle of cycles.slice(0, 5)) {
          // cycle.path is a string like "A → B → C → A"
          const firstFile = cycle.nodes?.[0]?.filePath || 'unknown';
          knots.push({
            type: 'circular_dependency',
            severity: 'critical',
            file: firstFile,
            description: `Циклическая зависимость: ${cycle.path || 'unknown cycle'}`,
            suggestion: cycle.suggestion || CRITICAL_RULES.find(r => r.type === 'circular_dependency')!.suggestion,
            effort: 'medium'
          });
        }
      }
      
    } catch (error: any) {
      log.debug(`GordianKnotDetector] Graph detection error: ${error.message}`);
    }
  }
  
  /**
   * Обнаружение через Architecture Advisor
   */
  private async detectFromArchAdvisor(knots: GordianKnot[]): Promise<void> {
    try {
      const projectPath = getProjectPath();
      const advisor = getArchitecturalAdvisor(projectPath);
      const antipatterns = await advisor.detectAntipatterns();
      
      for (const ap of antipatterns) {
        // Маппинг antipattern category/name → knot type
        let knotType: KnotType;
        let severity: KnotSeverity;
        
        // DetectedAntipattern has: name, category, severity, target, description
        const apName = ap.name.toLowerCase();
        
        if (apName.includes('god') || apName.includes('blob')) {
          knotType = 'god_object';
          severity = 'critical';
        } else if (apName.includes('circular') || apName.includes('cycle')) {
          knotType = 'circular_dependency';
          severity = 'critical';
        } else if (apName.includes('dead') || apName.includes('unused')) {
          knotType = 'code_duplication';
          severity = 'minor';
        } else {
          knotType = 'tight_coupling';
          severity = ap.severity === 'critical' ? 'critical' : 'major';
        }
        
        // Избежать дубликатов
        const targetFile = ap.target?.filePath || 'unknown';
        const exists = knots.some(
          k => k.type === knotType && k.file === targetFile
        );
        
        if (!exists) {
          // Build suggestion from evidence
          const suggestion = ap.evidence?.length > 0 
            ? `${ap.evidence[0]}. Consider refactoring.`
            : 'Review and refactor this code.';
          
          knots.push({
            type: knotType,
            severity,
            file: targetFile,
            line: ap.target?.lineNumber,
            description: ap.description,
            suggestion,
            effort: ap.severity === 'critical' ? 'high' : 'medium'
          });
        }
      }
      
    } catch (error: any) {
      log.debug(`GordianKnotDetector] ArchAdvisor detection error: ${error.message}`);
    }
  }
  
  /**
   * Построить summary
   */
  private buildSummary(
    critical: GordianKnot[],
    major: GordianKnot[],
    minor: GordianKnot[]
  ): string {
    const lines: string[] = ['## 🔗 Gordian Knot Detection', ''];
    
    if (critical.length === 0 && major.length === 0 && minor.length === 0) {
      lines.push('✅ Гордиевы узлы не обнаружены. Код чистый!');
      return lines.join('\n');
    }
    
    if (critical.length > 0) {
      lines.push(`### 🔴 CRITICAL (${critical.length}) — БЛОКИРУЕТ РЕАЛИЗАЦИЮ`);
      lines.push('');
      for (const k of critical) {
        lines.push(`**${k.file}${k.line ? `:${k.line}` : ''}**`);
        lines.push(`- ${k.description}`);
        lines.push(`- 💡 ${k.suggestion}`);
        lines.push('');
      }
      lines.push('> ⛔ Исправьте критические проблемы перед продолжением!');
      lines.push('');
    }
    
    if (major.length > 0) {
      lines.push(`### 🟡 MAJOR (${major.length}) — рекомендуется исправить`);
      lines.push('');
      for (const k of major) {
        lines.push(`- **${k.file}**: ${k.description}`);
      }
      lines.push('');
      lines.push('> ⚠️ Можно продолжить, но рекомендуется исправить или добавить в tech debt.');
      lines.push('');
    }
    
    if (minor.length > 0) {
      lines.push(`### 🟢 MINOR (${minor.length}) — tech debt`);
      lines.push('');
      for (const k of minor) {
        lines.push(`- ${k.file}: ${k.description}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

// Singleton
let instance: GordianKnotDetector | null = null;

export function getGordianKnotDetector(): GordianKnotDetector {
  if (!instance) {
    instance = new GordianKnotDetector();
  }
  return instance;
}

