/**
 * M7 Model Discovery System
 * @module hive/api/modelDiscovery
 * @version 3.6.3
 * 
 * Автоматическое определение лучших доступных моделей
 * через API OpenAI и Anthropic.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Логгер
import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[ModelDiscovery]');

/**
 * Информация о модели
 */
export interface ModelInfo {
  id: string;
  provider: 'openai' | 'anthropic';
  tier: 'flagship' | 'standard' | 'economy';
  contextWindow: number;
  supportsJson: boolean;
}

/**
 * Результат обнаружения моделей
 */
export interface DiscoveryResult {
  openai: {
    flagship: string;    // Лучшая модель (GPT-5.2, GPT-5)
    standard: string;    // Стандартная (GPT-4o)
    economy: string;     // Экономичная (GPT-4o-mini)
    available: string[];
  };
  anthropic: {
    flagship: string;    // Лучшая модель (Opus 4.6)
    standard: string;    // Стандартная (Sonnet 4.5)
    economy: string;     // Экономичная (Haiku 4.5)
    available: string[];
  };
  discoveredAt: string;
}

/**
 * Приоритет моделей OpenAI (от лучшей к худшей)
 */
const OPENAI_MODEL_PRIORITY: Record<string, { tier: 'flagship' | 'standard' | 'economy'; priority: number }> = {
  // Flagship models (April 2026)
  'gpt-5.5': { tier: 'flagship', priority: 130 },
  'gpt-5.5-2026-04-23': { tier: 'flagship', priority: 129 },
  'gpt-5.2': { tier: 'flagship', priority: 110 },
  'gpt-5': { tier: 'flagship', priority: 105 },
  'gpt-4o': { tier: 'flagship', priority: 100 },
  // Standard models
  'gpt-5.1': { tier: 'standard', priority: 90 },
  'gpt-4.1': { tier: 'standard', priority: 85 },
  'gpt-4-turbo': { tier: 'standard', priority: 80 },
  // Economy models
  'gpt-4.1-mini': { tier: 'economy', priority: 55 },
  'gpt-4.1-nano': { tier: 'economy', priority: 50 },
  'gpt-4o-mini': { tier: 'economy', priority: 45 },
};

/**
 * Приоритет моделей Anthropic (от лучшей к худшей)
 */
const ANTHROPIC_MODEL_PRIORITY: Record<string, { tier: 'flagship' | 'standard' | 'economy'; priority: number }> = {
  // Flagship models (April 2026)
  'claude-opus-4-7': { tier: 'flagship', priority: 130 },
  'claude-opus-4-6': { tier: 'flagship', priority: 110 },
  'claude-opus-4-5-20251101': { tier: 'flagship', priority: 100 },
  'claude-opus-4-5': { tier: 'flagship', priority: 99 },
  'claude-opus-4-1-20250805': { tier: 'flagship', priority: 96 },
  'claude-opus-4-1': { tier: 'flagship', priority: 95 },
  // Standard models (April 2026)
  'claude-sonnet-4-6': { tier: 'standard', priority: 90 },
  'claude-sonnet-4-5-20250929': { tier: 'standard', priority: 85 },
  'claude-sonnet-4-5': { tier: 'standard', priority: 84 },
  // Economy models
  'claude-haiku-4-5-20251001': { tier: 'economy', priority: 55 },
  'claude-haiku-4-5': { tier: 'economy', priority: 54 },
};

/**
 * Кэш результатов обнаружения (действует 24 часа)
 */
let cachedDiscovery: DiscoveryResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Получить список доступных моделей OpenAI
 */
async function discoverOpenAIModels(apiKey: string): Promise<string[]> {
  try {
    const client = new OpenAI({ apiKey, timeout: 10000 });
    const response = await client.models.list();
    
    // Фильтруем только chat модели
    const chatModels = response.data
      .filter(m => 
        m.id.includes('gpt-') && 
        !m.id.includes('instruct') &&
        !m.id.includes('vision') &&
        !m.id.includes('audio') &&
        !m.id.includes('tts') &&
        !m.id.includes('whisper') &&
        !m.id.includes('embedding') &&
        !m.id.includes('davinci') &&
        !m.id.includes('babbage')
      )
      .map(m => m.id);
    
    log.debug(` OpenAI models found: ${chatModels.length}`);
    return chatModels;
  } catch (error: any) {
    log.debug(` OpenAI discovery failed: ${error.message}`);
    return [];
  }
}

/**
 * Получить список доступных моделей Anthropic
 * Anthropic не имеет API для списка моделей, используем известный список
 */
async function discoverAnthropicModels(apiKey: string): Promise<string[]> {
  // Anthropic не предоставляет API для списка моделей
  // Пробуем вызвать каждую модель с минимальным запросом
  const client = new Anthropic({ apiKey, timeout: 10000 });
  const knownModels = Object.keys(ANTHROPIC_MODEL_PRIORITY);
  const available: string[] = [];
  
  // Проверяем только топовые модели каждого тира (для скорости)
  const modelsToCheck = [
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929', 
    'claude-haiku-4-5-20251001',
  ];
  
  for (const model of modelsToCheck) {
    try {
      // Минимальный тестовый запрос
      await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      available.push(model);
      log.debug(` Anthropic model available: ${model}`);
    } catch (error: any) {
      // Model not available or error
      if (!error.message?.includes('model')) {
        // Если ошибка не связана с моделью, возможно модель доступна
        log.debug(` Anthropic ${model}: ${error.message}`);
      }
    }
  }
  
  // Если ничего не нашли, используем дефолтные
  if (available.length === 0) {
    log.debug(` Using default Anthropic models`);
    return ['claude-sonnet-4-6', 'claude-sonnet-4-5-20250929'];
  }
  
  return available;
}

/**
 * Выбрать лучшую модель из списка по тиру
 */
function selectBestModel(
  available: string[],
  priority: Record<string, { tier: 'flagship' | 'standard' | 'economy'; priority: number }>,
  targetTier: 'flagship' | 'standard' | 'economy'
): string {
  // Фильтруем модели нужного тира
  const tierModels = available.filter(m => priority[m]?.tier === targetTier);
  
  if (tierModels.length > 0) {
    // Сортируем по приоритету и берём лучшую
    return tierModels.sort((a, b) => 
      (priority[b]?.priority || 0) - (priority[a]?.priority || 0)
    )[0];
  }
  
  // Если нет моделей нужного тира, берём любую лучшую
  const allSorted = available
    .filter(m => priority[m])
    .sort((a, b) => (priority[b]?.priority || 0) - (priority[a]?.priority || 0));
  
  return allSorted[0] || available[0] || '';
}

/**
 * Обнаружить доступные модели
 */
export async function discoverModels(
  openaiKey?: string,
  anthropicKey?: string
): Promise<DiscoveryResult> {
  // Проверяем кэш
  if (cachedDiscovery && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    log.debug(` Using cached results (${Math.round((Date.now() - cacheTimestamp) / 60000)} min old)`);
    return cachedDiscovery;
  }
  
  log.debug(` Starting model discovery...`);
  
  const result: DiscoveryResult = {
    openai: {
      flagship: 'gpt-5.5',
      standard: 'gpt-5.1',
      economy: 'gpt-4.1-mini',
      available: [],
    },
    anthropic: {
      flagship: 'claude-opus-4-6',
      standard: 'claude-sonnet-4-6',
      economy: 'claude-haiku-4-5-20251001',
      available: [],
    },
    discoveredAt: new Date().toISOString(),
  };
  
  // Discover OpenAI models
  if (openaiKey) {
    const openaiModels = await discoverOpenAIModels(openaiKey);
    result.openai.available = openaiModels;
    
    if (openaiModels.length > 0) {
      result.openai.flagship = selectBestModel(openaiModels, OPENAI_MODEL_PRIORITY, 'flagship');
      result.openai.standard = selectBestModel(openaiModels, OPENAI_MODEL_PRIORITY, 'standard');
      result.openai.economy = selectBestModel(openaiModels, OPENAI_MODEL_PRIORITY, 'economy');
    }
    
    log.debug(` OpenAI: flagship=${result.openai.flagship}, standard=${result.openai.standard}`);
  }
  
  // Discover Anthropic models
  if (anthropicKey) {
    const anthropicModels = await discoverAnthropicModels(anthropicKey);
    result.anthropic.available = anthropicModels;
    
    if (anthropicModels.length > 0) {
      result.anthropic.flagship = selectBestModel(anthropicModels, ANTHROPIC_MODEL_PRIORITY, 'flagship');
      result.anthropic.standard = selectBestModel(anthropicModels, ANTHROPIC_MODEL_PRIORITY, 'standard');
      result.anthropic.economy = selectBestModel(anthropicModels, ANTHROPIC_MODEL_PRIORITY, 'economy');
    }
    
    log.debug(` Anthropic: flagship=${result.anthropic.flagship}, standard=${result.anthropic.standard}`);
  }
  
  // Cache result
  cachedDiscovery = result;
  cacheTimestamp = Date.now();
  
  return result;
}

/**
 * Получить оптимальную конфигурацию агентов на основе доступных моделей
 */
export function getOptimalAgentModels(discovery: DiscoveryResult): Record<string, { provider: 'openai' | 'anthropic'; model: string }> {
  return {
    // Research - нужна глубина анализа → Flagship Anthropic (Opus)
    research: {
      provider: 'anthropic',
      model: discovery.anthropic.flagship,
    },
    // Implementation - нужна скорость и код → Flagship OpenAI (GPT-5.2)
    implementation: {
      provider: 'openai',
      model: discovery.openai.flagship,
    },
    // Architecture - системное мышление → Flagship OpenAI
    architecture: {
      provider: 'openai',
      model: discovery.openai.flagship,
    },
    // Security - критичен для безопасности → Flagship Anthropic (Opus)
    security: {
      provider: 'anthropic',
      model: discovery.anthropic.flagship,
    },
    // Testing - генерация тестов → Standard OpenAI
    testing: {
      provider: 'openai',
      model: discovery.openai.standard,
    },
    // Performance - оптимизация → Standard Anthropic
    performance: {
      provider: 'anthropic',
      model: discovery.anthropic.standard,
    },
    // TechSafety - критичен для рисков → Flagship Anthropic (Opus)
    techsafety: {
      provider: 'anthropic',
      model: discovery.anthropic.flagship,
    },
  };
}

/**
 * Очистить кэш (для тестирования)
 */
export function clearModelCache(): void {
  cachedDiscovery = null;
  cacheTimestamp = 0;
}
