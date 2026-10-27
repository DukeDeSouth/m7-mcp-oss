/**
 * M7 Mesh Relay — In-memory Store with JSON persistence
 * Zero dependencies. Runs standalone on VPS.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface WorkstationState {
  workstation: string;
  current_task?: string;
  current_task_id?: string;
  module?: string;
  blockers?: string[];
  recently_changed?: string[];
  last_heartbeat: number;
  status: 'active' | 'idle' | 'offline';
}

export interface FileEntry {
  path: string;
  content: string;
  author: string;
  updated_at: number;
  size: number;
}

export interface FileChange {
  id: string;
  path: string;
  action: 'created' | 'modified' | 'deleted' | 'renamed';
  summary: string;
  workstation: string;
  timestamp: number;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  type: 'question' | 'answer' | 'note' | 'broadcast';
  content: string;
  parent_id?: string;
  status: 'unread' | 'read';
  created_at: number;
}

export interface TaskEntry {
  id: string;
  workstation: string;
  title: string;
  status: 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  summary: string;
  module?: string;
  files_changed?: string[];
  started_at: number;
  completed_at?: number;
}

interface StoreSnapshot {
  state: Record<string, WorkstationState>;
  files: Record<string, FileEntry>;
  changes: FileChange[];
  messages: Message[];
  tasks: TaskEntry[];
  saved_at: number;
}

const MAX_CHANGES = 1000;
const MAX_MESSAGES = 500;
const MAX_TASKS = 200;
const STALE_TIMEOUT_MS = 90_000;
const TTL_7_DAYS = 7 * 24 * 60 * 60 * 1000;

export class RelayStore {
  state = new Map<string, WorkstationState>();
  files = new Map<string, FileEntry>();
  changes: FileChange[] = [];
  messages: Message[] = [];
  tasks: TaskEntry[] = [];

  private backupPath: string;
  private backupTimer: ReturnType<typeof setInterval> | null = null;
  private msgCounter = 0;
  private changeCounter = 0;

  constructor(backupPath: string) {
    this.backupPath = backupPath;
    this.restore();
    this.startBackupTimer();
  }

  // ─── State ──────────────────────────────────────────────────────────────

  setState(ws: string, s: Partial<WorkstationState>): WorkstationState {
    const existing = this.state.get(ws);
    const updated: WorkstationState = {
      workstation: ws,
      status: 'active',
      ...existing,
      ...s,
      last_heartbeat: Date.now(),
    };
    this.state.set(ws, updated);
    return updated;
  }

  getAllStates(): WorkstationState[] {
    this.markStale();
    return [...this.state.values()];
  }

  // ─── Files ──────────────────────────────────────────────────────────────

  putFile(path: string, content: string, author: string): FileEntry {
    const entry: FileEntry = {
      path,
      content,
      author,
      updated_at: Date.now(),
      size: Buffer.byteLength(content, 'utf-8'),
    };
    this.files.set(path, entry);
    return entry;
  }

  getFile(path: string): FileEntry | null {
    return this.files.get(path) || null;
  }

  listFiles(since?: number): FileEntry[] {
    const entries = [...this.files.values()];
    if (since) return entries.filter(f => f.updated_at > since);
    return entries;
  }

  // ─── Changes ────────────────────────────────────────────────────────────

  addChange(c: Omit<FileChange, 'id' | 'timestamp'>): FileChange {
    const change: FileChange = {
      ...c,
      id: `ch_${Date.now()}_${++this.changeCounter}`,
      timestamp: Date.now(),
    };
    this.changes.push(change);
    if (this.changes.length > MAX_CHANGES) {
      this.changes = this.changes.slice(-MAX_CHANGES);
    }
    return change;
  }

  getChanges(since?: number): FileChange[] {
    if (since) return this.changes.filter(c => c.timestamp > since);
    return [...this.changes];
  }

  // ─── Messages ───────────────────────────────────────────────────────────

  addMessage(m: Omit<Message, 'id' | 'status' | 'created_at'>): Message {
    const msg: Message = {
      ...m,
      id: `msg_${Date.now()}_${++this.msgCounter}`,
      status: 'unread',
      created_at: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    return msg;
  }

  getMessages(opts?: { for?: string; unread?: boolean }): Message[] {
    let result = [...this.messages];
    if (opts?.for) {
      result = result.filter(m => m.to === opts.for || m.to === 'all');
    }
    if (opts?.unread) {
      result = result.filter(m => m.status === 'unread');
    }
    return result;
  }

  getMessage(id: string): Message | undefined {
    return this.messages.find(m => m.id === id);
  }

  markRead(id: string): boolean {
    const msg = this.messages.find(m => m.id === id);
    if (msg) { msg.status = 'read'; return true; }
    return false;
  }

  // ─── Tasks ──────────────────────────────────────────────────────────────

  upsertTask(t: TaskEntry): TaskEntry {
    const idx = this.tasks.findIndex(x => x.id === t.id);
    if (idx >= 0) {
      this.tasks[idx] = { ...this.tasks[idx], ...t };
      return this.tasks[idx];
    }
    this.tasks.push(t);
    if (this.tasks.length > MAX_TASKS) {
      this.tasks = this.tasks.slice(-MAX_TASKS);
    }
    return t;
  }

  getTasks(opts?: { status?: string; limit?: number }): TaskEntry[] {
    let result = [...this.tasks];
    if (opts?.status && opts.status !== 'all') {
      result = result.filter(t => t.status === opts.status);
    }
    result.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
    if (opts?.limit) result = result.slice(0, opts.limit);
    return result;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  private markStale(): void {
    const cutoff = Date.now() - STALE_TIMEOUT_MS;
    for (const [ws, s] of this.state) {
      if (s.last_heartbeat < cutoff && s.status === 'active') {
        s.status = 'offline';
      }
    }
  }

  cleanup(): void {
    const cutoff = Date.now() - TTL_7_DAYS;
    this.changes = this.changes.filter(c => c.timestamp > cutoff);
    this.messages = this.messages.filter(m => m.created_at > cutoff);
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  backup(): void {
    try {
      const dir = dirname(this.backupPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const snapshot: StoreSnapshot = {
        state: Object.fromEntries(this.state),
        files: Object.fromEntries(this.files),
        changes: this.changes,
        messages: this.messages,
        tasks: this.tasks,
        saved_at: Date.now(),
      };
      writeFileSync(this.backupPath, JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.error('[relay] Backup failed:', e);
    }
  }

  private restore(): void {
    try {
      if (!existsSync(this.backupPath)) return;
      const raw = readFileSync(this.backupPath, 'utf-8');
      const snap: StoreSnapshot = JSON.parse(raw);

      this.state = new Map(Object.entries(snap.state || {}));
      this.files = new Map(Object.entries(snap.files || {}));
      this.changes = snap.changes || [];
      this.messages = snap.messages || [];
      this.tasks = snap.tasks || [];

      // Mark all states as offline on restart — they'll heartbeat back
      for (const s of this.state.values()) s.status = 'offline';

      console.log(`[relay] Restored: ${this.state.size} workstations, ${this.files.size} files, ${this.tasks.length} tasks`);
    } catch (e) {
      console.error('[relay] Restore failed, starting fresh:', e);
    }
  }

  private startBackupTimer(): void {
    this.backupTimer = setInterval(() => {
      this.cleanup();
      this.backup();
    }, 5 * 60 * 1000);
    this.backupTimer.unref();
  }

  shutdown(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
    this.backup();
  }
}
