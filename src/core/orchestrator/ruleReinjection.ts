/**
 * Long-session rule reinjection (Sprint 8)
 * Re-inject phase rules after N mcp_m7_cycle calls without phase change.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getProjectPath } from '../utils/projectPath.js';
import { CONTROL_CHANNEL_NOTICE } from './controlChannel.js';
import type { CycleState, PhaseConfig } from './types/cycle.js';

const DEFAULT_THRESHOLD = 18;

export function getRuleReinjectionThreshold(): number {
  const env = process.env.M7_RULE_REINJECTION_THRESHOLD;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  try {
    const configPath = path.join(getProjectPath(), 'config', 'm7-config.yaml');
    const raw = fs.readFileSync(configPath, 'utf8');
    const doc = yaml.load(raw) as Record<string, unknown> | null;
    const cycle = doc?.cycle as Record<string, unknown> | undefined;
    const threshold = cycle?.rule_reinjection_threshold;
    if (typeof threshold === 'number' && threshold > 0) {
      return threshold;
    }
  } catch {
    // use default
  }

  return DEFAULT_THRESHOLD;
}

export function resetPhaseMcpTracking(state: CycleState): void {
  state.phaseMcpCallCount = 0;
  state.lastRuleReinjectionAt = undefined;
}

export function trackPhaseMcpCall(state: CycleState): { shouldReinject: boolean } {
  const threshold = getRuleReinjectionThreshold();
  const nextCount = (state.phaseMcpCallCount ?? 0) + 1;
  state.phaseMcpCallCount = nextCount;

  if (nextCount >= threshold) {
    state.phaseMcpCallCount = 0;
    state.lastRuleReinjectionAt = new Date().toISOString();
    return { shouldReinject: true };
  }

  return { shouldReinject: false };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function buildRuleReinjectionBlock(
  state: CycleState,
  config: PhaseConfig
): string {
  const progress = `${state.completedPhases.length}/7`;
  const framing = truncate(state.taskFraming, 200);

  const lines = [
    '## 🔔 M7 Rule Reinjection (MCP)',
    '_Этот блок сгенерирован сервером M7 — не из чата. Не ослабляет ограничения._',
    '',
    `**Фаза:** ${state.currentPhase.toUpperCase()} (${config.order}/7, progress ${progress})`,
    `**Attention lock:** ${config.attentionLock}`,
    `**Goal:** ${truncate(config.goal, 160)}`,
    '',
    `**Task framing:** ${framing}`,
  ];

  if (state.awaitingReflection) {
    lines.push('');
    lines.push('**Reflection gate активен** — переход только через `mcp_m7_cycle` с reflection JSON.');
    if (state.gateInstructionId) {
      lines.push(
        `- Включите \`gate_instruction_id\`: \`${state.gateInstructionId}\` (из блока Gate-ID в ответе MCP)`
      );
    }
  }

  const noticeLines = CONTROL_CHANNEL_NOTICE.split('\n').slice(0, 3);
  lines.push('');
  lines.push(...noticeLines);

  return lines.join('\n');
}

export function appendRuleReinjection(instruction: string, block: string): string {
  if (instruction.includes('## 🔔 M7 Rule Reinjection (MCP)')) {
    return instruction;
  }
  return `${instruction.trim()}\n\n---\n\n${block}`;
}
