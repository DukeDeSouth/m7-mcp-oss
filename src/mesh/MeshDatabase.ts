/**
 * M7 Mesh Database — SQLite WAL wrapper for multi-instance state
 * @module mesh/MeshDatabase
 * @since v8.0
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import {
  MeshInstance,
  SharedContext,
  MeshIntent,
  IntentState,
  LockInfo,
  MeshEvent,
} from './types.js';

export class MeshDatabase {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Enable WAL mode for concurrent reads + single writer
    this.db.pragma('journal_mode = WAL');
    // Wait up to 5s if another writer holds the lock
    this.db.pragma('busy_timeout = 5000');
    // Foreign keys for cascading deletes
    this.db.pragma('foreign_keys = ON');
  }

  // ─── Schema ──────────────────────────────────────────────────────────────

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instances (
        instance_id    TEXT PRIMARY KEY,
        pid            INTEGER NOT NULL,
        project_root   TEXT NOT NULL,
        server_role    TEXT,
        capabilities   TEXT,
        started_at     INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        status         TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS shared_context (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id    TEXT NOT NULL,
        context_type   TEXT NOT NULL,
        scope          TEXT,
        content        TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER,
        FOREIGN KEY (instance_id) REFERENCES instances(instance_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ctx_instance ON shared_context(instance_id);
      CREATE INDEX IF NOT EXISTS idx_ctx_type ON shared_context(context_type);

      CREATE TABLE IF NOT EXISTS intents (
        intent_id      TEXT PRIMARY KEY,
        instance_id    TEXT NOT NULL,
        intent_type    TEXT NOT NULL,
        resource       TEXT,
        description    TEXT NOT NULL,
        state          TEXT DEFAULT 'proposed',
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES instances(instance_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS event_log (
        event_id       INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id    TEXT NOT NULL,
        event_type     TEXT NOT NULL,
        payload        TEXT NOT NULL,
        timestamp      INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resource_locks (
        resource_key   TEXT PRIMARY KEY,
        instance_id    TEXT NOT NULL,
        pid            INTEGER NOT NULL,
        acquired_at    INTEGER NOT NULL,
        ttl_ms         INTEGER NOT NULL DEFAULT 30000,
        purpose        TEXT
      );
    `);
  }

  // ─── Instances ───────────────────────────────────────────────────────────

  private _registerStmt: any;
  registerInstance(inst: MeshInstance): void {
    if (!this._registerStmt) {
      this._registerStmt = this.db.prepare(`
        INSERT OR REPLACE INTO instances 
        (instance_id, pid, project_root, server_role, capabilities, started_at, last_heartbeat, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    this._registerStmt.run(
      inst.instance_id,
      inst.pid,
      inst.project_root,
      inst.server_role || null,
      inst.capabilities ? JSON.stringify(inst.capabilities) : null,
      inst.started_at,
      inst.last_heartbeat,
      inst.status
    );
  }

  private _heartbeatStmt: any;
  updateHeartbeat(instanceId: string): void {
    if (!this._heartbeatStmt) {
      this._heartbeatStmt = this.db.prepare(
        `UPDATE instances SET last_heartbeat = ? WHERE instance_id = ?`
      );
    }
    this._heartbeatStmt.run(Date.now(), instanceId);
  }

  private _removeInstanceStmt: any;
  removeInstance(instanceId: string): void {
    if (!this._removeInstanceStmt) {
      this._removeInstanceStmt = this.db.prepare(
        `DELETE FROM instances WHERE instance_id = ?`
      );
    }
    this._removeInstanceStmt.run(instanceId);
  }

  getActiveInstances(staleCutoffMs: number): MeshInstance[] {
    const cutoff = Date.now() - staleCutoffMs;
    const rows = this.db.prepare(
      `SELECT * FROM instances WHERE last_heartbeat > ? AND status = 'active'`
    ).all(cutoff) as any[];

    return rows.map(r => ({
      ...r,
      capabilities: r.capabilities ? JSON.parse(r.capabilities) : undefined,
    }));
  }

  getAllInstances(): MeshInstance[] {
    const rows = this.db.prepare(`SELECT * FROM instances`).all() as any[];
    return rows.map(r => ({
      ...r,
      capabilities: r.capabilities ? JSON.parse(r.capabilities) : undefined,
    }));
  }

  // ─── Shared Context ─────────────────────────────────────────────────────

  private _upsertCtxStmt: any;
  upsertContext(ctx: SharedContext): void {
    if (!this._upsertCtxStmt) {
      this._upsertCtxStmt = this.db.prepare(`
        INSERT INTO shared_context (instance_id, context_type, scope, content, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
    }
    this._upsertCtxStmt.run(
      ctx.instance_id,
      ctx.context_type,
      ctx.scope || null,
      ctx.content,
      ctx.created_at || Date.now(),
      ctx.expires_at || null
    );
  }

  getContextByInstance(instanceId: string): SharedContext[] {
    return this.db.prepare(
      `SELECT * FROM shared_context WHERE instance_id = ? ORDER BY created_at DESC`
    ).all(instanceId) as SharedContext[];
  }

  getAllContexts(): SharedContext[] {
    const now = Date.now();
    return this.db.prepare(
      `SELECT * FROM shared_context WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC`
    ).all(now) as SharedContext[];
  }

  deleteContextByInstance(instanceId: string): void {
    this.db.prepare(
      `DELETE FROM shared_context WHERE instance_id = ?`
    ).run(instanceId);
  }

  // ─── Intents ────────────────────────────────────────────────────────────

  insertIntent(intent: MeshIntent): void {
    this.db.prepare(`
      INSERT INTO intents (intent_id, instance_id, intent_type, resource, description, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      intent.intent_id,
      intent.instance_id,
      intent.intent_type,
      intent.resource || null,
      intent.description,
      intent.state,
      intent.created_at,
      intent.updated_at
    );
  }

  updateIntentState(intentId: string, state: IntentState): void {
    this.db.prepare(
      `UPDATE intents SET state = ?, updated_at = ? WHERE intent_id = ?`
    ).run(state, Date.now(), intentId);
  }

  getActiveIntents(): MeshIntent[] {
    return this.db.prepare(
      `SELECT * FROM intents WHERE state IN ('proposed', 'acknowledged', 'committed') ORDER BY created_at DESC`
    ).all() as MeshIntent[];
  }

  // ─── Resource Locks ─────────────────────────────────────────────────────

  tryAcquireLock(key: string, instanceId: string, pid: number, ttlMs: number, purpose?: string): boolean {
    const now = Date.now();

    // First, remove expired locks
    this.db.prepare(
      `DELETE FROM resource_locks WHERE resource_key = ? AND (acquired_at + ttl_ms) < ?`
    ).run(key, now);

    // Try to insert (fails if key already exists and not expired)
    try {
      this.db.prepare(`
        INSERT INTO resource_locks (resource_key, instance_id, pid, acquired_at, ttl_ms, purpose)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(key, instanceId, pid, now, ttlMs, purpose || null);
      return true;
    } catch {
      // UNIQUE constraint violated — lock held by someone else
      return false;
    }
  }

  releaseLock(key: string, instanceId: string): void {
    this.db.prepare(
      `DELETE FROM resource_locks WHERE resource_key = ? AND instance_id = ?`
    ).run(key, instanceId);
  }

  getLock(key: string): LockInfo | null {
    const now = Date.now();
    const row = this.db.prepare(
      `SELECT * FROM resource_locks WHERE resource_key = ? AND (acquired_at + ttl_ms) > ?`
    ).get(key, now) as LockInfo | undefined;
    return row || null;
  }

  getAllLocks(): LockInfo[] {
    const now = Date.now();
    return this.db.prepare(
      `SELECT * FROM resource_locks WHERE (acquired_at + ttl_ms) > ?`
    ).all(now) as LockInfo[];
  }

  // ─── Events ─────────────────────────────────────────────────────────────

  logEvent(event: MeshEvent): void {
    this.db.prepare(`
      INSERT INTO event_log (instance_id, event_type, payload, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(event.instance_id, event.event_type, event.payload, event.timestamp || Date.now());
  }

  getRecentEvents(limit: number = 50): MeshEvent[] {
    return this.db.prepare(
      `SELECT * FROM event_log ORDER BY timestamp DESC LIMIT ?`
    ).all(limit) as MeshEvent[];
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  removeStaleInstances(cutoffMs: number): string[] {
    const cutoff = Date.now() - cutoffMs;
    const stale = this.db.prepare(
      `SELECT instance_id FROM instances WHERE last_heartbeat < ? AND status = 'active'`
    ).all(cutoff) as { instance_id: string }[];

    const ids = stale.map(s => s.instance_id);

    if (ids.length > 0) {
      // CASCADE deletes shared_context + intents
      const deleteStmt = this.db.prepare(`DELETE FROM instances WHERE instance_id = ?`);
      const deleteLocksStmt = this.db.prepare(`DELETE FROM resource_locks WHERE instance_id = ?`);
      
      const tx = this.db.transaction(() => {
        for (const id of ids) {
          deleteStmt.run(id);
          deleteLocksStmt.run(id);
        }
      });
      tx();
    }

    return ids;
  }

  removeExpiredLocks(): number {
    const now = Date.now();
    const result = this.db.prepare(
      `DELETE FROM resource_locks WHERE (acquired_at + ttl_ms) < ?`
    ).run(now);
    return result.changes;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed or error — ignore
    }
  }
}
