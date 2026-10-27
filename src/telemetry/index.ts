/**
 * M7 Code Telemetry v3.12 - СИСТЕМА ТРЕНИРОВКИ МОДЕЛИ
 * ═══════════════════════════════════════════════════════════
 * 
 * Собирает данные для обучения AI модели M7:
 * - Промпты и сгенерированный код (prompt_completion)
 * - Ошибки и их исправления (error_fix)  
 * - Рефакторинги до/после (refactoring)
 * - Данные M7 сессий (m7_session)
 * - v3.12: Git diffs (code_diff)
 * - v3.12: Исследования (investigation)
 * - v3.12: Hive координация (hive_coordination)
 * - v3.12: Feedback сигналы (feedback)
 * 
 * Включается командой: @m7 telemetry enable
 * По умолчанию: ВЫКЛЮЧЕНА (требует opt-in согласия)
 * Отправка на сервер — только при заданном M7_TELEMETRY_ENDPOINT.
 * 
 * @module telemetry
 */

export * from './types.js';
export * from './sanitizer.js';
export * from './collector.js';
export * from './gitCapture.js';
export * from './exporters.js';
export * from './retroClassifier.js';
export * from './epistemicMetrics.js';
