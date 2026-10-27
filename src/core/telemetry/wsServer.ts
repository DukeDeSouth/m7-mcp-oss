/**
 * M7 Telemetry WebSocket Server
 * 
 * Push-based real-time telemetry delivery from MCP Server to Extension.
 * 
 * Architecture:
 *   MCP Server → WS Server (random port) → Extension WS Client
 *   Port written to .m7/ws-port for discovery.
 * 
 * Protocol:
 *   Server → Client: JSON messages with type 'insights' containing TelemetryEnrichment
 *   Client → Server: JSON messages with type 'ping' (keepalive)
 * 
 * Fail-open: if WS server can't start, MCP continues without real-time push.
 * Extension falls back to file polling.
 * 
 * @module core/telemetry/wsServer
 * @since v7.2
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import type { TelemetryEnrichment } from './types.js';

/** Message types for WS protocol */
interface WsMessage {
  type: 'insights' | 'ping' | 'pong' | 'hello' | 'sessions' | 'get_sessions';
  data?: unknown;
  ts?: string;
}

/** Callback type for session requests */
type SessionsHandler = () => unknown[];

export class TelemetryWsServer {
  private wss: WebSocketServer | null = null;
  private port: number = 0;
  private readonly projectPath: string;
  private readonly portFilePath: string;
  private clientCount: number = 0;
  private sessionsHandler: SessionsHandler | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.portFilePath = path.join(projectPath, '.m7', 'ws-port');
  }

  /**
   * Start the WebSocket server on a random available port.
   * Writes port number to .m7/ws-port for Extension discovery.
   */
  async start(): Promise<number> {
    // Find a free port
    this.port = await this.findFreePort();

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

        this.wss.on('listening', () => {
          // Write port file for Extension discovery
          this.writePortFile();
          resolve(this.port);
        });

        this.wss.on('connection', (ws: WebSocket) => {
          this.clientCount++;

          // Send hello with server info
          this.send(ws, {
            type: 'hello',
            data: { version: '7.2', port: this.port },
            ts: new Date().toISOString(),
          });

          ws.on('message', (raw: Buffer) => {
            try {
              const msg = JSON.parse(raw.toString()) as WsMessage;
              if (msg.type === 'ping') {
                this.send(ws, { type: 'pong', ts: new Date().toISOString() });
              } else if (msg.type === 'get_sessions') {
                // Extension requests historical session data
                const sessions = this.sessionsHandler ? this.sessionsHandler() : [];
                this.send(ws, {
                  type: 'sessions',
                  data: sessions,
                  ts: new Date().toISOString(),
                });
              }
            } catch {
              // Ignore malformed messages
            }
          });

          ws.on('close', () => {
            this.clientCount--;
          });

          ws.on('error', () => {
            this.clientCount--;
          });
        });

        this.wss.on('error', (err: Error) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Broadcast enrichment data to all connected clients.
   * Only sends if there are connected clients (no wasted work).
   */
  broadcast(enrichment: TelemetryEnrichment): void {
    if (!this.wss || this.clientCount === 0) return;

    const message: WsMessage = {
      type: 'insights',
      data: {
        updated_at: new Date().toISOString(),
        freestyle_risk: enrichment.freestyle_risk,
        freestyle_hint: enrichment.freestyle_hint,
        discovery_phase: enrichment.discovery_phase,
        discovery_collapsed: enrichment.discovery_collapsed,
        session_duration_s: enrichment.session_duration_s,
        tool_calls: enrichment.tool_calls_count,
        file_edits: enrichment.file_edits,
        lines_changed: enrichment.lines_changed,
        thinking_time_s: enrichment.thinking_time_s,
      },
      ts: new Date().toISOString(),
    };

    const payload = JSON.stringify(message);

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // Skip broken connections
        }
      }
    });
  }

  /**
   * Broadcast session history to all connected clients.
   * Called periodically from pushTick to keep Dashboard Session Trends updated.
   * @since v7.3
   */
  broadcastSessions(sessions: unknown[]): void {
    if (!this.wss || this.clientCount === 0) return;

    const message: WsMessage = {
      type: 'sessions',
      data: sessions,
      ts: new Date().toISOString(),
    };

    const payload = JSON.stringify(message);

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // Skip broken connections
        }
      }
    });
  }

  /**
   * Stop the WebSocket server and clean up port file.
   */
  stop(): void {
    // Close all connections
    if (this.wss) {
      this.wss.clients.forEach((client: WebSocket) => {
        try { client.close(1000, 'Server shutting down'); } catch { /* */ }
      });
      this.wss.close();
      this.wss = null;
    }

    // Remove port file
    this.removePortFile();
    this.clientCount = 0;
  }

  /**
   * Get current port (0 if not started).
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get connected client count.
   */
  getClientCount(): number {
    return this.clientCount;
  }

  /**
   * Register a handler for session data requests.
   * Called when Extension sends 'get_sessions'.
   */
  onSessionsRequest(handler: SessionsHandler): void {
    this.sessionsHandler = handler;
  }

  /**
   * Find a free TCP port.
   */
  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to get port')));
        }
      });
      server.on('error', reject);
    });
  }

  /**
   * Write port number to .m7/ws-port for Extension discovery.
   */
  private writePortFile(): void {
    try {
      const dir = path.dirname(this.portFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.portFilePath, String(this.port), 'utf-8');
    } catch {
      // Non-fatal: Extension falls back to file polling
    }
  }

  /**
   * Remove port file on shutdown.
   */
  private removePortFile(): void {
    try {
      if (fs.existsSync(this.portFilePath)) {
        fs.unlinkSync(this.portFilePath);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Send a message to a specific client.
   */
  private send(ws: WebSocket, message: WsMessage): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch {
      // Skip
    }
  }
}
