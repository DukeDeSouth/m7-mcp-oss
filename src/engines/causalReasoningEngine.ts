export interface Effect {
  id: string;
  type: string;
  description: string;
  observable: boolean;
  measurable: boolean;
  context: Record<string, any>;
}

export interface Cause {
  id: string;
  type: string;
  description: string;
  probability: number;
  evidence: string[];
}

export interface CausalLink {
  cause: Cause;
  effect: Effect;
  mechanism: string;
  strength: number; // 0-1
  confidence: number; // 0-1
}

export interface CausalChain {
  effects: Effect[];
  causes: Cause[];
  links: CausalLink[];
  rootCause?: Cause;
}

export class CausalReasoningEngine {
  private knowledgeBase: Map<string, CausalPattern> = new Map();

  constructor() {
    this.initializeKnowledgeBase();
  }

  private initializeKnowledgeBase() {
    // Universal causal patterns that apply across domains
    this.addPattern({
      id: 'feedback_loop',
      name: 'Feedback Loop',
      description: 'A causes B, B causes A',
      indicators: ['repeating', 'cycle', 'loop', 'recurring'],
      mechanisms: ['direct_feedback', 'indirect_feedback', 'delayed_feedback']
    });

    this.addPattern({
      id: 'cascade_effect',
      name: 'Cascade Effect',
      description: 'A causes B, B causes C, C causes D...',
      indicators: ['chain reaction', 'domino', 'propagation', 'spread'],
      mechanisms: ['sequential_trigger', 'amplification', 'propagation']
    });

    this.addPattern({
      id: 'resource_contention',
      name: 'Resource Contention',
      description: 'Multiple processes competing for limited resource',
      indicators: ['slow', 'blocked', 'waiting', 'timeout', 'deadlock'],
      mechanisms: ['competition', 'starvation', 'priority_inversion']
    });

    this.addPattern({
      id: 'state_inconsistency',
      name: 'State Inconsistency',
      description: 'Different parts of system have conflicting state',
      indicators: ['mismatch', 'different', 'inconsistent', 'out of sync'],
      mechanisms: ['race_condition', 'cache_invalidation', 'replication_lag']
    });
  }

  private addPattern(pattern: CausalPattern) {
    this.knowledgeBase.set(pattern.id, pattern);
  }

  async analyzeCausality(effect: Effect): Promise<CausalChain> {
    const potentialCauses = await this.identifyPotentialCauses(effect);
    const causalLinks = await this.buildCausalLinks(effect, potentialCauses);
    const chain = await this.traceCausalChain(effect, causalLinks);
    
    return {
      ...chain,
      rootCause: await this.findRootCause(chain)
    };
  }

  private async identifyPotentialCauses(effect: Effect): Promise<Cause[]> {
    const causes: Cause[] = [];
    
    // Match against known patterns
    for (const [_, pattern] of this.knowledgeBase) {
      const matchScore = this.calculatePatternMatch(effect, pattern);
      if (matchScore > 0.5) {
        causes.push(...this.generateCausesFromPattern(effect, pattern, matchScore));
      }
    }

    // Generate domain-specific causes based on context
    if (effect.context) {
      causes.push(...this.generateContextualCauses(effect));
    }

    // Apply temporal analysis
    causes.push(...this.generateTemporalCauses(effect));

    return causes.sort((a, b) => b.probability - a.probability);
  }

  private calculatePatternMatch(effect: Effect, pattern: CausalPattern): number {
    const effectDesc = effect.description.toLowerCase();
    const matches = pattern.indicators.filter(indicator => 
      effectDesc.includes(indicator.toLowerCase())
    ).length;
    
    return matches / pattern.indicators.length;
  }

  private generateCausesFromPattern(
    effect: Effect, 
    pattern: CausalPattern, 
    matchScore: number
  ): Cause[] {
    return pattern.mechanisms.map(mechanism => ({
      id: `cause_${pattern.id}_${mechanism}`,
      type: pattern.name,
      description: `${pattern.name} via ${mechanism.replace(/_/g, ' ')}`,
      probability: matchScore * 0.8,
      evidence: [`Pattern "${pattern.name}" detected with ${(matchScore * 100).toFixed(0)}% confidence`]
    }));
  }

  private generateContextualCauses(effect: Effect): Cause[] {
    const causes: Cause[] = [];
    const context = effect.context;

    // Analyze numerical changes
    Object.entries(context).forEach(([key, value]) => {
      if (typeof value === 'number' && value > 100) {
        causes.push({
          id: `cause_high_${key}`,
          type: 'threshold_exceeded',
          description: `High ${key} value (${value})`,
          probability: 0.7,
          evidence: [`${key} = ${value} exceeds normal range`]
        });
      }
    });

    // Analyze boolean flags
    Object.entries(context).forEach(([key, value]) => {
      if (typeof value === 'boolean' && value === true) {
        causes.push({
          id: `cause_flag_${key}`,
          type: 'flag_enabled',
          description: `${key} is enabled`,
          probability: 0.6,
          evidence: [`${key} flag is true`]
        });
      }
    });

    return causes;
  }

  private generateTemporalCauses(effect: Effect): Cause[] {
    const causes: Cause[] = [];
    
    // Check for timing-related keywords
    const timingKeywords = ['slow', 'fast', 'delay', 'timeout', 'lag', 'latency'];
    const hasTimingIssue = timingKeywords.some(keyword => 
      effect.description.toLowerCase().includes(keyword)
    );

    if (hasTimingIssue) {
      causes.push({
        id: 'cause_timing',
        type: 'timing_issue',
        description: 'Timing or synchronization problem',
        probability: 0.75,
        evidence: ['Description contains timing-related keywords']
      });
    }

    return causes;
  }

  private async buildCausalLinks(
    effect: Effect, 
    causes: Cause[]
  ): Promise<CausalLink[]> {
    return causes.map(cause => ({
      cause,
      effect,
      mechanism: this.inferMechanism(cause, effect),
      strength: this.calculateLinkStrength(cause, effect),
      confidence: cause.probability
    }));
  }

  private inferMechanism(cause: Cause, effect: Effect): string {
    // Infer the mechanism based on cause and effect types
    const mechanisms: Record<string, Record<string, string>> = {
      'feedback_loop': {
        'performance': 'repeated processing amplifies load',
        'behavior': 'action triggers reaction that triggers action',
        'state': 'state change triggers update that changes state'
      },
      'resource_contention': {
        'performance': 'multiple consumers competing for limited resource',
        'behavior': 'conflicting operations block each other',
        'state': 'concurrent updates cause conflicts'
      },
      'timing_issue': {
        'performance': 'synchronization overhead or waiting',
        'behavior': 'race conditions or timeouts',
        'state': 'stale data or missed updates'
      }
    };

    const causeType = cause.type.toLowerCase();
    const effectType = effect.type.toLowerCase();
    
    return mechanisms[causeType]?.[effectType] || 
           `${cause.type} leads to ${effect.type}`;
  }

  private calculateLinkStrength(cause: Cause, effect: Effect): number {
    // Calculate how strongly the cause is linked to the effect
    let strength = cause.probability;

    // Boost strength if cause and effect share context
    if (cause.evidence.some(e => effect.description.includes(e))) {
      strength *= 1.2;
    }

    // Reduce strength if cause is generic
    if (cause.type.includes('generic') || cause.type.includes('unknown')) {
      strength *= 0.7;
    }

    return Math.min(strength, 1.0);
  }

  private async traceCausalChain(
    initialEffect: Effect,
    initialLinks: CausalLink[]
  ): Promise<CausalChain> {
    const effects = [initialEffect];
    const causes: Cause[] = [];
    const links = [...initialLinks];

    // Trace backwards from effect to causes
    const queue = initialLinks.map(l => l.cause);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const cause = queue.shift()!;
      if (visited.has(cause.id)) continue;
      
      visited.add(cause.id);
      causes.push(cause);

      // Check if this cause is actually an effect of something else
      const causeAsEffect: Effect = {
        id: `effect_${cause.id}`,
        type: cause.type,
        description: cause.description,
        observable: false,
        measurable: false,
        context: {}
      };

      const deeperCauses = await this.identifyPotentialCauses(causeAsEffect);
      if (deeperCauses.length > 0 && deeperCauses[0].probability > 0.6) {
        effects.push(causeAsEffect);
        const newLinks = await this.buildCausalLinks(causeAsEffect, deeperCauses.slice(0, 3));
        links.push(...newLinks);
        queue.push(...newLinks.map(l => l.cause));
      }
    }

    return { effects, causes, links };
  }

  private async findRootCause(chain: CausalChain): Promise<Cause | undefined> {
    // Find the cause with no parent causes
    const causesWithParents = new Set(
      chain.links
        .filter(link => chain.causes.some(c => c.id === link.effect.id))
        .map(link => link.cause.id)
    );

    const rootCauses = chain.causes.filter(c => !causesWithParents.has(c.id));
    
    // Return the most probable root cause
    return rootCauses.sort((a, b) => b.probability - a.probability)[0];
  }

  async predictEffects(change: CodeChange): Promise<PredictedEffect[]> {
    const predictions: PredictedEffect[] = [];

    // Analyze what the change modifies
    const modificationAnalysis = this.analyzeModification(change);

    // For each modification, predict potential effects
    for (const mod of modificationAnalysis) {
      const effects = this.predictModificationEffects(mod);
      predictions.push(...effects);
    }

    // Check for interaction effects
    if (modificationAnalysis.length > 1) {
      const interactions = this.predictInteractionEffects(modificationAnalysis);
      predictions.push(...interactions);
    }

    return predictions.sort((a, b) => b.probability - a.probability);
  }

  private analyzeModification(change: CodeChange): Modification[] {
    // This would analyze the actual code change
    // For now, returning a simplified version
    return [{
      type: 'function_change',
      target: change.file,
      scope: 'local',
      impacts: ['behavior', 'performance']
    }];
  }

  private predictModificationEffects(mod: Modification): PredictedEffect[] {
    const effects: PredictedEffect[] = [];

    if (mod.impacts.includes('behavior')) {
      effects.push({
        id: `effect_behavior_${mod.target}`,
        type: 'behavior_change',
        description: `Behavior change in ${mod.target}`,
        probability: 0.8,
        severity: 'medium',
        scope: mod.scope
      });
    }

    if (mod.impacts.includes('performance')) {
      effects.push({
        id: `effect_performance_${mod.target}`,
        type: 'performance_impact',
        description: `Potential performance impact in ${mod.target}`,
        probability: 0.6,
        severity: 'low',
        scope: mod.scope
      });
    }

    return effects;
  }

  private predictInteractionEffects(mods: Modification[]): PredictedEffect[] {
    // Predict effects from multiple modifications interacting
    return [{
      id: 'effect_interaction',
      type: 'interaction_effect',
      description: 'Multiple changes may interact',
      probability: 0.5,
      severity: 'medium',
      scope: 'global'
    }];
  }

  generateCausalDiagram(chain: CausalChain): string {
    let mermaid = 'graph TD\n';
    
    // Add effects
    chain.effects.forEach(effect => {
      mermaid += `  E${effect.id}["${effect.type}: ${effect.description.substring(0, 30)}..."]\n`;
    });

    // Add causes
    chain.causes.forEach(cause => {
      const style = cause === chain.rootCause ? ':::rootCause' : '';
      mermaid += `  C${cause.id}["${cause.type}: ${cause.description.substring(0, 30)}..."]${style}\n`;
    });

    // Add links
    chain.links.forEach(link => {
      const label = `${(link.strength * 100).toFixed(0)}%`;
      mermaid += `  C${link.cause.id} -->|${label}| E${link.effect.id}\n`;
    });

    // Add style
    mermaid += '\n  classDef rootCause fill:#f96,stroke:#333,stroke-width:4px;\n';

    return mermaid;
  }
}

// Types used by the engine
interface CausalPattern {
  id: string;
  name: string;
  description: string;
  indicators: string[];
  mechanisms: string[];
}

interface CodeChange {
  file: string;
  type: 'add' | 'modify' | 'delete';
  content: string;
  lines: { start: number; end: number };
}

interface Modification {
  type: string;
  target: string;
  scope: 'local' | 'module' | 'global';
  impacts: string[];
}

interface PredictedEffect {
  id: string;
  type: string;
  description: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  scope: string;
} 