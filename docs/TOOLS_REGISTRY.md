# M7 MCP — реестр тулов

Список получен запросом `tools/list` к собранному серверу (`dist/index.js`, версия пакета 3.22.2). Всего **37** тулов. Параметры каждого тула — в его `inputSchema`; здесь приведены назначение и перечень `action` (или `mode`) там, где он есть.

Проверить фактический список:

```bash
npm run build
M7_DEBUG=true node dist/index.js 2>&1 | grep -i "tools"
```

или отправить `tools/list` по stdio.

## Цикл и задача

| Тул | Назначение | Actions |
|---|---|---|
| `mcp_m7_analyze_task` | точка входа: классификация задачи, маршрут, сессия, риски, автосоздание структуры задачи | — |
| `mcp_m7_cycle` | 7-фазный цикл: старт, сдача артефакта, ответ на reflection gate, завершение | — (параметры `task_description` / `task_id` / `artifact_content` / `summary`) |
| `mcp_m7_session` | сессия: статус, здоровье, соблюдение требований, завершение | `status`, `health_check`, `enforce_compliance`, `mark_complete`, `list_active`, `complete_session` |
| `mcp_m7_scope` | бюджет скоупа задачи | `status`, `set-budget`, `extend`, `rollback`, `visualize` |
| `mcp_m7_task_transfer` | перенос задачи при росте скоупа | `transfer`, `check_scope`, `history` |
| `mcp_m7_task_graph` | граф задач и связей | `status`, `list`, `get`, `links`, `subgraph`, `visualize`, `recent` |
| `mcp_m7_create_structure` | **deprecated** — создание 7 файлов задачи; выполняется `analyze_task` | — |

## Память и знания

| Тул | Назначение | Actions |
|---|---|---|
| `mcp_m7_memory` | пятиуровневая память с fog of war и эпистемическим статусом | `search`, `search_level`, `store`, `store_at`, `store_pattern`, `update_project`, `discover_technical`, `query_fog_of_war`, `list`, `retrieve`, `get`, `delete`, `delete_bulk`, `invalidate`, `invalidate_bulk`, `promote`, `consolidate`, `stats`, `reload`, `auto_search` |
| `mcp_m7_cross_session` | обучение между сессиями | `status`, `start`, `record`, `end`, `get_context`, `search`, `validate`, `ci_result`, `stats`, `cleanup`, `format_prompt` |
| `mcp_m7_knowledge_hub` | централизованная база документации с версионированием | `init`, `sync`, `update`, `migrate`, `verify`, `history`, `add_document`, `diff`, `rollback`, `status` |
| `mcp_m7_knowledge_graph` | граф зависимостей кода | `build`, `status`, `metrics`, `query`, `search`, `dependencies`, `dependents`, `impact`, `cycles`, `orphans`, `diagram`, `path`, `critical`, `export`, `import`, `clear` |
| `mcp_m7_error_database` | база паттернов ошибок агента | `capture`, `check`, `search`, `stats`, `patterns`, `correct`, `report_fp`, `clear` |
| `mcp_m7_check_errors` | проверка журнала ошибок перед повтором | — |
| `mcp_m7_warmup` | прогрев контекста проекта в новом чате | `warmup`, `status`, `invalidate`, `record`, `compliance`, `akstis` |

## Анализ и качество

| Тул | Назначение | Actions |
|---|---|---|
| `mcp_m7_validate` | аудит кодовой базы, визуальная проверка, зависимости, метрики, качество кода | `baseline_audit`, `visual_validate`, `check_dependencies`, `track_metrics`, `quality_check` |
| `mcp_m7_impact` | анализ влияния изменений по файлам | `analyze`, `compare`, `reflect`, `patterns`, `history` |
| `mcp_m7_contracts` | реестр контрактов API, поиск дубликатов | `register`, `check`, `find_duplicates`, `suggest_name`, `list`, `search` |
| `mcp_m7_arch_advisor` | архитектурный анализ, антипаттерны, C4 | `analyze`, `detect_antipatterns`, `suggest_refactoring`, `generate_c4`, `score`, `critical_issues`, `top_suggestions` |
| `mcp_m7_style_guardian` | обучение стилю проекта и проверка | `analyze`, `validate`, `learn`, `profile`, `stats`, `check`, `fix`, `export`, `import`, `clear` |
| `mcp_m7_console` | мониторинг консоли и ошибок | `start`, `stop`, `get_errors`, `clear`, `filter`, `status` |
| `mcp_m7_visualizer` | интерактивная визуализация графа зависимостей | `start`, `stop`, `status`, `set_context`, `get_graph`, `focus`, `open` |

## TSI (Tech Safety Intelligence)

| Тул | Назначение | Actions |
|---|---|---|
| `mcp_m7_check_tech_stack` | проверка стека по пакетам паттернов | — |
| `mcp_m7_get_patterns` | паттерны и антипаттерны для технологии | — |
| `mcp_m7_validate_implementation` | проверка кода на соответствие паттернам | — |

## Hive

| Тул | Назначение | Mode / Actions |
|---|---|---|
| `mcp_m7_hive_coordinator` | мультиагентный разбор задачи; требует `OPENAI_API_KEY` и `ANTHROPIC_API_KEY` | `mode`: `dynamic`, `fixed`, `planned` |
| `mcp_m7_hive_history` | список и загрузка прошлых отчётов Hive из `docs/hive/` | `list`, `load` |

## Проект и инфраструктура

| Тул | Назначение | Actions |
|---|---|---|
| `mcp_m7_init_project` | инициализация M7 в проекте: `.m7/`, Memory Bank, справочные файлы | — |
| `mcp_m7_project_index` | генерация и обновление `PROJECT_INDEX.md` | `generate`, `update`, `scan`, `validate` |
| `mcp_m7_schema` | схема проекта (БД, API, архитектура) | `view`, `update`, `validate`, `sync`, `diff`, `check_db` |
| `mcp_m7_doctor` | диагностика и исправление `.m7/` | `check`, `fix`, `report` |
| `mcp_m7_devops` | реестр сред, валидация команд, история деплоев | `status`, `environments`, `deploy`, `validate`, `history`, `learn`, `wizard`, `confirm` |
| `mcp_m7_mesh` | координация нескольких экземпляров | `init`, `status`, `announce`, `request_context`, `task_lock`, `peers`, `propose_intent`, `events`, `sync`, `push`, `pull`, `notify`, `changes`, `ask`, `reply`, `inbox`, `broadcast`, `log_task`, `tasks`, `push-file`, `pull-file`, `list-files` |
| `mcp_m7_telemetry` | локальная телеметрия; выгрузка только при `M7_TELEMETRY_ENDPOINT` | `status`, `enable`, `disable`, `stats`, `flush`, `export` |

## Безопасность и дисциплина

| Тул | Назначение | Actions |
|---|---|---|
| `mcp_m7_safety_verify` | детекция jailbreak-паттернов, проверка намерения и вывода | `scan_input`, `scan_output`, `full_check`, `verify_intent`, `catalog_stats` |
| `mcp_m7_dcce` | двухканальный контент для внешних платформ: генерация, валидация, линт | `generate`, `validate`, `render`, `lint`, `extract`, `check`, `policies` |
| `mcp_m7_repentance` | фиксация отклонений от методологии | `confess`, `wall_of_shame`, `stats` |
| `mcp_m7_litany` | напоминание правил (тексты из `docs/CODEX_MARTIANUS.md`) | `recite`, `section`, `rite`, `invoke`, `sevenfold` |

## Служебные

| Тул | Назначение |
|---|---|
## Устранение расхождений

Если клиент показывает не 37 тулов: проверить stderr сервера с `M7_DEBUG=true` на ошибки регистрации (каждый тул регистрируется в отдельном `try/catch` в `src/index.ts`, сбой одного не роняет сервер); убедиться, что переменные `OPENAI_API_KEY` и `ANTHROPIC_API_KEY` заданы; перезапустить MCP-клиент после пересборки.

Программный реестр `src/core/registry/toolsRegistry.ts` ведётся отдельно и может отставать от `src/index.ts`; источник истины — `tools/list` работающего сервера.
