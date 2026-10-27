/**
 * M7 v3.6 - Keyword Extractor
 * 
 * Извлекает ключевые слова из описания задачи для поиска
 * похожего кода в проекте
 */

// ============================================
// STOP WORDS
// ============================================

const STOP_WORDS_EN = new Set([
  // Common verbs
  'add', 'create', 'make', 'fix', 'update', 'change', 'remove', 'delete',
  'implement', 'build', 'new', 'get', 'set', 'put', 'post', 'use',
  // Common words
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'want',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
  'this', 'that', 'these', 'those', 'it', 'its'
]);

const STOP_WORDS_RU = new Set([
  // Глаголы
  'добавить', 'создать', 'сделать', 'исправить', 'обновить', 'изменить',
  'удалить', 'реализовать', 'построить', 'использовать', 'получить',
  // Общие слова
  'нужно', 'надо', 'можно', 'должен', 'может', 'будет', 'был', 'была',
  'это', 'эти', 'этот', 'эта', 'то', 'те', 'тот', 'та',
  'как', 'что', 'где', 'когда', 'почему', 'зачем',
  'для', 'при', 'без', 'под', 'над', 'между', 'через',
  'все', 'всё', 'весь', 'вся', 'каждый', 'каждая', 'каждое',
  'новый', 'новая', 'новое', 'старый', 'старая', 'старое'
]);

const ALL_STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_RU]);

// ============================================
// KEYWORD EXTRACTOR CLASS
// ============================================

export class KeywordExtractor {
  private stopWords: Set<string>;

  constructor(additionalStopWords?: string[]) {
    this.stopWords = new Set([
      ...ALL_STOP_WORDS,
      ...(additionalStopWords || [])
    ]);
  }

  /**
   * Extract keywords from task description
   */
  extract(taskDescription: string): string[] {
    const keywords = new Set<string>();
    
    // 1. Extract camelCase identifiers (shouldHideContent, normalizePostsAccess)
    this.extractCamelCase(taskDescription).forEach(w => keywords.add(w));
    
    // 2. Extract PascalCase identifiers (PostContent, UserService, BookmarksNormalizer)
    this.extractPascalCase(taskDescription).forEach(w => keywords.add(w));
    
    // 3. Extract snake_case identifiers (user_access, post_content)
    this.extractSnakeCase(taskDescription).forEach(w => keywords.add(w));
    
    // 4. Extract code in backticks (`shouldHideContent`, `normalize()`)
    this.extractBackticks(taskDescription).forEach(w => keywords.add(w));
    
    // 5. Extract quoted strings
    this.extractQuoted(taskDescription).forEach(w => keywords.add(w));
    
    // Filter and return
    return Array.from(keywords)
      .filter(w => this.isValidKeyword(w))
      .slice(0, 10); // Limit to prevent too many searches
  }

  /**
   * Extract camelCase words
   * e.g., "shouldHideContent" from "Add shouldHideContent to Bookmarks"
   */
  private extractCamelCase(text: string): string[] {
    const regex = /[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/g;
    return text.match(regex) || [];
  }

  /**
   * Extract PascalCase words
   * e.g., "PostContent", "UserService" from "Update PostContent component"
   */
  private extractPascalCase(text: string): string[] {
    const regex = /[A-Z][a-z]+(?:[A-Z][a-z]+)+/g;
    const matches = text.match(regex) || [];
    
    // Also match single PascalCase words if they look like class/component names
    const singlePascal = /\b[A-Z][a-z]{2,}(?:[A-Z][a-z]+)*\b/g;
    const singleMatches = text.match(singlePascal) || [];
    
    return [...matches, ...singleMatches.filter(m => m.length > 4)];
  }

  /**
   * Extract snake_case words
   */
  private extractSnakeCase(text: string): string[] {
    const regex = /[a-z]+(?:_[a-z]+)+/g;
    return text.match(regex) || [];
  }

  /**
   * Extract content in backticks
   */
  private extractBackticks(text: string): string[] {
    const regex = /`([^`]+)`/g;
    const results: string[] = [];
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const content = match[1].trim();
      // Skip if it's a command or file path
      if (!content.includes(' ') && !content.startsWith('@') && !content.includes('/')) {
        results.push(content);
      }
    }
    
    return results;
  }

  /**
   * Extract content in quotes
   */
  private extractQuoted(text: string): string[] {
    const regex = /"([^"]+)"|'([^']+)'/g;
    const results: string[] = [];
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const content = (match[1] || match[2]).trim();
      // Only include if it looks like an identifier
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(content)) {
        results.push(content);
      }
    }
    
    return results;
  }

  /**
   * Check if keyword is valid for search
   */
  private isValidKeyword(word: string): boolean {
    // Too short
    if (word.length < 3) return false;
    
    // Stop word
    if (this.stopWords.has(word.toLowerCase())) return false;
    
    // Too generic
    const genericWords = new Set([
      'data', 'item', 'items', 'value', 'values', 'result', 'results',
      'list', 'array', 'object', 'string', 'number', 'boolean',
      'function', 'method', 'class', 'interface', 'type',
      'error', 'success', 'status', 'state', 'props', 'args',
      'index', 'count', 'length', 'size', 'name', 'id', 'key'
    ]);
    if (genericWords.has(word.toLowerCase())) return false;
    
    return true;
  }
}

// ============================================
// SINGLETON
// ============================================

let extractorInstance: KeywordExtractor | null = null;

export function getKeywordExtractor(): KeywordExtractor {
  if (!extractorInstance) {
    extractorInstance = new KeywordExtractor();
  }
  return extractorInstance;
}

export default KeywordExtractor;
