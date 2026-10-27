/**
 * M7 v3.0 - Auto Memory Types
 * 
 * Типы для автоматической системы памяти с мультипроектной поддержкой
 */

// ============================================================================
// Project Types
// ============================================================================

/**
 * Информация о проекте
 */
export interface ProjectInfo {
  /** Уникальный ID проекта (sanitized name) */
  id: string;
  
  /** Полный путь к проекту */
  path: string;
  
  /** Имя коллекции в ChromaDB */
  collectionName: string;
  
  /** Отображаемое имя */
  displayName: string;
  
  /** Последний доступ */
  lastAccessed: Date;
  
  /** Последняя индексация */
  lastIndexed: Date | null;
  
  /** Количество файлов */
  fileCount: number;
  
  /** Количество чанков в памяти */
  chunkCount: number;
  
  /** Обнаруженные технологии */
  technologies: string[];
  
  /** Статус индексации */
  indexStatus: 'none' | 'partial' | 'complete' | 'outdated';
}

/**
 * Конфигурация проекта
 */
export interface ProjectConfig {
  /** Паттерны для индексации */
  includePatterns: string[];
  
  /** Паттерны для исключения */
  excludePatterns: string[];
  
  /** Автоиндексация при старте */
  autoIndex: boolean;
  
  /** Следить за изменениями файлов */
  watchFiles: boolean;
  
  /** Важность проекта (влияет на TTL в кэше) */
  priority: 'low' | 'normal' | 'high';
}

// ============================================================================
// Context Injection Types
// ============================================================================

/**
 * Конфигурация context injection
 */
export interface ContextInjectionConfig {
  /** Включено ли автоматическое обогащение контекста */
  enabled: boolean;
  
  /** Максимум токенов для контекста */
  maxTokens: number;
  
  /** Количество релевантных чанков */
  topK: number;
  
  /** Минимальный score для включения */
  minScore: number;
  
  /** Паттерны для исключения из поиска */
  excludePatterns: string[];
  
  /** Где применять injection */
  triggers: {
    /** В analyze_task */
    analyzeTask: boolean;
    /** В hive_coordinator */
    hiveCoordinator: boolean;
    /** В session */
    session: boolean;
  };
  
  /** Кэширование результатов поиска */
  cacheResults: boolean;
  
  /** TTL кэша результатов (мс) */
  resultsCacheTtl: number;
}

/**
 * Обогащённый контекст
 */
export interface EnrichedContext {
  /** Исходный запрос */
  originalQuery: string;
  
  /** Релевантные чанки */
  relevantChunks: RelevantChunk[];
  
  /** Информация о проекте */
  projectInfo: {
    id: string;
    name: string;
    technologies: string[];
    patterns: string[];
  };
  
  /** Сформированный контекст для AI */
  assembledContext: string;
  
  /** Количество токенов */
  tokenCount: number;
  
  /** Время поиска (мс) */
  searchDuration: number;
  
  /** Откуда контекст (cache/search) */
  source: 'cache' | 'search';
}

/**
 * Релевантный чанк
 */
export interface RelevantChunk {
  /** Содержимое */
  content: string;
  
  /** Источник (путь к файлу) */
  source: string;
  
  /** Score релевантности */
  score: number;
  
  /** Тип контента */
  type: string;
  
  /** Язык */
  language?: string;
  
  /** Строки в файле */
  lines?: {
    start: number;
    end: number;
  };
}

// ============================================================================
// Collection Pool Types
// ============================================================================

/**
 * Конфигурация пула коллекций
 */
export interface CollectionPoolConfig {
  /** Максимум коллекций в памяти */
  maxSize: number;
  
  /** TTL неактивной коллекции (мс) */
  ttlMs: number;
  
  /** Интервал проверки на eviction (мс) */
  evictionIntervalMs: number;
  
  /** Preload часто используемых */
  preloadFrequent: boolean;
}

/**
 * Состояние коллекции в пуле
 */
export interface PooledCollection {
  /** ID проекта */
  projectId: string;
  
  /** Время последнего доступа */
  lastAccessed: Date;
  
  /** Количество обращений */
  accessCount: number;
  
  /** Размер в памяти (примерный) */
  memorySizeBytes: number;
  
  /** Статус */
  status: 'loading' | 'ready' | 'error';
}

// ============================================================================
// Embedding Cache Types
// ============================================================================

/**
 * Конфигурация кэша embeddings
 */
export interface EmbeddingCacheConfig {
  /** Путь к SQLite базе */
  dbPath: string;
  
  /** Размер in-memory LRU кэша */
  memoryCacheSize: number;
  
  /** TTL записей в SQLite (мс) */
  sqliteTtlMs: number;
  
  /** Интервал очистки устаревших (мс) */
  pruneIntervalMs: number;
}

/**
 * Запись в кэше embeddings
 */
export interface CachedEmbedding {
  /** Hash контента (SHA-256) */
  contentHash: string;
  
  /** Вектор embedding */
  embedding: number[];
  
  /** Модель */
  model: string;
  
  /** Дата создания */
  createdAt: Date;
  
  /** Количество использований */
  hitCount: number;
}

/**
 * Статистика кэша
 */
export interface CacheStats {
  /** Записей в memory cache */
  memoryCacheSize: number;
  
  /** Записей в SQLite */
  sqliteSize: number;
  
  /** Hit rate (0-1) */
  hitRate: number;
  
  /** Всего запросов */
  totalRequests: number;
  
  /** Hits */
  hits: number;
  
  /** Misses */
  misses: number;
  
  /** Сэкономлено API вызовов */
  savedApiCalls: number;
}

// ============================================================================
// Index Pipeline Types
// ============================================================================

/**
 * Конфигурация индексации
 */
export interface IndexPipelineConfig {
  /** Размер чанка (символы) */
  chunkSize: number;
  
  /** Перекрытие чанков */
  chunkOverlap: number;
  
  /** Использовать AST для chunking */
  useAstChunking: boolean;
  
  /** Параллельные workers */
  workerCount: number;
  
  /** Batch size для embeddings */
  embeddingBatchSize: number;
  
  /** Следить за файлами */
  watchEnabled: boolean;
  
  /** Debounce для file watcher (мс) */
  watchDebounceMs: number;
}

/**
 * Результат индексации файла
 */
export interface FileIndexResult {
  /** Путь к файлу */
  path: string;
  
  /** Статус */
  status: 'indexed' | 'skipped' | 'error';
  
  /** Количество чанков */
  chunks: number;
  
  /** Токенов использовано */
  tokensUsed: number;
  
  /** Время индексации (мс) */
  duration: number;
  
  /** Ошибка (если есть) */
  error?: string;
}

// ============================================================================
// Memory Manager Types
// ============================================================================

/**
 * Конфигурация MemoryManager
 */
export interface MemoryManagerConfig {
  /** OpenAI API ключ */
  openaiApiKey: string;
  
  /** URL ChromaDB сервера */
  chromaUrl: string;
  
  /** Путь к конфигу проектов */
  projectsConfigPath: string;
  
  /** Context injection */
  contextInjection: ContextInjectionConfig;
  
  /** Collection pool */
  collectionPool: CollectionPoolConfig;
  
  /** Embedding cache */
  embeddingCache: EmbeddingCacheConfig;
  
  /** Index pipeline */
  indexPipeline: IndexPipelineConfig;
}

/**
 * Статистика по всем проектам
 */
export interface MultiProjectStats {
  /** Всего проектов */
  totalProjects: number;
  
  /** Активных в памяти */
  activeProjects: number;
  
  /** Всего чанков */
  totalChunks: number;
  
  /** Всего запросов */
  totalQueries: number;
  
  /** Cache hit rate */
  cacheHitRate: number;
  
  /** Использование памяти */
  memoryUsageMb: number;
  
  /** Сэкономлено на API */
  savedApiCost: number;
  
  /** По проектам */
  projects: Array<{
    id: string;
    name: string;
    chunks: number;
    queries: number;
    lastAccessed: Date;
  }>;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_CONTEXT_INJECTION_CONFIG: ContextInjectionConfig = {
  enabled: true,
  maxTokens: 4000,
  topK: 5,
  minScore: 0.65,
  excludePatterns: ['*.test.ts', '*.spec.ts', '*.d.ts', 'node_modules/**'],
  triggers: {
    analyzeTask: true,
    hiveCoordinator: true,
    session: false,
  },
  cacheResults: true,
  resultsCacheTtl: 5 * 60 * 1000, // 5 minutes
};

export const DEFAULT_COLLECTION_POOL_CONFIG: CollectionPoolConfig = {
  maxSize: 5,
  ttlMs: 30 * 60 * 1000, // 30 minutes
  evictionIntervalMs: 5 * 60 * 1000, // 5 minutes
  preloadFrequent: true,
};

export const DEFAULT_EMBEDDING_CACHE_CONFIG: EmbeddingCacheConfig = {
  dbPath: '~/.m7/embedding_cache.db',
  memoryCacheSize: 10000,
  sqliteTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  pruneIntervalMs: 24 * 60 * 60 * 1000, // 1 day
};

export const DEFAULT_INDEX_PIPELINE_CONFIG: IndexPipelineConfig = {
  chunkSize: 1000,
  chunkOverlap: 100,
  useAstChunking: false, // TODO: implement AST chunking
  workerCount: 4,
  embeddingBatchSize: 50,
  watchEnabled: false, // TODO: implement file watching
  watchDebounceMs: 500,
};

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.json', '**/*.md'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/*.d.ts'],
  autoIndex: false,
  watchFiles: false,
  priority: 'normal',
};

