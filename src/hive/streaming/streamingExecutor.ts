import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[StreamingExecutor]');

/**
 * M7 Hive - Streaming Executor
 * 
 * Enables streaming for long-running agent tasks.
 * Shows progress in real-time via callbacks.
 * 
 * @version 3.9.0
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Progress callback for streaming
 */
export type StreamProgressCallback = (chunk: string, totalChars: number) => void;

/**
 * Streaming execution options
 */
export interface StreamingOptions {
  onProgress?: StreamProgressCallback;
  onStart?: () => void;
  onComplete?: (totalChars: number, durationMs: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Streaming execution result
 */
export interface StreamingResult {
  output: string;
  tokens: number;
  durationMs: number;
  chunksReceived: number;
}

/**
 * Execute OpenAI request with streaming
 */
export async function executeOpenAIStreaming(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: StreamingOptions = {}
): Promise<StreamingResult> {
  const startTime = Date.now();
  let output = '';
  let chunksReceived = 0;
  
  options.onStart?.();
  
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 4096,
      stream: true
    });
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        output += content;
        chunksReceived++;
        options.onProgress?.(content, output.length);
        
        // Log progress every 500 chars
        if (output.length % 500 < content.length) {
          log.debug(`[Streaming] 📡 ${output.length} chars received...`);
        }
      }
    }
    
    const durationMs = Date.now() - startTime;
    
    // Estimate tokens (actual usage not available in streaming)
    const tokens = Math.ceil(output.length / 4) + Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    
    options.onComplete?.(output.length, durationMs);
    log.debug(`[Streaming] ✅ OpenAI complete: ${output.length} chars in ${durationMs}ms`);
    
    return { output, tokens, durationMs, chunksReceived };
    
  } catch (error: any) {
    options.onError?.(error);
    throw error;
  }
}

/**
 * Execute Anthropic request with streaming
 */
export async function executeAnthropicStreaming(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: StreamingOptions = {}
): Promise<StreamingResult> {
  const startTime = Date.now();
  let output = '';
  let chunksReceived = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  
  options.onStart?.();
  
  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    
    stream.on('text', (text) => {
      output += text;
      chunksReceived++;
      options.onProgress?.(text, output.length);
      
      // Log progress every 500 chars
      if (output.length % 500 < text.length) {
        log.debug(`[Streaming] 📡 ${output.length} chars received...`);
      }
    });
    
    // Wait for completion
    const finalMessage = await stream.finalMessage();
    
    inputTokens = finalMessage.usage.input_tokens;
    outputTokens = finalMessage.usage.output_tokens;
    
    const durationMs = Date.now() - startTime;
    const tokens = inputTokens + outputTokens;
    
    options.onComplete?.(output.length, durationMs);
    log.debug(`[Streaming] ✅ Anthropic complete: ${output.length} chars, ${tokens} tokens in ${durationMs}ms`);
    
    return { output, tokens, durationMs, chunksReceived };
    
  } catch (error: any) {
    options.onError?.(error);
    throw error;
  }
}

/**
 * Smart executor - uses streaming for expected long tasks
 */
export async function executeWithSmartStreaming(
  openaiClient: OpenAI,
  anthropicClient: Anthropic,
  provider: 'openai' | 'anthropic',
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: StreamingOptions & { forceStreaming?: boolean } = {}
): Promise<StreamingResult> {
  // Estimate if task is long (based on prompt length)
  const promptLength = systemPrompt.length + userPrompt.length;
  const isLongTask = promptLength > 2000 || options.forceStreaming;
  
  if (isLongTask) {
    log.debug(`[Streaming] 🚀 Using streaming mode (prompt: ${promptLength} chars)`);
    
    if (provider === 'anthropic') {
      return executeAnthropicStreaming(anthropicClient, model, systemPrompt, userPrompt, options);
    } else {
      return executeOpenAIStreaming(openaiClient, model, systemPrompt, userPrompt, options);
    }
  }
  
  // Fall back to non-streaming for short tasks
  log.debug(`[Streaming] ⚡ Using direct mode (prompt: ${promptLength} chars)`);
  
  const startTime = Date.now();
  let output: string;
  let tokens: number;
  
  if (provider === 'anthropic') {
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    output = response.content[0].type === 'text' ? response.content[0].text : '';
    tokens = response.usage.input_tokens + response.usage.output_tokens;
  } else {
    const response = await openaiClient.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 4096
    });
    output = response.choices[0].message.content || '';
    tokens = response.usage?.total_tokens || 0;
  }
  
  const durationMs = Date.now() - startTime;
  
  return { output, tokens, durationMs, chunksReceived: 1 };
}
