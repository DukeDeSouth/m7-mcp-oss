/**
 * One-shot worker for restart tests: runs the steps given as argv[2] (JSON) in a
 * fresh process bound to CURSOR_WORKSPACE, drains shutdown contributors, prints
 * one result line, exits. Not a test file (not matched by tests/*.test.mjs).
 */

import { readFile, writeFile, truncate, stat } from 'node:fs/promises';
import path from 'node:path';

const MARKER = '@@DEEPSCAN_RESULT@@';
const DIST = path.resolve(import.meta.dirname, '..', '..', 'dist');
const dir = process.env.CURSOR_WORKSPACE;

const load = rel => import(path.join(DIST, rel));

function resolveRefs(value, results) {
  if (typeof value === 'string') {
    const m = /^\$(\d+)\.(\w+)$/.exec(value);
    return m ? results[Number(m[1])]?.[m[2]] : value;
  }
  if (Array.isArray(value)) return value.map(v => resolveRefs(v, results));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  }
  return value;
}

function recordView(r) {
  if (!r) return { found: false };
  return {
    found: true,
    id: r.id,
    level: r.level,
    confidence: r.confidence,
    source: r.source,
    invalidatedAt: r.invalidatedAt ? String(r.invalidatedAt) : null,
    content: r.content,
  };
}

let memoryCore;
async function core() {
  if (!memoryCore) {
    const { getMemoryCore } = await load('memory/auto/unified-memory-core.js');
    memoryCore = await getMemoryCore(dir);
  }
  return memoryCore;
}

let cycleOrch;
async function cycles() {
  if (!cycleOrch) {
    const { CycleOrchestrator } = await load('core/orchestrator/cycleOrchestrator.js');
    cycleOrch = new CycleOrchestrator();
  }
  return cycleOrch;
}

let taskOrch;
async function sessions() {
  if (!taskOrch) {
    const { TaskOrchestrator } = await load('core/orchestrator/taskOrchestrator.js');
    const { registerShutdownContributor } = await load('core/shutdown/flushOnExit.js');
    taskOrch = new TaskOrchestrator({ logFeature: async () => 'feat-id' });
    registerShutdownContributor(() => taskOrch.flushPersist());
  }
  return taskOrch;
}

async function gateIdOf(orch, taskId) {
  const { extractGateInstructionId } = await load('core/orchestrator/controlChannel.js');
  const cur = await orch.getCurrentInstruction(taskId);
  const text = [cur.instruction?.instruction, cur.instruction?.gate?.prompt].filter(Boolean).join('\n');
  return { cur, gateId: extractGateInstructionId(text) };
}

const ops = {
  async 'mem.store'({ content, level = 'L2', confidence, source, contradicts }) {
    const c = await core();
    const opts = { level, source };
    if (confidence !== undefined) opts.confidence = confidence;
    if (contradicts) opts.dependencySpecs = [{ id: contradicts, relationType: 'contradicts' }];
    const r = await c.store(content, opts);
    return recordView(r);
  },
  async 'mem.get'({ id }) {
    return recordView(await (await core()).get(id));
  },
  async 'mem.storeMany'({ count, prefix = 'bulk', level = 'L2' }) {
    const c = await core();
    for (let i = 0; i < count; i++) await c.store(`${prefix} record ${i} ${'m'.repeat(40)}`, { level });
    return { stored: count };
  },
  async 'mem.delete'({ id }) {
    return { deleted: await (await core()).delete(id) };
  },
  async 'mem.invalidate'({ id, factor = 0.3 }) {
    const r = await (await core()).invalidate(id, factor);
    return { ok: r.ok, reason: r.reason ?? null };
  },
  async 'mem.search'({ query, levels, minConfidence }) {
    const hits = await (await core()).cascadeSearch(query, { levels, minConfidence });
    return { hits: hits.map(h => ({ id: h.record.id, level: h.record.level, confidence: h.record.confidence })) };
  },
  async 'mem.tool'({ args }) {
    const { unifiedMemoryTool } = await load('core/tools/unified/memoryTool.js');
    const res = await unifiedMemoryTool.handler(args);
    return { text: res.content.map(c => c.text).join('\n'), isError: Boolean(res.isError) };
  },
  async 'ms.roundtrip'({ key }) {
    const { MemorySystem } = await load('memory/memorySystem.js');
    const ms = new MemorySystem(dir);
    await ms.ensureLoaded();
    const loaded = (await ms.list('longterm')).length;
    await ms.store(key, { added: true }, 'longterm');
    await ms.shutdown();
    return { loaded };
  },
  async 'cycle.start'({ description }) {
    const r = await (await cycles()).startCycle(description);
    return { taskId: r.taskId };
  },
  async 'cycle.submit'({ taskId, content }) {
    const r = await (await cycles()).submitArtifact(taskId, content);
    return { success: r.success, error: r.error ?? null };
  },
  async 'cycle.reflect'({ taskId, decision = 'continue' }) {
    const orch = await cycles();
    const { gateId } = await gateIdOf(orch, taskId);
    const body = JSON.stringify({ gate_instruction_id: gateId, decision, change_detected: false, summary: 'ok', confidence: 0.9 });
    const r = await orch.submitReflection(taskId, `\`\`\`json\n${body}\n\`\`\``);
    return { success: r.success, error: r.error ?? null };
  },
  async 'cycle.get'({ taskId }) {
    const orch = await cycles();
    const { cur, gateId } = await gateIdOf(orch, taskId);
    return { success: cur.success, error: cur.error ?? null, phase: cur.instruction?.phase?.name ?? null, gateId };
  },
  async 'cycle.state'({ taskId }) {
    const st = await (await cycles()).getState(taskId);
    if (!st) return { found: false };
    return {
      found: true,
      status: st.status,
      currentPhase: st.currentPhase,
      completedPhases: st.completedPhases,
      awaitingReflection: st.awaitingReflection,
      reflections: st.reflections.length,
    };
  },
  async 'session.start'({ description, route = 'light' }) {
    const s = await (await sessions()).startTask(description, route);
    return { id: s.id, currentPhase: s.currentPhase };
  },
  async 'session.complete'({ id, force = false, notes }) {
    const ok = await (await sessions()).completeSession(id, notes, { force });
    return { ok };
  },
  async 'session.status'({ id }) {
    const orch = await sessions();
    await orch.checkCanProceedToCode(id).catch(() => {}); // public path that awaits the session load
    const s = orch.getSessionStatus(id);
    if (!s) return { found: false };
    return {
      found: true,
      currentPhase: s.currentPhase,
      forcedCompletion: s.forcedCompletion ?? null,
      lastError: s.lastError ?? null,
    };
  },
  async 'fs.truncateHalf'({ file }) {
    const abs = path.join(dir, file);
    const { size } = await stat(abs);
    await truncate(abs, Math.floor(size / 2));
    return { size };
  },
  async 'fs.read'({ file }) {
    return { text: await readFile(path.join(dir, file), 'utf8') };
  },
  async 'fs.write'({ file, text }) {
    await writeFile(path.join(dir, file), text);
    return {};
  },
};

const steps = JSON.parse(process.argv[2] ?? '[]');
const results = [];
let output;
try {
  for (const step of steps) {
    const fn = ops[step.op];
    if (!fn) throw new Error(`unknown op ${step.op}`);
    results.push(await fn(resolveRefs(step.params ?? {}, results)));
  }
  const { flushAllWithTimeout } = await load('core/shutdown/flushOnExit.js');
  const flush = await flushAllWithTimeout();
  output = { results, flush };
} catch (err) {
  output = { error: err?.message ?? String(err), stack: err?.stack, results };
}
process.stdout.write(`\n${MARKER}${JSON.stringify(output)}\n`, () => process.exit(0));
