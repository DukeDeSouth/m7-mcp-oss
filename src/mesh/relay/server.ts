#!/usr/bin/env node
/**
 * M7 Mesh Relay Server
 * 
 * Lightweight HTTP server for coordinating multiple M7 MCP instances.
 * Zero external dependencies — uses Node.js builtins only.
 * 
 * Deploy: node server.js
 * Config: M7_RELAY_PORT (default 9700), M7_RELAY_SECRET, M7_RELAY_DATA_DIR
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { RelayStore } from './store.js';
import { join } from 'path';

const PORT = parseInt(process.env.M7_RELAY_PORT || '9700', 10);
const SECRET = process.env.M7_RELAY_SECRET || '';
const DATA_DIR = process.env.M7_RELAY_DATA_DIR || join(process.cwd(), 'data');

if (!SECRET) {
  console.error('[relay] FATAL: M7_RELAY_SECRET must be set');
  process.exit(1);
}

const store = new RelayStore(join(DATA_DIR, 'relay-backup.json'));

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(res: ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, msg: string, status = 400): void {
  json(res, { error: msg }, status);
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 1_048_576) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function auth(req: IncomingMessage): boolean {
  const header = req.headers.authorization || '';
  return header === `Bearer ${SECRET}`;
}

function parseUrl(url: string): { path: string; params: URLSearchParams } {
  const u = new URL(url, 'http://localhost');
  return { path: u.pathname, params: u.searchParams };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { path, params } = parseUrl(req.url || '/');
  const method = req.method || 'GET';

  // Health (no auth)
  if (path === '/health' && method === 'GET') {
    const states = store.getAllStates();
    const active = states.filter(s => s.status === 'active').length;
    json(res, { status: 'ok', workstations: states.length, active, uptime: process.uptime() });
    return;
  }

  // Auth check
  if (!auth(req)) { error(res, 'Unauthorized', 401); return; }

  try {
    // ─── STATE ──────────────────────────────────────────────────────

    if (path === '/state' && method === 'POST') {
      const body = await readBody(req);
      if (!body.workstation) { error(res, 'workstation required'); return; }
      const state = store.setState(body.workstation, body);
      json(res, { ok: true, state });
      return;
    }

    if (path === '/state' && method === 'GET') {
      json(res, { states: store.getAllStates() });
      return;
    }

    // ─── FILES ──────────────────────────────────────────────────────

    if (path.startsWith('/files/') && method === 'PUT') {
      const filePath = decodeURIComponent(path.slice(7));
      const body = await readBody(req);
      if (!body.content || !body.author) { error(res, 'content and author required'); return; }
      const entry = store.putFile(filePath, body.content, body.author);
      json(res, { ok: true, file: { path: entry.path, size: entry.size, updated_at: entry.updated_at } });
      return;
    }

    if (path.startsWith('/files/') && method === 'GET') {
      const filePath = decodeURIComponent(path.slice(7));
      const file = store.getFile(filePath);
      if (!file) { error(res, 'Not found', 404); return; }
      json(res, { file });
      return;
    }

    if (path === '/files' && method === 'GET') {
      const since = params.get('since') ? parseInt(params.get('since')!, 10) : undefined;
      const files = store.listFiles(since).map(f => ({
        path: f.path, author: f.author, updated_at: f.updated_at, size: f.size
      }));
      json(res, { files });
      return;
    }

    // ─── CHANGES ────────────────────────────────────────────────────

    if (path === '/changes' && method === 'POST') {
      const body = await readBody(req);
      if (!body.path || !body.workstation) { error(res, 'path and workstation required'); return; }
      const change = store.addChange({
        path: body.path,
        action: body.action || 'modified',
        summary: body.summary || '',
        workstation: body.workstation,
      });
      json(res, { ok: true, change });
      return;
    }

    if (path === '/changes' && method === 'GET') {
      const since = params.get('since') ? parseInt(params.get('since')!, 10) : undefined;
      json(res, { changes: store.getChanges(since) });
      return;
    }

    // ─── MESSAGES ───────────────────────────────────────────────────

    if (path === '/messages' && method === 'POST') {
      const body = await readBody(req);
      if (!body.from || !body.content) { error(res, 'from and content required'); return; }
      const msg = store.addMessage({
        from: body.from,
        to: body.to || 'all',
        type: body.type || 'note',
        content: body.content,
        parent_id: body.parent_id,
      });
      json(res, { ok: true, message: msg });
      return;
    }

    if (path === '/messages' && method === 'GET') {
      const forWs = params.get('for') || undefined;
      const unread = params.get('unread') === 'true';
      json(res, { messages: store.getMessages({ for: forWs, unread }) });
      return;
    }

    if (path.match(/^\/messages\/[^/]+\/reply$/) && method === 'POST') {
      const msgId = path.split('/')[2];
      const body = await readBody(req);
      if (!body.from || !body.content) { error(res, 'from and content required'); return; }
      const parent = store.getMessage(msgId);
      if (!parent) { error(res, 'Message not found', 404); return; }
      const reply = store.addMessage({
        from: body.from,
        to: parent.from,
        type: 'answer',
        content: body.content,
        parent_id: msgId,
      });
      store.markRead(msgId);
      json(res, { ok: true, message: reply });
      return;
    }

    if (path.match(/^\/messages\/[^/]+\/read$/) && method === 'POST') {
      const msgId = path.split('/')[2];
      const ok = store.markRead(msgId);
      json(res, { ok });
      return;
    }

    // ─── TASKS ──────────────────────────────────────────────────────

    if (path === '/tasks' && method === 'POST') {
      const body = await readBody(req);
      if (!body.id || !body.workstation || !body.title) {
        error(res, 'id, workstation, and title required'); return;
      }
      const task = store.upsertTask({
        id: body.id,
        workstation: body.workstation,
        title: body.title,
        status: body.status || 'in_progress',
        summary: body.summary || '',
        module: body.module,
        files_changed: body.files_changed,
        started_at: body.started_at || Date.now(),
        completed_at: body.completed_at,
      });
      json(res, { ok: true, task });
      return;
    }

    if (path === '/tasks' && method === 'GET') {
      const status = params.get('status') || 'all';
      const limit = parseInt(params.get('limit') || '20', 10);
      json(res, { tasks: store.getTasks({ status, limit }) });
      return;
    }

    // ─── 404 ────────────────────────────────────────────────────────

    error(res, `Not found: ${method} ${path}`, 404);

  } catch (e: any) {
    console.error(`[relay] Error handling ${method} ${path}:`, e.message);
    error(res, e.message || 'Internal error', 500);
  }
}

// ─── Server ─────────────────────────────────────────────────────────────────

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`[M7 Mesh Relay] Running on port ${PORT}`);
  console.log(`[M7 Mesh Relay] Data dir: ${DATA_DIR}`);
  console.log(`[M7 Mesh Relay] Auth: Bearer token required`);
});

process.on('SIGTERM', () => { store.shutdown(); process.exit(0); });
process.on('SIGINT', () => { store.shutdown(); process.exit(0); });
