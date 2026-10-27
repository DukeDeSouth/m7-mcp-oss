/**
 * M7 Hive - JSON Extractor
 * 
 * Extracts JSON from mixed content (markdown, prose, etc.)
 * Priority: markdown json block -> any markdown block -> inline JSON
 */

import { ExtractionResult, ExtractionSource } from './types.js';

// ============================================================================
// EXTRACTION PATTERNS
// ============================================================================

const PATTERNS = {
  // ```json ... ``` blocks (highest priority)
  markdownJson: /```json\s*([\s\S]*?)```/i,
  
  // ``` ... ``` blocks (any language or none)
  markdownAny: /```(?:\w+)?\s*([\s\S]*?)```/,
  
  // Inline JSON object { ... } (greedy but balanced)
  inlineObject: /\{[\s\S]*\}/,
  
  // Inline JSON array [ ... ] (greedy but balanced)
  inlineArray: /\[[\s\S]*\]/
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find the outermost balanced JSON structure
 * Handles nested braces/brackets correctly
 */
function findBalancedJson(content: string, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let startPos = -1;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === openChar) {
      if (depth === 0) {
        startPos = i;
      }
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0 && startPos !== -1) {
        return content.substring(startPos, i + 1);
      }
    }
  }
  
  // Handle unclosed structures (for truncation recovery)
  if (startPos !== -1 && depth > 0) {
    return content.substring(startPos);
  }
  
  return null;
}

/**
 * Validate that extracted content looks like JSON
 */
function looksLikeJson(content: string): boolean {
  const trimmed = content.trim();
  return (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    trimmed.length > 2
  );
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract JSON from mixed content with priority:
 * 1. ```json ... ``` blocks
 * 2. ``` ... ``` blocks (any language)
 * 3. First balanced { ... } or [ ... ]
 * 4. Raw content if it looks like JSON
 */
export function extractJson(content: string): ExtractionResult {
  const warnings: string[] = [];
  const originalLength = content.length;
  
  if (!content || typeof content !== 'string') {
    return {
      found: false,
      json: null,
      source: 'none',
      warnings: ['Empty or invalid content'],
      originalLength: 0
    };
  }
  
  const trimmed = content.trim();
  
  // Strategy 1: Extract from ```json``` block
  const jsonBlockMatch = trimmed.match(PATTERNS.markdownJson);
  if (jsonBlockMatch) {
    const extracted = jsonBlockMatch[1].trim();
    if (looksLikeJson(extracted)) {
      warnings.push('Extracted from ```json``` block');
      return {
        found: true,
        json: extracted,
        source: 'markdown_json',
        warnings,
        originalLength
      };
    }
  }
  
  // Strategy 2: Extract from any ``` block
  const anyBlockMatch = trimmed.match(PATTERNS.markdownAny);
  if (anyBlockMatch) {
    const extracted = anyBlockMatch[1].trim();
    if (looksLikeJson(extracted)) {
      warnings.push('Extracted from markdown code block');
      return {
        found: true,
        json: extracted,
        source: 'markdown_any',
        warnings,
        originalLength
      };
    }
  }
  
  // Strategy 3: Find balanced JSON object
  const balancedObject = findBalancedJson(trimmed, '{', '}');
  if (balancedObject) {
    // Check if there's also an array and which comes first
    const objectStart = trimmed.indexOf('{');
    const arrayStart = trimmed.indexOf('[');
    
    if (arrayStart !== -1 && (arrayStart < objectStart || objectStart === -1)) {
      // Array comes first
      const balancedArray = findBalancedJson(trimmed, '[', ']');
      if (balancedArray) {
        warnings.push('Found inline JSON array');
        return {
          found: true,
          json: balancedArray,
          source: 'inline',
          warnings,
          originalLength
        };
      }
    }
    
    warnings.push('Found inline JSON object');
    return {
      found: true,
      json: balancedObject,
      source: 'inline',
      warnings,
      originalLength
    };
  }
  
  // Strategy 4: Find balanced JSON array
  const balancedArray = findBalancedJson(trimmed, '[', ']');
  if (balancedArray) {
    warnings.push('Found inline JSON array');
    return {
      found: true,
      json: balancedArray,
      source: 'inline',
      warnings,
      originalLength
    };
  }
  
  // Strategy 5: Raw content if it looks like JSON
  if (looksLikeJson(trimmed)) {
    warnings.push('Using raw content as JSON');
    return {
      found: true,
      json: trimmed,
      source: 'raw',
      warnings,
      originalLength
    };
  }
  
  // No JSON found
  return {
    found: false,
    json: null,
    source: 'none',
    warnings: ['No JSON structure found in content'],
    originalLength
  };
}

/**
 * Extract multiple JSON objects from content
 * Useful for responses with multiple JSON blocks
 */
export function extractAllJson(content: string): ExtractionResult[] {
  const results: ExtractionResult[] = [];
  const originalLength = content.length;
  
  // Find all markdown json blocks
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
  let match;
  
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const extracted = match[1].trim();
    if (looksLikeJson(extracted)) {
      results.push({
        found: true,
        json: extracted,
        source: 'markdown_json',
        warnings: [`Found at position ${match.index}`],
        originalLength
      });
    }
  }
  
  // If no markdown blocks, try to find all inline objects
  if (results.length === 0) {
    const remaining = content;
    let pos = 0;
    
    while (pos < remaining.length) {
      const startBrace = remaining.indexOf('{', pos);
      if (startBrace === -1) break;
      
      const json = findBalancedJson(remaining.substring(startBrace), '{', '}');
      if (json) {
        results.push({
          found: true,
          json,
          source: 'inline',
          warnings: [`Found at position ${startBrace}`],
          originalLength
        });
        pos = startBrace + json.length;
      } else {
        pos = startBrace + 1;
      }
    }
  }
  
  return results;
}
