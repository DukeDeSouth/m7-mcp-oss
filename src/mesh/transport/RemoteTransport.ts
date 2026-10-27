/**
 * M7 Mesh Remote Transport — HTTP client for M7 Mesh Relay
 */

import { createLogger } from '../../core/utils/logger.js';
import type {
  MeshTransport,
  MeshTransportState,
  MeshTransportFile,
  MeshTransportFileChange,
  MeshTransportMessage,
  MeshTransportTask,
} from './MeshTransport.js';

const log = createLogger('[mesh-remote]');

const REQUEST_TIMEOUT_MS = 5000;

export class RemoteTransport implements MeshTransport {
  private relayUrl: string;
  private secret: string;
  private workstation: string;
  private connected = false;
  private lastSync = 0;

  constructor(relayUrl: string, secret: string, workstation: string) {
    this.relayUrl = relayUrl.replace(/\/$/, '');
    this.secret = secret;
    this.workstation = workstation;
  }

  // ─── HTTP helpers ────────────────────────────────────────────────────

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.relayUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const opts: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };
      if (body) opts.body = JSON.stringify(body);

      const resp = await fetch(url, opts);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      return resp.json();
    } catch (e: any) {
      if (e.name === 'AbortError') throw new Error(`Relay timeout: ${method} ${path}`);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  async connect(): Promise<void> {
    try {
      const health = await this.request('GET', '/health');
      this.connected = true;
      log.debug(`Connected to relay: ${health.active} active workstation(s)`);
    } catch (e: any) {
      log.debug(`Failed to connect to relay: ${e.message}`);
      this.connected = false;
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.request('POST', '/state', {
        workstation: this.workstation,
        status: 'offline',
      });
    } catch { /* best-effort */ }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── State ───────────────────────────────────────────────────────────

  async publishState(state: Partial<MeshTransportState>): Promise<void> {
    await this.request('POST', '/state', {
      workstation: this.workstation,
      ...state,
    });
  }

  async getAllStates(): Promise<MeshTransportState[]> {
    const data = await this.request('GET', '/state');
    return data.states || [];
  }

  // ─── Files ───────────────────────────────────────────────────────────

  async pushFile(path: string, content: string): Promise<void> {
    await this.request('PUT', `/files/${encodeURIComponent(path)}`, {
      content,
      author: this.workstation,
    });
  }

  async pullFile(path: string): Promise<MeshTransportFile | null> {
    try {
      const data = await this.request('GET', `/files/${encodeURIComponent(path)}`);
      return data.file || null;
    } catch (e: any) {
      if (e.message?.includes('404')) return null;
      throw e;
    }
  }

  async listFiles(since?: number): Promise<MeshTransportFile[]> {
    const qs = since ? `?since=${since}` : '';
    const data = await this.request('GET', `/files${qs}`);
    return data.files || [];
  }

  // ─── Changes ─────────────────────────────────────────────────────────

  async notifyChange(path: string, action: string, summary: string): Promise<void> {
    await this.request('POST', '/changes', {
      path,
      action,
      summary,
      workstation: this.workstation,
    });
  }

  async getChanges(since?: number): Promise<MeshTransportFileChange[]> {
    const qs = since ? `?since=${since}` : '';
    const data = await this.request('GET', `/changes${qs}`);
    return data.changes || [];
  }

  // ─── Messages ────────────────────────────────────────────────────────

  async sendMessage(to: string, type: string, content: string, parentId?: string): Promise<string> {
    const data = await this.request('POST', '/messages', {
      from: this.workstation,
      to,
      type,
      content,
      parent_id: parentId,
    });
    return data.message?.id || '';
  }

  async getMessages(opts?: { unread?: boolean }): Promise<MeshTransportMessage[]> {
    const params = new URLSearchParams({ for: this.workstation });
    if (opts?.unread) params.set('unread', 'true');
    const data = await this.request('GET', `/messages?${params}`);
    return data.messages || [];
  }

  async replyToMessage(messageId: string, content: string): Promise<string> {
    const data = await this.request('POST', `/messages/${messageId}/reply`, {
      from: this.workstation,
      content,
    });
    return data.message?.id || '';
  }

  async markRead(messageId: string): Promise<void> {
    await this.request('POST', `/messages/${messageId}/read`, {});
  }

  // ─── Tasks ───────────────────────────────────────────────────────────

  async logTask(task: MeshTransportTask): Promise<void> {
    await this.request('POST', '/tasks', task);
  }

  async getTasks(opts?: { status?: string; limit?: number }): Promise<MeshTransportTask[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params}` : '';
    const data = await this.request('GET', `/tasks${qs}`);
    return data.tasks || [];
  }

  // ─── Sync helper ─────────────────────────────────────────────────────

  async sync(currentState?: Partial<MeshTransportState>): Promise<{
    peers: MeshTransportState[];
    changes: MeshTransportFileChange[];
    messages: MeshTransportMessage[];
  }> {
    const since = this.lastSync;
    this.lastSync = Date.now();

    const results = await Promise.allSettled([
      currentState ? this.publishState(currentState) : Promise.resolve(),
      this.getAllStates(),
      this.getChanges(since || undefined),
      this.getMessages({ unread: true }),
    ]);

    const states = results[1].status === 'fulfilled' ? (results[1].value as MeshTransportState[]) : [];
    const changes = results[2].status === 'fulfilled' ? (results[2].value as MeshTransportFileChange[]) : [];
    const messages = results[3].status === 'fulfilled' ? (results[3].value as MeshTransportMessage[]) : [];

    return {
      peers: states.filter(s => s.workstation !== this.workstation),
      changes: changes.filter(c => c.workstation !== this.workstation),
      messages,
    };
  }
}
