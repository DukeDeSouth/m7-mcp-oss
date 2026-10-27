/**
 * Project Index Manager Types
 * Автоматическое создание и обновление INDEX.md файла проекта
 */

export interface ProjectInfo {
  name: string;
  version: string;
  description: string;
  lastUpdated: string;
  status: 'development' | 'production' | 'maintenance' | 'archived';
  techStack: string[];
  domain?: string;
}

export interface DeploymentInfo {
  server?: string;
  method?: string;
  url?: string;
  environment?: 'development' | 'staging' | 'production';
  lastDeploy?: string;
  deployScript?: string;
}

export interface GitInfo {
  repository?: string;
  branch?: string;
  remote?: string;
  lastCommit?: string;
  contributors?: string[];
}

export interface DocumentationFile {
  path: string;
  name: string;
  status: 'current' | 'outdated' | 'missing' | 'draft';
  purpose: string;
  lastUpdated?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'core' | 'api' | 'deployment' | 'development' | 'user' | 'methodology';
}

export interface ConfigFile {
  path: string;
  name: string;
  purpose: string;
  status: 'current' | 'outdated' | 'missing';
  critical: boolean;
}

export interface ProjectStructure {
  directories: DirectoryInfo[];
  keyFiles: string[];
  totalFiles: number;
  totalDirectories: number;
}

export interface DirectoryInfo {
  path: string;
  name: string;
  purpose: string;
  fileCount: number;
  importance: 'critical' | 'high' | 'medium' | 'low';
}

export interface ProjectIndex {
  project: ProjectInfo;
  deployment: DeploymentInfo;
  git: GitInfo;
  structure: ProjectStructure;
  documentation: DocumentationFile[];
  configuration: ConfigFile[];
  quickStart: string[];
  importantNotes: string[];
  generatedAt: string;
  generatedBy: string;
}

export interface ScanOptions {
  includeHidden: boolean;
  maxDepth: number;
  excludePatterns: string[];
  includeGitInfo: boolean;
  includePackageInfo: boolean;
  scanDocumentation: boolean;
  scanConfiguration: boolean;
}

export interface IndexGeneratorOptions {
  template?: 'minimal' | 'standard' | 'comprehensive';
  sections: IndexSection[];
  outputPath?: string;
  autoUpdate: boolean;
  includeMetrics: boolean;
}

export interface IndexSection {
  id: string;
  title: string;
  enabled: boolean;
  priority: number;
  content?: string;
}

export interface ProjectScanner {
  scanProject(rootPath: string, options: ScanOptions): Promise<ProjectIndex>;
  scanDocumentation(rootPath: string): Promise<DocumentationFile[]>;
  scanConfiguration(rootPath: string): Promise<ConfigFile[]>;
  scanGitInfo(rootPath: string): Promise<GitInfo>;
  scanPackageInfo(rootPath: string): Promise<ProjectInfo>;
  scanStructure(rootPath: string, options: ScanOptions): Promise<ProjectStructure>;
}

export interface IndexGenerator {
  generate(index: ProjectIndex, options: IndexGeneratorOptions): Promise<string>;
  generateSection(section: IndexSection, index: ProjectIndex): Promise<string>;
  saveToFile(content: string, filePath: string): Promise<void>;
  validateIndex(index: ProjectIndex): Promise<ValidationResult>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
  score: number;
}

// Предопределенные шаблоны секций
export const DEFAULT_INDEX_SECTIONS: IndexSection[] = [
  {
    id: 'overview',
    title: 'Project Overview',
    enabled: true,
    priority: 1
  },
  {
    id: 'quick_start',
    title: 'Quick Start',
    enabled: true,
    priority: 2
  },
  {
    id: 'deployment',
    title: 'Deployment Information',
    enabled: true,
    priority: 3
  },
  {
    id: 'git_info',
    title: 'Git Repository',
    enabled: true,
    priority: 4
  },
  {
    id: 'structure',
    title: 'Project Structure',
    enabled: true,
    priority: 5
  },
  {
    id: 'documentation',
    title: 'Documentation Index',
    enabled: true,
    priority: 6
  },
  {
    id: 'configuration',
    title: 'Configuration Files',
    enabled: true,
    priority: 7
  },
  {
    id: 'tech_stack',
    title: 'Technology Stack',
    enabled: true,
    priority: 8
  },
  {
    id: 'important_notes',
    title: 'Important Notes',
    enabled: true,
    priority: 9
  }
];

// Паттерны для исключения при сканировании
export const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '*.temp'
];

// Критические файлы конфигурации
export const CRITICAL_CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'mcp.json',
  '.env',
  '.env.example',
  'docker-compose.yml',
  'Dockerfile',
  '.cursorrules',
  'README.md'
];

// Важные директории
export const IMPORTANT_DIRECTORIES = [
  { pattern: 'src', purpose: 'Source code', importance: 'critical' as const },
  { pattern: 'docs', purpose: 'Documentation', importance: 'high' as const },
  { pattern: 'tests', purpose: 'Test files', importance: 'high' as const },
  { pattern: 'config', purpose: 'Configuration', importance: 'high' as const },
  { pattern: 'scripts', purpose: 'Build/deployment scripts', importance: 'medium' as const },
  { pattern: 'public', purpose: 'Static assets', importance: 'medium' as const },
  { pattern: 'assets', purpose: 'Project assets', importance: 'medium' as const }
];
