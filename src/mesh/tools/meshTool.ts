/**
 * M7 Mesh MCP Tool — Multi-Instance Communication & Coordination
 * 
 * Actions:
 * - init: Initialize mesh network on this machine
 * - status: Show mesh health, peers, intents, locks
 * - announce: Publish server role or context to the mesh
 * - request_context: Get context from a specific peer or all peers
 * - task_lock: Acquire or release an advisory resource lock
 * - peers: Detailed peer information
 * 
 * @module mesh/tools/meshTool
 * @since v8.0
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { getMeshManager } from '../MeshManager.js';
import type { ContextType, IntentType, MeshPeerContext } from '../types.js';
import { getProjectPath } from '../../core/utils/projectPath.js';

// ─── Schema ─────────────────────────────────────────────────────────────────

const MeshToolSchema = z.object({
  action: z.enum([
    // Local mesh (legacy)
    'init', 'status', 'announce', 'request_context', 'task_lock', 'peers', 'propose_intent', 'events',
    // Remote relay (v10)
    'sync', 'push', 'pull', 'notify', 'changes',
    'ask', 'reply', 'inbox', 'broadcast',
    'log_task', 'tasks',
    'push-file', 'pull-file', 'list-files'
  ]).describe('Mesh action to perform'),

  // For announce
  server_role: z.string().optional().describe('Server role description (e.g., "auth backend on server-1")'),
  context_type: z.enum(['working_set', 'decision', 'dependency', 'summary', 'server_role']).optional()
    .describe('Type of context to publish'),
  content: z.string().optional().describe('Context content (JSON string or plain text)'),
  scope: z.string().optional().describe('Context scope (e.g., file path)'),
  expires_in_ms: z.number().optional().describe('Context TTL in milliseconds'),

  // For request_context
  peer_id: z.string().optional().describe('Specific peer instance ID to query'),

  // For task_lock
  resource: z.string().optional().describe('Resource key to lock/unlock (e.g., file path)'),
  lock_action: z.enum(['acquire', 'release', 'check']).optional().describe('Lock operation'),
  purpose: z.string().optional().describe('Purpose of the lock'),
  ttl_ms: z.number().optional().describe('Lock TTL in milliseconds (default: 30000)'),

  // For propose_intent
  intent_type: z.enum(['modify_file', 'deploy', 'schema_change', 'task']).optional()
    .describe('Type of intent to propose'),
  description: z.string().optional().describe('Intent description'),

  // For init
  project_root: z.string().optional().describe('Project root path (default: cwd)'),

  // For events / tasks
  limit: z.number().optional().describe('Number of recent events/tasks to show (default: 20)'),

  // v10: Remote relay params
  path: z.string().optional().describe('File path for push/pull/notify'),
  summary: z.string().optional().describe('Change summary for notify'),
  file_action: z.string().optional().describe('File action for notify: created/modified/deleted'),
  to: z.string().optional().describe('Target workstation for ask/message (or "all")'),
  question: z.string().optional().describe('Question text for ask'),
  answer: z.string().optional().describe('Answer text for reply'),
  message: z.string().optional().describe('Message text for broadcast'),
  message_id: z.string().optional().describe('Message ID for reply'),
  since: z.string().optional().describe('Time filter: "1h", "24h", timestamp'),

  // For log_task
  task_id: z.string().optional().describe('M7 cycle/task ID'),
  title: z.string().optional().describe('Task title'),
  task_status: z.string().optional().describe('Task status: in_progress/completed/blocked'),
  module: z.string().optional().describe('Module name'),
  files_changed: z.array(z.string()).optional().describe('List of changed files'),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ─── Handlers ───────────────────────────────────────────────────────────────

function handleInit(params: any): string {
  const mesh = getMeshManager();
  
  if (mesh.isActive()) {
    const peers = mesh.getPeers();
    return `⚡ Mesh already active.\n\n` +
      `Instance: ${mesh.getInstanceId().slice(0, 12)}...\n` +
      `Peers: ${peers.length}\n\n` +
      `Use \`mesh status\` for details.`;
  }

  mesh.init();
  mesh.join(params.server_role, params.project_root);

  const peers = mesh.getPeers();
  
  return `🔗 M7 Mesh initialized!\n\n` +
    `Instance ID: ${mesh.getInstanceId()}\n` +
    `PID: ${process.pid}\n` +
    `Project: ${params.project_root || process.cwd()}\n` +
    `Role: ${params.server_role || '(none)'}\n\n` +
    `Discovered ${peers.length} peer(s).\n` +
    (peers.length > 0
      ? `\nPeers:\n` + peers.map(p =>
          `  - ${p.instance_id.slice(0, 12)}... (PID ${p.pid}) role="${p.server_role || 'none'}" last_heartbeat=${timeAgo(p.last_heartbeat)}`
        ).join('\n')
      : '\nNo peers found. Start another M7 instance to see mesh in action.') +
    `\n\nHeartbeat: every 30s | Stale timeout: 90s`;
}

function handleStatus(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    if (mesh.meshExists()) {
      return `⏸️ Mesh directory exists but not joined.\n\nRun \`mesh init\` to join the mesh network.`;
    }
    return `❌ Mesh not initialized.\n\nRun \`mesh init\` to create the mesh network on this machine.`;
  }

  const peers = mesh.getPeers();
  const allInstances = mesh.getAllInstances();
  const intents = mesh.getActiveIntents();
  const locks = mesh.getAllLocks();

  let output = `🔗 M7 MESH STATUS\n${'═'.repeat(50)}\n\n`;
  output += `This Instance: ${mesh.getInstanceId().slice(0, 12)}... (PID ${process.pid})\n`;
  output += `Total Instances: ${allInstances.length}\n`;
  output += `Active Peers: ${peers.length}\n`;
  output += `Active Intents: ${intents.length}\n`;
  output += `Resource Locks: ${locks.length}\n\n`;

  if (peers.length > 0) {
    output += `📡 PEERS\n${'-'.repeat(30)}\n`;
    for (const peer of peers) {
      output += `  ${peer.instance_id.slice(0, 12)}...\n`;
      output += `    PID: ${peer.pid} | Role: ${peer.server_role || '(none)'}\n`;
      output += `    Project: ${peer.project_root}\n`;
      output += `    Heartbeat: ${timeAgo(peer.last_heartbeat)} | Started: ${formatTimestamp(peer.started_at)}\n\n`;
    }
  }

  if (intents.length > 0) {
    output += `🎯 ACTIVE INTENTS\n${'-'.repeat(30)}\n`;
    for (const intent of intents) {
      output += `  [${intent.state.toUpperCase()}] ${intent.intent_type}: ${intent.description}\n`;
      output += `    By: ${intent.instance_id.slice(0, 12)}... | Resource: ${intent.resource || '(none)'}\n\n`;
    }
  }

  if (locks.length > 0) {
    output += `🔒 RESOURCE LOCKS\n${'-'.repeat(30)}\n`;
    for (const lock of locks) {
      output += `  ${lock.resource_key}\n`;
      output += `    Held by: ${lock.instance_id.slice(0, 12)}... (PID ${lock.pid})\n`;
      output += `    Purpose: ${lock.purpose || '(none)'} | TTL: ${lock.ttl_ms}ms | Since: ${timeAgo(lock.acquired_at)}\n\n`;
    }
  }

  return output.trim();
}

function handleAnnounce(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    return '❌ Mesh not active. Run `mesh init` first.';
  }

  const contextType: ContextType = params.context_type || 'server_role';
  const content = params.content || params.server_role || '';

  if (!content) {
    return '❌ Provide content or server_role to announce.';
  }

  mesh.publishContext(contextType, content, params.scope, params.expires_in_ms);

  return `📢 Context published to mesh!\n\n` +
    `Type: ${contextType}\n` +
    `Content: ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}\n` +
    `Scope: ${params.scope || '(global)'}\n` +
    `Expires: ${params.expires_in_ms ? `${params.expires_in_ms}ms` : 'never'}\n\n` +
    `Peers will see this on their next context query.`;
}

function handleRequestContext(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    return '❌ Mesh not active. Run `mesh init` first.';
  }

  if (params.peer_id) {
    const contexts = mesh.getContextForPeer(params.peer_id);
    if (contexts.length === 0) {
      return `No context found for peer ${params.peer_id.slice(0, 12)}...`;
    }

    let output = `📋 Context from peer ${params.peer_id.slice(0, 12)}...\n${'─'.repeat(40)}\n\n`;
    for (const ctx of contexts) {
      output += `  [${ctx.context_type}] ${ctx.scope || '(global)'}\n`;
      output += `  ${ctx.content.slice(0, 300)}${ctx.content.length > 300 ? '...' : ''}\n`;
      output += `  Posted: ${timeAgo(ctx.created_at)}\n\n`;
    }
    return output.trim();
  }

  // All peers
  const peerContexts: MeshPeerContext[] = mesh.getAllPeerContexts();
  if (peerContexts.length === 0) {
    return 'No peer contexts available. Other instances may not have published context yet.';
  }

  let output = `📋 ALL PEER CONTEXTS\n${'═'.repeat(50)}\n\n`;
  for (const peer of peerContexts) {
    output += `🖥️ ${peer.instance_id.slice(0, 12)}... (PID ${peer.pid})\n`;
    output += `   Role: ${peer.server_role || '(none)'} | Project: ${peer.project_root}\n`;

    if (peer.contexts.length === 0) {
      output += `   (no context published)\n\n`;
    } else {
      for (const ctx of peer.contexts) {
        output += `   [${ctx.context_type}] ${ctx.scope || 'global'}: ${ctx.content.slice(0, 200)}\n`;
      }
      output += '\n';
    }
  }

  return output.trim();
}

function handleTaskLock(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    return '❌ Mesh not active. Run `mesh init` first.';
  }

  if (!params.resource) {
    return '❌ Provide resource key to lock/unlock.';
  }

  const action = params.lock_action || 'check';

  if (action === 'acquire') {
    const acquired = mesh.acquireLock(params.resource, params.purpose, params.ttl_ms);
    if (acquired) {
      return `🔒 Lock acquired: ${params.resource}\n` +
        `Purpose: ${params.purpose || '(none)'}\n` +
        `TTL: ${params.ttl_ms || 30000}ms`;
    } else {
      const existing = mesh.getLock(params.resource);
      return `⚠️ Lock NOT acquired — resource already locked.\n\n` +
        `Held by: ${existing?.instance_id.slice(0, 12) || 'unknown'}... (PID ${existing?.pid || '?'})\n` +
        `Purpose: ${existing?.purpose || '(none)'}\n` +
        `Since: ${existing ? timeAgo(existing.acquired_at) : '?'}`;
    }
  }

  if (action === 'release') {
    mesh.releaseLock(params.resource);
    return `🔓 Lock released: ${params.resource}`;
  }

  // check
  const lock = mesh.getLock(params.resource);
  if (!lock) {
    return `✅ Resource not locked: ${params.resource}`;
  }

  return `🔒 Resource locked: ${params.resource}\n` +
    `Held by: ${lock.instance_id.slice(0, 12)}... (PID ${lock.pid})\n` +
    `Purpose: ${lock.purpose || '(none)'}\n` +
    `Since: ${timeAgo(lock.acquired_at)} | TTL: ${lock.ttl_ms}ms`;
}

function handlePeers(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    return '❌ Mesh not active. Run `mesh init` first.';
  }

  const peers = mesh.getPeers();
  if (peers.length === 0) {
    return '🔇 No peers found.\n\nYou are the only M7 instance on the mesh.\nStart another Cursor window with M7 to see mesh networking.';
  }

  let output = `📡 MESH PEERS (${peers.length})\n${'═'.repeat(50)}\n\n`;
  for (const peer of peers) {
    output += `Instance: ${peer.instance_id}\n`;
    output += `  PID: ${peer.pid}\n`;
    output += `  Role: ${peer.server_role || '(none)'}\n`;
    output += `  Project: ${peer.project_root}\n`;
    output += `  Capabilities: ${(peer.capabilities || []).join(', ')}\n`;
    output += `  Started: ${formatTimestamp(peer.started_at)}\n`;
    output += `  Heartbeat: ${timeAgo(peer.last_heartbeat)}\n\n`;
  }

  return output.trim();
}

function handleProposeIntent(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    return '❌ Mesh not active. Run `mesh init` first.';
  }

  if (!params.intent_type || !params.description) {
    return '❌ Provide intent_type and description.';
  }

  const intentId = mesh.proposeIntent(
    params.intent_type as IntentType,
    params.description,
    params.resource
  );

  return `🎯 Intent proposed: ${intentId}\n\n` +
    `Type: ${params.intent_type}\n` +
    `Description: ${params.description}\n` +
    `Resource: ${params.resource || '(none)'}\n\n` +
    `Status: PROPOSED — waiting for peer acknowledgment.`;
}

function handleEvents(params: any): string {
  const mesh = getMeshManager();

  if (!mesh.isActive()) {
    return '❌ Mesh not active. Run `mesh init` first.';
  }

  const limit = params.limit || 20;
  const events = mesh.getRecentEvents(limit);

  if (events.length === 0) {
    return '📜 No mesh events recorded yet.';
  }

  let output = `📜 RECENT MESH EVENTS (${events.length})\n${'═'.repeat(50)}\n\n`;
  for (const event of events) {
    output += `  [${formatTimestamp(event.timestamp)}] ${event.event_type.toUpperCase()}\n`;
    output += `    Instance: ${event.instance_id.slice(0, 12)}...\n`;
    try {
      const payload = JSON.parse(event.payload);
      output += `    Details: ${JSON.stringify(payload)}\n`;
    } catch {
      output += `    Details: ${event.payload}\n`;
    }
    output += '\n';
  }

  return output.trim();
}

// ─── Remote Handlers (v10) ──────────────────────────────────────────────────

function parseSince(since?: string): number | undefined {
  if (!since) return undefined;
  const num = parseInt(since, 10);
  if (!isNaN(num)) return num;
  const match = since.match(/^(\d+)(h|m|d)$/);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === 'h' ? val * 3600000 : unit === 'm' ? val * 60000 : val * 86400000;
    return Date.now() - ms;
  }
  return undefined;
}

async function handleRemoteSync(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected. Set M7_MESH_RELAY, M7_MESH_SECRET, M7_WORKSTATION.';

  const result = await transport.sync({
    current_task: params.content,
    module: params.module,
    status: 'active',
  });

  let output = `🔗 MESH SYNC COMPLETE\n${'═'.repeat(50)}\n\n`;

  output += `📡 PEERS (${result.peers.length})\n`;
  for (const peer of result.peers) {
    const statusIcon = peer.status === 'active' ? '🟢' : '⚪';
    output += `  ${statusIcon} ${peer.workstation}: ${peer.current_task || '(idle)'}\n`;
    if (peer.module) output += `     Module: ${peer.module}\n`;
    if (peer.blockers?.length) output += `     ⚠️ Blockers: ${peer.blockers.join(', ')}\n`;
    if (peer.recently_changed?.length) output += `     📝 Recently changed: ${peer.recently_changed.join(', ')}\n`;
  }

  if (result.changes.length > 0) {
    output += `\n⚠️ FILE CHANGES BY PEERS (${result.changes.length})\n`;
    output += `   Твои локальные файлы МОГУТ БЫТЬ УСТАРЕВШИМИ:\n`;
    for (const c of result.changes) {
      output += `   - ${c.workstation}: ${c.action} ${c.path}${c.summary ? ' — ' + c.summary : ''}\n`;
    }
  }

  if (result.messages.length > 0) {
    output += `\n📬 UNREAD MESSAGES (${result.messages.length})\n`;
    for (const m of result.messages) {
      const typeIcon = m.type === 'question' ? '❓' : m.type === 'broadcast' ? '📢' : '💬';
      output += `   ${typeIcon} [${m.id}] от ${m.from}: ${m.content.slice(0, 150)}\n`;
    }
  }

  if (result.peers.length === 0 && result.changes.length === 0 && result.messages.length === 0) {
    output += '\n✅ Всё чисто. Нет обновлений от peers.\n';
  }

  return output.trim();
}

async function handleRemotePush(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';
  if (!params.path || !params.content) return '❌ path and content required.';

  await transport.pushFile(params.path, params.content);
  return `📤 Pushed: ${params.path} (${Buffer.byteLength(params.content, 'utf-8')} bytes)`;
}

async function handleRemotePull(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';
  if (!params.path) return '❌ path required.';

  const file = await transport.pullFile(params.path);
  if (!file) return `❌ File not found on relay: ${params.path}`;
  return `📥 ${file.path} (by ${file.author}, ${formatTimestamp(file.updated_at)})\n\n${file.content}`;
}

async function handleRemoteNotify(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';
  if (!params.path) return '❌ path required.';

  await transport.notifyChange(params.path, params.file_action || 'modified', params.summary || '');
  return `📢 Notified peers: ${params.file_action || 'modified'} ${params.path}${params.summary ? ' — ' + params.summary : ''}`;
}

async function handleRemoteChanges(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const since = parseSince(params.since);
  const changes = await transport.getChanges(since);

  if (changes.length === 0) return '✅ No file changes from peers.';

  let output = `📋 FILE CHANGES (${changes.length})\n${'─'.repeat(40)}\n\n`;
  for (const c of changes) {
    output += `  [${formatTimestamp(c.timestamp)}] ${c.workstation}: ${c.action} ${c.path}\n`;
    if (c.summary) output += `    → ${c.summary}\n`;
  }
  return output.trim();
}

async function handleRemoteAsk(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const to = params.to || 'all';
  const content = params.question || params.content;
  if (!content) return '❌ question required.';

  const msgId = await transport.sendMessage(to, 'question', content);
  return `❓ Question sent to ${to}: "${content.slice(0, 100)}"\nMessage ID: ${msgId}`;
}

async function handleRemoteReply(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const msgId = params.message_id;
  const content = params.answer || params.content;
  if (!msgId || !content) return '❌ message_id and answer required.';

  const replyId = await transport.replyToMessage(msgId, content);
  return `✅ Reply sent (${replyId})`;
}

async function handleRemoteInbox(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const messages = await transport.getMessages({ unread: true });
  if (messages.length === 0) return '📭 Inbox empty — no unread messages.';

  let output = `📬 INBOX (${messages.length} unread)\n${'═'.repeat(50)}\n\n`;
  for (const m of messages) {
    const typeIcon = m.type === 'question' ? '❓' : m.type === 'answer' ? '✅' : m.type === 'broadcast' ? '📢' : '💬';
    output += `${typeIcon} [${m.id}] от ${m.from} (${timeAgo(m.created_at)})\n`;
    output += `   ${m.content}\n`;
    if (m.parent_id) output += `   ↩ Reply to: ${m.parent_id}\n`;
    output += '\n';
  }
  return output.trim();
}

async function handleRemoteBroadcast(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const content = params.message || params.content;
  if (!content) return '❌ message required.';

  const msgId = await transport.sendMessage('all', 'broadcast', content);
  return `📢 Broadcast sent: "${content.slice(0, 100)}"\nMessage ID: ${msgId}`;
}

async function handleRemoteLogTask(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const taskId = params.task_id;
  const title = params.title;
  if (!taskId || !title) return '❌ task_id and title required.';

  await transport.logTask({
    id: taskId,
    workstation: mesh.getWorkstation(),
    title,
    status: (params.task_status || 'in_progress') as any,
    summary: params.summary || params.description || '',
    module: params.module,
    files_changed: params.files_changed,
    started_at: Date.now(),
    completed_at: params.task_status === 'completed' ? Date.now() : undefined,
  });

  return `📋 Task logged: ${taskId} — ${title} [${params.task_status || 'in_progress'}]`;
}

async function handleRemoteTasks(params: any): Promise<string> {
  const mesh = getMeshManager();
  const transport = mesh.getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const tasks = await transport.getTasks({
    status: params.task_status || 'all',
    limit: params.limit || 20,
  });

  if (tasks.length === 0) return '📋 No tasks logged yet.';

  let output = `📋 TASK INDEX (${tasks.length})\n${'═'.repeat(50)}\n\n`;
  for (const t of tasks) {
    const icon = t.status === 'completed' ? '✅' : t.status === 'blocked' ? '🔴' : '🔄';
    output += `${icon} [${t.workstation}] ${t.title}\n`;
    output += `   ID: ${t.id} | Module: ${t.module || '—'} | ${t.status}\n`;
    if (t.summary) output += `   ${t.summary}\n`;
    if (t.files_changed?.length) output += `   Files: ${t.files_changed.join(', ')}\n`;
    output += '\n';
  }
  return output.trim();
}

// ─── File Exchange Handlers (v10.1) ─────────────────────────────────────────

const BLOCKED_EXTENSIONS = ['.env', '.key', '.pem', '.p12', '.pfx', '.jks', '.keystore'];

function resolveAndValidatePath(relativePath: string): string {
  const projectPath = getProjectPath();
  const resolved = pathModule.resolve(projectPath, relativePath);
  if (!resolved.startsWith(projectPath)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return resolved;
}

async function handleRemotePushFile(params: any): Promise<string> {
  const transport = getMeshManager().getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';
  if (!params.path) return '❌ path required.';

  const ext = pathModule.extname(params.path).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return `❌ Blocked: ${ext} files cannot be pushed (security).`;
  }

  const resolved = resolveAndValidatePath(params.path);

  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf-8');
  } catch (e: any) {
    if (e.code === 'ENOENT') return `❌ File not found: ${params.path}`;
    return `❌ Read error: ${e.message}`;
  }

  const size = Buffer.byteLength(content, 'utf-8');

  await transport.pushFile(params.path, content);
  await transport.notifyChange(params.path, 'modified', `pushed via mesh (${(size / 1024).toFixed(1)}KB)`);

  return `📤 Pushed: ${params.path} (${(size / 1024).toFixed(1)}KB) → relay. Peer notified.`;
}

async function handleRemotePullFile(params: any): Promise<string> {
  const transport = getMeshManager().getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';
  if (!params.path) return '❌ path required.';

  const file = await transport.pullFile(params.path);
  if (!file) return `❌ File not found on relay: ${params.path}`;

  const resolved = resolveAndValidatePath(params.path);
  await fs.mkdir(pathModule.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, file.content, 'utf-8');

  return `📥 Pulled: ${params.path} (${(file.size / 1024).toFixed(1)}KB, by ${file.author}, ${formatTimestamp(file.updated_at)}) → saved to disk.`;
}

async function handleRemoteListFiles(params: any): Promise<string> {
  const transport = getMeshManager().getRemoteTransport();
  if (!transport) return '❌ Remote mesh not connected.';

  const since = parseSince(params.since);
  const files = await transport.listFiles(since);

  if (files.length === 0) return '📁 No shared files on relay.';

  let output = `📁 SHARED FILES (${files.length})\n${'═'.repeat(50)}\n\n`;
  for (const f of files) {
    output += `  ${f.path}\n`;
    output += `    Author: ${f.author} | Size: ${(f.size / 1024).toFixed(1)}KB | Updated: ${formatTimestamp(f.updated_at)}\n\n`;
  }
  output += `\nUse \`mesh pull-file path="<path>"\` to download.`;
  return output.trim();
}

// ─── Main Handler ───────────────────────────────────────────────────────────

async function handler(request: any): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const params = MeshToolSchema.parse(request);

    let result: string;

    switch (params.action) {
      // Legacy local mesh actions
      case 'init': {
        // Try remote first, fall back to local
        const mesh = getMeshManager();
        const remoteOk = await mesh.initRemote();
        if (remoteOk) {
          const states = await mesh.getRemoteTransport()!.getAllStates();
          const active = states.filter(s => s.status === 'active').length;
          result = `🔗 Connected to remote relay!\n\nWorkstation: ${mesh.getWorkstation()}\nActive peers: ${active}\n\nUse \`mesh sync\` for full status.`;
        } else {
          result = handleInit(params);
        }
        break;
      }
      case 'status': {
        const mesh = getMeshManager();
        if (mesh.isRemoteMode()) {
          result = await handleRemoteSync(params);
        } else {
          result = handleStatus(params);
        }
        break;
      }
      case 'announce':
        result = handleAnnounce(params);
        break;
      case 'request_context':
        result = handleRequestContext(params);
        break;
      case 'task_lock':
        result = handleTaskLock(params);
        break;
      case 'peers':
        result = handlePeers(params);
        break;
      case 'propose_intent':
        result = handleProposeIntent(params);
        break;
      case 'events':
        result = handleEvents(params);
        break;
      // v10 Remote relay actions
      case 'sync':
        result = await handleRemoteSync(params);
        break;
      case 'push':
        result = await handleRemotePush(params);
        break;
      case 'pull':
        result = await handleRemotePull(params);
        break;
      case 'notify':
        result = await handleRemoteNotify(params);
        break;
      case 'changes':
        result = await handleRemoteChanges(params);
        break;
      case 'ask':
        result = await handleRemoteAsk(params);
        break;
      case 'reply':
        result = await handleRemoteReply(params);
        break;
      case 'inbox':
        result = await handleRemoteInbox(params);
        break;
      case 'broadcast':
        result = await handleRemoteBroadcast(params);
        break;
      case 'log_task':
        result = await handleRemoteLogTask(params);
        break;
      case 'tasks':
        result = await handleRemoteTasks(params);
        break;
      case 'push-file':
        result = await handleRemotePushFile(params);
        break;
      case 'pull-file':
        result = await handleRemotePullFile(params);
        break;
      case 'list-files':
        result = await handleRemoteListFiles(params);
        break;
      default:
        result = `Unknown action: ${params.action}`;
    }

    return { content: [{ type: 'text', text: result }] };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Mesh error: ${error.message || String(error)}`
      }]
    };
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const meshTool = {
  name: 'mcp_m7_mesh',
  description: `M7 Mesh — Multi-instance communication and coordination.

Connects M7 instances across machines via relay server, or locally via SQLite.

## Remote Relay Actions (set M7_MESH_RELAY, M7_MESH_SECRET, M7_WORKSTATION):
- **sync**: Full sync — push state, pull peers/changes/messages
- **push**: Push shared doc to relay (path, content)
- **pull**: Pull shared doc from relay (path)
- **notify**: Notify peers about file change (path, summary)
- **changes**: View file change feed from peers
- **ask**: Ask a question to specific peer or all (to, question)
- **reply**: Reply to a message (message_id, answer)
- **inbox**: View unread messages
- **broadcast**: Send note to all peers (message)
- **log_task**: Register M7 task in shared index (task_id, title, status, summary)
- **tasks**: View shared task index
- **push-file**: Read local file and push to relay (path) — auto-notifies peer
- **pull-file**: Pull file from relay and save to local disk (path)
- **list-files**: List all shared files on relay

## Local Mesh Actions (legacy):
- **init**: Initialize mesh (auto-detects remote if configured)
- **status**: Show mesh health
- **announce**: Publish context
- **peers**: List peers
- **request_context**: Query peer context`,

  inputSchema: MeshToolSchema,
  handler,
};
