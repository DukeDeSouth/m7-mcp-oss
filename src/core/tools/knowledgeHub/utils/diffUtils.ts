/**
 * Diff Utilities for Knowledge Hub
 * Smart comparison between document versions
 */

import { DocumentDiff, Change, DiffSummary } from '../types.js';

/**
 * Generate diff between two versions of content
 */
export function generateDiff(
  documentId: string,
  oldVersion: string,
  newVersion: string,
  oldContent: string,
  newContent: string
): DocumentDiff {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  const changes = computeChanges(oldLines, newLines);
  const summary = computeSummary(changes);
  
  return {
    document_id: documentId,
    old_version: oldVersion,
    new_version: newVersion,
    changes,
    summary
  };
}

/**
 * Compute changes between two arrays of lines
 * Uses a simple LCS-based algorithm
 */
function computeChanges(oldLines: string[], newLines: string[]): Change[] {
  const changes: Change[] = [];
  const lcs = longestCommonSubsequence(oldLines, newLines);
  
  let oldIndex = 0;
  let newIndex = 0;
  let lcsIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    // Check if we're at an LCS element
    if (
      lcsIndex < lcs.length &&
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === lcs[lcsIndex] &&
      newLines[newIndex] === lcs[lcsIndex]
    ) {
      // Lines match, move forward
      oldIndex++;
      newIndex++;
      lcsIndex++;
    } else if (
      oldIndex < oldLines.length &&
      (lcsIndex >= lcs.length || oldLines[oldIndex] !== lcs[lcsIndex])
    ) {
      // Line removed
      changes.push({
        type: 'remove',
        line_number: oldIndex + 1,
        old_content: oldLines[oldIndex]
      });
      oldIndex++;
    } else if (
      newIndex < newLines.length &&
      (lcsIndex >= lcs.length || newLines[newIndex] !== lcs[lcsIndex])
    ) {
      // Line added
      changes.push({
        type: 'add',
        line_number: newIndex + 1,
        new_content: newLines[newIndex]
      });
      newIndex++;
    }
  }
  
  return changes;
}

/**
 * Longest Common Subsequence algorithm
 */
function longestCommonSubsequence(arr1: string[], arr2: string[]): string[] {
  const m = arr1.length;
  const n = arr2.length;
  
  // Build LCS matrix
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;
  
  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return lcs;
}

/**
 * Compute summary statistics from changes
 */
function computeSummary(changes: Change[]): DiffSummary {
  let linesAdded = 0;
  let linesRemoved = 0;
  let linesModified = 0;
  const sectionsAffected: string[] = [];
  
  // Count changes by type
  for (const change of changes) {
    switch (change.type) {
      case 'add':
        linesAdded++;
        break;
      case 'remove':
        linesRemoved++;
        break;
      case 'modify':
        linesModified++;
        break;
    }
    
    // Detect section changes (lines starting with #)
    const content = change.old_content || change.new_content || '';
    if (content.trim().startsWith('#')) {
      const section = content.trim().replace(/^#+\s*/, '');
      if (!sectionsAffected.includes(section)) {
        sectionsAffected.push(section);
      }
    }
  }
  
  return {
    lines_added: linesAdded,
    lines_removed: linesRemoved,
    lines_modified: linesModified,
    sections_affected: sectionsAffected
  };
}

/**
 * Format diff as readable text
 */
export function formatDiff(diff: DocumentDiff): string {
  let output = `# Diff: ${diff.document_id}\n\n`;
  output += `**From:** v${diff.old_version} → **To:** v${diff.new_version}\n\n`;
  output += `## Summary\n\n`;
  output += `- ✅ Added: ${diff.summary.lines_added} lines\n`;
  output += `- ❌ Removed: ${diff.summary.lines_removed} lines\n`;
  output += `- 🔄 Modified: ${diff.summary.lines_modified} lines\n\n`;
  
  if (diff.summary.sections_affected.length > 0) {
    output += `**Affected Sections:**\n`;
    for (const section of diff.summary.sections_affected) {
      output += `- ${section}\n`;
    }
    output += `\n`;
  }
  
  output += `## Changes\n\n`;
  output += `\`\`\`diff\n`;
  
  for (const change of diff.changes) {
    switch (change.type) {
      case 'add':
        output += `+ ${change.new_content}\n`;
        break;
      case 'remove':
        output += `- ${change.old_content}\n`;
        break;
      case 'modify':
        output += `- ${change.old_content}\n`;
        output += `+ ${change.new_content}\n`;
        break;
    }
  }
  
  output += `\`\`\`\n`;
  
  return output;
}

/**
 * Check if two contents are significantly different
 */
export function hasSignificantChanges(
  oldContent: string,
  newContent: string,
  threshold: number = 0.05 // 5% change threshold
): boolean {
  if (oldContent === newContent) {
    return false;
  }
  
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  const changes = computeChanges(oldLines, newLines);
  const totalLines = Math.max(oldLines.length, newLines.length);
  
  if (totalLines === 0) return false;
  
  const changeRatio = changes.length / totalLines;
  return changeRatio >= threshold;
}

/**
 * Get diff statistics
 */
export function getDiffStats(oldContent: string, newContent: string): {
  old_lines: number;
  new_lines: number;
  changes: number;
  change_percentage: number;
} {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const changes = computeChanges(oldLines, newLines);
  
  const totalLines = Math.max(oldLines.length, newLines.length);
  const changePercentage = totalLines > 0 ? (changes.length / totalLines) * 100 : 0;
  
  return {
    old_lines: oldLines.length,
    new_lines: newLines.length,
    changes: changes.length,
    change_percentage: Math.round(changePercentage * 100) / 100
  };
}

