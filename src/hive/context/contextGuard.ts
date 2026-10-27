/**
 * M7 v3.10 Context Window Guard
 * 
 * Prevents context window overflow by monitoring token usage
 * and automatically truncating content when necessary.
 * 
 * Features:
 * - Approximate token counting (4 chars ≈ 1 token)
 * - Multiple truncation strategies
 * - Model-aware limits
 * - Smart content prioritization
 * 
 * @version 3.10.0
 * @date 2026-02-06
 */

import { createLogger } from '../../core/utils/logger.js';
import {
  ModelLimits,
  TruncationStrategy,
  TruncationConfig,
  ContextAnalysis,
  ContextSection,
  ContextGuardResult,
  ContextGuardConfig,
  MODEL_LIMITS,
  DEFAULT_MODEL_LIMITS,
  DEFAULT_TRUNCATION_CONFIG,
  DEFAULT_CONTEXT_GUARD_CONFIG,
} from './types.js';

const log = createLogger('[ContextGuard]');

// ============================================
// TOKEN COUNTING
// ============================================

/**
 * Estimate token count for a string.
 * Uses approximation: ~4 characters per token (GPT-style tokenization).
 * This is accurate enough for buffer calculations without external dependencies.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Base estimation: 4 chars ≈ 1 token
  let tokens = Math.ceil(text.length / 4);
  
  // Adjustments for special content:
  // - Code tends to have more tokens per character
  const codeBlockMatches = text.match(/```[\s\S]*?```/g) || [];
  for (const block of codeBlockMatches) {
    // Code is denser: ~3 chars per token
    tokens += Math.ceil(block.length / 12); // Add ~25% more for code
  }
  
  // - URLs and special chars use more tokens
  const urlMatches = text.match(/https?:\/\/[^\s]+/g) || [];
  tokens += urlMatches.length * 5; // URLs typically use more tokens
  
  // - Newlines and whitespace
  const newlineCount = (text.match(/\n/g) || []).length;
  tokens += Math.ceil(newlineCount / 4);
  
  return tokens;
}

/**
 * Get model limits for a given model name.
 */
export function getModelLimits(model: string): ModelLimits {
  // Try exact match first
  if (MODEL_LIMITS[model]) {
    return MODEL_LIMITS[model];
  }
  
  // Try prefix match (e.g., "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, limits] of Object.entries(MODEL_LIMITS)) {
    if (model.startsWith(key)) {
      return limits;
    }
  }
  
  // Default for unknown models
  log.warn(`Unknown model "${model}", using default limits`);
  return { ...DEFAULT_MODEL_LIMITS, model };
}

// ============================================
// CONTEXT ANALYSIS
// ============================================

/**
 * Analyze context content and return detailed metrics.
 */
export function analyzeContext(
  content: string,
  model: string,
  systemPrompt?: string
): ContextAnalysis {
  const limits = getModelLimits(model);
  
  const totalTokens = estimateTokens(content);
  const systemPromptTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;
  
  // Estimate code tokens
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  const codeContent = codeBlocks.join('');
  const codeTokens = estimateTokens(codeContent);
  
  // User vs assistant message estimation (rough)
  const userMessageTokens = Math.ceil(totalTokens * 0.6);
  const assistantTokens = Math.ceil(totalTokens * 0.4) - systemPromptTokens;
  
  const isWithinLimits = totalTokens <= limits.safeInputLimit;
  const tokensOverLimit = Math.max(0, totalTokens - limits.safeInputLimit);
  const utilizationPercent = Math.round((totalTokens / limits.safeInputLimit) * 100);
  const responseHeadroom = limits.maxContextTokens - totalTokens - limits.maxOutputTokens;
  
  return {
    totalTokens,
    systemPromptTokens,
    userMessageTokens: Math.max(0, userMessageTokens),
    assistantTokens: Math.max(0, assistantTokens),
    codeTokens,
    model,
    limits,
    isWithinLimits,
    tokensOverLimit,
    utilizationPercent,
    responseHeadroom: Math.max(0, responseHeadroom),
  };
}

// ============================================
// CONTENT SECTIONING
// ============================================

/**
 * Split content into sections for smart truncation.
 */
export function sectionizeContent(
  content: string,
  systemPrompt?: string
): ContextSection[] {
  const sections: ContextSection[] = [];
  
  // System prompt (highest priority, never truncate)
  if (systemPrompt) {
    sections.push({
      type: 'system',
      content: systemPrompt,
      tokens: estimateTokens(systemPrompt),
      canTruncate: false,
      priority: 0,
    });
  }
  
  // Split content into parts
  const parts = content.split(/(?=```)|(?<=```[^\n]*\n[\s\S]*?```)/);
  
  for (const part of parts) {
    if (!part.trim()) continue;
    
    const isCode = part.startsWith('```');
    const tokens = estimateTokens(part);
    
    if (isCode) {
      sections.push({
        type: 'code',
        content: part,
        tokens,
        canTruncate: true,
        priority: 2, // Code is important but can be truncated
      });
    } else {
      // Determine if it's context, user message, or other
      const isContext = part.includes('Context:') || 
                        part.includes('File:') || 
                        part.includes('Current state:');
      
      sections.push({
        type: isContext ? 'context' : 'user',
        content: part,
        tokens,
        canTruncate: true,
        priority: isContext ? 3 : 1, // Context is less critical than user message
      });
    }
  }
  
  return sections;
}

// ============================================
// TRUNCATION STRATEGIES
// ============================================

/**
 * Truncate from the beginning (keep tail).
 * Best for: chat history where recent messages matter more.
 */
function truncateTail(
  content: string,
  targetTokens: number,
  config: TruncationConfig
): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= targetTokens) return content;
  
  const tokensToRemove = currentTokens - targetTokens;
  const charsToRemove = tokensToRemove * 4; // Approximate
  
  // Keep tail, remove from head
  const truncated = content.substring(charsToRemove);
  
  if (config.addMarker) {
    return config.markerText + truncated;
  }
  
  return truncated;
}

/**
 * Truncate from the end (keep head).
 * Best for: documents where beginning is most important.
 */
function truncateHead(
  content: string,
  targetTokens: number,
  config: TruncationConfig
): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= targetTokens) return content;
  
  const charsToKeep = targetTokens * 4; // Approximate
  
  const truncated = content.substring(0, charsToKeep);
  
  if (config.addMarker) {
    return truncated + config.markerText;
  }
  
  return truncated;
}

/**
 * Truncate from the middle (keep head and tail).
 * Best for: preserving context from beginning and end.
 */
function truncateMiddle(
  content: string,
  targetTokens: number,
  config: TruncationConfig
): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= targetTokens) return content;
  
  const headTokens = Math.max(config.minHeadTokens, Math.floor(targetTokens * 0.4));
  const tailTokens = Math.max(config.minTailTokens, Math.floor(targetTokens * 0.6));
  
  const headChars = headTokens * 4;
  const tailChars = tailTokens * 4;
  
  const head = content.substring(0, headChars);
  const tail = content.substring(content.length - tailChars);
  
  if (config.addMarker) {
    return head + config.markerText + tail;
  }
  
  return head + '\n\n' + tail;
}

/**
 * Smart truncation based on content analysis.
 * Removes low-priority content first.
 */
function truncateSmart(
  content: string,
  targetTokens: number,
  config: TruncationConfig,
  systemPrompt?: string
): string {
  const sections = sectionizeContent(content, systemPrompt);
  
  // Sort by priority (higher number = can be removed first)
  const sortedSections = [...sections].sort((a, b) => b.priority - a.priority);
  
  let currentTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  const removedSections: Set<ContextSection> = new Set();
  
  // Remove sections until we're under target
  for (const section of sortedSections) {
    if (currentTokens <= targetTokens) break;
    if (!section.canTruncate) continue;
    
    removedSections.add(section);
    currentTokens -= section.tokens;
  }
  
  // Reconstruct content without removed sections
  const keptSections = sections.filter(s => !removedSections.has(s));
  let result = keptSections.map(s => s.content).join('\n\n');
  
  // If still over limit, fall back to middle truncation
  if (estimateTokens(result) > targetTokens) {
    result = truncateMiddle(result, targetTokens, config);
  }
  
  if (config.addMarker && removedSections.size > 0) {
    const removedCount = removedSections.size;
    const removedTokens = [...removedSections].reduce((sum, s) => sum + s.tokens, 0);
    result = `[${removedCount} sections (~${removedTokens} tokens) truncated]\n\n` + result;
  }
  
  return result;
}

// ============================================
// MAIN GUARD FUNCTION
// ============================================

/**
 * Apply context guard to content.
 * Returns truncated content if necessary, along with analysis.
 */
export function guardContext(
  content: string,
  model: string,
  options: {
    systemPrompt?: string;
    config?: Partial<ContextGuardConfig>;
    truncationConfig?: Partial<TruncationConfig>;
  } = {}
): ContextGuardResult {
  const config = { ...DEFAULT_CONTEXT_GUARD_CONFIG, ...options.config };
  const truncConfig = { 
    ...DEFAULT_TRUNCATION_CONFIG, 
    ...config.truncation,
    ...options.truncationConfig 
  };
  
  const analysis = analyzeContext(content, model, options.systemPrompt);
  const warnings: string[] = [];
  
  // Set target tokens based on model if not specified
  if (!truncConfig.targetTokens) {
    truncConfig.targetTokens = analysis.limits.safeInputLimit;
  }
  
  // Check if truncation is needed
  if (analysis.isWithinLimits && analysis.utilizationPercent < config.errorThreshold) {
    // Log warning if approaching limit
    if (analysis.utilizationPercent >= config.warningThreshold && config.logUsage) {
      const msg = `Context at ${analysis.utilizationPercent}% capacity ` +
                  `(${analysis.totalTokens}/${analysis.limits.safeInputLimit} tokens)`;
      log.warn(msg);
      warnings.push(msg);
    }
    
    return {
      truncated: false,
      originalTokens: analysis.totalTokens,
      finalTokens: analysis.totalTokens,
      tokensRemoved: 0,
      strategy: truncConfig.strategy,
      content,
      warnings,
      analysis,
    };
  }
  
  // Truncation needed
  if (!config.autoTruncate) {
    const errorMsg = `Context overflow: ${analysis.totalTokens} tokens exceeds ` +
                     `limit of ${analysis.limits.safeInputLimit} (auto-truncate disabled)`;
    log.error(errorMsg);
    warnings.push(errorMsg);
    
    return {
      truncated: false,
      originalTokens: analysis.totalTokens,
      finalTokens: analysis.totalTokens,
      tokensRemoved: 0,
      strategy: truncConfig.strategy,
      content,
      warnings,
      analysis,
    };
  }
  
  // Apply truncation strategy
  log.warn(
    `Truncating context: ${analysis.totalTokens} → ${truncConfig.targetTokens} tokens ` +
    `(strategy: ${truncConfig.strategy})`
  );
  
  let truncatedContent: string;
  
  switch (truncConfig.strategy) {
    case 'tail':
      truncatedContent = truncateTail(content, truncConfig.targetTokens, truncConfig);
      break;
    case 'head':
      truncatedContent = truncateHead(content, truncConfig.targetTokens, truncConfig);
      break;
    case 'middle':
      truncatedContent = truncateMiddle(content, truncConfig.targetTokens, truncConfig);
      break;
    case 'smart':
      truncatedContent = truncateSmart(
        content, 
        truncConfig.targetTokens, 
        truncConfig,
        options.systemPrompt
      );
      break;
    case 'summarize':
      // Summarize requires LLM call - fall back to smart for now
      log.warn('Summarize strategy not implemented, using smart truncation');
      truncatedContent = truncateSmart(
        content, 
        truncConfig.targetTokens, 
        truncConfig,
        options.systemPrompt
      );
      break;
    default:
      truncatedContent = truncateMiddle(content, truncConfig.targetTokens, truncConfig);
  }
  
  const finalTokens = estimateTokens(truncatedContent);
  const tokensRemoved = analysis.totalTokens - finalTokens;
  
  warnings.push(
    `Truncated ${tokensRemoved} tokens (${truncConfig.strategy} strategy)`
  );
  
  if (config.logUsage) {
    log.info(
      `Context truncated: ${analysis.totalTokens} → ${finalTokens} tokens ` +
      `(-${tokensRemoved}, ${Math.round((tokensRemoved / analysis.totalTokens) * 100)}%)`
    );
  }
  
  return {
    truncated: true,
    originalTokens: analysis.totalTokens,
    finalTokens,
    tokensRemoved,
    strategy: truncConfig.strategy,
    content: truncatedContent,
    warnings,
    analysis,
  };
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Quick check if content fits within model limits.
 */
export function fitsInContext(content: string, model: string): boolean {
  const analysis = analyzeContext(content, model);
  return analysis.isWithinLimits;
}

/**
 * Get remaining token capacity for a model.
 */
export function getRemainingCapacity(
  content: string, 
  model: string
): { remaining: number; percentUsed: number } {
  const analysis = analyzeContext(content, model);
  return {
    remaining: Math.max(0, analysis.limits.safeInputLimit - analysis.totalTokens),
    percentUsed: analysis.utilizationPercent,
  };
}

/**
 * Format context analysis for logging.
 */
export function formatAnalysis(analysis: ContextAnalysis): string {
  return [
    `Context Analysis (${analysis.model}):`,
    `  Total: ${analysis.totalTokens} tokens (${analysis.utilizationPercent}% used)`,
    `  Limit: ${analysis.limits.safeInputLimit} (safe) / ${analysis.limits.maxContextTokens} (max)`,
    `  Status: ${analysis.isWithinLimits ? '✅ OK' : '❌ OVER LIMIT'}`,
    analysis.tokensOverLimit > 0 ? `  Over by: ${analysis.tokensOverLimit} tokens` : '',
    `  Response headroom: ${analysis.responseHeadroom} tokens`,
  ].filter(Boolean).join('\n');
}

// ============================================
// EXPORTS
// ============================================

export { ContextGuardConfig, ContextAnalysis, ContextGuardResult, TruncationStrategy };
