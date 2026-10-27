/**
 * M7 Hive - Context Builder
 * 
 * Builds markdown-formatted code context for prompt injection.
 * 
 * @version 3.8.0
 */

import { RelevantFile, CodeContext, EMPTY_CODE_CONTEXT } from './types.js';

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build formatted code context markdown
 */
export function buildCodeContext(
  files: RelevantFile[],
  keywords: string[],
  searchDurationMs: number,
  maxTokens: number = 4000
): CodeContext {
  
  if (files.length === 0) {
    return {
      ...EMPTY_CODE_CONTEXT,
      keywords,
      searchDurationMs
    };
  }
  
  let markdown = '## 📁 Code Context\n\n';
  markdown += `*Relevant code from project (keywords: ${keywords.slice(0, 5).join(', ')}):*\n\n`;
  
  let totalLines = 0;
  let totalTokens = 0;
  const includedFiles: RelevantFile[] = [];
  
  for (const file of files) {
    const fileTokens = estimateTokens(file.snippet);
    
    // Check if adding this file would exceed token limit
    if (totalTokens + fileTokens > maxTokens && includedFiles.length > 0) {
      markdown += `\n*...${files.length - includedFiles.length} more files omitted (token limit)*\n`;
      break;
    }
    
    // Add file header with line range
    markdown += `### \`${file.relativePath}\``;
    if (file.lines.start > 0) {
      markdown += ` (lines ${file.lines.start}-${file.lines.end})`;
    }
    markdown += `\n`;
    markdown += `*Relevance: ${Math.round(file.relevance * 100)}%*\n\n`;
    
    // Add code block
    markdown += `\`\`\`${file.language}\n`;
    markdown += file.snippet;
    if (!file.snippet.endsWith('\n')) {
      markdown += '\n';
    }
    markdown += `\`\`\`\n\n`;
    
    totalLines += file.snippet.split('\n').length;
    totalTokens += fileTokens;
    includedFiles.push(file);
  }
  
  // Add summary
  markdown += `---\n`;
  markdown += `*${includedFiles.length} files, ${totalLines} lines, ~${totalTokens} tokens*\n`;
  
  return {
    files: includedFiles,
    keywords,
    totalLines,
    totalTokens,
    markdown,
    searchDurationMs
  };
}

/**
 * Build minimal context (just file paths, no content)
 */
export function buildMinimalContext(
  files: RelevantFile[],
  keywords: string[],
  searchDurationMs: number
): CodeContext {
  
  if (files.length === 0) {
    return {
      ...EMPTY_CODE_CONTEXT,
      keywords,
      searchDurationMs
    };
  }
  
  let markdown = '## 📁 Related Files\n\n';
  markdown += `*Files related to: ${keywords.slice(0, 5).join(', ')}*\n\n`;
  
  for (const file of files) {
    markdown += `- \`${file.relativePath}\` (${Math.round(file.relevance * 100)}% relevant)\n`;
  }
  
  return {
    files,
    keywords,
    totalLines: 0,
    totalTokens: estimateTokens(markdown),
    markdown,
    searchDurationMs
  };
}
