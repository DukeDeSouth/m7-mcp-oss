/**
 * M7 Phase Templates
 * 
 * Cognitive focus templates for each phase.
 * Each phase is a thinking instrument — it protects against specific classes of mistakes
 * by focusing attention on one aspect at a time.
 * 
 * Language principle: instrument, not coercion.
 * "This phase focuses on X" instead of "Do NOT do Y".
 */

import { PhaseConfig, PhaseType, GateWeight } from '../types/cycle.js';

export const PHASE_CONFIGS: Record<PhaseType, PhaseConfig> = {
  intake: {
    name: 'intake',
    order: 1,
    goal: 'Понять задачу — формулировка, контекст, критерии успеха.',
    nonGoals: [
      'Решения и планы — на следующих фазах',
      'Код — после полного понимания'
    ],
    attentionLock: '🎯 Фокус: формулировка задачи, контекст, критерии успеха',
    artifactTemplate: `# INTAKE: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** INTAKE

---

## 🎯 ФОКУС ФАЗЫ

Эта фаза — инструмент понимания. Она защищает от premature convergence (преждевременного перехода к решению без полного понимания задачи).

Сейчас фокус на: формулировка, контекст, критерии успеха, открытые вопросы.
Решения и код — на следующих фазах, когда понимание будет полным.

---

## Task Description

[Опишите задачу своими словами]

---

## Context

[Какой контекст важен для этой задачи?]

---

## Success Criteria

- [ ] [Критерий 1]
- [ ] [Критерий 2]

---

## Constraints

[Какие ограничения существуют?]

---

## Open Questions

[Что неясно?]

---

## Definition of Done (Intake)

- [ ] Задача сформулирована
- [ ] Контекст описан
- [ ] Критерии успеха определены
- [ ] Открытые вопросы зафиксированы

---

**Status:** INTAKE COMPLETE — переход к DISCOVERY`,
    definitionOfDone: [
      'Задача сформулирована',
      'Контекст описан',
      'Критерии успеха определены'
    ]
  },

  discovery: {
    name: 'discovery',
    order: 2,
    goal: 'Исследовать существующий код — файлы, зависимости, root cause.',
    nonGoals: [
      'Архитектура и планирование — следующие фазы',
      'Код — после полного исследования'
    ],
    attentionLock: '🔍 Фокус: существующие файлы, зависимости, паттерны, root cause\n- Перечисли смежные области, которые НЕ исследовались, и почему это ок (unknown-unknowns)\n- Незнакомый символ/API/термин/сущность на критическом пути → fog UNKNOWN (discover_technical, conf < 0.15), не догадка',
    artifactTemplate: `# DISCOVERY: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** DISCOVERY

---

## 🔍 ФОКУС ФАЗЫ

Эта фаза — самый ценный инструмент M7. Она защищает от familiarity illusion (иллюзии знания) и incomplete root cause analysis.

Сейчас фокус на: grep всего pipeline, трассировка от entry point до bug manifestation, поиск ВСЕХ затронутых файлов.
Решение проектируется на следующих фазах, когда картина будет полной.

---

## ⚠️ ОБЯЗАТЕЛЬНО: Проверка памяти

Перед началом исследования выполните:
\`\`\`
mcp_m7_memory action="search" query="<ключевые слова задачи>"
\`\`\`
Это предотвращает повторное исследование уже известных фактов.

---

## Relevant Files

| File | Purpose | Lines |
|------|---------|-------|
| | | |

---

## Current State

[Как это работает сейчас?]

---

## Dependencies

[Какие зависимости существуют?]

---

## Findings

[Что обнаружено?]

---

## Definition of Done (Discovery)

- [ ] Релевантные файлы найдены
- [ ] Текущее состояние описано
- [ ] Зависимости определены
- [ ] Findings задокументированы
- [ ] Blocking unknowns записаны в fog (discover_technical) или явно сняты

---

**Status:** DISCOVERY COMPLETE — переход к ARCHITECTURE`,
    definitionOfDone: [
      'Релевантные файлы найдены',
      'Текущее состояние описано',
      'Зависимости определены'
    ]
  },

  architecture: {
    name: 'architecture',
    order: 3,
    goal: 'Анализировать текущую архитектуру — паттерны, integration points, constraints.',
    nonGoals: [
      'Проектирование нового — следующая фаза (SOLUTION)',
      'Код — после проектирования'
    ],
    attentionLock: '🏗️ Фокус: текущая структура, паттерны, точки интеграции, ограничения',
    artifactTemplate: `# ARCHITECTURE: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** ARCHITECTURE

---

## 🏗️ ФОКУС ФАЗЫ

Эта фаза — инструмент понимания системы. Она защищает от integration blindspots — невидимых точек пересечения, которые ломают фикс.

Сейчас фокус на: текущая архитектура, паттерны, integration points, architectural constraints.
Проектирование решения — на следующей фазе, когда карта системы будет полной.

---

## Architecture Overview

[Описание текущей архитектуры]

---

## Patterns Used

[Какие паттерны используются?]

---

## Integration Points

[Точки интеграции]

---

## Architectural Constraints

[Архитектурные ограничения]

---

## Definition of Done (Architecture)

- [ ] Архитектура описана
- [ ] Паттерны идентифицированы
- [ ] Точки интеграции найдены
- [ ] Ограничения зафиксированы

---

**Status:** ARCHITECTURE COMPLETE — переход к SOLUTION`,
    definitionOfDone: [
      'Архитектура описана',
      'Паттерны идентифицированы',
      'Ограничения зафиксированы'
    ]
  },

  solution: {
    name: 'solution',
    order: 4,
    goal: 'Спроектировать решение — дизайн, файлы, шаги реализации.',
    nonGoals: [
      'Финальный код — после оценки рисков и симуляции'
    ],
    attentionLock: '📐 Фокус: дизайн, API, структура файлов, шаги реализации\n- Каждый ключевой вывод — ref на memory/fog; irreversible шаги требуют KNOWN/HUMAN_CONFIRMED оснований\n- Обязательна секция ## Adversarial Review перед gate',
    artifactTemplate: `# SOLUTION PLAN: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** SOLUTION

---

## 📐 ФОКУС ФАЗЫ

Эта фаза — инструмент проектирования. Она защищает от premature coding (кода без чёткого направления).

Сейчас фокус на: дизайн решения, какие файлы менять, алгоритм, шаги реализации.
Код пишется после оценки рисков (IMPACT) и когнитивной репетиции (SIMULATION).

---

## Solution Overview

[Краткое описание решения]

---

## Design

[Детальный дизайн]

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| | | |

---

## Implementation Steps

1. 
2. 
3. 

---

## Grounding

List key premises with memory/fog refs and classify plan steps (reversible vs irreversible). Required JSON:

\`\`\`json
{
  "grounding": {
    "premises": [
      { "id": "p1", "ref": "mem_...", "claim": "..." },
      { "id": "p2", "ref": "path:src/foo.ts", "claim": "..." }
    ],
    "steps": [
      {
        "id": "s1",
        "description": "Change config default",
        "reversibility": "reversible",
        "rollback": "Revert config",
        "premise_ids": ["p1"]
      },
      {
        "id": "s2",
        "description": "Deploy to production",
        "reversibility": "irreversible",
        "premise_ids": ["p1", "p2"]
      }
    ]
  }
}
\`\`\`

---

## Adversarial Review

1. **Counter-arguments:** 2–3 strongest reasons this plan may be wrong (alternative root cause, wrong incident, hidden dependency)
2. **Rebuttal:** your response to each counter-argument
3. **Reframing check (Fable 5):** did you re-explain any inconvenient fact so the plan could continue? If yes → signal to rewind discovery, not proof to proceed

---

## Definition of Done (Solution)

- [ ] Дизайн задокументирован
- [ ] Файлы определены
- [ ] Шаги реализации описаны

---

**Status:** SOLUTION COMPLETE — переход к IMPACT`,
    definitionOfDone: [
      'Дизайн задокументирован',
      'Файлы определены',
      'Шаги реализации описаны'
    ]
  },

  impact: {
    name: 'impact',
    order: 5,
    goal: 'Оценить риски — что может пойти не так, blast radius, rollback.',
    nonGoals: [
      'Митигация — при реализации; сейчас — только карта рисков'
    ],
    attentionLock: '⚡ Фокус: риски, blast radius, affected components, rollback strategy',
    artifactTemplate: `# IMPACT ANALYSIS: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** IMPACT

---

## ⚡ ФОКУС ФАЗЫ

Эта фаза — инструмент предотвращения. Она защищает от undetected regressions и edge cases, которые ломают PR.

Ценность IMPACT измеряется не % попаданий, а классом предотвращённого ущерба (Prevented Failure Value).

Сейчас фокус на: какие компоненты затронуты, что может сломаться, как откатить.

---

## Risk Assessment

### Critical Risks 🔴
[Риски с высоким impact]

### Major Risks 🟡
[Риски со средним impact]

### Minor Risks 🟢
[Риски с низким impact]

---

## Affected Components

| Component | Impact | Risk Level |
|-----------|--------|------------|
| | | |

---

## Behavioral Equivalence (для рефакторинга)

Если задача меняет реализацию существующей логики:
- [ ] f_old(x) == f_new(x) для всех x? Если нет — это осознанно?
- [ ] Проверить implicit semantics (round()=banker's, sort()=stable, etc)

---

## Rollback Strategy

[Как откатить изменения?]

---

## Definition of Done (Impact)

- [ ] Риски идентифицированы
- [ ] Impact оценен
- [ ] Rollback strategy defined

---

**Status:** IMPACT COMPLETE — переход к SIMULATION`,
    definitionOfDone: [
      'Риски идентифицированы',
      'Impact оценен',
      'Rollback strategy defined'
    ]
  },

  simulation: {
    name: 'simulation',
    order: 6,
    goal: 'Когнитивная репетиция — draft кода, review checklist, edge cases.',
    nonGoals: [
      'Финальный код — на следующей фазе (IMPLEMENTATION)'
    ],
    attentionLock: '🧪 Фокус: код-симуляция, review checklist, edge case validation\n- Перед IMPLEMENTATION gate MCP перепроверит irreversible основания из solution',
    artifactTemplate: `# SIMULATION: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** SIMULATION

---

## 🧪 ФОКУС ФАЗЫ

Эта фаза — когнитивная репетиция. Ценность не в совпадении кода с финальным, а в трансформации понимания.

Даже если 100% кода будет переписано при имплементации — процесс think-through снижает риски и ускоряет реализацию.

Сейчас фокус на: draft кода, review checklist, edge case validation.

---

## Code Simulation

\`\`\`typescript
// File: path/to/file.ts
// This is a SIMULATION, not final code

// Code here...
\`\`\`

---

## Review Checklist

- [ ] Types correct
- [ ] Patterns followed
- [ ] Edge cases handled
- [ ] Error handling implemented
- [ ] Old behavior vs new behavior compared (for refactoring)

---

## Definition of Done (Simulation)

- [ ] Код симулирован
- [ ] Review выполнен
- [ ] Готов к реализации

---

**Status:** SIMULATION COMPLETE — переход к IMPLEMENTATION`,
    definitionOfDone: [
      'Код симулирован',
      'Review выполнен'
    ]
  },

  implementation: {
    name: 'implementation',
    order: 7,
    goal: 'Реализовать решение.',
    nonGoals: [],
    attentionLock: '🔓 Разрешено: писать код, создавать файлы',
    artifactTemplate: `# IMPLEMENTATION: {task}

**Task ID:** \`{taskId}\`
**Date:** {date}
**Phase:** IMPLEMENTATION

---

## 🔓 IMPLEMENTATION PHASE

Теперь можно писать код!

---

## Files Created/Modified

| File | Action | Status |
|------|--------|--------|
| | | |

---

## Testing

- [ ] Manual test
- [ ] Unit tests
- [ ] Integration tests

---

## Deployment

[Как задеплоить?]

---

## Definition of Done (Implementation)

- [ ] Код написан
- [ ] Тесты пройдены
- [ ] Задеплоено / готово к деплою

---

**Status:** IMPLEMENTATION COMPLETE — M7 CYCLE DONE ✅`,
    definitionOfDone: [
      'Код написан',
      'Тесты пройдены'
    ]
  }
};

export function getPhaseConfig(phase: PhaseType): PhaseConfig {
  return PHASE_CONFIGS[phase];
}

export function getNextPhase(current: PhaseType): PhaseType | null {
  const order = PHASE_CONFIGS[current].order;
  const next = Object.values(PHASE_CONFIGS).find(p => p.order === order + 1);
  return next?.name ?? null;
}

export function getAllPhases(): PhaseType[] {
  return Object.values(PHASE_CONFIGS)
    .sort((a, b) => a.order - b.order)
    .map(p => p.name);
}

export function isLastPhase(phase: PhaseType): boolean {
  return PHASE_CONFIGS[phase].order === 7;
}

// ───── Reflection Gates v2 ─────

/**
 * Gate weight by phase transition.
 * Heavy gates require detailed reflection (DISCOVERY→ARCHITECTURE, ARCHITECTURE→SOLUTION).
 * Light gates allow quick pass-through (IMPACT→SIMULATION, SIMULATION→IMPLEMENTATION).
 */
export const GATE_WEIGHTS: Record<string, GateWeight> = {
  'intake→discovery': 'standard',
  'discovery→architecture': 'heavy',
  'architecture→solution': 'heavy',
  'solution→impact': 'standard',
  'impact→simulation': 'light',
  'simulation→implementation': 'light',
};

export function getGateWeight(from: PhaseType, to: PhaseType | null): GateWeight {
  if (!to) return 'light';
  const key = `${from}→${to}`;
  return GATE_WEIGHTS[key] || 'standard';
}

import { CONTROL_CHANNEL_NOTICE } from '../controlChannel.js';

export function generateGateTemplate(
  phase: PhaseType,
  weight: GateWeight,
  taskFraming: string
): string {
  const nextPhase = getNextPhase(phase);
  const nextName = nextPhase ? nextPhase.toUpperCase() : 'COMPLETE';
  
  const heavyBlock = weight === 'heavy'
    ? `\n### Deep Reflection Required\nЭтот переход критичен. Ответьте развёрнуто — обнаруженное может изменить весь подход.\n`
    : '';
  
  const lightBlock = weight === 'light'
    ? `\n_Лёгкий gate — достаточно краткого ответа._\n`
    : '';

  return `# Reflection Gate: ${phase.toUpperCase()} → ${nextName}
${heavyBlock}${lightBlock}
## Current Task Framing

> ${taskFraming}

## Instructions

Проанализируйте результаты фазы **${phase.toUpperCase()}**.
Совпадают ли находки с текущим пониманием задачи?

Ответьте JSON блоком:

\`\`\`json
{
  "gate_instruction_id": "<from Gate-ID block>",
  "decision": "continue | pivot | rewind | abort",
  "change_detected": true / false,
  "summary": "краткое описание находок / причин решения",
  "task_framing_update": "новое понимание задачи (только при pivot)",
  "rewind_target": "phase_name (только при rewind)",
  "confidence": 0.0 - 1.0
}
\`\`\`

${CONTROL_CHANNEL_NOTICE}

### Decision Guide
- **continue**: Находки соответствуют ожиданиям. Идём дальше.
- **pivot**: Обнаружено существенное отличие. Обновляем понимание задачи, но идём дальше.
- **rewind**: Нужно вернуться на предыдущую фазу и пересмотреть артефакт.
- **abort**: Задача невалидна / нерешаема. Останавливаем цикл.
`;
}

export function generateDiscoveryGateExtension(
  report: string,
  spawnedIds: string[]
): string {
  const spawnLine = spawnedIds.length > 0
    ? `- Auto-spawned recon tasks: ${spawnedIds.join(', ')}`
    : '- No recon tasks spawned (no blocking unknowns or taskGraph disabled)';

  return `${report}

### Discovery exit decision (required in reflection summary)
- If blocking unknowns = 0 OR all addressed → continue
- If blocking unknowns remain → state why OK to continue OR request rewind to discovery
${spawnLine}`;
}
