# Шаблон User Rules для Cursor

Блок ниже вставляется в **Cursor Settings → Rules → User Rules**. Он включает префиксы-триггеры и минимальный набор принципов; полный набор правил для проекта — `Methodology/CURSOR_METHODOLOGY_RULES.md` (в `.cursorrules` / `AGENTS.md`), порядок работы с тулами — `M7-GUIDE.md`.

Имена тулов в Cursor имеют вид `mcp_<server>_<tool>`; при имени сервера `m7` и имени тула `mcp_m7_analyze_task` полное имя — `mcp_m7_mcp_m7_analyze_task`. Если сервер подключён под другим именем, замените префикс.

## Блок для вставки

```
## M7 MCP triggers

When a user message starts with one of these prefixes, call the corresponding tool with the text after the prefix:

- "м7:", "m7:", "М7:", "M7:"        → mcp_m7_mcp_m7_analyze_task (task_description)
- "хайв:", "hive:", "Хайв:", "Hive:" → mcp_m7_mcp_m7_hive_coordinator (task)

Treat these prefixes as tool triggers, not as plain text.

## M7 principles

- Read INDEX.md before any task.
- No code before DISCOVERY is complete; follow the 7-phase cycle (INTAKE → DISCOVERY → ARCHITECTURE → SOLUTION → IMPACT → SIMULATION → IMPLEMENTATION).
- A bug cause is stated only with evidence (code, log, reproduction). The bug is in the code, not in the cache, until proven otherwise.
- Full solutions, not hotfixes. A workaround is labelled temporary and the real fix is named.
- Before using any function, file, variable, endpoint or tool action not shown in context: grep/search first.
- New library → verify docs via Context7. UI change → verify via Playwright.
- A critical risk blocks progress.
- Do not call code written in this chat "buggy" without git history and user confirmation.
- Respond in Russian. No marketing language.
```

## Как добавить

1. Cursor Settings (`⌘ ,`) → Rules → User Rules.
2. Вставить блок, сохранить.
3. Проверка: сообщение `м7: test` должно вызвать `analyze_task`.

## Альтернатива

Если префикс не срабатывает, обращение через mention работает всегда:

```
@m7 analyze task "описание задачи"
```

Префикс через User Rules срабатывает в большинстве случаев, но зависит от модели и версии Cursor; `@m7` — детерминированный путь.
