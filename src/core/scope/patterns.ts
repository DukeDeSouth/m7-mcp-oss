/**
 * M7 v3.5 - Technology Patterns for Scope Scanner
 * 
 * Библиотека паттернов для различных технологий и типов рефакторинга.
 * Используется для анализа кодовой базы и оценки scope задачи.
 * 
 * @author M7 AI Assistant
 * @version 3.5.0
 * @date 2026-01-22
 */

/**
 * Паттерн для поиска в коде
 */
export interface ScanPattern {
  /** Уникальный ID паттерна */
  id: string;
  
  /** Человекочитаемое название */
  name: string;
  
  /** Расширения файлов для поиска */
  fileExtensions: string[];
  
  /** Regex паттерны для поиска в коде */
  codePatterns: RegExp[];
  
  /** Описание что этот паттерн ищет */
  description: string;
}

// ============================================
// TECHNOLOGY PATTERNS
// ============================================

export const TECHNOLOGY_PATTERNS: Record<string, ScanPattern> = {
  
  // ========== PHP ==========
  
  'php7-to-php8': {
    id: 'php7-to-php8',
    name: 'PHP7 to PHP8 Migration',
    fileExtensions: ['.php'],
    codePatterns: [
      /array\s*\(/g,                    // array() → []
      /\$\w+\s*=\s*array\s*\(/g,        // $arr = array() → $arr = []
      /mysql_\w+\s*\(/g,                // mysql_* removed in PHP7
      /each\s*\(/g,                     // each() removed in PHP8
      /create_function\s*\(/g,          // create_function removed
      /ereg[i]?\s*\(/g,                 // ereg* removed
      /split\s*\(/g,                    // split() → explode()
      /\(\s*unset\s*\)/g,               // (unset) cast removed
      /\$\{\s*\$/g,                     // ${$var} → {$$var}
    ],
    description: 'PHP7 constructs deprecated or removed in PHP8'
  },
  
  'php-legacy': {
    id: 'php-legacy',
    name: 'Legacy PHP Patterns',
    fileExtensions: ['.php'],
    codePatterns: [
      /mysql_connect/g,
      /mysql_query/g,
      /mysql_fetch/g,
      /\$GLOBALS\s*\[/g,
      /global\s+\$/g,
      /extract\s*\(/g,
    ],
    description: 'Legacy PHP patterns that should be refactored'
  },
  
  // ========== JavaScript ==========
  
  'commonjs-to-esm': {
    id: 'commonjs-to-esm',
    name: 'CommonJS to ESM Migration',
    fileExtensions: ['.js', '.cjs'],
    codePatterns: [
      /require\s*\(\s*['"][^'"]+['"]\s*\)/g,  // require('...')
      /module\.exports\s*=/g,                  // module.exports = 
      /exports\.\w+\s*=/g,                     // exports.x = 
      /module\.exports\.\w+/g,                 // module.exports.x
    ],
    description: 'CommonJS patterns to migrate to ESM imports/exports'
  },
  
  'var-to-const-let': {
    id: 'var-to-const-let',
    name: 'var to const/let',
    fileExtensions: ['.js', '.jsx'],
    codePatterns: [
      /\bvar\s+\w+\s*=/g,
      /\bvar\s+\w+\s*;/g,
      /\bvar\s+\w+\s*,/g,
    ],
    description: 'var declarations to convert to const/let'
  },
  
  'callback-to-promise': {
    id: 'callback-to-promise',
    name: 'Callbacks to Promises/Async',
    fileExtensions: ['.js', '.ts', '.jsx', '.tsx'],
    codePatterns: [
      /function\s*\([^)]*callback[^)]*\)/gi,
      /\.then\s*\(\s*function/g,
      /new\s+Promise\s*\(/g,
    ],
    description: 'Callback patterns that could use async/await'
  },
  
  // ========== TypeScript ==========
  
  'javascript-to-typescript': {
    id: 'javascript-to-typescript',
    name: 'JavaScript to TypeScript',
    fileExtensions: ['.js', '.jsx'],
    codePatterns: [
      /\.propTypes\s*=/g,                      // PropTypes → interfaces
      /\/\*\*[\s\S]*?@param\s+\{[^}]+\}/g,     // JSDoc params
      /\/\*\*[\s\S]*?@returns?\s+\{[^}]+\}/g,  // JSDoc returns
      /function\s+\w+\s*\([^)]*\)\s*\{/g,      // Untyped functions
      /=>\s*\{/g,                               // Arrow functions
    ],
    description: 'JavaScript patterns requiring TypeScript types'
  },
  
  'any-types': {
    id: 'any-types',
    name: 'any Type Usage',
    fileExtensions: ['.ts', '.tsx'],
    codePatterns: [
      /:\s*any\b/g,
      /as\s+any\b/g,
      /<any>/g,
      /\bany\[\]/g,
    ],
    description: 'any type usages that should be properly typed'
  },
  
  // ========== React ==========
  
  'react-class-to-hooks': {
    id: 'react-class-to-hooks',
    name: 'React Class to Hooks',
    fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
    codePatterns: [
      /class\s+\w+\s+extends\s+(React\.)?Component/g,
      /class\s+\w+\s+extends\s+(React\.)?PureComponent/g,
      /componentDidMount\s*\(/g,
      /componentDidUpdate\s*\(/g,
      /componentWillUnmount\s*\(/g,
      /this\.state\b/g,
      /this\.setState\s*\(/g,
      /this\.props\b/g,
    ],
    description: 'React class components to convert to functional with hooks'
  },
  
  'react-deprecated': {
    id: 'react-deprecated',
    name: 'Deprecated React APIs',
    fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
    codePatterns: [
      /componentWillReceiveProps/g,
      /componentWillMount/g,
      /componentWillUpdate/g,
      /UNSAFE_componentWillReceiveProps/g,
      /UNSAFE_componentWillMount/g,
      /UNSAFE_componentWillUpdate/g,
      /ReactDOM\.findDOMNode/g,
    ],
    description: 'Deprecated React lifecycle methods and APIs'
  },
  
  'react-string-refs': {
    id: 'react-string-refs',
    name: 'React String Refs',
    fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
    codePatterns: [
      /ref\s*=\s*["'][^"']+["']/g,  // ref="myRef"
      /this\.refs\./g,              // this.refs.x
    ],
    description: 'String refs to convert to createRef/useRef'
  },
  
  // ========== General Cleanup ==========
  
  'console-logs': {
    id: 'console-logs',
    name: 'Console Statements',
    fileExtensions: ['.js', '.ts', '.jsx', '.tsx'],
    codePatterns: [
      /console\.log\s*\(/g,
      /console\.warn\s*\(/g,
      /console\.error\s*\(/g,
      /console\.debug\s*\(/g,
      /console\.info\s*\(/g,
      /console\.trace\s*\(/g,
    ],
    description: 'Console statements to remove or replace with proper logging'
  },
  
  'todo-comments': {
    id: 'todo-comments',
    name: 'TODO/FIXME Comments',
    fileExtensions: ['.js', '.ts', '.jsx', '.tsx', '.php', '.py', '.java', '.go'],
    codePatterns: [
      /\/\/\s*TODO[:\s]/gi,
      /\/\/\s*FIXME[:\s]/gi,
      /\/\/\s*HACK[:\s]/gi,
      /\/\/\s*XXX[:\s]/gi,
      /#\s*TODO[:\s]/gi,
      /#\s*FIXME[:\s]/gi,
    ],
    description: 'TODO and FIXME comments that need attention'
  },
  
  'magic-numbers': {
    id: 'magic-numbers',
    name: 'Magic Numbers',
    fileExtensions: ['.js', '.ts', '.jsx', '.tsx'],
    codePatterns: [
      /[=<>!]\s*\d{3,}/g,           // Comparisons with 3+ digit numbers
      /setTimeout\s*\([^,]+,\s*\d{4,}\)/g,  // setTimeout with magic ms
      /setInterval\s*\([^,]+,\s*\d{4,}\)/g, // setInterval with magic ms
    ],
    description: 'Magic numbers that should be constants'
  },
  
  // ========== Python ==========
  
  'python2-to-python3': {
    id: 'python2-to-python3',
    name: 'Python 2 to Python 3',
    fileExtensions: ['.py'],
    codePatterns: [
      /print\s+[^(]/g,              // print x → print(x)
      /print\s*>>/g,                // print >> deprecated
      /xrange\s*\(/g,               // xrange → range
      /\.iteritems\s*\(/g,          // dict.iteritems → dict.items
      /\.itervalues\s*\(/g,         // dict.itervalues → dict.values
      /\.iterkeys\s*\(/g,           // dict.iterkeys → dict.keys
      /raw_input\s*\(/g,            // raw_input → input
      /unicode\s*\(/g,              // unicode → str
      /\.has_key\s*\(/g,            // dict.has_key → in
    ],
    description: 'Python 2 patterns that need Python 3 migration'
  },
  
  // ========== CSS ==========
  
  'css-vendor-prefixes': {
    id: 'css-vendor-prefixes',
    name: 'CSS Vendor Prefixes',
    fileExtensions: ['.css', '.scss', '.less'],
    codePatterns: [
      /-webkit-/g,
      /-moz-/g,
      /-ms-/g,
      /-o-/g,
    ],
    description: 'Vendor prefixes that might need autoprefixer'
  },
  
  // ========== SQL ==========
  
  'sql-injection-risk': {
    id: 'sql-injection-risk',
    name: 'SQL Injection Risks',
    fileExtensions: ['.php', '.js', '.ts', '.py', '.java'],
    codePatterns: [
      /query\s*\(\s*["'`]\s*SELECT/gi,
      /query\s*\(\s*["'`]\s*INSERT/gi,
      /query\s*\(\s*["'`]\s*UPDATE/gi,
      /query\s*\(\s*["'`]\s*DELETE/gi,
      /\+\s*["'`]\s*WHERE/gi,
      /\$_GET\s*\[/g,
      /\$_POST\s*\[/g,
    ],
    description: 'Potential SQL injection vulnerabilities'
  },
};

// ============================================
// KEYWORD TO PATTERNS MAPPING
// ============================================

/**
 * Сопоставление ключевых слов с ID паттернов
 */
export const KEYWORD_TO_PATTERNS: Record<string, string[]> = {
  // PHP
  'php': ['php7-to-php8', 'php-legacy'],
  'php7': ['php7-to-php8'],
  'php8': ['php7-to-php8'],
  'php5': ['php-legacy', 'php7-to-php8'],
  
  // JavaScript
  'javascript': ['commonjs-to-esm', 'var-to-const-let', 'callback-to-promise'],
  'js': ['commonjs-to-esm', 'var-to-const-let', 'callback-to-promise'],
  'esm': ['commonjs-to-esm'],
  'commonjs': ['commonjs-to-esm'],
  'es6': ['var-to-const-let', 'callback-to-promise'],
  'async': ['callback-to-promise'],
  
  // TypeScript
  'typescript': ['javascript-to-typescript', 'any-types'],
  'ts': ['javascript-to-typescript', 'any-types'],
  'types': ['any-types', 'javascript-to-typescript'],
  'typing': ['any-types', 'javascript-to-typescript'],
  
  // React
  'react': ['react-class-to-hooks', 'react-deprecated', 'react-string-refs'],
  'hooks': ['react-class-to-hooks'],
  'functional': ['react-class-to-hooks'],
  'class component': ['react-class-to-hooks'],
  
  // Python
  'python': ['python2-to-python3'],
  'python2': ['python2-to-python3'],
  'python3': ['python2-to-python3'],
  'py': ['python2-to-python3'],
  
  // Console logging
  'console': ['console-logs'],
  'console.log': ['console-logs'],
  'logging': ['console-logs'],
  
  // General actions
  'refactor': ['console-logs', 'todo-comments', 'magic-numbers'],
  'cleanup': ['console-logs', 'todo-comments'],
  'clean': ['console-logs', 'todo-comments'],
  
  // Russian keywords
  'рефактор': ['console-logs', 'todo-comments'],
  'замен': ['console-logs'],
  'удалить': ['console-logs', 'todo-comments'],
  'убрать': ['console-logs', 'todo-comments'],
  'migrate': ['commonjs-to-esm', 'javascript-to-typescript'],
  'upgrade': ['php7-to-php8', 'python2-to-python3', 'react-deprecated'],
  'modernize': ['var-to-const-let', 'callback-to-promise', 'react-class-to-hooks'],
  
  // Security
  'security': ['sql-injection-risk'],
  'secure': ['sql-injection-risk'],
  'sql': ['sql-injection-risk'],
  
  // CSS
  'css': ['css-vendor-prefixes'],
  'style': ['css-vendor-prefixes'],
};

// ============================================
// FILE EXTENSION TO TECHNOLOGY
// ============================================

/**
 * Сопоставление расширений файлов с технологиями
 */
export const EXTENSION_TO_TECH: Record<string, string[]> = {
  '.php': ['php'],
  '.js': ['javascript'],
  '.jsx': ['javascript', 'react'],
  '.ts': ['typescript'],
  '.tsx': ['typescript', 'react'],
  '.py': ['python'],
  '.css': ['css'],
  '.scss': ['css'],
  '.less': ['css'],
};

/**
 * Получить паттерны по ключевым словам
 */
export function getPatternsForKeywords(keywords: string[]): ScanPattern[] {
  const patternIds = new Set<string>();
  
  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase().trim();
    const ids = KEYWORD_TO_PATTERNS[normalizedKeyword] || [];
    ids.forEach(id => patternIds.add(id));
  }
  
  return Array.from(patternIds)
    .map(id => TECHNOLOGY_PATTERNS[id])
    .filter((p): p is ScanPattern => p !== undefined);
}

/**
 * Получить паттерны по расширению файла
 */
export function getPatternsForExtension(extension: string): ScanPattern[] {
  const techs = EXTENSION_TO_TECH[extension.toLowerCase()] || [];
  return getPatternsForKeywords(techs);
}

/**
 * v3.5.1: Получить паттерн по ID напрямую
 * Используется для LLM-selected паттернов
 */
export function getPatternById(id: string): ScanPattern | undefined {
  return TECHNOLOGY_PATTERNS[id];
}
