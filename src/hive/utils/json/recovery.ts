/**
 * M7 Hive - Truncation Recovery
 * 
 * Attempts to recover truncated JSON by:
 * - Detecting truncation patterns
 * - Closing unclosed strings
 * - Adding missing brackets/braces
 * - Providing reasonable default values
 */

import { RecoveryResult, TruncationAnalysis } from './types.js';

// ============================================================================
// TRUNCATION DETECTION
// ============================================================================

/**
 * Analyze JSON structure to detect truncation
 */
export function analyzeTruncation(json: string): TruncationAnalysis {
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let truncationPosition = json.length;
  
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }
  }
  
  const isTruncated = braceCount > 0 || bracketCount > 0 || inString;
  
  return {
    isTruncated,
    unclosedBraces: Math.max(0, braceCount),
    unclosedBrackets: Math.max(0, bracketCount),
    unclosedString: inString,
    truncationPosition
  };
}

// ============================================================================
// RECOVERY STRATEGIES
// ============================================================================

/**
 * Find the last complete value in the JSON
 * Used to determine where to truncate and close
 */
function findLastCompleteValue(json: string): number {
  let lastComplete = 0;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      if (!inString) {
        // End of string - might be a complete value
        if (depth > 0) lastComplete = i + 1;
      }
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth >= 0) lastComplete = i + 1;
      } else if (char === ',' && depth > 0) {
        lastComplete = i + 1;
      }
    }
  }
  
  return lastComplete;
}

/**
 * Attempt to close an incomplete string value
 */
function closeIncompleteString(json: string): string {
  // Find the last quote
  const lastQuote = json.lastIndexOf('"');
  if (lastQuote === -1) return json;
  
  // Check if we're inside a string
  let quoteCount = 0;
  for (let i = 0; i <= lastQuote; i++) {
    if (json[i] === '"' && (i === 0 || json[i-1] !== '\\')) {
      quoteCount++;
    }
  }
  
  // If odd number of quotes, we're inside a string
  if (quoteCount % 2 === 1) {
    return json + '"';
  }
  
  return json;
}

/**
 * Determine what comes after a value (comma or closing)
 */
function determineNextToken(json: string): string {
  const trimmed = json.trimEnd();
  
  // If ends with a value, might need comma
  if (trimmed.endsWith('"') || 
      trimmed.endsWith('true') || 
      trimmed.endsWith('false') || 
      trimmed.endsWith('null') ||
      /\d$/.test(trimmed)) {
    // Check if we need a comma (more items expected)
    // For simplicity, just close without comma
    return '';
  }
  
  // If ends with comma or colon, might need a default value
  if (trimmed.endsWith(',')) {
    // Remove trailing comma
    return '';
  }
  
  if (trimmed.endsWith(':')) {
    // Need a default value
    return ' null';
  }
  
  return '';
}

// ============================================================================
// MAIN RECOVERY FUNCTION
// ============================================================================

/**
 * Attempt to recover truncated JSON
 */
export function recoverTruncatedJson(json: string): RecoveryResult {
  const analysis = analyzeTruncation(json);
  const addedParts: string[] = [];
  
  if (!analysis.isTruncated) {
    return {
      recovered: json,
      analysis,
      recoveryAttempted: false,
      structureIntact: true,
      addedParts: []
    };
  }
  
  let recovered = json;
  
  // Step 1: Close any unclosed strings
  if (analysis.unclosedString) {
    recovered = closeIncompleteString(recovered);
    addedParts.push('"');
  }
  
  // Step 2: Handle incomplete value after colon
  const trimmed = recovered.trimEnd();
  if (trimmed.endsWith(':')) {
    recovered = trimmed + ' null';
    addedParts.push('null');
  } else if (trimmed.endsWith(',')) {
    // Remove trailing comma before closing
    recovered = trimmed.slice(0, -1);
    addedParts.push('(removed trailing comma)');
  }
  
  // Step 3: Re-analyze after string fix
  const afterStringFix = analyzeTruncation(recovered);
  
  // Step 4: Close brackets and braces
  // Close in reverse order (innermost first)
  const closingChars: string[] = [];
  
  for (let i = 0; i < afterStringFix.unclosedBrackets; i++) {
    closingChars.push(']');
  }
  
  for (let i = 0; i < afterStringFix.unclosedBraces; i++) {
    closingChars.push('}');
  }
  
  if (closingChars.length > 0) {
    recovered = recovered.trimEnd() + closingChars.join('');
    addedParts.push(...closingChars);
  }
  
  // Step 5: Verify structure is now valid
  const finalAnalysis = analyzeTruncation(recovered);
  const structureIntact = !finalAnalysis.isTruncated;
  
  return {
    recovered,
    analysis,
    recoveryAttempted: true,
    structureIntact,
    addedParts
  };
}

/**
 * More aggressive recovery that tries multiple strategies
 */
export function aggressiveRecovery(json: string): RecoveryResult {
  // Strategy 1: Simple recovery
  const simple = recoverTruncatedJson(json);
  if (simple.structureIntact) {
    try {
      JSON.parse(simple.recovered);
      return simple;
    } catch {
      // Continue to next strategy
    }
  }
  
  // Strategy 2: Truncate to last complete value
  const lastComplete = findLastCompleteValue(json);
  if (lastComplete > 0 && lastComplete < json.length) {
    const truncated = json.substring(0, lastComplete);
    const recovered = recoverTruncatedJson(truncated);
    if (recovered.structureIntact) {
      try {
        JSON.parse(recovered.recovered);
        return {
          ...recovered,
          addedParts: ['(truncated to last complete value)', ...recovered.addedParts]
        };
      } catch {
        // Continue to next strategy
      }
    }
  }
  
  // Strategy 3: Extract first complete object/array
  const firstBrace = json.indexOf('{');
  const firstBracket = json.indexOf('[');
  const start = firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket) 
    ? firstBrace 
    : firstBracket;
  
  if (start !== -1) {
    const openChar = json[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = start; i < json.length; i++) {
      const char = json[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === openChar) depth++;
        else if (char === closeChar) {
          depth--;
          if (depth === 0) {
            // Found complete structure
            const complete = json.substring(start, i + 1);
            return {
              recovered: complete,
              analysis: analyzeTruncation(complete),
              recoveryAttempted: true,
              structureIntact: true,
              addedParts: ['(extracted first complete structure)']
            };
          }
        }
      }
    }
  }
  
  // Fallback: Return best effort from simple recovery
  return simple;
}
