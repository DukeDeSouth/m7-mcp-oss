#!/usr/bin/env node
/**
 * Checks that the deep scan suites catch each fix being reverted.
 *
 * For every mutant: run the named test against the current build (must pass),
 * put the old behavior back into one dist/ file, run the test again (must fail),
 * restore the file. Exit code 1 if a mutant survives, a pattern no longer
 * matches the build, or a baseline run fails.
 *
 * Run: npm run build && npm run test:mutants
 *      ONLY=GRAPH npm run test:mutants   (mutants whose id starts with ONLY)
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const ACCEPTANCE = 'tests/deepScanAcceptance.test.mjs';
const E2E = 'tests/deepScanE2E.test.mjs';

const MUTANTS = [
  {
    id: 'CYC-1', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: "return valid.includes(str) ? str : null;", replace: "return valid.includes(str) ? str : 'continue';",
    test: ACCEPTANCE, name: 'unparseable or unknown reflection is rejected',
  },
  {
    id: 'CYC-2', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: 'if (la.sha256 !== this.hashSubmitContent(content)) {',
    replace: 'if (la.phase !== state.currentPhase || la.kind !== kind) { return null; }\n        if (la.sha256 !== this.hashSubmitContent(content)) {',
    test: ACCEPTANCE, name: 'tool retry of an accepted reflection',
  },
  {
    id: 'CYC-3', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: "if (s === 'completed' || s === 'aborted') {\n            return { success: false, error: `Cycle is ${s}` };",
    replace: "if (false) {\n            return { success: false, error: `Cycle is ${s}` };",
    test: ACCEPTANCE, name: 'completed and aborted cycles are terminal',
  },
  {
    id: 'CYC-9', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: "if (status === 'active')\n            return true;", replace: "if (status === 'active')\n            return false;",
    test: ACCEPTANCE, name: 'cleanup only archives terminal cycles',
  },
  {
    id: 'CYC-10 (folder from the id)', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: 'const taskSlug = `${slug}-${suffix}`;', replace: 'const taskSlug = slug;',
    test: ACCEPTANCE, name: 'two cycles with one description → two folders',
  },
  {
    id: 'CYC-10 (exclusive folder)', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: 'await fs.mkdir(artifactsDir);', replace: 'await fs.mkdir(artifactsDir, { recursive: true });',
    test: ACCEPTANCE, name: 'a taken id or folder is never reused',
  },
  {
    id: 'CYC-10 (through the server)', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: 'const taskSlug = `${slug}-${suffix}`;', replace: 'const taskSlug = slug;',
    test: E2E, name: 'each gets its own artifact folder',
  },
  {
    id: 'STATE-5 (load awaited)', file: 'dist/core/tools/critical/contracts.js',
    find: '        await registry.ready();\n        switch (request.action) {', replace: '        switch (request.action) {',
    test: ACCEPTANCE, name: 'function, endpoint, method, class',
  },
  {
    id: 'STATE-5 (stable ids)', file: 'dist/core/tools/critical/contracts.js',
    find: 'id: entry.id || this.generateId(),', replace: 'id: this.generateId(),',
    test: ACCEPTANCE, name: 'function, endpoint, method, class',
  },
  {
    id: 'STATE-5 (failure reported)', file: 'dist/core/tools/critical/contracts.js',
    find: "category: 'runtime'\n            });\n            throw error;", replace: "category: 'runtime'\n            });",
    test: ACCEPTANCE, name: 'no PROJECT_SCHEMA.yaml → register fails',
  },
  {
    id: 'STATE-5 (through the server)', file: 'dist/core/tools/critical/contracts.js',
    find: 'for (const [section, type] of CONTRACT_SECTIONS) {', replace: 'for (const [section, type] of CONTRACT_SECTIONS.slice(0, 1)) {',
    test: E2E, name: 'three kinds registered',
  },
  {
    id: 'STATE-3 (drain on exit)', file: 'dist/index.js',
    find: 'registerShutdownContributor(() => this.orchestrator.flushPersist());', replace: '',
    test: E2E, name: 'session is on disk and visible after restart',
  },
  {
    id: 'STATE-3 (pinned file)', file: 'dist/core/orchestrator/taskOrchestrator.js',
    find: 'return this.sessionsFilePath;', replace: "return path.join(getProjectPath(), '.m7', 'orchestrator-sessions.json');",
    test: ACCEPTANCE, name: 'keeps writing to A',
  },
  {
    id: 'STATE-3 (load race)', file: 'dist/core/tools/unified/sessionTool.js',
    find: 'await orchestrator.ready();\n', replace: '',
    test: ACCEPTANCE, name: 'no race with the async load',
  },
  {
    id: 'STATE-4 (cross-session store)', file: 'dist/cross-session/knowledge-accumulator.js',
    find: "this.basePath = path.join(projectPath, '.m7', 'cross-session');",
    replace: "this.basePath = path.join(process.cwd(), '.m7', 'cross-session');",
    test: ACCEPTANCE, name: 'stored under the project, nothing under cwd',
  },
  {
    id: 'STATE-4 (server cwd ≠ project)', file: 'dist/cross-session/knowledge-accumulator.js',
    find: "this.basePath = path.join(projectPath, '.m7', 'cross-session');",
    replace: "this.basePath = path.join(process.cwd(), '.m7', 'cross-session');",
    test: E2E, name: 'nothing under cwd',
  },
  {
    id: 'STATE-4 (instance per project)', file: 'dist/cross-session/index.js',
    find: 'let instance = instances.get(projectPath);', replace: 'let instance = instances.values().next().value;',
    test: ACCEPTANCE, name: 'one instance per project',
  },
  {
    id: 'STATE-4 (git default dir)', file: 'dist/telemetry/gitCapture.js',
    find: 'cwd: cwd || getProjectPath(),', replace: 'cwd: cwd || process.cwd(),',
    test: ACCEPTANCE, name: 'git capture defaults to the project',
  },
  {
    id: 'MEM-2', file: 'dist/memory/auto/unified-memory-core.js',
    find: 'confidence: data.confidence ?? 0.5,', replace: 'confidence: data.confidence || 0.5,',
    test: ACCEPTANCE, name: 'confidence 0 survives a round trip',
  },
  {
    id: 'MEM-5 (long-term level)', file: 'dist/memory/memorySystem.js',
    find: 'longterm: new Map(),', replace: 'longterm: new BoundedMap(2000),',
    test: ACCEPTANCE, name: 'review trace: first record, then 2000 more',
  },
  {
    id: 'MEM-5 (fog of war)', file: 'dist/memory/memorySystem.js',
    find: 'this.fogOfWar = new Map();', replace: 'this.fogOfWar = new BoundedMap(500);',
    test: ACCEPTANCE, name: 'fog of war: a 600-entry file',
  },
  {
    id: 'MEM-5 (tombstones)', file: 'dist/memory/auto/unified-memory-core.js',
    find: 'const deletedIds = new Set();',
    replace: "const deletedIds = new (await import('../../core/utils/boundedMap.js')).BoundedSet(5000);",
    test: ACCEPTANCE, name: 'tombstones: 5001 on disk',
  },
  {
    id: 'MEM-6', file: 'dist/schema/schemaSystem.js',
    find: '            return this.schema;\n        }',
    replace: "            await (await (await import('../memory/auto/unified-memory-core.js')).getMemoryCore()).store(JSON.stringify(this.schema), { level: 'L2', source: 'code_analysis', contextKeys: ['project', 'schema'], confidence: 1.0 }).catch(() => {});\n            return this.schema;\n        }",
    test: ACCEPTANCE, name: 'three loadSchema() calls',
  },
  {
    id: 'MEM-7 (one write queue)', file: 'dist/memory/memorySystem.js',
    find: 'const run = this.writeChain.then(task);', replace: 'const run = Promise.resolve().then(task);',
    test: ACCEPTANCE, name: '500 stores while the first file write is held',
  },
  {
    id: 'MEM-7 (retired core drained)', file: 'dist/memory/auto/unified-memory-core.js',
    find: 'await Promise.all([memoryCore?.shutdown(), ...retiringCores]);', replace: 'await memoryCore?.shutdown();',
    test: ACCEPTANCE, name: 'a write in project A right before a switch',
  },
  {
    id: 'GRAPH-1', file: 'dist/core/task-graph/taskGraphManager.js',
    find: 'if (seenAt !== undefined && depth <= seenAt)', replace: 'if (seenAt !== undefined)',
    test: ACCEPTANCE, name: 'depth-limited traversal includes every node',
  },
  {
    id: 'GRAPH-2', file: 'dist/core/task-graph/taskGraphManager.js',
    find: 'if (this.graph.nodes[options.id]) {\n            throw new Error(`Task id already exists',
    replace: 'if (false) {\n            throw new Error(`Task id already exists',
    test: ACCEPTANCE, name: 'createTask refuses to overwrite an existing id',
  },
  {
    id: 'GRAPH-3', file: 'dist/core/task-transfer/transferManager.js',
    find: 'await this.graphManager.restoreTask(fromSnapshot);',
    replace: 'await this.graphManager.updateTaskStatus(fromTaskId, fromSnapshot.status);',
    test: ACCEPTANCE, name: 'graph JSON before equals graph JSON after',
  },
  {
    id: 'GATE-2', file: 'dist/core/orchestrator/groundingGate.js',
    find: "if (step.reversibility === 'irreversible'\n            && step.premise_ids.length === 0) {", replace: 'if (false) {',
    test: ACCEPTANCE, name: 'exactly one strong warning',
  },
  {
    id: 'HYG-1 (unicode slug)', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: ".replace(/[^\\p{L}\\p{M}\\p{N}\\s-]/gu, '')", replace: ".replace(/[^a-zа-яё0-9\\s-]/gi, '')",
    test: ACCEPTANCE, name: 'emoji and punctuation-only',
  },
  {
    id: 'HYG-1 (hash fallback)', file: 'dist/core/orchestrator/cycleOrchestrator.js',
    find: "return slug || createHash('sha1').update(description).digest('hex').slice(0, 8);", replace: 'return slug;',
    test: ACCEPTANCE, name: 'emoji and punctuation-only',
  },
  {
    id: 'HYG-2', file: 'dist/hive/cache/taskResultCache.js',
    find: ".replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')", replace: ".replace(/[^\\w\\s]/g, ' ')",
    test: ACCEPTANCE, name: 'hive cache keys keep non-Latin text',
  },
  {
    id: 'HYG-3', file: 'dist/hive/context/fileSearcher.js',
    find: "'-i', '-e', keyword]", replace: "'-i', keyword]",
    test: ACCEPTANCE, name: 'looks like a grep option',
  },
  {
    id: 'HYG-4', file: 'dist/index.js',
    find: "log('  OPENAI_API_KEY: set');", replace: 'log(`  OPENAI_API_KEY: set (${openaiKey.substring(0, 15)}...)`);',
    test: E2E, name: '8-character piece',
  },
  {
    id: 'HYG-9 (hint)', file: 'dist/core/health/healthCheck.js',
    find: 'action: `optional: start ChromaDB at ${chromaUrl} or set CHROMA_URL; memory uses local JSON until then`,',
    replace: "action: 'docker compose up -d',",
    test: ACCEPTANCE, name: 'the hint names CHROMA_URL and the local fallback',
  },
  {
    id: 'HYG-9 (no docker)', file: 'dist/core/health/healthCheck.js',
    find: '    const components = [',
    replace: "    try { (await import('node:child_process')).execSync('docker compose up -d', { cwd: process.cwd(), stdio: 'ignore', timeout: 5000 }); } catch {}\n    const components = [",
    test: E2E, name: 'docker on PATH: never invoked',
  },
  {
    id: 'HYG-10 (git fields independent)', file: 'dist/core/tools/projectIndex/projectScanner.js',
    find: '.then(({ stdout }) => stdout.trim() || undefined, () => undefined);',
    replace: '.then(({ stdout }) => stdout.trim() || undefined);',
    test: ACCEPTANCE, name: 'project scan reads branch and last commit',
  },
  {
    id: 'HYG-10 (no cascade invalidation)', file: 'dist/memory/auto/unified-memory-core.js',
    find: '    getDependencyGraph(recordId) {',
    replace: '    async invalidateDependents(recordId) { return []; }\n    getDependencyGraph(recordId) {',
    test: ACCEPTANCE, name: 'no RAM-only cascade invalidation',
  },
  {
    id: 'HYG-8', file: 'dist/index.js',
    find: "name: '@m7/mcp-server',\n            version: PACKAGE_VERSION,", replace: "name: '@m7/mcp-server',\n            version: '2.0.0',",
    test: E2E, name: 'serverInfo and m7://status report the package version',
  },
  {
    id: 'HYG-11 (tsi)', file: 'dist/tsi/index.js',
    find: 'return new TSISystemClass(config);',
    replace: "const { TSISystem } = require('./tsiSystem.js');\n    return new TSISystem(config);",
    test: ACCEPTANCE, name: 'createTSISystem() returns a TSI system',
  },
  {
    id: 'HYG-11 (mesh presence)', file: 'dist/mesh/MeshManager.js',
    find: 'hostname: hostname(),', replace: "hostname: require('os').hostname(),",
    test: ACCEPTANCE, name: 'joining the mesh writes the presence file',
  },
];

const env = {
  ...process.env,
  CURSOR_WORKSPACE: process.env.CURSOR_WORKSPACE ?? ROOT,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-test-placeholder',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'sk-ant-test-placeholder',
};

// A mutant may write wherever the old code wrote (e.g. process.cwd()); keep that out of the repo.
async function runTest(test, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cwd = mkdtempSync(path.join(tmpdir(), 'm7-mutant-cwd-'));
  const out = await execFileAsync(
    process.execPath,
    ['--test', '--test-force-exit', `--test-name-pattern=${escaped}`, path.join(ROOT, test)],
    { cwd, env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
  ).then(r => r.stdout + r.stderr, err => (err.stdout ?? '') + (err.stderr ?? ''))
    .finally(() => rmSync(cwd, { recursive: true, force: true }));
  const count = key => Number(new RegExp(`^ℹ ${key} (\\d+)`, 'm').exec(out)?.[1] ?? 0);
  const reason = out.split('\n').find(l => /AssertionError|Error:/.test(l))?.trim() ?? '';
  return { pass: count('pass'), fail: count('fail'), reason };
}

const originals = new Map();
const restoreAll = () => {
  for (const [file, text] of originals) writeFileSync(file, text);
  originals.clear();
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restoreAll();
    process.exit(130);
  });
}

const selected = MUTANTS.filter(m => !process.env.ONLY || m.id.startsWith(process.env.ONLY));
let bad = 0;
for (const m of selected) {
  const file = path.join(ROOT, m.file);
  const source = readFileSync(file, 'utf8');
  if (!source.includes(m.find)) {
    console.log(`STALE     ${m.id}: pattern not found in ${m.file} (rebuild, or update the mutant)`);
    bad++;
    continue;
  }
  const base = await runTest(m.test, m.name);
  if (base.pass === 0 || base.fail > 0) {
    console.log(`BASELINE  ${m.id}: pass=${base.pass} fail=${base.fail} without the mutation`);
    bad++;
    continue;
  }
  originals.set(file, source);
  writeFileSync(file, source.replace(m.find, m.replace));
  try {
    const mut = await runTest(m.test, m.name);
    if (mut.fail > 0) {
      console.log(`KILLED    ${m.id}  (${mut.reason.slice(0, 100)})`);
    } else {
      console.log(`SURVIVED  ${m.id}: "${m.name}" still passes with the old behavior`);
      bad++;
    }
  } finally {
    restoreAll();
  }
}

console.log(`\n${selected.length - bad}/${selected.length} mutants killed`);
process.exit(bad || selected.length === 0 ? 1 : 0);
