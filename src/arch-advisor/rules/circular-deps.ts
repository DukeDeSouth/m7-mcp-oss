/**
 * M7 v3.0 - Circular Dependencies Detection Rule
 * 
 * Detects circular dependencies between modules.
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
 * Circular Dependencies antipattern detector
 * 
 * Circular dependencies (A→B→C→A) create:
 * - Hard to understand code
 * - Difficult testing
 * - Initialization issues
 * - Bundle/build problems
 */
export class CircularDepsRule extends BaseRule {
  // ============================================
  // METADATA
  // ============================================
  
  get id(): string {
    return 'circular-dependency';
  }
  
  get name(): string {
    return 'Circular Dependency';
  }
  
  get category(): AntipatternCategory {
    return AntipatternCategory.COUPLING;
  }
  
  get defaultSeverity(): AntipatternSeverity {
    return AntipatternSeverity.CRITICAL;
  }
  
  get description(): string {
    return 'Circular dependency between modules that creates tight coupling and initialization problems';
  }
  
  // ============================================
  // DETECTION
  // ============================================
  
  detect(): DetectedAntipattern[] {
    const antipatterns: DetectedAntipattern[] = [];
    
    // Use Knowledge Graph's built-in cycle detection
    const cycles = this.graph.detectCycles({ maxCycles: 100 });
    
    // Track which cycles we've already reported (by first node)
    const reportedCycleStarts = new Set<string>();
    
    for (const cycle of cycles) {
      // Skip if we've already reported a cycle starting from any node in this cycle
      const cycleKey = cycle.nodes.map(n => n.id).sort().join('|');
      if (reportedCycleStarts.has(cycleKey)) continue;
      reportedCycleStarts.add(cycleKey);
      
      const firstNode = cycle.nodes[0];
      const cycleNames = cycle.nodes.map(n => n.name);
      const cycleFiles = new Set(cycle.nodes.map(n => n.filePath));
      
      // Longer cycles are worse
      const severity = cycle.nodes.length > 3 
        ? AntipatternSeverity.CRITICAL 
        : AntipatternSeverity.MAJOR;
      
      antipatterns.push(this.createAntipattern({
        target: {
          nodeId: firstNode.id,
          filePath: firstNode.filePath,
          name: firstNode.name,
          lineNumber: firstNode.line
        },
        description: `Circular dependency: ${cycleNames.join(' → ')} → ${cycleNames[0]}`,
        evidence: [
          `Cycle length: ${cycle.nodes.length} nodes`,
          `Files involved: ${cycleFiles.size}`,
          ...cycle.nodes.map(n => `  • ${n.name} (${n.filePath})`)
        ],
        metrics: {
          cycleLength: cycle.nodes.length,
          filesInvolved: cycleFiles.size
        },
        confidence: 1.0, // Cycles are always certain
        severityOverride: severity
      }));
    }
    
    return antipatterns;
  }
  
  // ============================================
  // SUGGESTIONS
  // ============================================
  
  suggest(antipattern: DetectedAntipattern): RefactoringSuggestion {
    const cycleLength = antipattern.metrics?.cycleLength ?? 2;
    
    // Different strategies based on cycle length
    if (cycleLength === 2) {
      // Simple A→B→A cycle
      return this.createSuggestion({
        antipattern,
        type: RefactoringType.EXTRACT,
        title: `Break circular dependency in "${antipattern.target.name}"`,
        description: 'Two modules depend on each other. Extract shared code to a third module.',
        steps: [
          '1. Identify what each module needs from the other',
          '2. Create a new "shared" or "common" module',
          '3. Move the shared types/interfaces/functions there',
          '4. Update both modules to import from the shared module',
          '5. Remove the direct circular imports'
        ],
        effort: 'medium',
        impact: 'high',
        beforeCode: `// module-a.ts
import { B } from './module-b';
export interface A { b: B; }

// module-b.ts
import { A } from './module-a';
export interface B { a: A; }`,
        afterCode: `// shared.ts
export interface SharedBase { id: string; }

// module-a.ts
import { SharedBase } from './shared';
export interface A extends SharedBase { }

// module-b.ts
import { SharedBase } from './shared';
export interface B extends SharedBase { }`
      });
    }
    
    // Longer cycles
    return this.createSuggestion({
      antipattern,
      type: RefactoringType.EXTRACT,
      title: `Break ${cycleLength}-way circular dependency`,
      description: 'Multiple modules form a dependency cycle. Restructure to use dependency injection or event-based communication.',
      steps: [
        '1. Map the full dependency cycle',
        '2. Identify the "core" types that all modules need',
        '3. Extract core types to a base module with no dependencies',
        '4. Consider using dependency injection',
        '5. Consider using an event bus for loose coupling',
        '6. Refactor each module to depend only on abstractions'
      ],
      effort: 'high',
      impact: 'high',
      beforeCode: `// Circular: A → B → C → A
import { B } from './b';
import { C } from './c';
import { A } from './a';`,
      afterCode: `// Dependency Injection Pattern
interface IB { }
interface IC { }

class A {
  constructor(
    private b: IB,
    private c: IC
  ) {}
}

// Wire up in composition root`
    });
  }
}

