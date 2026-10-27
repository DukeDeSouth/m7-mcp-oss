/**
 * M7 Feature Flags
 * 
 * Загрузка и управление feature flags из config/m7-config.yaml
 * 
 * @version 1.0.0
 * @since M7 v4.0
 */

import { createLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getProjectPath } from '../utils/projectPath.js';

const log = createLogger('[FeatureFlags]');

/**
 * Feature flags для M7 v4.0
 */
export interface M7FeatureFlags {
  /** HEAVY-first routing */
  heavyFirstRouting: boolean;
  
  /** Автоматическая интерпретация */
  autoInterpretation: boolean;
  
  /** Task Graph */
  taskGraph: boolean;
  
  /** Task Transfer */
  taskTransfer: boolean;
  
  /** Scope Alerts */
  scopeAlerts: boolean;
  
  /** Порог для scope alert */
  scopeAlertThreshold: number;
}

/**
 * Настройки интерпретации
 */
export interface InterpretationSettings {
  outputFormat: 'compact' | 'detailed' | 'hybrid';
  includeDiscoveryDetails: boolean;
  maxFilesInOutput: number;
  maxSimilarCodeInOutput: number;
}

/**
 * Полная конфигурация M7
 */
export interface M7Config {
  features: M7FeatureFlags;
  interpretation: InterpretationSettings;
}

/**
 * Дефолтные значения
 */
const DEFAULT_FEATURES: M7FeatureFlags = {
  heavyFirstRouting: true,
  autoInterpretation: true,
  taskGraph: true,
  taskTransfer: true,
  scopeAlerts: true,
  scopeAlertThreshold: 2.0,
};

const DEFAULT_INTERPRETATION: InterpretationSettings = {
  outputFormat: 'hybrid',
  includeDiscoveryDetails: true,
  maxFilesInOutput: 5,
  maxSimilarCodeInOutput: 3
};

let cachedConfig: M7Config | null = null;

/**
 * Загружает конфигурацию из файла
 */
export function loadM7Config(): M7Config {
  if (cachedConfig) {
    return cachedConfig;
  }
  
  try {
    const projectPath = getProjectPath();
    const configPath = path.join(projectPath, 'config', 'm7-config.yaml');
    
    if (!fs.existsSync(configPath)) {
      log.debug('Config file not found, using defaults');
      cachedConfig = {
        features: DEFAULT_FEATURES,
        interpretation: DEFAULT_INTERPRETATION
      };
      return cachedConfig;
    }
    
    const content = fs.readFileSync(configPath, 'utf-8');
    const rawConfig = yaml.load(content) as any;
    
    // Парсим features
    const features: M7FeatureFlags = {
      heavyFirstRouting: rawConfig?.features?.heavy_first_routing ?? DEFAULT_FEATURES.heavyFirstRouting,
      autoInterpretation: rawConfig?.features?.auto_interpretation ?? DEFAULT_FEATURES.autoInterpretation,
      taskGraph: rawConfig?.features?.task_graph ?? DEFAULT_FEATURES.taskGraph,
      taskTransfer: rawConfig?.features?.task_transfer ?? DEFAULT_FEATURES.taskTransfer,
      scopeAlerts: rawConfig?.features?.scope_alerts ?? DEFAULT_FEATURES.scopeAlerts,
      scopeAlertThreshold: rawConfig?.features?.scope_alert_threshold ?? DEFAULT_FEATURES.scopeAlertThreshold,
    };
    
    // Парсим interpretation
    const interpretation: InterpretationSettings = {
      outputFormat: rawConfig?.interpretation?.output_format ?? DEFAULT_INTERPRETATION.outputFormat,
      includeDiscoveryDetails: rawConfig?.interpretation?.include_discovery_details ?? DEFAULT_INTERPRETATION.includeDiscoveryDetails,
      maxFilesInOutput: rawConfig?.interpretation?.max_files_in_output ?? DEFAULT_INTERPRETATION.maxFilesInOutput,
      maxSimilarCodeInOutput: rawConfig?.interpretation?.max_similar_code_in_output ?? DEFAULT_INTERPRETATION.maxSimilarCodeInOutput
    };
    
    cachedConfig = { features, interpretation };
    
    log.debug(`Config loaded: heavyFirst=${features.heavyFirstRouting}, autoInterp=${features.autoInterpretation}`);
    
    return cachedConfig;
    
  } catch (error: any) {
    log.warn(`Failed to load config: ${error.message}, using defaults`);
    cachedConfig = {
      features: DEFAULT_FEATURES,
      interpretation: DEFAULT_INTERPRETATION
    };
    return cachedConfig;
  }
}

/**
 * Получает feature flags
 */
export function getFeatureFlags(): M7FeatureFlags {
  return loadM7Config().features;
}

/**
 * Получает настройки интерпретации
 */
export function getInterpretationSettings(): InterpretationSettings {
  return loadM7Config().interpretation;
}

/**
 * Проверяет включён ли feature flag
 */
export function isFeatureEnabled(flag: keyof M7FeatureFlags): boolean {
  const flags = getFeatureFlags();
  const value = flags[flag];
  return typeof value === 'boolean' ? value : false;
}

/**
 * Сбрасывает кэш конфигурации (для тестов)
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}
