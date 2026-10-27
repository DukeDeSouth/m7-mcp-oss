# Архив ранних редакций методологии

Документы в этой папке написаны в 2025 году для закрытого веб-проекта (Next.js, tRPC, Drizzle, Solana), из которого выросла методология M7; название проекта в публичной версии убрано. Они описывают систему четырёх файлов на задачу и содержат проверки, специфичные для того стека. Сохранены как история; **не являются нормативными** и не согласованы с текущей реализацией сервера (семь фаз, семь файлов, маршруты `light`/`medium`/`heavy`/`decompose`).

Актуальные документы: `Methodology/IDEAL_METHODOLOGY.md` (спецификация), `Methodology/CURSOR_METHODOLOGY_RULES.md` (правила для агента), `Methodology/ANTI_HALLUCINATION_CHECKLIST.md`, `M7-GUIDE.md`.

| Файл | Содержание | Что из него перенесено в актуальные документы |
|---|---|---|
| `IMPLEMENTATION_METHODOLOGY.md` | планирование реализации, система 4 файлов, Context7 | фазы SOLUTION/IMPACT, проверка библиотек через Context7 |
| `DEBUGGING_METHODOLOGY.md` | системный дебаггинг: данные раньше кода, изоляция, валидация гипотез | диагностические правила (`IDEAL_METHODOLOGY.md` §8) |
| `TYPE_SAFETY_METHODOLOGY.md` | типы БД против runtime (decimal → string и т. п.), версии tRPC/Next.js | принцип проверки существования и актуальности; детали стека не переносились |
| `CHANGE_TRACKING_SYSTEM.md` | маркеры `@AI-FIX-XXX`, журнал `docs/changes/` | защита от самоуничтожения через `git log`/`git diff`; маркеры в коде не используются |
| `FOUR_FILES_EXAMPLE.md`, `FOUR_FILES_QUICK_REFERENCE.md` | пример и памятка по 4 файлам | заменены структурой из 7 файлов (`mcp_m7_create_structure`) |
| `METHODOLOGY_USAGE.md` | как подключать методологию в чат | `docs/M7_USER_RULES_TEMPLATE.md` |

Ссылки внутри архивных документов могут указывать на файлы, которых больше нет (`DEBUGGING_METHODOLOGY_OLD.md`, `docs/IMPLEMENTATION_METHODOLOGY.md`); они не исправлялись.
