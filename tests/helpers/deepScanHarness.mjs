/**
 * Shared helpers for the Deep Scan acceptance suites.
 *
 * Every helper here works on a throwaway project directory so the suites never
 * write into the repository (run-tests.sh pins CURSOR_WORKSPACE to the repo root,
 * and CURSOR_WORKSPACE outranks M7_PROJECT_PATH in project-path resolution).
 */

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DIST = path.join(ROOT, 'dist');
const WORKER = path.join(import.meta.dirname, 'deepScanWorker.mjs');
const RESULT_MARKER = '@@DEEPSCAN_RESULT@@';

export const PLACEHOLDER_KEYS = {
  OPENAI_API_KEY: 'sk-test-placeholder-openai-0123456789abcdef',
  ANTHROPIC_API_KEY: 'sk-ant-test-placeholder-anthropic-fedcba9876543210',
};

export const PHASES = [
  'intake',
  'discovery',
  'architecture',
  'solution',
  'impact',
  'simulation',
  'implementation',
];

export async function makeProject(prefix = 'deepscan-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'deepscan-fixture' }));
  return dir;
}

export async function removeProject(dir) {
  await rm(dir, { recursive: true, force: true });
}

/** Environment for a child process bound to `dir` and nothing else. */
export function isolatedEnv(dir, extra = {}) {
  const env = { ...process.env };
  delete env.WORKSPACE_FOLDER_PATHS;
  delete env.AGENT_TRANSCRIPTS;
  delete env.M7_DEBUG;
  Object.assign(env, PLACEHOLDER_KEYS, {
    CURSOR_WORKSPACE: dir,
    M7_PROJECT_PATH: dir,
    CURSOR_PROJECTS_DIR: path.join(dir, '.no-cursor-projects'),
  }, extra);
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
  }
  return env;
}

/**
 * Bind the current process to `dir`. Returns a restore function.
 * Needed for in-process tests: getProjectPath() caches and prefers CURSOR_WORKSPACE.
 */
export async function bindProject(dir) {
  const { resetProjectPathStateForTests } = await import(path.join(DIST, 'core/utils/projectPath.js'));
  const prev = {
    CURSOR_WORKSPACE: process.env.CURSOR_WORKSPACE,
    M7_PROJECT_PATH: process.env.M7_PROJECT_PATH,
  };
  process.env.CURSOR_WORKSPACE = dir;
  process.env.M7_PROJECT_PATH = dir;
  resetProjectPathStateForTests();
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetProjectPathStateForTests();
  };
}

/**
 * Run `steps` in a fresh Node process bound to `dir`, then flush and exit.
 * Two calls = one real restart in between (no shared module state).
 * A string value "$<i>.<field>" in step params is replaced with that field of step i's result.
 */
export async function runWorker(dir, steps, { env = {}, timeoutMs = 60_000 } = {}) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [WORKER, JSON.stringify(steps)],
    { env: isolatedEnv(dir, env), cwd: dir, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  ).catch(err => {
    err.message += `\n--- worker stderr ---\n${err.stderr ?? ''}\n--- worker stdout ---\n${err.stdout ?? ''}`;
    throw err;
  });
  const line = stdout.split('\n').find(l => l.startsWith(RESULT_MARKER));
  if (!line) {
    throw new Error(`worker produced no result\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`);
  }
  const out = JSON.parse(line.slice(RESULT_MARKER.length));
  if (out.error) {
    throw new Error(`worker step failed: ${out.error}\n${out.stack ?? ''}`);
  }
  return out.results;
}

export { RESULT_MARKER };

/**
 * Start the real MCP server (`node dist/index.js`) over stdio, bound to `dir`.
 * `cwd` defaults to `dir`; clients often launch servers from somewhere else.
 */
export async function startServer(dir, { env = {}, cwd = dir } = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(DIST, 'index.js')],
    env: isolatedEnv(dir, env),
    cwd,
    stderr: 'pipe',
  });
  const stderrChunks = [];
  transport.stderr?.on('data', chunk => stderrChunks.push(String(chunk)));
  const client = new Client({ name: 'deepscan-e2e', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const pid = transport.pid;

  async function call(name, args) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).map(c => c.text ?? '').join('\n');
    return { ...res, text };
  }

  async function waitForExit(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      await new Promise(r => setTimeout(r, 25));
    }
    return false;
  }

  async function stop(how = 'close') {
    if (how === 'close') {
      await client.close().catch(() => {});
    } else {
      process.kill(pid, how);
    }
    const exited = await waitForExit();
    if (!exited) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
    if (how !== 'close') await client.close().catch(() => {});
    return exited;
  }

  return { client, transport, pid, call, stop, stderr: () => stderrChunks.join('') };
}

/** First ```json fenced block in a tool response, parsed. */
export function jsonBlock(text) {
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  return m ? JSON.parse(m[1]) : null;
}

export function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

export function fakeArtifact(phase, filler = 'x', length = 220) {
  return `# ${phase.toUpperCase()}: deep scan fixture\n\n${filler.repeat(length)}`;
}

export function reflectionJson(gateId, decision = 'continue', extra = {}) {
  return `\`\`\`json\n${JSON.stringify({
    gate_instruction_id: gateId,
    decision,
    change_detected: decision !== 'continue',
    summary: `${decision} at gate`,
    confidence: 0.9,
    ...extra,
  })}\n\`\`\``;
}

export function gateIdFromText(text) {
  const m = /## Gate-ID:\s*(\S+)/.exec(text ?? '');
  return m ? m[1] : null;
}
