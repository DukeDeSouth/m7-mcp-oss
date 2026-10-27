/**
 * M7 v3.0 - God Object Detection Rule
 * 
 * Detects classes/modules with too many responsibilities.
 */

import { BaseRule } from './base-rule.js';
import {
  DetectedAntipattern,
  RefactoringSuggestion,
  AntipatternSeverity,
  AntipatternCategory,
  RefactoringType
} from '../types.js';

/**
 * God Object antipattern detector
 * 
 * A "God Object" is a class that knows too much or does too much.
 * Signs include:
 * - Too many methods/properties
 * - Too many dependencies
 * - Too many dependents
 * - Too many lines of code
 */
export class GodObjectRule extends BaseRule {
  // ============================================
  // METADATA
  // ============================================
  
  get id(): string {
    return 'god-object';
  }
  
  get name(): string {
    return 'God Object';
  }
  
  get category(): AntipatternCategory {
    return AntipatternCategory.COHESION;
  }
  
  get defaultSeverity(): AntipatternSeverity {
    return AntipatternSeverity.MAJOR;
  }
  
  get description(): string {
    return 'Class or module with too many responsibilities, violating Single Responsibility Principle';
  }
  
  // ============================================
  // DETECTION
  // ============================================
  
  detect(): DetectedAntipattern[] {
    const antipatterns: DetectedAntipattern[] = [];
    
    // Get all classes from the graph
    const classes = this.graph.queryNodes({ type: 'class' });
    
    for (const cls of classes) {
      const deps = this.graph.getDependencies(cls.id);
      const dependents = this.graph.getDependents(cls.id);
      const totalConnections = deps.length + dependents.length;
      
      // Check if it exceeds the threshold
      if (totalConnections > this.thresholds.godObjectConnections) {
        const confidence = this.calculateConfidence(
          totalConnections,
          this.thresholds.godObjectConnections,
          3 // Max multiplier for full confidence
        );
        
        // Determine severity based on connection count
        let severity = this.defaultSeverity;
        if (totalConnections > this.thresholds.godObjectConnections * 2) {
          severity = AntipatternSeverity.CRITICAL;
        }
        
        antipatterns.push(this.createAntipattern({
          target: {
            nodeId: cls.id,
            filePath: cls.filePath,
            name: cls.name,
            lineNumber: cls.line
          },
          description: `Class "${cls.name}" has ${totalConnections} connections (threshold: ${this.thresholds.godObjectConnections})`,
          evidence: [
            `Dependencies: ${deps.length} (what this class uses)`,
            `Dependents: ${dependents.length} (what uses this class)`,
            `Total connections: ${totalConnections}`,
            `File: ${cls.filePath}`
          ],
          metrics: {
            dependencies: deps.length,
            dependents: dependents.length,
            totalConnections,
            threshold: this.thresholds.godObjectConnections
          },
          confidence,
          severityOverride: severity
        }));
      }
    }
    
    // Also check modules (files) for too many exports
    const modules = this.graph.queryNodes({ type: 'module' });
    
    for (const mod of modules) {
      // Get all nodes in this file
      const nodesInFile = this.graph.getNodesByFile(mod.filePath);
      const exportCount = nodesInFile.filter(n => n.metadata?.exported).length;
      
      if (exportCount > this.thresholds.godObjectMethods) {
        const confidence = this.calculateConfidence(
          exportCount,
          this.thresholds.godObjectMethods,
          2
        );
        
        antipatterns.push(this.createAntipattern({
          target: {
            nodeId: mod.id,
            filePath: mod.filePath,
            name: mod.name
          },
          description: `Module "${mod.name}" exports ${exportCount} items (threshold: ${this.thresholds.godObjectMethods})`,
          evidence: [
            `Exports: ${exportCount}`,
            `File: ${mod.filePath}`,
            'Consider splitting into smaller modules'
          ],
          metrics: {
            exportCount,
            threshold: this.thresholds.godObjectMethods
          },
          confidence
        }));
      }
    }
    
    return this.filterByConfidence(antipatterns);
  }
  
  // ============================================
  // SUGGESTIONS
  // ============================================
  
  suggest(antipattern: DetectedAntipattern): RefactoringSuggestion {
    const isModule = antipattern.target.nodeId.includes('module');
    
    if (isModule) {
      return this.createSuggestion({
        antipattern,
        type: RefactoringType.SPLIT,
        title: `Split module "${antipattern.target.name}" into smaller modules`,
        description: 'This module has too many exports. Each module should have a clear, single responsibility.',
        steps: [
          '1. Identify groups of related exports',
          '2. Create new files for each group',
          '3. Move related exports to their new files',
          '4. Update the main index.ts to re-export from new modules',
          '5. Update imports in dependent files'
        ],
        effort: 'medium',
        impact: 'high',
        beforeCode: `// ${antipattern.target.name}
export function funcA() { }
export function funcB() { }
export function funcC() { }
// ... ${antipattern.metrics?.exportCount} exports`,
        afterCode: `// ${antipattern.target.name}/index.ts
export * from './group-a';
export * from './group-b';

// group-a.ts
export function funcA() { }
export function funcB() { }

// group-b.ts
export function funcC() { }`
      });
    }
    
    return this.createSuggestion({
      antipattern,
      type: RefactoringType.SPLIT,
      title: `Split class "${antipattern.target.name}" into smaller classes`,
      description: 'This class has too many responsibilities. Apply Single Responsibility Principle.',
      steps: [
        '1. Identify distinct responsibilities (e.g., data access, business logic, utilities)',
        '2. Group related methods and properties for each responsibility',
        '3. Create new classes for each group',
        '4. Use composition or dependency injection to wire them together',
        '5. Update all usages to use the new classes'
      ],
      effort: 'high',
      impact: 'high',
      beforeCode: `class ${antipattern.target.name} {
  // ${antipattern.metrics?.totalConnections} connections
  methodA() { }
  methodB() { }
  methodC() { }
  // ... many more methods
}`,
      afterCode: `// Split by responsibility
class ${antipattern.target.name}Core {
  constructor(
    private helper: ${antipattern.target.name}Helper,
    private service: ${antipattern.target.name}Service
  ) {}
}

class ${antipattern.target.name}Helper {
  methodA() { }
}

class ${antipattern.target.name}Service {
  methodB() { }
}`
    });
  }
}

