/**
 * M7 v3.10 Retry System
 * 
 * Provides intelligent retry logic with:
 * - Exponential backoff
 * - Jitter to prevent thundering herd
 * - Error classification (retryable vs fatal)
 * - Detailed logging of all attempts
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

import { createLogger } from './logger.js';

const log = createLogger('[Retry]');

// ============================================
// CONFIGURATION
// ============================================

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in milliseconds (default: 300) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Jitter factor 0-1 (default: 0.1 = 10%) */
  jitter: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 300,
  maxDelayMs: 30000,
  jitter: 0.1,
  backoffMultiplier: 2,
};

// ============================================
// ERROR CLASSIFICATION
// ============================================

export type RetryableErrorCode = 
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'CONNECTION_RESET';

export type FatalErrorCode =
  | 'AUTHENTICATION'
  | 'INVALID_API_KEY'
  | 'BILLING'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'CONTENT_POLICY';

export interface ClassifiedError {
  original: unknown;
  code: RetryableErrorCode | FatalErrorCode | 'UNKNOWN';
  isRetryable: boolean;
  message: string;
  httpStatus?: number;
  retryAfter?: number; // Seconds to wait before retry (from Retry-After header)
}

/**
 * Classify an error to determine if it's retryable.
 */
export function classifyError(error: unknown): ClassifiedError {
  const result: ClassifiedError = {
    original: error,
    code: 'UNKNOWN',
    isRetryable: false,
    message: 'Unknown error',
  };

  if (!error) {
    return result;
  }

  // Extract error details
  const err = error as any;
  const message = err.message || err.error?.message || String(error);
  const status = err.status || err.statusCode || err.response?.status;
  const code = err.code || err.error?.code;

  result.message = message;
  result.httpStatus = status;

  // Check for Retry-After header
  if (err.headers?.['retry-after']) {
    result.retryAfter = parseInt(err.headers['retry-after'], 10);
  }

  // Classify by HTTP status
  if (status) {
    switch (status) {
      case 429:
        result.code = 'RATE_LIMIT';
        result.isRetryable = true;
        break;
      case 500:
        result.code = 'INTERNAL_ERROR';
        result.isRetryable = true;
        break;
      case 502:
      case 503:
        result.code = 'SERVICE_UNAVAILABLE';
        result.isRetryable = true;
        break;
      case 504:
        result.code = 'GATEWAY_TIMEOUT';
        result.isRetryable = true;
        break;
      case 401:
        result.code = 'AUTHENTICATION';
        result.isRetryable = false;
        break;
      case 402:
        result.code = 'BILLING';
        result.isRetryable = false;
        break;
      case 403:
        result.code = 'PERMISSION_DENIED';
        result.isRetryable = false;
        break;
      case 404:
        result.code = 'NOT_FOUND';
        result.isRetryable = false;
        break;
      case 400:
        result.code = 'INVALID_REQUEST';
        result.isRetryable = false;
        break;
    }
    return result;
  }

  // Classify by error code
  if (code) {
    const codeUpper = String(code).toUpperCase();
    
    if (codeUpper.includes('TIMEOUT') || codeUpper === 'ETIMEDOUT' || codeUpper === 'ESOCKETTIMEDOUT') {
      result.code = 'TIMEOUT';
      result.isRetryable = true;
      return result;
    }
    
    if (codeUpper === 'ECONNRESET' || codeUpper === 'ECONNREFUSED') {
      result.code = 'CONNECTION_RESET';
      result.isRetryable = true;
      return result;
    }
    
    if (codeUpper === 'ENOTFOUND' || codeUpper === 'EAI_AGAIN') {
      result.code = 'NETWORK_ERROR';
      result.isRetryable = true;
      return result;
    }
  }

  // Classify by message patterns
  const msgLower = message.toLowerCase();
  
  if (msgLower.includes('rate limit') || msgLower.includes('too many requests')) {
    result.code = 'RATE_LIMIT';
    result.isRetryable = true;
    return result;
  }
  
  if (msgLower.includes('timeout') || msgLower.includes('timed out')) {
    result.code = 'TIMEOUT';
    result.isRetryable = true;
    return result;
  }
  
  if (msgLower.includes('overloaded') || msgLower.includes('capacity')) {
    result.code = 'SERVICE_UNAVAILABLE';
    result.isRetryable = true;
    return result;
  }
  
  if (msgLower.includes('invalid api key') || msgLower.includes('authentication')) {
    result.code = 'INVALID_API_KEY';
    result.isRetryable = false;
    return result;
  }
  
  if (msgLower.includes('billing') || msgLower.includes('quota exceeded')) {
    result.code = 'BILLING';
    result.isRetryable = false;
    return result;
  }
  
  if (msgLower.includes('content policy') || msgLower.includes('safety')) {
    result.code = 'CONTENT_POLICY';
    result.isRetryable = false;
    return result;
  }

  return result;
}

// ============================================
// DELAY CALCULATION
// ============================================

/**
 * Calculate delay with exponential backoff and jitter.
 * 
 * Formula: min(maxDelay, initialDelay * (multiplier ^ attempt) * (1 ± jitter))
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterSeconds?: number
): number {
  // If server specified Retry-After, respect it
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    const serverDelayMs = retryAfterSeconds * 1000;
    // Add small jitter even to server-specified delay
    const jitterMs = serverDelayMs * config.jitter * (Math.random() * 2 - 1);
    return Math.min(config.maxDelayMs, serverDelayMs + jitterMs);
  }

  // Exponential backoff
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  
  // Apply jitter (±jitter%)
  const jitterRange = exponentialDelay * config.jitter;
  const jitterMs = jitterRange * (Math.random() * 2 - 1);
  
  // Cap at maxDelayMs
  return Math.min(config.maxDelayMs, exponentialDelay + jitterMs);
}

// ============================================
// RETRY RESULT
// ============================================

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: ClassifiedError;
  attempts: number;
  totalDelayMs: number;
  attemptHistory: AttemptRecord[];
}

export interface AttemptRecord {
  attempt: number;
  timestamp: number;
  durationMs: number;
  error?: ClassifiedError;
  delayAfterMs?: number;
}

// ============================================
// MAIN RETRY FUNCTION
// ============================================

/**
 * Execute an async function with intelligent retry logic.
 * 
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @returns Result with success status and attempt history
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => apiClient.call(request),
 *   { maxAttempts: 3, initialDelayMs: 500 }
 * );
 * 
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(`Failed after ${result.attempts} attempts:`, result.error);
 * }
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  
  const result: RetryResult<T> = {
    success: false,
    attempts: 0,
    totalDelayMs: 0,
    attemptHistory: [],
  };

  let lastError: ClassifiedError | undefined;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const attemptStart = Date.now();
    result.attempts = attempt + 1;

    const record: AttemptRecord = {
      attempt: attempt + 1,
      timestamp: attemptStart,
      durationMs: 0,
    };

    try {
      // Execute the function
      const data = await fn();
      
      record.durationMs = Date.now() - attemptStart;
      result.attemptHistory.push(record);
      
      result.success = true;
      result.data = data;
      
      if (attempt > 0) {
        log.info(`Success on attempt ${attempt + 1}/${cfg.maxAttempts}`);
      }
      
      return result;

    } catch (error) {
      record.durationMs = Date.now() - attemptStart;
      
      // Classify the error
      const classified = cfg.isRetryable 
        ? { ...classifyError(error), isRetryable: cfg.isRetryable(error) }
        : classifyError(error);
      
      record.error = classified;
      lastError = classified;
      
      // Check if we should retry
      const isLastAttempt = attempt === cfg.maxAttempts - 1;
      
      if (!classified.isRetryable || isLastAttempt) {
        result.attemptHistory.push(record);
        result.error = classified;
        
        if (!classified.isRetryable) {
          log.warn(`Non-retryable error [${classified.code}]: ${classified.message}`);
        } else {
          log.warn(`Max attempts (${cfg.maxAttempts}) reached: ${classified.message}`);
        }
        
        return result;
      }

      // Calculate delay
      const delayMs = calculateDelay(attempt, cfg, classified.retryAfter);
      record.delayAfterMs = delayMs;
      result.attemptHistory.push(record);
      result.totalDelayMs += delayMs;

      // Log retry
      log.info(
        `Attempt ${attempt + 1}/${cfg.maxAttempts} failed [${classified.code}], ` +
        `retrying in ${Math.round(delayMs)}ms...`
      );

      // Callback
      if (cfg.onRetry) {
        cfg.onRetry(attempt + 1, error, delayMs);
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // Should not reach here, but just in case
  result.error = lastError;
  return result;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a function to automatically retry on failure.
 * Returns a new function with the same signature.
 */
export function retryable<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: Partial<RetryConfig> = {}
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const result = await withRetry(() => fn(...args), config);
    
    if (result.success) {
      return result.data;
    }
    
    // Re-throw the original error
    throw result.error?.original || new Error(result.error?.message || 'Retry failed');
  }) as T;
}

/**
 * Check if an error is retryable without executing retry logic.
 */
export function isRetryableError(error: unknown): boolean {
  return classifyError(error).isRetryable;
}

/**
 * Get human-readable description of retry result.
 */
export function formatRetryResult<T>(result: RetryResult<T>): string {
  if (result.success) {
    if (result.attempts === 1) {
      return 'Success on first attempt';
    }
    return `Success after ${result.attempts} attempts (total delay: ${result.totalDelayMs}ms)`;
  }

  const errorDesc = result.error 
    ? `[${result.error.code}] ${result.error.message}`
    : 'Unknown error';

  return `Failed after ${result.attempts} attempts: ${errorDesc}`;
}

// ============================================
// EXPORTS
// ============================================

export default {
  withRetry,
  retryable,
  classifyError,
  calculateDelay,
  isRetryableError,
  formatRetryResult,
  DEFAULT_RETRY_CONFIG,
};
