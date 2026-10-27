export type TaskRoute = 'light' | 'medium' | 'heavy' | 'decompose';

export type ComplexityLevel = 'trivial' | 'simple' | 'moderate' | 'complex' | 'very-complex';

export interface ComplexityFactor {
  name: string;
  weight: number;
  value: number;
}

export interface Certainty {
  level: number;
  reasoning: string;
}

export interface Risk {
  description: string;
  severity: 'critical' | 'major' | 'minor';
  mitigation?: string;
}

export interface CodeModRequest {
  file: string;
  action: 'implementation' | 'code_change' | 'file_edit';
  linesAdded?: number;
  linesRemoved?: number;
  type?: 'create' | 'modify' | 'delete';
  isBreaking?: boolean;
} 