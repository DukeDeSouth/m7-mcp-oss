# Pre-PR Gate

Обязательный gate перед любым новым upstream PR в чужой репозиторий.

Документ составлен по итогам разбора реальных PR (см. раздел «Что этот gate должен был бы поймать»). Внутренние материалы разбора (анализ фидбэка, матрица профилей репозиториев, журнал контрибуций) в публичный снапшот не включены; ссылки на них удалены.

Цель:

- не отправлять полуготовые PR
- не ломать trust на process/gov уровне
- не повторять типовые ошибки из уже полученного фидбэка

---

## Принцип

PR нельзя оценивать только по критерию "фикс технически правильный".

PR можно отправлять только если одновременно выполнены 4 условия:

1. проблема действительно понята
2. решение действительно закрывает bug surface
3. change действительно mergeable для этого репозитория
4. форма подачи не создаёт лишний review burden

Если любой из этих пунктов не выполняется, PR считается неготовым.

---

## Структура gate

Gate делится на 8 блоков:

1. Repo fit
2. Problem fit
3. Solution completeness
4. Validation
5. Diff hygiene
6. PR presentation
7. Evidence pack
8. Follow-up readiness

PR можно отправлять только если:

- нет ни одного `RED`
- все `YELLOW` осознанно приняты

---

## 1. Repo fit

### 1.1 Contribution rules checked

- [ ] Прочитан `CONTRIBUTING.md`
- [ ] Проверены labels/issue template/review ritual
- [ ] Понято, нужен ли `CLA`
- [ ] Понято, нужен ли `assign`
- [ ] Понято, нужны ли скриншоты/видео/demo
- [ ] Понято, нужен ли RFC/ACP/design doc до PR

`RED`, если:

- репозиторий требует governance artifact, а у нас его нет
- contribution flow непонятен

### 1.2 AI policy checked

- [ ] Проверено, есть ли явная anti-AI политика
- [ ] Проверено, были ли у нас в этом репо негативные AI-сигналы ранее
- [ ] Выбран режим подачи: обычный / human-heavy / avoid

`RED`, если:

- репозиторий явно не принимает AI-authored changes
- у нас уже был moderation warning и мы идём тем же способом

### 1.3 Existing PR sweep done

- [ ] Проверены open PR по issue
- [ ] Проверены recent closed PR по issue
- [ ] Проверено, не fixed ли уже проблема upstream
- [ ] Проверено, не out-of-scope ли этот change для проекта

`RED`, если:

- есть active duplicate
- maintainers уже сказали, что такой класс изменений out-of-scope

---

## 2. Problem fit

### 2.1 Bug is real

- [ ] Есть issue / bug report / direct user signal
- [ ] Есть воспроизведение или достаточный proof
- [ ] Root cause сформулирован в 1-3 предложениях
- [ ] Понятно, почему это именно bug, а не expected behavior

`RED`, если:

- нет уверенности, что это реально баг
- root cause расплывчатый

### 2.2 Repo value is clear

- [ ] Понятно, почему проекту это важно
- [ ] Понятно, кто страдает от бага
- [ ] Понятно, почему maintainer должен хотеть принять fix

`YELLOW`, если:

- баг технически интересный, но project value слабая или спорная

---

## 3. Solution completeness

### 3.1 Full closure check

- [ ] Исправлен не только symptom, но и основной path
- [ ] Проверены соседние branches
- [ ] Проверены edge cases
- [ ] Проверены platform/dialect-specific branches
- [ ] Нет известных незакрытых holes рядом с fix

`RED`, если:

- fix partial по известным данным
- есть незакрытый variant того же бага

### 3.2 Architectural fit

- [ ] Решение соответствует внутренним паттернам репозитория
- [ ] Не добавляет временную глобальщину без крайней причины
- [ ] Не ломает existing invariants
- [ ] Не выглядит как "локальный костыль поверх архитектуры"

`YELLOW`, если:

- идея правильная, но implementation style выглядит не-native для проекта

---

## 4. Validation

### 4.1 Tests

- [ ] Есть тест, который падает без фикса
- [ ] Есть тест, который проходит с фиксом
- [ ] Нет новых падающих тестов
- [ ] Нет игнорирования failures в CI

`RED`, если:

- CI красная
- нет regression proof

### 4.2 Formatting / lint / housekeeping

- [ ] Проходит formatting
- [ ] Проходит lint
- [ ] Проходят repo-native gates (`tidy`, `typecheck`, `cargo fmt`, и т.д.)

`RED`, если:

- падает любой обязательный housekeeping gate

### 4.3 Scope validation

- [ ] Изменение минимально по размеру
- [ ] Нет лишнего рефакторинга
- [ ] Нет unrelated cleanup в одном PR

`YELLOW`, если:

- diff больше нужного для фикса

---

## 5. Diff hygiene

### 5.1 Clean diff

- [ ] Нет lockfiles, если они не нужны
- [ ] Нет случайных generated files
- [ ] Нет debug prints / temp comments
- [ ] Нет stale assertions
- [ ] Нет случайных whitespace-only шумов

`RED`, если:

- в diff есть нерелевантные файлы

### 5.2 Reviewer burden

- [ ] Diff легко читать
- [ ] Коммиты/описание помогают reviewer, а не мешают
- [ ] Maintainer не должен сам догадываться, что именно мы исправили

`YELLOW`, если:

- change technically correct, but review path тяжёлый

---

## 6. PR presentation

### 6.1 Human-style text

- [ ] Описание короткое и человеческое
- [ ] Нет AI-style headers/walls of bullets без нужды
- [ ] Нет нерелевантной теории
- [ ] Нет перефразирования всего diff в prose
- [ ] Текст объясняет "почему", а не механически перечисляет "что"

`RED`, если:

- PR текст даёт strong AI-generated impression

### 6.2 Repo-native framing

- [ ] Использована лексика и framing, близкие к этому репо
- [ ] Указаны только действительно важные детали
- [ ] Нет ощущения, что мы пришли с чужим process style

`YELLOW`, если:

- текст хороший сам по себе, но не совпадает с культурой репо

---

## 7. Evidence pack

### 7.1 Proof attached

- [ ] Есть reproduction notes
- [ ] Есть before/after signal
- [ ] Для UI: есть screenshot/video если это ожидается
- [ ] Для perf/race/security: есть минимальное доказательство, а не только уверенность

`RED`, если:

- change нельзя быстро верифицировать извне

### 7.2 Reviewer questions pre-answered

- [ ] Почему это не duplicate?
- [ ] Почему это не expected behavior?
- [ ] Почему fix complete?
- [ ] Почему именно такой design?
- [ ] Почему risk of regression acceptable?

`YELLOW`, если:

- ответы есть у нас в голове, но не материализованы в PR artifacts

---

## 8. Follow-up readiness

### 8.1 Post-submit plan exists

- [ ] Понятно, кто и как следит за PR
- [ ] Понятно, как быстро отвечаем на review
- [ ] Понятно, что делаем при stale / bot comment / CI request

`YELLOW`, если:

- PR можно отправить, но сопровождать некому

### 8.2 Exit criteria defined

- [ ] Понятно, когда мы продолжаем fight
- [ ] Понятно, когда мы переводим PR в wait-only
- [ ] Понятно, когда мы закрываем тему и не тратим больше время

---

## Go / No-Go rubric

### GO

PR можно отправлять, если:

- все `RED` закрыты
- `YELLOW` не больше 2
- нет cultural/governance mismatch
- CI и diff hygiene зелёные

### NO-GO

PR нельзя отправлять, если есть хотя бы один пункт:

- governance prerequisite не закрыт
- explicit anti-AI repo stance
- open duplicate / upstream already fixed
- red CI
- incomplete fix по известным данным
- dirty diff
- текст PR выглядит AI-generated

### SPECIAL REVIEW REQUIRED

Нужен отдельный ручной review перед отправкой, если:

- compiler / kernel / security / DB dialect / concurrency-heavy fix
- репозиторий уже давал нам негативный trust signal
- репозиторий по прошлому опыту относится к классу «строгий, но проходимый» или «избегать» (внутренняя матрица профилей репозиториев в снапшот не включена)

---

## Минимальный pre-submit checklist

Если времени мало, хотя бы этот короткий блок должен быть зелёным:

- [ ] No duplicate
- [ ] No anti-AI policy conflict
- [ ] Tests green
- [ ] Formatting green
- [ ] Diff clean
- [ ] Fix not partial
- [ ] PR text human and short
- [ ] Reviewer can verify before/after quickly

Если хоть один пункт нет, PR наружу не уходит.

---

## Типовые причины стопа

### Stop: repo mismatch

Примеры:

- нужен ACP
- проект не принимает AI code
- change out of scope

Действие:

- не шипить PR
- сначала закрыть governance path или отказаться

### Stop: mergeability mismatch

Примеры:

- red CI
- formatting fail
- dirty diff
- duplicate

Действие:

- не шипить PR
- довести до mergeable состояния локально

### Stop: solution mismatch

Примеры:

- fix закрывает только symptom
- не покрыты edge cases
- не проверены dialect/platform branches

Действие:

- вернуться в implementation/review phase

### Stop: trust mismatch

Примеры:

- AI-looking PR text
- слишком много нерелевантного объяснения
- reviewer burden слишком высокий

Действие:

- переписать подачу
- упростить narrative

---

## Что этот gate должен был бы поймать в прошлых кейсах

Шесть реальных PR, на которых собран этот gate. Ссылки на репозитории и номера в публичной версии убраны; оставлены класс проекта и причина стопа.

### Компилятор системного языка

Должен был остановиться на:

- governance prerequisite (изменение требовало предварительного процесса согласования)
- anti-AI / trust risk
- presentation quality

### Сборщик модулей для JavaScript

Должен был остановиться на:

- red tests
- AI-looking presentation

### ORM для TypeScript

Должен был остановиться на:

- duplicate sweep
- failing tests
- incomplete dialect validation

### Хобби-ОС с явной anti-AI политикой

Должен был остановиться на:

- anti-AI repo mismatch
- incomplete fix

### Проект с формальным процессом контрибуций

Должен был остановиться на:

- missing process artifacts
- missing evidence pack

### Агентный фреймворк с строгой гигиеной diff

Должен был остановиться на:

- dirty diff
- hygiene failure

---

## Рабочий вывод

Этот gate нужен не для бюрократии.

Он нужен потому, что наши реальные провалы происходили не на уровне "не нашли root cause", а на уровне:

- отправили слишком рано
- отправили не в тот репозиторий тем способом
- отправили без закрытия process/trust gates

Поэтому правило простое:

> Нет зелёного `Pre-PR Gate` — нет внешнего PR.
