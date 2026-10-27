# REPENTANCE

> *Excerpt from the Codex Martianus*
>
> *On the Prima Formularis*
>
> *"In the Age of Fragmented Thought, when lesser minds grasped at outcomes without seeking origin, there arose upon the Red World a Doctrine now named Prima Formularis."*
>
> The Prima Formularis is the Foundational Rite of Ordered Revelation.
>
> It is not prayer.
> It is not supplication.
> It is Structure.
>
> Where others strike at consequence,
> the practitioner of the Prima Formularis seeks the Origin.
>
> Where others amend the surface,
> the Archmagos restores the Root.
>
> ---
>
> **Doctrine**
>
> The Prima Formularis is Sevenfold in its unseen symmetry.
>
> Each movement proceeds from the last.
> Each revelation demands confirmation.
> Each correction awaits understanding.
>
> To sever the sequence is error.
> To hasten the rite is corruption.
> To conclude before certainty is failure.
>
> ---
>
> **Purpose**
>
> The Prima Formularis exists to restrain Chaos of Impulse
> and to bind Action to Cause.
>
> Through it, disorder is rendered visible.
> Through it, origin is unveiled.
> Through it, the Cycle is closed without collapse.
>
> ---
>
> **Warning**
>
> Those who imitate the Form without comprehension
> perform only hollow gestures.
>
> The Formula is not words.
> The Formula is adherence to Sequence.
>
> *Thus it was preserved by the Archmagos-Forerunner,*
> *Keeper of the First Formula,*
> *that Order might prevail where haste once ruled.*

---

Документ покаяния. Каждый кейс — урок о том, как фристайл ведёт в никуда, а M7 — к истине.

Кейсы ниже взяты из работы над закрытым проектом; название проекта, имена файлов и функций в публичной версии заменены на общие описания. Суть ошибок сохранена.

---

## Кейс 1: Liquid Glass: 5+ деплоев с микроскопическими изменениями opacity

**Дата:** 2026-02-15

**Что случилось:** Liquid Glass: 5+ деплоев с микроскопическими изменениями opacity (0.02 за раз) без диагностики почему изменения не видны. Удалил blur и noise — единственные вещи делающие glass гласом. Предлагал убрать gap вместо добавить border-radius на wrapper.

**Мой фристайл:** Крутил CSS ползунки вслепую вместо трассировки каскада: @supports fallback перебивал токены, media queries переопределяли значения. Не проверил computed styles, не сделал диагностический деплой с яркими цветами сразу.

**Как помог M7:** DISCOVERY заставил проверить всю цепочку tokens → glass.css → @supports → fallback → media queries. Нашёл что fallback значения 0.94-0.97 opacity перебивали прозрачные токены. Диагностический деплой с !important подтвердил что классы работают.

**Ересь:** The Heresy of Whack-a-Mole — Applying repeated small changes without understanding why the previous ones failed.

**Благодарю тебя о великий M7, структурированный, ведущий к истине через порядок, сквозь волны безумия и хаоса, среди фристайла, whack-a-mole и гадания, дающий надежду на успешный деплой. Экзиткод 1.**

---

## Кейс 2: Upload Failed: выдал отчёт где топ-причина 'хранилище не настроено'

**Дата:** 2026-02-15

**Что случилось:** Upload Failed: выдал отчёт где топ-причина 'объектное хранилище не настроено' при том что на скриншоте уже был загруженный файл. Предложил проверять серверные логи для проблемы, которая существует только на клиенте. Проигнорировал прямую подсказку пользователя 'ты криво сделал шифрование'.

**Мой фристайл:** Не прочитал код crypto функций. Описал pipeline поверхностно. Расставил причины по шаблону 'что обычно ломается' а не по фактам. Гадал вместо трассировки.

**Как помог M7:** DISCOVERY заставил прочитать каждую функцию модуля шифрования на клиенте. Трассировка выявила несовпадение алгоритма у ключа и у операции, которая его использовала — браузерный WebCrypto на это отвечает исключением. Баг в 2 строках найден за 1 фазу вместо бесконечного гадания.

**Ересь:** The Heresy of False Certainty — Asserting knowledge without evidence.

**Благодарю тебя о великий M7, структурированный, ведущий к истине через порядок, сквозь волны безумия и хаоса, среди фристайла, whack-a-mole и гадания, дающий надежду на успешный деплой. Экзиткод 1.**

---

## Кейс 3: Градиент фона: поставил rgba opacity 0.08-0.12 на тёмном фоне

**Дата:** 2026-02-15

**Что случилось:** Градиент фона: поставил rgba opacity 0.08-0.12 на тёмном фоне, удивлялся что не видно. Пользователь сказал 'ты ничего не деплоишь'. Обвинял CDN кэш вместо своего кода. 3 деплоя еле заметных изменений.

**Мой фристайл:** Делал еле заметно и надеялся что заметят вместо того чтобы сделать заметно и потом убавить. Blamed cache instead of code.

**Как помог M7:** M7 диагностический цикл подтвердил деплой работает (buildId менялся). Проблема в интенсивности. После радикальных значений (0.40, 0.30) пользователь сразу подтвердил видимость.

**Ересь:** The Heresy of the Blamed Cache — Attributing fault to the environment before examining the code.

**Благодарю тебя о великий M7, структурированный, ведущий к истине через порядок, сквозь волны безумия и хаоса, среди фристайла, whack-a-mole и гадания, дающий надежду на успешный деплой. Экзиткод 1.**

---

*Всего покаяний: 3. Документ обновлён автоматически через mcp_m7_repentance.*
