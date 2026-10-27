/**
 * M7 Hive - JSON Repairer
 * 
 * Fixes common JSON issues from LLM responses:
 * - Trailing commas
 * - Comments (// and block comments)
 * - Smart quotes (curly to straight)
 * - Unescaped characters in strings
 * - Common typos (treu, fales, nul)
 */

import { RepairResult, RepairChange, RepairType } from './types.js';

// ============================================================================
// REPAIR RULES
// ============================================================================

interface RepairRule {
  name: RepairType;
  pattern: RegExp;
  replacement: string | ((match: string, ...args: string[]) => string);
  description: string;
}

const REPAIR_RULES: RepairRule[] = [
  // Trailing commas before } or ]
  {
    name: 'trailing_comma',
    pattern: /,(\s*[}\]])/g,
    replacement: '$1',
    description: 'Remove trailing comma'
  },
  
  // Single-line comments // ...
  {
    name: 'line_comment',
    pattern: /\/\/[^\n"]*(?=\n|$)/g,
    replacement: '',
    description: 'Remove line comment'
  },
  
  // Block comments /* ... */
  {
    name: 'block_comment',
    pattern: /\/\*[\s\S]*?\*\//g,
    replacement: '',
    description: 'Remove block comment'
  },
  
  // Smart double quotes to regular quotes
  {
    name: 'smart_quote_double',
    pattern: /[\u201C\u201D]/g,
    replacement: '"',
    description: 'Replace smart double quotes'
  },
  
  // Smart single quotes to regular quotes (in already-quoted strings)
  {
    name: 'smart_quote_single',
    pattern: /[\u2018\u2019]/g,
    replacement: "'",
    description: 'Replace smart single quotes'
  },
  
  // Common typos: treu to true
  {
    name: 'typo_true',
    pattern: /:\s*treu\b/gi,
    replacement: ': true',
    description: 'Fix typo: treu to true'
  },
  
  // Common typos: flase/fales to false
  {
    name: 'typo_false',
    pattern: /:\s*(flase|fales)\b/gi,
    replacement: ': false',
    description: 'Fix typo: false'
  },
  
  // Common typos: nul to null
  {
    name: 'typo_null',
    pattern: /:\s*nul\b/gi,
    replacement: ': null',
    description: 'Fix typo: nul to null'
  }
];

// ============================================================================
// ADVANCED REPAIRS
// ============================================================================

/**
 * Fix unescaped characters inside string values
 * This is more complex and needs state tracking
 */
function fixUnescapedStrings(json: string): { result: string; changes: RepairChange[] } {
  const changes: RepairChange[] = [];
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      result += char;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    
    if (inString) {
      // Fix unescaped newlines in strings
      if (char === '\n') {
        result += '\\n';
        changes.push({
          type: 'unescaped_newline',
          position: i,
          original: '\n',
          replacement: '\\n'
        });
        continue;
      }
      
      // Fix unescaped tabs in strings
      if (char === '\t') {
        result += '\\t';
        changes.push({
          type: 'unescaped_tab',
          position: i,
          original: '\t',
          replacement: '\\t'
        });
        continue;
      }
    }
    
    result += char;
  }
  
  return { result, changes };
}

/**
 * Fix missing quotes around property names
 * e.g., {name: "value"} → {"name": "value"}
 */
function fixUnquotedKeys(json: string): { result: string; changes: RepairChange[] } {
  const changes: RepairChange[] = [];
  
  // Pattern: unquoted key followed by colon
  // Matches: word characters not already in quotes
  const pattern = /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g;
  
  const result = json.replace(pattern, (match, before, key, after, offset) => {
    // Check if key is already quoted by looking at context
    const beforeMatch = json.substring(Math.max(0, offset - 1), offset);
    if (beforeMatch === '"') {
      return match; // Already quoted
    }
    
    changes.push({
      type: 'missing_quote',
      position: offset + before.length,
      original: key,
      replacement: `"${key}"`
    });
    
    return `${before}"${key}"${after}`;
  });
  
  return { result, changes };
}

// ============================================================================
// MAIN REPAIR FUNCTION
// ============================================================================

/**
 * Apply all repair rules to fix common JSON issues
 */
export function repairJson(json: string): RepairResult {
  const changes: RepairChange[] = [];
  let repaired = json;
  let totalChanges = 0;
  
  // Apply regex-based repair rules
  for (const rule of REPAIR_RULES) {
    const matches = repaired.match(rule.pattern);
    if (matches && matches.length > 0) {
      const before = repaired;
      repaired = repaired.replace(rule.pattern, rule.replacement as string);
      
      if (before !== repaired) {
        // Track each match as a change
        let match;
        const regex = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''));
        let searchPos = 0;
        
        while ((match = before.substring(searchPos).match(regex)) !== null) {
          if (match.index === undefined) break;
          const position = searchPos + match.index;
          changes.push({
            type: rule.name,
            position,
            original: match[0].substring(0, 50), // Truncate long matches
            replacement: rule.description
          });
          searchPos = position + 1;
          totalChanges++;
          
          // Safety limit
          if (totalChanges > 100) break;
        }
      }
    }
  }
  
  // Apply advanced repairs
  const stringFix = fixUnescapedStrings(repaired);
  repaired = stringFix.result;
  changes.push(...stringFix.changes);
  
  // Fix unquoted keys (common in LLM output)
  const keyFix = fixUnquotedKeys(repaired);
  repaired = keyFix.result;
  changes.push(...keyFix.changes);
  
  // Calculate confidence based on number of repairs
  // More repairs = less confidence the result is correct
  const confidence = Math.max(0.5, 1 - (changes.length * 0.05));
  
  return {
    repaired,
    changes,
    wasRepaired: changes.length > 0,
    confidence
  };
}

/**
 * Quick check if JSON might need repair
 * Used to skip repair step for clean JSON
 */
export function mightNeedRepair(json: string): boolean {
  // Quick checks for common issues
  return (
    json.includes(',}') ||
    json.includes(',]') ||
    json.includes('//') ||
    json.includes('/*') ||
    json.includes('\u201C') || // left double quote
    json.includes('\u201D') || // right double quote
    json.includes('\u2018') || // left single quote
    json.includes('\u2019') || // right single quote
    /:\s*treu\b/i.test(json) ||
    /:\s*(flase|fales)\b/i.test(json) ||
    /:\s*nul\b/i.test(json)
  );
}
