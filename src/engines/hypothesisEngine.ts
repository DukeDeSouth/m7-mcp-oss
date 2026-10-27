export interface Symptom {
  type: 'performance' | 'behavior' | 'visual' | 'error';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: any;
}

export interface Hypothesis {
  id: string;
  title: string;
  description: string;
  category: 'state' | 'props' | 'effect' | 'memo' | 'context' | 'external';
  confidence: number;
  testable: boolean;
  suggestedFix?: string;
  experiments: Experiment[];
}

export interface Experiment {
  id: string;
  type: 'code' | 'console' | 'devtools' | 'performance';
  description: string;
  code?: string;
  expectedResult: string;
  actualResult?: string;
  validates?: boolean;
}

export interface ValidationResult {
  hypothesis: Hypothesis;
  validated: boolean;
  evidence: string[];
  confidence: number;
  experiments: Experiment[];
}

export class HypothesisEngine {
  private knownPatterns = [
    {
      symptoms: ['infinite loop', 'multiple renders', 'performance'],
      hypotheses: [
        {
          category: 'effect' as const,
          title: 'Missing useEffect dependencies',
          description: 'useEffect is missing dependencies causing it to run on every render',
          confidence: 0.8,
          experiments: [
            {
              type: 'code' as const,
              description: 'Add exhaustive deps to useEffect',
              code: 'useEffect(() => { ... }, [dep1, dep2, ...])',
              expectedResult: 'Renders should decrease significantly'
            }
          ]
        },
        {
          category: 'state' as const,
          title: 'setState in render',
          description: 'State is being updated during render phase',
          confidence: 0.7,
          experiments: [
            {
              type: 'console' as const,
              description: 'Add console.log before setState calls',
              code: 'log.debug("Setting state", newValue); setState(newValue);',
              expectedResult: 'Console logs appear multiple times per render'
            }
          ]
        },
        {
          category: 'props' as const,
          title: 'Parent creating new objects/arrays',
          description: 'Parent component creates new object/array references on each render',
          confidence: 0.9,
          experiments: [
            {
              type: 'code' as const,
              description: 'Memoize object/array props in parent',
              code: 'const memoizedData = useMemo(() => ({ ...data }), [data]);',
              expectedResult: 'Child component renders should decrease'
            }
          ]
        }
      ]
    },
    {
      symptoms: ['props changing', 'unnecessary renders'],
      hypotheses: [
        {
          category: 'memo' as const,
          title: 'Missing React.memo',
          description: 'Component re-renders when parent renders even with same props',
          confidence: 0.6,
          experiments: [
            {
              type: 'code' as const,
              description: 'Wrap component in React.memo',
              code: 'export default React.memo(Component);',
              expectedResult: 'Component only renders when props actually change'
            }
          ]
        },
        {
          category: 'props' as const,
          title: 'Inline function props',
          description: 'Functions are defined inline in JSX',
          confidence: 0.8,
          experiments: [
            {
              type: 'code' as const,
              description: 'Use useCallback for function props',
              code: 'const handleClick = useCallback(() => {...}, [deps]);',
              expectedResult: 'Function reference remains stable'
            }
          ]
        }
      ]
    },
    {
      symptoms: ['context', 'global state', 'many components rendering'],
      hypotheses: [
        {
          category: 'context' as const,
          title: 'Context value changing reference',
          description: 'Context provider value is a new object on each render',
          confidence: 0.85,
          experiments: [
            {
              type: 'code' as const,
              description: 'Memoize context value',
              code: 'const contextValue = useMemo(() => ({ state, dispatch }), [state]);',
              expectedResult: 'Only components using changed values re-render'
            }
          ]
        }
      ]
    }
  ];

  generateHypotheses(symptoms: Symptom[]): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];
    const symptomDescriptions = symptoms.map(s => s.description.toLowerCase());

    // Match symptoms to known patterns
    this.knownPatterns.forEach(pattern => {
      const matchScore = pattern.symptoms.filter(patternSymptom =>
        symptomDescriptions.some(desc => desc.includes(patternSymptom))
      ).length / pattern.symptoms.length;

      if (matchScore > 0.5) {
        pattern.hypotheses.forEach(hyp => {
          hypotheses.push({
            id: `hyp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...hyp,
            confidence: hyp.confidence * matchScore,
            testable: true,
            experiments: hyp.experiments.map(exp => ({
              id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              ...exp
            }))
          });
        });
      }
    });

    // Generate dynamic hypotheses based on specific symptoms
    if (symptomDescriptions.some(desc => desc.includes('185') || desc.includes('loop'))) {
      hypotheses.push(this.generateLoopHypothesis(symptoms));
    }

    // Sort by confidence
    return hypotheses.sort((a, b) => b.confidence - a.confidence);
  }

  private generateLoopHypothesis(symptoms: Symptom[]): Hypothesis {
    const renderCount = this.extractRenderCount(symptoms);
    
    return {
      id: `hyp_loop_${Date.now()}`,
      title: `Render loop detected (${renderCount} renders)`,
      description: `Component is rendering ${renderCount} times, indicating a state/props update cycle`,
      category: 'effect',
      confidence: 0.95,
      testable: true,
      suggestedFix: `
1. Check useEffect dependencies
2. Look for setState calls in render or effects
3. Verify parent isn't creating new objects/functions
4. Use React DevTools Profiler to trace updates`,
      experiments: [
        {
          id: `exp_trace_${Date.now()}`,
          type: 'devtools',
          description: 'Use React DevTools to trace what triggers re-renders',
          expectedResult: 'Identify specific prop/state causing updates'
        },
        {
          id: `exp_log_${Date.now()}`,
          type: 'console',
          description: 'Add render counter and log props/state',
          code: `
const renderCount = useRef(0);
useEffect(() => {
  renderCount.current++;
  log.debug('Render #', renderCount.current, { props, state });
});`,
          expectedResult: 'See which values change between renders'
        }
      ]
    };
  }

  private extractRenderCount(symptoms: Symptom[]): number {
    for (const symptom of symptoms) {
      const match = symptom.description.match(/(\d+)\s*(?:times|renders|loops)/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return 0;
  }

  async validateHypothesis(hypothesis: Hypothesis, experimentResults: Map<string, any>): Promise<ValidationResult> {
    const validatedExperiments = hypothesis.experiments.map(exp => {
      const result = experimentResults.get(exp.id);
      return {
        ...exp,
        actualResult: result?.output || 'Not tested',
        validates: result ? this.checkExperimentResult(exp, result) : undefined
      };
    });

    const validationScore = validatedExperiments.filter(exp => exp.validates === true).length / validatedExperiments.length;
    const evidence: string[] = [];

    validatedExperiments.forEach(exp => {
      if (exp.validates === true) {
        evidence.push(`✅ ${exp.description}: ${exp.actualResult}`);
      } else if (exp.validates === false) {
        evidence.push(`❌ ${exp.description}: Expected "${exp.expectedResult}" but got "${exp.actualResult}"`);
      }
    });

    return {
      hypothesis,
      validated: validationScore > 0.7,
      evidence,
      confidence: hypothesis.confidence * validationScore,
      experiments: validatedExperiments
    };
  }

  private checkExperimentResult(experiment: Experiment, result: any): boolean {
    // Simple validation - in real implementation would be more sophisticated
    if (experiment.type === 'performance') {
      return result.improved === true;
    }
    
    if (experiment.expectedResult.includes('decrease')) {
      return result.decreased === true;
    }
    
    if (experiment.expectedResult.includes('stable')) {
      return result.stable === true;
    }
    
    return result.success === true;
  }

  rankByProbability(results: ValidationResult[]): Array<{hypothesis: Hypothesis, probability: number}> {
    return results
      .map(result => ({
        hypothesis: result.hypothesis,
        probability: result.validated ? result.confidence : result.confidence * 0.3
      }))
      .sort((a, b) => b.probability - a.probability);
  }

  suggestNextExperiment(validationResults: ValidationResult[]): Experiment | null {
    // Find untested experiments from validated hypotheses
    for (const result of validationResults) {
      if (result.validated) {
        const untestedExp = result.experiments.find(exp => exp.validates === undefined);
        if (untestedExp) {
          return untestedExp;
        }
      }
    }

    // Find experiments from high-confidence unvalidated hypotheses
    const highConfidence = validationResults
      .filter(r => !r.validated && r.confidence > 0.6)
      .sort((a, b) => b.confidence - a.confidence);

    for (const result of highConfidence) {
      const untestedExp = result.experiments.find(exp => exp.validates === undefined);
      if (untestedExp) {
        return untestedExp;
      }
    }

    return null;
  }

  generateFixSuggestion(validatedHypothesis: Hypothesis): string {
    if (validatedHypothesis.suggestedFix) {
      return validatedHypothesis.suggestedFix;
    }

    const fixes: Record<string, string> = {
      'effect': `
// Fix useEffect dependencies
useEffect(() => {
  // Your effect code
}, [/* Add all dependencies here */]);

// Or disable if intentional
useEffect(() => {
  // Your effect code
}, []); // eslint-disable-line react-hooks/exhaustive-deps`,
      
      'props': `
// Memoize object/array props
const memoizedData = useMemo(() => ({
  // your data
}), [/* dependencies */]);

// Memoize callback functions  
const handleClick = useCallback(() => {
  // handler code
}, [/* dependencies */]);`,
      
      'state': `
// Avoid setting state during render
// Move setState to useEffect or event handlers

// Bad:
if (someCondition) {
  setState(newValue); // Causes infinite loop
}

// Good:
useEffect(() => {
  if (someCondition) {
    setState(newValue);
  }
}, [someCondition]);`,
      
      'memo': `
// Use React.memo to prevent unnecessary renders
export default React.memo(YourComponent, (prevProps, nextProps) => {
  // Return true if props are equal (skip render)
  // Return false if props changed (do render)
  return prevProps.id === nextProps.id;
});`,
      
      'context': `
// Memoize context value to prevent unnecessary renders
const contextValue = useMemo(() => ({
  state,
  dispatch,
  // other values
}), [state]); // Only recreate when state changes

<MyContext.Provider value={contextValue}>
  {children}
</MyContext.Provider>`,
      
      'external': `
// Check external dependencies and API calls
// Ensure they're not triggering unnecessary updates`
    };

    return fixes[validatedHypothesis.category] || 'No specific fix available';
  }
} 