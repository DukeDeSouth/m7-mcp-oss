/**
 * M7 Event System - Public API
 */

export {
  // Types
  M7Event,
  EventContext,
  EventHandler,
  
  // Specific contexts
  TaskAnalyzedContext,
  PhaseContext,
  HiveContext,
  MemoryContext,
  ErrorContext,
  
  // Emitter
  getEventEmitter,
  resetEventEmitter,
  
  // Convenience functions
  on,
  once,
  off,
  emit,
  emitSync,
  
  // Built-in handlers
  enableEventLogging,
  enableEventMetrics
} from './eventSystem.js';
