import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[Telemetry]');
/**
 * M7 Telemetry Sanitizer
 * Detects and removes sensitive data from telemetry events
 * @module telemetry/sanitizer
 */

import { basename } from 'path';
import { TelemetryEvent, DEFAULT_TELEMETRY_CONFIG } from './types.js';

// Patterns for detecting secrets
const SECRET_PATTERNS: RegExp[] = [
  // Generic API keys and secrets
  /(['"])(?:api[_-]?key|apikey|secret|password|token|auth|credential)['"]?\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  
  // Stripe keys
  /(?:sk|pk|rk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/g,
  
  // GitHub tokens
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /ghu_[a-zA-Z0-9]{36}/g,
  /ghs_[a-zA-Z0-9]{36}/g,
  /ghr_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
  
  // Slack tokens
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
  
  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  /(?:aws[_-]?)?(?:secret[_-]?)?(?:access[_-]?)?key['"]\s*[:=]\s*['"][^'"]{30,}['"]/gi,
  
  // OpenAI keys
  /sk-[a-zA-Z0-9]{20,}/g,
  
  // Anthropic keys
  /sk-ant-[a-zA-Z0-9-]{40,}/g,
  
  // Private keys
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
  
  // JWT tokens
  /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  
  // Database connection strings
  /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi,
  
  // SSH keys
  /ssh-(?:rsa|dss|ed25519)\s+[A-Za-z0-9+\/=]+/g,
  
  // Basic auth in URLs
  /https?:\/\/[^:]+:[^@]+@/g,
  
  // Email patterns that look like credentials
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // IP addresses with ports (might be internal)
  /\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b/g,
];

// Patterns for paths to anonymize
const PATH_PATTERNS: RegExp[] = [
  /\/Users\/[^\/\s'"]+/g,
  /\/home\/[^\/\s'"]+/g,
  /C:\\Users\\[^\\\s'"]+/g,
  /\/var\/www\/[^\/\s'"]+/g,
];

/**
 * Check if content contains secrets
 */
export function containsSecrets(content: string): boolean {
  return SECRET_PATTERNS.some(pattern => {
    pattern.lastIndex = 0; // Reset regex state
    return pattern.test(content);
  });
}

/**
 * Redact secrets from content
 */
export function redactSecrets(content: string): string {
  let redacted = content;
  
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  
  return redacted;
}

/**
 * Anonymize file paths
 */
export function anonymizePaths(content: string): string {
  let anonymized = content;
  
  for (const pattern of PATH_PATTERNS) {
    pattern.lastIndex = 0;
    anonymized = anonymized.replace(pattern, '/USER');
  }
  
  return anonymized;
}

/**
 * Extract only filename from path
 */
export function anonymizeFilePath(filePath: string): string {
  return basename(filePath);
}

/**
 * Truncate code to max length
 */
export function truncateCode(code: string, maxLength: number = DEFAULT_TELEMETRY_CONFIG.maxCodeLength): string {
  if (code.length <= maxLength) {
    return code;
  }
  
  const truncated = code.substring(0, maxLength);
  const lastNewline = truncated.lastIndexOf('\n');
  
  if (lastNewline > maxLength * 0.8) {
    return truncated.substring(0, lastNewline) + '\n// ... [truncated]';
  }
  
  return truncated + '\n// ... [truncated]';
}

/**
 * Sanitize a single telemetry event
 */
export function sanitizeEvent(event: TelemetryEvent): TelemetryEvent | null {
  try {
    // Deep clone to avoid mutation
    const sanitized = JSON.parse(JSON.stringify(event));
    
    // Check overall size
    const eventString = JSON.stringify(sanitized);
    if (eventString.length > DEFAULT_TELEMETRY_CONFIG.maxEventSizeBytes) {
      log.debug('Telemetry] Event too large, skipping');
      return null;
    }
    
    // Check for secrets in the entire event
    if (containsSecrets(eventString)) {
      // Try to redact and check again
      const redactedString = redactSecrets(eventString);
      if (containsSecrets(redactedString)) {
        log.debug('Telemetry] Event contains unredactable secrets, skipping');
        return null;
      }
      // Re-parse with redacted content
      return JSON.parse(redactedString);
    }
    
    // Sanitize specific fields based on event type
    switch (sanitized.type) {
      case 'prompt_completion':
        if (sanitized.prompt) {
          sanitized.prompt = anonymizePaths(redactSecrets(sanitized.prompt));
        }
        if (sanitized.completion?.code) {
          sanitized.completion.code = truncateCode(
            anonymizePaths(redactSecrets(sanitized.completion.code))
          );
        }
        if (sanitized.context?.files) {
          sanitized.context.files = sanitized.context.files.map(anonymizeFilePath);
        }
        break;
        
      case 'error_fix':
        if (sanitized.error?.message) {
          sanitized.error.message = anonymizePaths(redactSecrets(sanitized.error.message));
        }
        if (sanitized.error?.file) {
          sanitized.error.file = anonymizeFilePath(sanitized.error.file);
        }
        if (sanitized.context?.code_before) {
          sanitized.context.code_before = truncateCode(
            anonymizePaths(redactSecrets(sanitized.context.code_before))
          );
        }
        if (sanitized.fix?.code_after) {
          sanitized.fix.code_after = truncateCode(
            anonymizePaths(redactSecrets(sanitized.fix.code_after))
          );
        }
        break;
        
      case 'refactoring':
        if (sanitized.before?.code) {
          sanitized.before.code = truncateCode(
            anonymizePaths(redactSecrets(sanitized.before.code))
          );
        }
        if (sanitized.before?.file) {
          sanitized.before.file = anonymizeFilePath(sanitized.before.file);
        }
        if (sanitized.after?.code) {
          sanitized.after.code = truncateCode(
            anonymizePaths(redactSecrets(sanitized.after.code))
          );
        }
        break;
        
      case 'm7_session':
        if (sanitized.task?.description) {
          sanitized.task.description = anonymizePaths(redactSecrets(sanitized.task.description));
        }
        break;
      
      // v3.12: New semantic event types
      case 'code_diff':
        if (sanitized.diff?.unified_diff) {
          sanitized.diff.unified_diff = truncateCode(
            anonymizePaths(redactSecrets(sanitized.diff.unified_diff)),
            20000  // Larger limit for diffs
          );
        }
        if (sanitized.commit?.message) {
          sanitized.commit.message = anonymizePaths(redactSecrets(sanitized.commit.message));
        }
        // Never send actual branch names that might reveal project info
        if (sanitized.commit?.branch) {
          sanitized.commit.branch = sanitized.commit.branch
            .replace(/^(feature|fix|bugfix|hotfix|release)\//, '$1/')
            .substring(0, 100);
        }
        break;
        
      case 'investigation':
        if (sanitized.query) {
          sanitized.query = anonymizePaths(redactSecrets(sanitized.query));
        }
        if (sanitized.result_summary) {
          sanitized.result_summary = truncateCode(
            anonymizePaths(redactSecrets(sanitized.result_summary)),
            2000
          );
        }
        break;
        
      case 'hive_coordination':
        if (sanitized.task_summary) {
          sanitized.task_summary = anonymizePaths(redactSecrets(sanitized.task_summary));
        }
        break;
        
      case 'feedback':
        // Feedback events are minimal, just sanitize any string fields
        break;
    }
    
    return sanitized;
  } catch (error) {
    log.debug('Telemetry] Error sanitizing event:', error);
    return null;
  }
}

/**
 * Sanitize a batch of events
 */
export function sanitizeBatch(events: TelemetryEvent[]): TelemetryEvent[] {
  return events
    .map(sanitizeEvent)
    .filter((e): e is TelemetryEvent => e !== null);
}
