/**
 * M7 v3.0 - Dead Code Detection Rule
 * 
 * Detects unused exported code.
 */

import { BaseRule } from './base-rule.js';
import {
  DetectedAntipattern,
  RefactoringSuggestion,
  AntipatternSeverity,
  AntipatternCategory,
  RefactoringType,
  DEFAULT_EXCLUSIONS
} from '../types.js';

/**
 * Dead Code antipattern detector
 * 
 * Dead code includes:
 * - Exported functions never imported
 * - Unused classes
 * - Unreachable code paths
 */
export class DeadCodeRule extends BaseRule {
  // ============================================
  // METADATA
  // ============================================
  
  get id(): string {
    return 'dead-code';
  }
  
  get name(): string {
    return 'Dead Code';
  }
  
  get category(): AntipatternCategory {
    return AntipatternCategory.DEAD_CODE;
  }
  
  get defaultSeverity(): AntipatternSeverity {
    return AntipatternSeverity.MINOR;
  }
  
  get description(): string {
    return 'Exported code that is never imported or used anywhere in the codebase';
  }
  
  // ============================================
  // DETECTION
  // ============================================
  
  detect(): DetectedAntipattern[] {
    const antipatterns: DetectedAntipattern[] = [];
    
    // Use Knowledge Graph's orphan detection
    const orphans = this.graph.findOrphans();
    
    // Filter out false positives
    const realOrphans = orphans.filter(orphan => {
      const node = orphan.node;
      
      // Exclude TypeScript types/interfaces - they may be part of public API
      if (DEFAULT_EXCLUSIONS.orphanExclusions.includes(node.type as any)) {
        return false;
      }
      
      // Exclude index.ts exports - they're public API
      if (this.isPublicApiFile(node.filePath)) {
        return false;
      }
      
      // Exclude test files
      if (this.isTestFile(node.filePath)) {
        return false;
      }
      
      // Exclude files in excluded directories
      if (this.isExcludedDirectory(node.filePath)) {
        return false;
      }
      
      return true;
    });
    
    for (const orphan of realOrphans) {
      const node = orphan.node;
      
      // Calculate confidence based on node type
      let confidence = orphan.confidence;
      
      // Functions are more likely to be true dead code
      if (node.type === 'function') {
        confidence = Math.min(1, confidence + 0.1);
      }
      
      // Classes might have external instantiation
      if (node.type === 'class') {
        confidence = Math.max(0.5, confidence - 0.1);
      }
      
      antipatterns.push(this.createAntipattern({
        target: {
          nodeId: node.id,
          filePath: node.filePath,
          name: node.name,
          lineNumber: node.line
        },
        description: `"${node.name}" is exported but never imported anywhere`,
        evidence: [
          `Type: ${node.type}`,
          `File: ${node.filePath}`,
          `Reason: ${orphan.reason}`,
          'Note: May be used externally (public API) - verify before removing'
        ],
        metrics: {
          nodeType: this.nodeTypeToNumber(node.type)
        },
        confidence
      }));
    }
    
    return this.filterByConfidence(antipatterns);
  }
  
  // ============================================
  // SUGGESTIONS
  // ============================================
  
  suggest(antipattern: DetectedAntipattern): RefactoringSuggestion {
    return this.createSuggestion({
      antipattern,
      type: RefactoringType.DELETE,
      title: `Remove unused "${antipattern.target.name}"`,
      description: 'This code is exported but never imported. If it\'s not part of public API, it can be safely removed.',
      steps: [
        '1. Verify it\'s not used externally (check package.json exports, documentation)',
        '2. Search for dynamic imports or require() calls',
        '3. Check if it\'s referenced in configuration files',
        '4. If unused, remove the export keyword or the entire code',
        '5. If the entire file becomes empty, delete the file',
        '6. Run tests to verify nothing is broken'
      ],
      effort: 'low',
      impact: 'low',
      beforeCode: `// ${antipattern.target.filePath}
export function ${antipattern.target.name}() {
  // This function is never imported
}`,
      afterCode: `// ${antipattern.target.filePath}
// Function removed - was never used

// Or if needed internally:
function ${antipattern.target.name}() {
  // Keep but don't export
}`
    });
  }
  
  // ============================================
  // HELPERS
  // ============================================
  
  private isPublicApiFile(filePath: string): boolean {
    return DEFAULT_EXCLUSIONS.publicApiPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(filePath);
    });
  }
  
  private isTestFile(filePath: string): boolean {
    return DEFAULT_EXCLUSIONS.testPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(filePath);
    });
  }
  
  private isExcludedDirectory(filePath: string): boolean {
    return DEFAULT_EXCLUSIONS.excludeDirectories.some(dir => 
      filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`)
    );
  }
  
  private nodeTypeToNumber(type: string): number {
    const typeMap: Record<string, number> = {
      'function': 1,
      'class': 2,
      'variable': 3,
      'interface': 4,
      'type': 5,
      'enum': 6
    };
    return typeMap[type] ?? 0;
  }
}

