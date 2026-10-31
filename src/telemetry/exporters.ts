/**
 * M7 Training Data Exporters v3.13
 * Converts local gold data (.m7/cycles, hive-learning) into training-ready JSONL
 * 
 * Output format: one JSON object per line, suitable for SFT fine-tuning
 * Schema: { type, instruction, response, metadata }
 * 
 * @module telemetry/exporters
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createLogger } from '../core/utils/logger.js';
import { getProjectPath } from '../core/utils/projectPath.js';

const log = createLogger('[Exporters]');

const GLOBAL_M7_DIR = join(homedir(), '.m7');

/**
 * Find .m7 directory — check the active project first, then global (~/.m7)
 */
function findM7Dir(): string {
  const projectM7 = join(getProjectPath(), '.m7');
  if (existsSync(projectM7)) return projectM7;
  return GLOBAL_M7_DIR;
}

function getCyclesDir(m7Dir?: string): string {
  return join(m7Dir || findM7Dir(), 'cycles');
}

function getHiveLearningFile(m7Dir?: string): string {
  return join(m7Dir || findM7Dir(), 'hive-learning.jsonl');
}

function getTrainingDir(m7Dir?: string): string {
  return join(m7Dir || findM7Dir(), 'training');
}

// =========================================
// Training sample interfaces
// =========================================

interface TrainingSample {
  /** Sample type for filtering */
  type: 'cycle_trajectory' | 'cycle_phase' | 'hive_expert' | 'hive_synthesis';
  /** Instruction / prompt for the model */
  instruction: string;
  /** Expected response / completion */
  response: string;
  /** Metadata for filtering, stratification, quality control */
  metadata: {
    source: 'local_cycles' | 'local_hive' | 'telemetry_server' | 'mammoth_pr';
    source_file: string;
    task_id?: string;
    phase?: string;
    tool_name?: string;
    model_used?: string;
    confidence?: number;
    difficulty?: 'low' | 'medium' | 'high' | 'expert';
    domain?: string;
    timestamp?: string;
    schema_version: number;
  };
}

// =========================================
// Cycle exporter
// =========================================

interface CycleData {
  taskId: string;
  taskSlug?: string;
  taskDescription: string;
  currentPhase: string;
  completedPhases: string[];
  artifacts: Record<string, string | null>;
  startedAt: string;
  lastUpdatedAt: string;
  taskFraming: string;
  reflections: any[];
}

/**
 * Export M7 cycles to training JSONL.
 * Each cycle produces:
 *   1. Full trajectory sample (task → all phase artifacts)
 *   2. Per-phase samples (phase instruction → phase artifact)
 */
export function exportCycles(m7Dir?: string): { samples: TrainingSample[]; errors: string[] } {
  const samples: TrainingSample[] = [];
  const errors: string[] = [];
  const cyclesDir = getCyclesDir(m7Dir);

  if (!existsSync(cyclesDir)) {
    return { samples, errors: ['Cycles directory not found: ' + cyclesDir] };
  }

  const cycleFiles = readdirSync(cyclesDir).filter(f => f.endsWith('.json') && !f.includes('REFLECTION'));

  for (const file of cycleFiles) {
    try {
      const filePath = join(cyclesDir, file);
      const raw = readFileSync(filePath, 'utf-8');
      const cycle: CycleData = JSON.parse(raw);

      if (!cycle.taskDescription || !cycle.artifacts) continue;

      // Determine difficulty from task description heuristics
      const difficulty = guessDifficulty(cycle.taskDescription);

      // 1. Full trajectory: task description → all completed artifacts
      const completedArtifacts = Object.entries(cycle.artifacts)
        .filter(([_, v]) => v && typeof v === 'string' && v.length > 20)
        .map(([phase, content]) => `## ${phase.toUpperCase()}\n${content}`)
        .join('\n\n---\n\n');

      if (completedArtifacts.length > 50) {
        samples.push({
          type: 'cycle_trajectory',
          instruction: `You are an M7 AI coding assistant following the M7 methodology. Solve this task through the full M7 cycle (intake → discovery → architecture → solution → impact → simulation → implementation).\n\nTask: ${cycle.taskDescription}`,
          response: completedArtifacts,
          metadata: {
            source: 'local_cycles',
            source_file: file,
            task_id: cycle.taskId,
            difficulty,
            timestamp: cycle.startedAt,
            schema_version: 2,
          },
        });
      }

      // 2. Per-phase samples
      for (const [phase, content] of Object.entries(cycle.artifacts)) {
        if (!content || typeof content !== 'string' || content.length < 20) continue;

        const phaseInstruction = getPhaseInstruction(phase, cycle.taskDescription, cycle.taskFraming);

        samples.push({
          type: 'cycle_phase',
          instruction: phaseInstruction,
          response: content,
          metadata: {
            source: 'local_cycles',
            source_file: file,
            task_id: cycle.taskId,
            phase,
            difficulty,
            timestamp: cycle.startedAt,
            schema_version: 2,
          },
        });
      }
    } catch (err) {
      errors.push(`Error processing ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { samples, errors };
}

// =========================================
// Hive learning exporter
// =========================================

interface HiveLearningEntry {
  id: string;
  timestamp: string;
  task: string;
  agent: {
    id: string;
    role: string;
    expertise: string;
    focus: string;
    perspective?: string;
    domain?: string;
  };
  model: string;
  provider?: string;
  responsePreview: string;
  tokensUsed: number;
  latencyMs: number;
  wasUsedInFinal: boolean;
}

/**
 * Export Hive learning data to training JSONL.
 * Each entry produces an expert response sample.
 */
export function exportHiveLearning(m7Dir?: string): { samples: TrainingSample[]; errors: string[] } {
  const samples: TrainingSample[] = [];
  const errors: string[] = [];
  const hiveLearningFile = getHiveLearningFile(m7Dir);

  if (!existsSync(hiveLearningFile)) {
    return { samples, errors: ['Hive learning file not found: ' + hiveLearningFile] };
  }

  const lines = readFileSync(hiveLearningFile, 'utf-8').split('\n').filter(l => l.trim());

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry: HiveLearningEntry = JSON.parse(lines[i]);
      
      if (!entry.task || !entry.responsePreview || entry.responsePreview.length < 50) continue;

      const instruction = `You are a ${entry.agent.role} with expertise in: ${entry.agent.expertise}.\n\nYour focus: ${entry.agent.focus}\n\nTask: ${entry.task}`;

      samples.push({
        type: 'hive_expert',
        instruction,
        response: entry.responsePreview,
        metadata: {
          source: 'local_hive',
          source_file: basename(hiveLearningFile),
          tool_name: 'mcp_m7_hive_coordinator',
          model_used: entry.model,
          domain: entry.agent.domain,
          timestamp: entry.timestamp,
          schema_version: 2,
        },
      });
    } catch (err) {
      errors.push(`Error on hive-learning line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { samples, errors };
}

// =========================================
// Full export pipeline
// =========================================

export interface ExportResult {
  outputPath: string;
  totalSamples: number;
  byType: Record<string, number>;
  errors: string[];
}

/**
 * Export all local gold data to a single training JSONL file.
 */
export function exportAllToJSONL(outputPath?: string, m7Dir?: string): ExportResult {
  const resolvedM7Dir = m7Dir || findM7Dir();
  const outPath = outputPath || join(getTrainingDir(resolvedM7Dir), `training_${new Date().toISOString().slice(0, 10)}.jsonl`);

  // Ensure output directory exists
  const outDir = join(outPath, '..');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const allSamples: TrainingSample[] = [];
  const allErrors: string[] = [];

  // Export cycles
  const cycleResult = exportCycles(resolvedM7Dir);
  allSamples.push(...cycleResult.samples);
  allErrors.push(...cycleResult.errors);

  // Export hive learning
  const hiveResult = exportHiveLearning(resolvedM7Dir);
  allSamples.push(...hiveResult.samples);
  allErrors.push(...hiveResult.errors);

  // Write JSONL
  const jsonlContent = allSamples.map(s => JSON.stringify(s)).join('\n');
  writeFileSync(outPath, jsonlContent + '\n', 'utf-8');

  // Count by type
  const byType: Record<string, number> = {};
  for (const s of allSamples) {
    byType[s.type] = (byType[s.type] || 0) + 1;
  }

  log.info(`Exported ${allSamples.length} training samples to ${outPath}`);
  if (allErrors.length > 0) {
    log.warn(`${allErrors.length} errors during export`);
  }

  return {
    outputPath: outPath,
    totalSamples: allSamples.length,
    byType,
    errors: allErrors,
  };
}

// =========================================
// Helpers
// =========================================

function guessDifficulty(description: string): 'low' | 'medium' | 'high' | 'expert' {
  const lower = description.toLowerCase();
  if (lower.includes('next.js') || lower.includes('typescript') || lower.includes('webpack') || lower.includes('rust')) {
    return 'expert';
  }
  if (lower.includes('fix') && (lower.includes('bug') || lower.includes('#'))) {
    return 'high';
  }
  if (lower.includes('refactor') || lower.includes('redesign') || lower.includes('implement')) {
    return 'medium';
  }
  return 'low';
}

function getPhaseInstruction(phase: string, taskDescription: string, taskFraming: string): string {
  const context = taskFraming || taskDescription;

  switch (phase) {
    case 'intake':
      return `You are performing the INTAKE phase of the M7 methodology. Formulate the task, define context, success criteria, constraints, and open questions.\n\nTask: ${context}`;
    case 'discovery':
      return `You are performing the DISCOVERY phase of the M7 methodology. Research the codebase, find relevant files, understand current state, identify root cause.\n\nTask: ${context}`;
    case 'architecture':
      return `You are performing the ARCHITECTURE phase of the M7 methodology. Map the current system architecture relevant to this task, identify modification points and dependencies.\n\nTask: ${context}`;
    case 'solution':
      return `You are performing the SOLUTION phase of the M7 methodology. Design a concrete implementation plan with specific code changes.\n\nTask: ${context}`;
    case 'impact':
      return `You are performing the IMPACT phase of the M7 methodology. Analyze risks, side effects, and impact of the proposed changes.\n\nTask: ${context}`;
    case 'simulation':
      return `You are performing the SIMULATION phase of the M7 methodology. Simulate the implementation with pseudo-code or dry-run diffs.\n\nTask: ${context}`;
    case 'implementation':
      return `You are performing the IMPLEMENTATION phase of the M7 methodology. Execute the changes and document the results.\n\nTask: ${context}`;
    default:
      return `You are performing the ${phase.toUpperCase()} phase of the M7 methodology.\n\nTask: ${context}`;
  }
}
