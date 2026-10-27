/**
 * M7 Mesh Manager — Singleton lifecycle manager for multi-instance communication
 * 
 * Handles: discovery, heartbeat, context sharing, intent protocol, resource locks.
 * Uses SQLite WAL + filesystem signals for IPC on the same machine.
 * 
 * @module mesh/MeshManager
 * @since v8.0
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { MeshDatabase } from './MeshDatabase.js';
import { MeshSignals } from './MeshSignals.js';
import {
  MeshInstance,
  SharedContext,
  ContextType,
  MeshIntent,
  IntentType,
  IntentState,
  LockInfo,
  MeshPeerContext,
  MeshConfig,
  DEFAULT_MESH_CONFIG,
  SignalType,
} from './types.js';
import type { MeshTransport } from './transport/MeshTransport.js';
import { RemoteTransport } from './transport/RemoteTransport.js';

// ─── Singleton ──────────────────────────────────────────────────────────────

let _meshInstance: MeshManager | null = null;

export function getMeshManager(): MeshManager {
  if (!_meshInstance) {
    _meshInstance = new MeshManager();
  }
  return _meshInstance;
}

// ─── Remote mode detection ──────────────────────────────────────────────────

function getRelayConfig(): { url: string; secret: string; workstation: string } | null {
  const url = process.env.M7_MESH_RELAY;
  const secret = process.env.M7_MESH_SECRET;
  const workstation = process.env.M7_WORKSTATION;
  if (url && secret && workstation) return { url, secret, workstation };
  return null;
}

// ─── PID Checking ───────────────────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Manager Class ──────────────────────────────────────────────────────────

export class MeshManager {
  private config: MeshConfig;
  private db: MeshDatabase | null = null;
  private signals: MeshSignals | null = null;
  private instanceId: string = '';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private active = false;

  // v10: Remote transport for multi-machine mesh
  private remoteTransport: RemoteTransport | null = null;
  private remoteMode = false;

  constructor() {
    this.config = {
      ...DEFAULT_MESH_CONFIG,
      meshDir: join(homedir(), '.m7', 'mesh'),
    };
  }

  // ─── Remote Transport Access ───────────────────────────────────────────

  isRemoteMode(): boolean {
    return this.remoteMode;
  }

  getRemoteTransport(): RemoteTransport | null {
    return this.remoteTransport;
  }

  getWorkstation(): string {
    const cfg = getRelayConfig();
    return cfg?.workstation || `local-${process.pid}`;
  }

  /**
   * Initialize remote transport if M7_MESH_RELAY is configured.
   * Can be called alongside or instead of local init().
   */
  async initRemote(): Promise<boolean> {
    const cfg = getRelayConfig();
    if (!cfg) return false;

    this.remoteTransport = new RemoteTransport(cfg.url, cfg.secret, cfg.workstation);
    try {
      await this.remoteTransport.connect();
      this.remoteMode = true;
      this.active = true;
      return true;
    } catch (e: any) {
      this.remoteTransport = null;
      return false;
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize mesh subsystem: create dirs, open DB, clean stale, start watcher.
   * Safe to call multiple times (idempotent).
   */
  init(meshDir?: string): void {
    if (this.active) return;

    if (meshDir) {
      this.config.meshDir = meshDir;
    }

    // Create directory structure
    const dir = this.config.meshDir;
    const signalsDir = join(dir, 'signals');
    const presenceDir = join(dir, 'presence');

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(signalsDir)) {
      mkdirSync(signalsDir, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(presenceDir)) {
      mkdirSync(presenceDir, { recursive: true, mode: 0o700 });
    }

    // Generate mesh secret if not exists
    const secretPath = join(dir, 'mesh.secret');
    if (!existsSync(secretPath)) {
      writeFileSync(secretPath, randomUUID(), { mode: 0o600 });
    }

    // Open database
    const dbPath = join(dir, 'mesh.db');
    this.db = new MeshDatabase(dbPath);
    this.db.initialize();

    // Clean stale instances (check PID)
    this.cleanStale();

    // Start signal watcher
    this.signals = new MeshSignals(signalsDir);
    this.signals.start((type, instanceId) => {
      // Signal received from another instance — can trigger UI refresh, etc.
      // For now, just clean stale on any signal
      this.cleanStale();
    });

    this.active = true;
  }

  /**
   * Join the mesh network. Registers this instance in the database.
   */
  join(serverRole?: string, projectRoot?: string): void {
    if (!this.active || !this.db) {
      throw new Error('Mesh not initialized. Call init() first.');
    }

    this.instanceId = randomUUID();
    const now = Date.now();

    const instance: MeshInstance = {
      instance_id: this.instanceId,
      pid: process.pid,
      project_root: projectRoot || process.cwd(),
      server_role: serverRole,
      capabilities: ['context', 'intents', 'locks'],
      started_at: now,
      last_heartbeat: now,
      status: 'active',
    };

    this.db.registerInstance(instance);

    // Write presence file for debugging
    this.writePresence(instance);

    // Log join event
    this.db.logEvent({
      instance_id: this.instanceId,
      event_type: 'joined',
      payload: JSON.stringify({ pid: process.pid, role: serverRole }),
      timestamp: now,
    });

    // Emit signal
    this.signals?.emit('joined', this.instanceId);

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Leave the mesh. Deregisters instance, cleans up resources.
   */
  leave(): void {
    if (!this.active || !this.db || !this.instanceId) return;

    // Stop heartbeat
    this.stopHeartbeat();

    // Log leave event
    try {
      this.db.logEvent({
        instance_id: this.instanceId,
        event_type: 'left',
        payload: JSON.stringify({ pid: process.pid }),
        timestamp: Date.now(),
      });
    } catch { /* DB may be closing */ }

    // Remove instance (CASCADE deletes context + intents)
    try {
      this.db.removeInstance(this.instanceId);
    } catch { /* ignore */ }

    // Remove presence file
    this.removePresence();

    // Emit signal
    try {
      this.signals?.emit('left', this.instanceId);
    } catch { /* ignore */ }

    // Close resources
    this.signals?.stop();
    this.db.close();

    this.active = false;
    this.db = null;
    this.signals = null;
    this.instanceId = '';
  }

  /**
   * Check if mesh is initialized and active.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Check if mesh directory exists (can be used before init).
   */
  meshExists(): boolean {
    return existsSync(this.config.meshDir);
  }

  /**
   * Get this instance's ID.
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  // ─── Discovery ──────────────────────────────────────────────────────────

  /**
   * Get all live peer instances (excluding self).
   */
  getPeers(): MeshInstance[] {
    if (!this.active || !this.db) return [];

    const all = this.db.getActiveInstances(this.config.staleCutoffMs);
    return all.filter(inst => inst.instance_id !== this.instanceId);
  }

  /**
   * Get all instances including self.
   */
  getAllInstances(): MeshInstance[] {
    if (!this.active || !this.db) return [];
    return this.db.getActiveInstances(this.config.staleCutoffMs);
  }

  // ─── Context ────────────────────────────────────────────────────────────

  /**
   * Publish context from this instance.
   */
  publishContext(type: ContextType, content: string, scope?: string, expiresIn?: number): void {
    if (!this.active || !this.db) return;

    const ctx: SharedContext = {
      instance_id: this.instanceId,
      context_type: type,
      scope,
      content,
      created_at: Date.now(),
      expires_at: expiresIn ? Date.now() + expiresIn : undefined,
    };

    this.db.upsertContext(ctx);
    this.signals?.emit('ctx', this.instanceId);

    this.db.logEvent({
      instance_id: this.instanceId,
      event_type: 'context_update',
      payload: JSON.stringify({ type, scope }),
      timestamp: Date.now(),
    });
  }

  /**
   * Get context from a specific peer.
   */
  getContextForPeer(peerId: string): SharedContext[] {
    if (!this.active || !this.db) return [];
    return this.db.getContextByInstance(peerId);
  }

  /**
   * Get all peers with their contexts (for Hive integration).
   */
  getAllPeerContexts(): MeshPeerContext[] {
    if (!this.active || !this.db) return [];

    const peers = this.getPeers();
    return peers.map(peer => ({
      instance_id: peer.instance_id,
      server_role: peer.server_role,
      project_root: peer.project_root,
      pid: peer.pid,
      contexts: this.db!.getContextByInstance(peer.instance_id),
    }));
  }

  // ─── Intent Protocol ────────────────────────────────────────────────────

  /**
   * Propose an intent (e.g., "I want to modify file X").
   * Returns intent_id.
   */
  proposeIntent(type: IntentType, description: string, resource?: string): string {
    if (!this.active || !this.db) throw new Error('Mesh not active');

    const intentId = `intent_${Date.now()}_${this.instanceId.slice(0, 8)}`;
    const now = Date.now();

    const intent: MeshIntent = {
      intent_id: intentId,
      instance_id: this.instanceId,
      intent_type: type,
      resource,
      description,
      state: 'proposed',
      created_at: now,
      updated_at: now,
    };

    this.db.insertIntent(intent);
    this.signals?.emit('intent', this.instanceId);

    this.db.logEvent({
      instance_id: this.instanceId,
      event_type: 'intent',
      payload: JSON.stringify({ intent_id: intentId, type, state: 'proposed' }),
      timestamp: now,
    });

    return intentId;
  }

  /**
   * Acknowledge an intent (peer confirms awareness).
   */
  acknowledgeIntent(intentId: string): void {
    if (!this.active || !this.db) return;
    this.db.updateIntentState(intentId, 'acknowledged');
    this.signals?.emit('intent', this.instanceId);
  }

  /**
   * Commit an intent (execution started).
   */
  commitIntent(intentId: string): void {
    if (!this.active || !this.db) return;
    this.db.updateIntentState(intentId, 'committed');
    this.signals?.emit('intent', this.instanceId);
  }

  /**
   * Release an intent (execution completed).
   */
  releaseIntent(intentId: string): void {
    if (!this.active || !this.db) return;
    this.db.updateIntentState(intentId, 'released');
  }

  /**
   * Get all active intents across the mesh.
   */
  getActiveIntents(): MeshIntent[] {
    if (!this.active || !this.db) return [];
    return this.db.getActiveIntents();
  }

  // ─── Resource Locks ─────────────────────────────────────────────────────

  /**
   * Acquire an advisory lock on a resource.
   * Returns true if lock acquired, false if held by another.
   */
  acquireLock(resource: string, purpose?: string, ttlMs?: number): boolean {
    if (!this.active || !this.db) return false;

    const acquired = this.db.tryAcquireLock(
      resource,
      this.instanceId,
      process.pid,
      ttlMs || this.config.lockDefaultTtlMs,
      purpose
    );

    if (acquired) {
      this.signals?.emit('lock', this.instanceId);
    }

    return acquired;
  }

  /**
   * Release a lock held by this instance.
   */
  releaseLock(resource: string): void {
    if (!this.active || !this.db) return;
    this.db.releaseLock(resource, this.instanceId);
  }

  /**
   * Check if a resource is locked.
   */
  getLock(resource: string): LockInfo | null {
    if (!this.active || !this.db) return null;
    return this.db.getLock(resource);
  }

  /**
   * Get all active locks.
   */
  getAllLocks(): LockInfo[] {
    if (!this.active || !this.db) return [];
    return this.db.getAllLocks();
  }

  // ─── Recent Events ──────────────────────────────────────────────────────

  getRecentEvents(limit: number = 20): { instance_id: string; event_type: string; payload: string; timestamp: number }[] {
    if (!this.active || !this.db) return [];
    return this.db.getRecentEvents(limit);
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.db || !this.instanceId) return;

      try {
        // Update heartbeat
        this.db.updateHeartbeat(this.instanceId);

        // Clean stale instances
        this.cleanStale();

        // Clean old signals
        this.signals?.cleanup(this.config.signalTtlMs);

        // Clean expired locks
        this.db.removeExpiredLocks();
      } catch {
        // Non-fatal: heartbeat failure doesn't crash the server
      }
    }, this.config.heartbeatMs);

    // Don't keep the process alive just for heartbeat
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Check for stale instances (dead PIDs) and remove them.
   */
  private cleanStale(): void {
    if (!this.db) return;

    try {
      // Get all instances, check if their PID is alive
      const all = this.db.getAllInstances();
      for (const inst of all) {
        if (inst.instance_id === this.instanceId) continue;

        if (!isPidAlive(inst.pid)) {
          // PID is dead — remove the instance
          this.db.removeInstance(inst.instance_id);

          // Log the cleanup event
          this.db.logEvent({
            instance_id: this.instanceId,
            event_type: 'left',
            payload: JSON.stringify({
              cleaned_instance: inst.instance_id,
              dead_pid: inst.pid,
              reason: 'stale_pid',
            }),
            timestamp: Date.now(),
          });

          // Remove presence file
          try {
            const presencePath = join(this.config.meshDir, 'presence', `instance_${inst.instance_id}.json`);
            if (existsSync(presencePath)) unlinkSync(presencePath);
          } catch { /* ignore */ }
        }
      }

      // Also remove instances beyond stale cutoff (belt and suspenders)
      this.db.removeStaleInstances(this.config.staleCutoffMs);
    } catch {
      // Non-fatal
    }
  }

  private writePresence(instance: MeshInstance): void {
    try {
      const presenceDir = join(this.config.meshDir, 'presence');
      const presencePath = join(presenceDir, `instance_${instance.instance_id}.json`);
      writeFileSync(presencePath, JSON.stringify({
        ...instance,
        hostname: require('os').hostname(),
        user: process.env.USER || process.env.USERNAME || 'unknown',
      }, null, 2), { mode: 0o600 });
    } catch { /* non-fatal */ }
  }

  private removePresence(): void {
    try {
      const presencePath = join(this.config.meshDir, 'presence', `instance_${this.instanceId}.json`);
      if (existsSync(presencePath)) unlinkSync(presencePath);
    } catch { /* ignore */ }
  }
}
