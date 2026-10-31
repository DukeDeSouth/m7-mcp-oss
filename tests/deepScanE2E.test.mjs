/**
 * Deep Scan end-to-end suite: the real MCP server (`node dist/index.js`) over stdio,
 * one throwaway project per test, real process restarts between write and read.
 *
 * Covers what in-process tests cannot prove: the server's exit paths drain
 * pending writes (MEM-3, STATE-3), tool responses as the client sees them
 * including appended hints (GATE-3, CYC-1, CYC-2), the tool surface (HYG-4),
 * the reported version (HYG-8), state location when cwd ≠ project (STATE-4) and
 * side effects on the host (HYG-9).
 *
 * Run: npm run build && node --test --test-force-exit tests/deepScanE2E.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ROOT,
  PLACEHOLDER_KEYS,
  makeProject,
  removeProject,
  startServer,
  jsonBlock,
  countOccurrences,
  fakeArtifact,
  reflectionJson,
  gateIdFromText,
} from './helpers/deepScanHarness.mjs';

const T = { timeout: 60_000 };

async function withServerProject(prefix, fn) {
  const dir = await makeProject(prefix);
  const servers = [];
  const start = async opts => {
    const s = await startServer(dir, opts);
    servers.push(s);
    return s;
  };
  try {
    return await fn(dir, start);
  } finally {
    for (const s of servers) await s.stop('SIGKILL').catch(() => {});
    await removeProject(dir);
  }
}

function storedId(text) {
  const m = /\*\*Stored:\*\* (\S+)/.exec(text);
  assert.ok(m, `no stored id in:\n${text}`);
  return m[1];
}

async function getRecord(server, id) {
  const res = await server.call('mcp_m7_memory', { action: 'get', id });
  return /\*\*Found:\*\* ✅/.test(res.text) ? jsonBlock(res.text) : null;
}

async function startCycleViaTool(server, description) {
  const res = await server.call('mcp_m7_cycle', { task_description: description });
  const m = /task_id="(cycle_[^"]+)"/.exec(res.text);
  assert.ok(m, `no task id in:\n${res.text.slice(0, 400)}`);
  return m[1];
}

describe('[MEM-3] store, exit, restart: the record is present', () => {
  for (const how of ['SIGTERM', 'SIGINT', 'close']) {
    it(`exit via ${how === 'close' ? 'stdin close (client disconnect)' : how} right after store_at L2`, T, async () => {
      await withServerProject(`e2e-mem3-${how}-`, async (dir, start) => {
        const s1 = await start();
        const content = `MEM-3 e2e ${how} ${'p'.repeat(80)}`;
        const id = storedId((await s1.call('mcp_m7_memory', { action: 'store_at', level: 'L2', content })).text);
        assert.equal(await s1.stop(how), true, 'server must exit');

        const raw = JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8'));
        assert.ok(raw[id], 'record must be on disk after exit');

        const s2 = await start();
        const rec = await getRecord(s2, id);
        assert.ok(rec, 'record must be readable after restart');
        assert.equal(rec.content, content);
      });
    });
  }
});

describe('[STATE-3] session created right before exit survives the restart', () => {
  it('analyze_task creates a session, SIGTERM at once, session is on disk and visible after restart', T, async () => {
    await withServerProject('e2e-state3-', async (dir, start) => {
      const s1 = await start();
      const res = await s1.call('mcp_m7_analyze_task', { task_description: 'Add retry to the HTTP client wrapper in network layer' });
      const m = /Session ID:\*\* `([^`]+)`/.exec(res.text);
      assert.ok(m, `no session id:\n${res.text.slice(0, 600)}`);
      const sessionId = m[1];
      assert.equal(await s1.stop('SIGTERM'), true);

      const raw = JSON.parse(await readFile(path.join(dir, '.m7', 'orchestrator-sessions.json'), 'utf8'));
      assert.ok(raw[sessionId], 'session must be persisted before exit');

      const s2 = await start();
      const status = await s2.call('mcp_m7_session', { action: 'status', session_id: sessionId });
      assert.ok(status.text.includes(sessionId), status.text.slice(0, 400));
      assert.doesNotMatch(status.text, /not found/i);
    });
  });

  it('m7://session read as the first request after restart lists the persisted session', T, async () => {
    await withServerProject('e2e-state3-res-', async (dir, start) => {
      const s1 = await start();
      const res = await s1.call('mcp_m7_analyze_task', { task_description: 'Add retry to the HTTP client wrapper in network layer' });
      const sessionId = /Session ID:\*\* `([^`]+)`/.exec(res.text)?.[1];
      assert.ok(sessionId);
      await s1.stop('SIGTERM');

      const s2 = await start();
      const body = JSON.parse((await s2.client.readResource({ uri: 'm7://session' })).contents[0].text);
      assert.equal(body.active_sessions, 1);
      assert.ok(JSON.stringify(body).includes(sessionId));
    });
  });
});

describe('[STATE-4] a server started from another directory keeps state in the project', () => {
  it('analyze_task + forced complete_session → .m7 state under the project, nothing under cwd', T, async () => {
    const elsewhere = await makeProject('e2e-state4-cwd-');
    try {
      await withServerProject('e2e-state4-', async (dir, start) => {
        const s = await start({ cwd: elsewhere });
        const res = await s.call('mcp_m7_analyze_task', { task_description: 'Add retry to the HTTP client wrapper in network layer' });
        const sessionId = /Session ID:\*\* `([^`]+)`/.exec(res.text)?.[1];
        assert.ok(sessionId, res.text.slice(0, 400));
        const done = await s.call('mcp_m7_session', { action: 'complete_session', session_id: sessionId, force: true });
        assert.match(done.text, /Session Completed Successfully/);
        await s.stop('SIGTERM');

        await readFile(path.join(dir, '.m7', 'orchestrator-sessions.json'), 'utf8');
        await readFile(path.join(dir, '.m7', 'cross-session', 'stats.json'), 'utf8');
        await assert.rejects(readFile(path.join(elsewhere, '.m7', 'cross-session', 'stats.json'), 'utf8'));
      });
    } finally {
      await removeProject(elsewhere);
    }
  });
});

describe('[HYG-9] analyze_task with ChromaDB offline runs no docker command', () => {
  it('compose file in cwd, docker on PATH: never invoked; the hint names CHROMA_URL', { timeout: 90_000 }, async () => {
    const elsewhere = await makeProject('e2e-hyg9-cwd-');
    try {
      await writeFile(path.join(elsewhere, 'compose.yml'), 'services:\n  user-service:\n    image: busybox\n');
      const bin = path.join(elsewhere, 'bin');
      const log = path.join(elsewhere, 'docker-calls.log');
      await mkdir(bin);
      await writeFile(path.join(bin, 'docker'), `#!/bin/sh\necho "$@" >> "${log}"\nexit 0\n`);
      await chmod(path.join(bin, 'docker'), 0o755);

      await withServerProject('e2e-hyg9-', async (dir, start) => {
        const s = await start({
          cwd: elsewhere,
          env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, CHROMA_URL: 'http://127.0.0.1:9' },
        });
        const res = await s.call('mcp_m7_analyze_task', { task_description: 'Add retry to the HTTP client wrapper in network layer' });
        assert.match(res.text, /ChromaDB/, 'health block is part of the response');
        assert.match(res.text, /http:\/\/127\.0\.0\.1:9/);
        assert.doesNotMatch(res.text, /docker/i);
      });
      await assert.rejects(readFile(log, 'utf8'), 'docker must not be called');
    } finally {
      await removeProject(elsewhere);
    }
  });
});

describe('[STATE-2] complete_session through the server refuses a fresh session', () => {
  it('refused without force, recorded with force, both visible after restart', T, async () => {
    await withServerProject('e2e-state2-', async (dir, start) => {
      const s1 = await start();
      const res = await s1.call('mcp_m7_analyze_task', { task_description: 'Rename the config loader module in settings layer' });
      const sessionId = /Session ID:\*\* `([^`]+)`/.exec(res.text)?.[1];
      assert.ok(sessionId);
      const refused = await s1.call('mcp_m7_session', { action: 'complete_session', session_id: sessionId });
      assert.match(refused.text, /Completion Refused/);
      const forced = await s1.call('mcp_m7_session', { action: 'complete_session', session_id: sessionId, force: true, notes: 'e2e force' });
      assert.match(forced.text, /Completed Successfully/);
      assert.match(forced.text, /force: true/);
      await s1.stop('SIGTERM');

      const raw = JSON.parse(await readFile(path.join(dir, '.m7', 'orchestrator-sessions.json'), 'utf8'));
      assert.equal(raw[sessionId].currentPhase, 'completed');
      assert.equal(raw[sessionId].forcedCompletion?.notes, 'e2e force');
    });
  });
});

describe('[MEM-0] [MEM-1] [MEM-2] memory tool results are the same after a server restart', () => {
  it('[MEM-0d] store_at L4 → restart → get returns the same record', T, async () => {
    await withServerProject('e2e-mem0d-', async (dir, start) => {
      const s1 = await start();
      const id = storedId((await s1.call('mcp_m7_memory', { action: 'store_at', level: 'L4', content: `project fact ${'f'.repeat(50)}`, confidence: 0.85 })).text);
      const warm = await getRecord(s1, id);
      await s1.stop('close');
      const s2 = await start();
      const cold = await getRecord(s2, id);
      assert.ok(cold);
      assert.equal(cold.level, 'L4');
      assert.equal(cold.confidence, warm.confidence);
    });
  });

  it('[MEM-1] invalidate_bulk → restart → confidence reduced and invalidatedAt set', T, async () => {
    await withServerProject('e2e-mem1-', async (dir, start) => {
      const s1 = await start();
      const id = storedId((await s1.call('mcp_m7_memory', { action: 'store_at', level: 'L2', content: `invalidate me ${'i'.repeat(60)}`, confidence: 0.9 })).text);
      const inv = await s1.call('mcp_m7_memory', { action: 'invalidate_bulk', ids: [id] });
      assert.match(inv.text, /\*\*Invalidated:\*\* 1\/1/);
      await s1.stop('SIGTERM');
      const s2 = await start();
      const cold = await getRecord(s2, id);
      assert.ok(Math.abs(cold.confidence - 0.27) < 1e-9, `confidence ${cold.confidence}`);
      assert.ok(cold.invalidatedAt);
    });
  });

  it('[MEM-2] store_at with confidence 0 → restart → confidence 0', T, async () => {
    await withServerProject('e2e-mem2-', async (dir, start) => {
      const s1 = await start();
      const id = storedId((await s1.call('mcp_m7_memory', { action: 'store_at', level: 'L2', content: `refuted claim ${'r'.repeat(60)}`, confidence: 0 })).text);
      await s1.stop('SIGTERM');
      const s2 = await start();
      const cold = await getRecord(s2, id);
      assert.ok(cold);
      assert.equal(cold.confidence, 0);
    });
  });
});

describe('[GATE-3] [CYC-1] [CYC-2] cycle responses as the client receives them', () => {
  it('[GATE-3] gate response (with appended hints) contains "Gate-ID:" exactly once', T, async () => {
    await withServerProject('e2e-gate3-', async (dir, start) => {
      const s = await start();
      const taskId = await startCycleViaTool(s, 'GATE-3 end to end gate render');
      const submit = await s.call('mcp_m7_cycle', { task_id: taskId, artifact_content: fakeArtifact('intake') });
      assert.equal(countOccurrences(submit.text, 'Gate-ID:'), 1, 'after artifact submit');
      const current = await s.call('mcp_m7_cycle', { task_id: taskId });
      assert.equal(countOccurrences(current.text, 'Gate-ID:'), 1, 'on re-read of the gate');
      assert.equal(countOccurrences(current.text, '## 🚦 Reflection Gate'), 1);
      assert.doesNotMatch(current.text, /errors increasing/i);
    });
  });

  it('[CYC-1] unparseable reflection → isError, gate unchanged, survives restart', T, async () => {
    await withServerProject('e2e-cyc1-', async (dir, start) => {
      const s1 = await start();
      const taskId = await startCycleViaTool(s1, 'CYC-1 end to end');
      const gateText = (await s1.call('mcp_m7_cycle', { task_id: taskId, artifact_content: fakeArtifact('intake') })).text;
      const gateId = gateIdFromText(gateText);
      assert.ok(gateId);
      const bad = await s1.call('mcp_m7_cycle', { task_id: taskId, artifact_content: `## Gate-ID: ${gateId}\n\nnot json` });
      assert.equal(bad.isError, true);
      await s1.stop('SIGTERM');

      const s2 = await start();
      const cur = await s2.call('mcp_m7_cycle', { task_id: taskId });
      assert.equal(gateIdFromText(cur.text), gateId);
      assert.match(cur.text, /INTAKE/);
    });
  });

  it('[CYC-2] client retry of an accepted reflection returns the same text and does not advance', T, async () => {
    await withServerProject('e2e-cyc2-', async (dir, start) => {
      const s = await start();
      const taskId = await startCycleViaTool(s, 'CYC-2 end to end retry');
      const gateId = gateIdFromText((await s.call('mcp_m7_cycle', { task_id: taskId, artifact_content: fakeArtifact('intake') })).text);
      const body = reflectionJson(gateId, 'continue');
      const r1 = await s.call('mcp_m7_cycle', { task_id: taskId, artifact_content: body });
      const r2 = await s.call('mcp_m7_cycle', { task_id: taskId, artifact_content: body });
      assert.ok(!r1.isError);
      assert.ok(!r2.isError);
      const strip = t => t.replace(/\n---\n[\s\S]*$/, '');
      assert.equal(strip(r2.text), strip(r1.text));
      const state = JSON.parse(await readFile(path.join(dir, '.m7', 'cycles', `${taskId}.json`), 'utf8'));
      assert.deepEqual(state.completedPhases, ['intake']);
      assert.equal(state.currentPhase, 'discovery');
    });
  });
});

describe('[HYG-4] tool surface and key hygiene', () => {
  it('tools/list has no mcp_m7_test_tool and matches mcp.json, TOOLS_REGISTRY.md and the README count', T, async () => {
    await withServerProject('e2e-hyg4-', async (dir, start) => {
      const s = await start();
      const names = (await s.client.listTools()).tools.map(t => t.name).sort();
      assert.ok(!names.includes('mcp_m7_test_tool'));

      const manifest = JSON.parse(await readFile(path.join(ROOT, 'mcp.json'), 'utf8'));
      assert.deepEqual([...manifest.tools].sort(), names, 'mcp.json tools');

      const registry = await readFile(path.join(ROOT, 'docs', 'TOOLS_REGISTRY.md'), 'utf8');
      const registryNames = [...registry.matchAll(/^\| `(mcp_m7_[a-z_]+)`/gm)].map(m => m[1]).sort();
      assert.deepEqual(registryNames, names, 'TOOLS_REGISTRY.md rows');
      assert.match(registry, new RegExp(`Всего \\*\\*${names.length}\\*\\* тулов`));

      const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
      assert.match(readme, new RegExp(`${names.length} tools are registered`));
      const master = await readFile(path.join(ROOT, 'MASTER_REFERENCE.md'), 'utf8');
      assert.match(master, new RegExp(`registers ${names.length} tools`));
    });
  });

  it('with M7_DEBUG on, stderr contains no 8-character piece of either API key', T, async () => {
    await withServerProject('e2e-hyg4-keys-', async (dir, start) => {
      const s = await start({ env: { M7_DEBUG: 'true' } });
      await s.client.listTools();
      await s.call('mcp_m7_memory', { action: 'stats' });
      await s.stop('SIGTERM');
      const stderr = s.stderr();
      assert.ok(stderr.length > 0, 'debug logging must be active for this check to mean anything');
      assert.match(stderr, /OPENAI_API_KEY: set/);
      for (const key of Object.values(PLACEHOLDER_KEYS)) {
        for (let i = 0; i + 8 <= key.length; i++) {
          const piece = key.slice(i, i + 8);
          assert.ok(!stderr.includes(piece), `stderr leaks "${piece}"`);
        }
      }
    });
  });
});

describe('[HYG-8] the version the client sees is the package version', () => {
  it('serverInfo and m7://status report the package version', T, async () => {
    await withServerProject('e2e-hyg8-', async (dir, start) => {
      const s = await start();
      const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
      assert.equal(s.client.getServerVersion()?.version, version);
      const status = JSON.parse((await s.client.readResource({ uri: 'm7://status' })).contents[0].text);
      assert.equal(status.version, version);
      assert.equal(status.tools, (await s.client.listTools()).tools.length);
    });
  });
});

describe('[CYC-10] two cycles with one description through the server', () => {
  it('each gets its own artifact folder; neither INTAKE.md contains the other', T, async () => {
    await withServerProject('e2e-cyc10-', async (dir, start) => {
      const s = await start();
      const folders = [];
      for (const filler of ['p', 'q']) {
        const res = await s.call('mcp_m7_cycle', { task_description: 'CYC-10 end to end same text' });
        const taskId = /task_id="(cycle_[^"]+)"/.exec(res.text)?.[1];
        const folder = /`(m7-cycles\/[^/`]+)\/INTAKE\.md`/.exec(res.text)?.[1];
        assert.ok(taskId && folder, res.text.slice(0, 600));
        assert.ok(folder.endsWith(taskId.slice(-6)), `${folder} does not carry the id suffix of ${taskId}`);
        assert.equal((await s.call('mcp_m7_cycle', { task_id: taskId, artifact_content: fakeArtifact('intake', filler) })).isError, undefined);
        folders.push(folder);
      }
      assert.notEqual(folders[0], folders[1]);
      const p = await readFile(path.join(dir, folders[0], 'INTAKE.md'), 'utf8');
      const q = await readFile(path.join(dir, folders[1], 'INTAKE.md'), 'utf8');
      assert.ok(p.includes('p'.repeat(220)) && !p.includes('q'.repeat(220)));
      assert.ok(q.includes('q'.repeat(220)) && !q.includes('p'.repeat(220)));
    });
  });
});

describe('[STATE-5] contract registry through the server', () => {
  const register = (s, name, type) => s.call('mcp_m7_contracts', { action: 'register', contract: { name, type, purpose: `purpose of ${name}` } });
  const list = async s => JSON.parse((await s.call('mcp_m7_contracts', { action: 'list' })).text).contracts;

  it('three kinds registered → listed in the session and after a restart with the same ids; a fourth adds, not replaces', T, async () => {
    await withServerProject('e2e-state5-', async (dir, start) => {
      await writeFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), 'project:\n  name: e2e-state5\n  version: 0.0.1\n');
      const s1 = await start();
      for (const [name, type] of [['getUserById', 'function'], ['GET /users', 'endpoint'], ['UserService', 'class']]) {
        assert.equal(JSON.parse((await register(s1, name, type)).text).success, true, name);
      }
      const before = await list(s1);
      assert.equal(before.length, 3);
      await s1.stop('SIGTERM');

      const s2 = await start();
      const after = await list(s2);
      assert.deepEqual(after.map(c => c.id).sort(), before.map(c => c.id).sort());
      assert.equal(JSON.parse((await register(s2, 'createOrder', 'function')).text).success, true);
      assert.equal((await list(s2)).length, 4);
    });
  });

  it('without PROJECT_SCHEMA.yaml register reports failure', T, async () => {
    await withServerProject('e2e-state5-none-', async (dir, start) => {
      const s = await start();
      const body = JSON.parse((await register(s, 'getUserById', 'function')).text);
      assert.equal(body.success, false);
      assert.match(body.error, /init_project|PROJECT_SCHEMA/i);
      await assert.rejects(readFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), 'utf8'));
    });
  });
});

describe('[MEM-6] reading the project schema writes nothing to memory', () => {
  it('three analyze_task calls with PROJECT_SCHEMA.yaml present leave no schema copy in long-term memory', T, async () => {
    await withServerProject('e2e-mem6-', async (dir, start) => {
      await writeFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), 'project:\n  name: e2e-mem6-schema\n  version: 0.0.1\n');
      const s = await start();
      for (let i = 0; i < 3; i++) {
        await s.call('mcp_m7_analyze_task', { task_description: `MEM-6 probe ${i}: fix a small parser bug` });
      }
      await s.stop('SIGTERM');
      const longterm = JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8').catch(() => '{}'));
      const copies = Object.values(longterm).filter(v => JSON.stringify(v).includes('e2e-mem6-schema'));
      assert.equal(copies.length, 0);
    });
  });
});
