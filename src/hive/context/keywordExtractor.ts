/**
 * M7 Hive - Keyword Extractor
 * 
 * Extracts relevant keywords from task descriptions for code search.
 * 
 * @version 3.8.0
 */

/**
 * Common stop words to filter out
 */
const STOP_WORDS = new Set([
  // Articles
  'the', 'a', 'an',
  // Be verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  // Have verbs
  'have', 'has', 'had', 'having',
  // Do verbs
  'do', 'does', 'did', 'doing',
  // Modal verbs
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  // Prepositions
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
  // Demonstratives
  'this', 'that', 'these', 'those',
  // Conjunctions
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  // Other common words
  'not', 'no', 'yes', 'all', 'any', 'some', 'each', 'every', 'many', 'much',
  'more', 'most', 'other', 'another', 'such', 'what', 'which', 'who', 'whom',
  'when', 'where', 'why', 'how', 'if', 'then', 'than', 'because', 'while',
  // Task-related but not useful for search
  'create', 'make', 'build', 'implement', 'add', 'remove', 'update', 'fix',
  'write', 'read', 'get', 'set', 'use', 'using', 'need', 'want', 'please',
  'help', 'complete', 'task', 'provide', 'ensure'
]);

/**
 * Technical terms to boost (more likely to be code-related)
 */
const TECH_TERMS = new Set([
  // Programming
  'function', 'class', 'interface', 'type', 'method', 'variable', 'const',
  'export', 'import', 'async', 'await', 'promise', 'callback', 'return',
  // Patterns
  'validator', 'handler', 'controller', 'service', 'model', 'provider',
  'factory', 'singleton', 'observer', 'middleware', 'router', 'reducer',
  // Concepts
  'api', 'http', 'rest', 'graphql', 'socket', 'websocket', 'database',
  'query', 'mutation', 'schema', 'config', 'context', 'state', 'store',
  // Testing
  'test', 'spec', 'mock', 'stub', 'fixture', 'assertion',
  // Types
  'string', 'number', 'boolean', 'array', 'object', 'null', 'undefined',
  // M7 specific
  'hive', 'agent', 'planner', 'auction', 'gatekeeper', 'orchestrator'
]);

/**
 * Extract keywords from task description
 */
export function extractKeywords(text: string): string[] {
  // Convert to lowercase and split into words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
  
  // Score each word
  const scored: Map<string, number> = new Map();
  
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    
    let score = scored.get(word) || 0;
    score += 1; // Base score for occurrence
    
    if (TECH_TERMS.has(word)) {
      score += 3; // Boost technical terms more
    }
    
    // Boost longer words (more specific)
    if (word.length > 6) {
      score += 0.5;
    }
    
    scored.set(word, score);
  }
  
  // Sort by score and return top keywords (single words only, no compounds)
  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Extract compound terms (adjacent word pairs)
 */
function extractCompoundTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  
  const compounds: string[] = [];
  
  for (let i = 0; i < words.length - 1; i++) {
    const compound = words[i] + words[i + 1];
    if (compound.length > 6) {
      compounds.push(compound);
    }
  }
  
  return compounds;
}

/**
 * Extract file patterns from text (e.g., "*.ts", "src/")
 */
export function extractFilePatterns(text: string): string[] {
  const patterns: string[] = [];
  
  // Match file extensions
  const extMatches = text.match(/\*?\.[a-z]{2,4}/gi);
  if (extMatches) {
    patterns.push(...extMatches.map(e => e.startsWith('*') ? e : `*${e}`));
  }
  
  // Match directory patterns
  const dirMatches = text.match(/\b(src|lib|test|spec|utils?|helpers?|components?|services?|models?|types?)\b/gi);
  if (dirMatches) {
    patterns.push(...dirMatches.map(d => `**/${d.toLowerCase()}/**`));
  }
  
  return [...new Set(patterns)];
}
