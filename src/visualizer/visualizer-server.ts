import { createLogger } from '../core/utils/logger.js';
const log = createLogger('[Visualizer]');
/**
 * M7 v3.0 - Visualizer Server
 * 
 * WebSocket + HTTP server for real-time graph visualization
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { 
  GraphVisualizerService, 
  getGraphVisualizerService 
} from './graph-visualizer-service.js';
import {
  WSMessage,
  WSMessageType,
  GraphState,
  VisualizerConfig,
  DEFAULT_VISUALIZER_CONFIG,
} from './types.js';

// ============================================
// VISUALIZER SERVER
// ============================================

export class VisualizerServer {
  private config: VisualizerConfig;
  private visualizer: GraphVisualizerService;
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private clients: Set<WebSocket> = new Set();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  constructor(config?: Partial<VisualizerConfig>) {
    this.config = { ...DEFAULT_VISUALIZER_CONFIG, ...config };
    this.visualizer = getGraphVisualizerService(this.config);
  }
  
  // ============================================
  // LIFECYCLE
  // ============================================
  
  /**
   * Start the visualizer server
   */
  async start(): Promise<{ wsPort: number; httpPort: number }> {
    if (this.isRunning) {
      return { wsPort: this.config.wsPort, httpPort: this.config.httpPort };
    }
    
    // Start HTTP server for static files
    await this.startHttpServer();
    
    // Start WebSocket server
    await this.startWebSocketServer();
    
    // Start periodic updates
    this.startPeriodicUpdates();
    
    this.isRunning = true;
    
    log.debug(`M7 Visualizer] Server started`);
    log.debug(`M7 Visualizer] HTTP: http://localhost:${this.config.httpPort}`);
    log.debug(`M7 Visualizer] WebSocket: ws://localhost:${this.config.wsPort}`);
    
    return { wsPort: this.config.wsPort, httpPort: this.config.httpPort };
  }
  
  /**
   * Stop the visualizer server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    // Stop periodic updates
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Close all WebSocket connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    
    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    
    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    
    this.isRunning = false;
    log.debug('M7 Visualizer] Server stopped');
  }
  
  /**
   * Check if server is running
   */
  get running(): boolean {
    return this.isRunning;
  }
  
  // ============================================
  // HTTP SERVER
  // ============================================
  
  private startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });
      
      this.httpServer.listen(this.config.httpPort, () => {
        resolve();
      });
      
      this.httpServer.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // API endpoints
    if (url === '/api/graph') {
      this.handleGraphApi(res);
      return;
    }
    
    if (url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
      return;
    }
    
    // Serve static HTML for main page
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getVisualizerHtml());
      return;
    }
    
    // 404 for other requests
    res.writeHead(404);
    res.end('Not Found');
  }
  
  private async handleGraphApi(res: http.ServerResponse): Promise<void> {
    try {
      const state = await this.visualizer.getGraphState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  
  // ============================================
  // WEBSOCKET SERVER
  // ============================================
  
  private startWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.config.wsPort });
      
      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });
      
      this.wss.on('listening', () => {
        resolve();
      });
      
      this.wss.on('error', (err: Error) => {
        reject(err);
      });
    });
  }
  
  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    log.debug(`M7 Visualizer] Client connected. Total: ${this.clients.size}`);
    
    // Send initial state
    this.sendGraphState(ws);
    
    // Handle messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        this.handleMessage(ws, message);
      } catch (error) {
        log.debug('M7 Visualizer] Invalid message:', error);
      }
    });
    
    // Handle close
    ws.on('close', () => {
      this.clients.delete(ws);
      log.debug(`M7 Visualizer] Client disconnected. Total: ${this.clients.size}`);
    });
    
    // Handle errors
    ws.on('error', (error: Error) => {
      log.debug('M7 Visualizer] WebSocket error:', error);
      this.clients.delete(ws);
    });
  }
  
  private handleMessage(ws: WebSocket, message: WSMessage): void {
    switch (message.type) {
      case 'ping':
        this.send(ws, { type: 'pong', payload: {}, timestamp: Date.now() });
        break;
        
      case 'view_change':
        this.visualizer.updateViewSettings(message.payload);
        this.broadcastGraphState();
        break;
        
      case 'node_focus':
        this.visualizer.focusNode(message.payload.nodeId);
        this.broadcastGraphState();
        break;
        
      default:
        log.debug('M7 Visualizer] Unknown message type:', message.type);
    }
  }
  
  // ============================================
  // BROADCASTING
  // ============================================
  
  /**
   * Send graph state to a specific client
   */
  private async sendGraphState(ws: WebSocket): Promise<void> {
    try {
      const state = await this.visualizer.getGraphState();
      this.send(ws, {
        type: 'graph_update',
        payload: state,
        timestamp: Date.now(),
      });
    } catch (error) {
      log.debug('M7 Visualizer] Error sending graph state:', error);
    }
  }
  
  /**
   * Broadcast graph state to all clients
   */
  async broadcastGraphState(): Promise<void> {
    if (this.clients.size === 0) return;
    
    try {
      const state = await this.visualizer.getGraphState();
      const message: WSMessage = {
        type: 'graph_update',
        payload: state,
        timestamp: Date.now(),
      };
      
      this.broadcast(message);
    } catch (error) {
      log.debug('M7 Visualizer] Error broadcasting state:', error);
    }
  }
  
  /**
   * Broadcast context update
   */
  broadcastContextUpdate(): void {
    const message: WSMessage = {
      type: 'context_update',
      payload: { context: this.visualizer['context'] },
      timestamp: Date.now(),
    };
    this.broadcast(message);
  }
  
  /**
   * Send message to a client
   */
  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
  
  /**
   * Broadcast message to all clients
   */
  private broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
  
  // ============================================
  // PERIODIC UPDATES
  // ============================================
  
  private startPeriodicUpdates(): void {
    this.updateInterval = setInterval(() => {
      if (this.clients.size > 0) {
        this.broadcastGraphState();
      }
    }, this.config.updateInterval);
  }
  
  // ============================================
  // CONTEXT API
  // ============================================
  
  /**
   * Update active file
   */
  setActiveFile(filePath: string | null): void {
    this.visualizer.setActiveFile(filePath);
    this.broadcastContextUpdate();
  }
  
  /**
   * Add modified file
   */
  addModifiedFile(filePath: string): void {
    this.visualizer.addModifiedFile(filePath);
    this.broadcastContextUpdate();
  }
  
  /**
   * Set task description
   */
  setTaskDescription(description: string): void {
    this.visualizer.updateContext({ taskDescription: description });
    this.broadcastContextUpdate();
  }
  
  // ============================================
  // HTML TEMPLATE
  // ============================================
  
  private getVisualizerHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>M7 Context Visualizer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: #2E3440;
      color: #ECEFF4;
      height: 100vh;
      overflow: hidden;
    }
    
    .container {
      display: grid;
      grid-template-columns: 280px 1fr;
      grid-template-rows: 60px 1fr 200px;
      height: 100vh;
      gap: 1px;
      background: #3B4252;
    }
    
    header {
      grid-column: 1 / -1;
      background: #3B4252;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #4C566A;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .logo h1 {
      font-size: 18px;
      font-weight: 600;
      color: #88C0D0;
    }
    
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #A3BE8C;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .sidebar {
      background: #2E3440;
      padding: 16px;
      overflow-y: auto;
    }
    
    .sidebar h3 {
      font-size: 12px;
      text-transform: uppercase;
      color: #4C566A;
      margin-bottom: 12px;
      letter-spacing: 1px;
    }
    
    .context-box {
      background: #3B4252;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
    }
    
    .context-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid #4C566A;
    }
    
    .context-item:last-child { border-bottom: none; }
    
    .context-label {
      font-size: 11px;
      color: #4C566A;
      min-width: 60px;
    }
    
    .context-value {
      font-size: 12px;
      color: #ECEFF4;
      word-break: break-all;
    }
    
    .metric-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    
    .metric {
      background: #3B4252;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    
    .metric-value {
      font-size: 24px;
      font-weight: 700;
      color: #88C0D0;
    }
    
    .metric-label {
      font-size: 10px;
      color: #4C566A;
      text-transform: uppercase;
    }
    
    .graph-container {
      background: #2E3440;
      position: relative;
    }
    
    #graph-canvas {
      width: 100%;
      height: 100%;
    }
    
    .timeline {
      grid-column: 1 / -1;
      background: #2E3440;
      padding: 16px;
      border-top: 1px solid #4C566A;
      overflow-x: auto;
    }
    
    .timeline h3 {
      font-size: 12px;
      text-transform: uppercase;
      color: #4C566A;
      margin-bottom: 12px;
    }
    
    .timeline-items {
      display: flex;
      gap: 16px;
    }
    
    .timeline-item {
      flex-shrink: 0;
      background: #3B4252;
      border-radius: 8px;
      padding: 12px 16px;
      min-width: 200px;
    }
    
    .timeline-file {
      font-size: 12px;
      color: #88C0D0;
      margin-bottom: 4px;
    }
    
    .timeline-time {
      font-size: 10px;
      color: #4C566A;
    }
    
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 16px;
    }
    
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }
    
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }
    
    .node {
      cursor: pointer;
      transition: transform 0.2s;
    }
    
    .node:hover {
      transform: scale(1.2);
    }
    
    .node-label {
      font-size: 10px;
      fill: #ECEFF4;
      pointer-events: none;
    }
    
    .link {
      stroke-opacity: 0.6;
      fill: none;
    }
    
    .tooltip {
      position: absolute;
      background: #3B4252;
      border: 1px solid #4C566A;
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#88C0D0" stroke-width="2"/>
          <circle cx="12" cy="12" r="4" fill="#88C0D0"/>
          <circle cx="6" cy="8" r="2" fill="#A3BE8C"/>
          <circle cx="18" cy="8" r="2" fill="#B48EAD"/>
          <circle cx="12" cy="18" r="2" fill="#EBCB8B"/>
        </svg>
        <h1>M7 Context Visualizer</h1>
      </div>
      <div class="status">
        <div class="status-dot"></div>
        <span id="status-text">Connecting...</span>
      </div>
    </header>
    
    <aside class="sidebar">
      <h3>📍 Current Context</h3>
      <div class="context-box">
        <div class="context-item">
          <span class="context-label">File:</span>
          <span class="context-value" id="ctx-file">-</span>
        </div>
        <div class="context-item">
          <span class="context-label">Task:</span>
          <span class="context-value" id="ctx-task">-</span>
        </div>
        <div class="context-item">
          <span class="context-label">Modified:</span>
          <span class="context-value" id="ctx-modified">0 files</span>
        </div>
      </div>
      
      <h3>📊 Metrics</h3>
      <div class="metric-grid">
        <div class="metric">
          <div class="metric-value" id="m-nodes">0</div>
          <div class="metric-label">Nodes</div>
        </div>
        <div class="metric">
          <div class="metric-value" id="m-links">0</div>
          <div class="metric-label">Links</div>
        </div>
        <div class="metric">
          <div class="metric-value" id="m-orphans">0</div>
          <div class="metric-label">Orphans</div>
        </div>
        <div class="metric">
          <div class="metric-value" id="m-health">-</div>
          <div class="metric-label">Health</div>
        </div>
      </div>
      
      <h3 style="margin-top: 16px;">🎨 Legend</h3>
      <div class="legend">
        <div class="legend-item">
          <div class="legend-color" style="background: #5E81AC;"></div>
          <span>File</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #B48EAD;"></div>
          <span>Class</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #A3BE8C;"></div>
          <span>Function</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #EBCB8B;"></div>
          <span>Interface</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #88C0D0;"></div>
          <span>Component</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #BF616A;"></div>
          <span>Orphan</span>
        </div>
      </div>
    </aside>
    
    <main class="graph-container">
      <svg id="graph-canvas"></svg>
      <div class="tooltip" id="tooltip"></div>
    </main>
    
    <section class="timeline">
      <h3>🕐 Navigation History</h3>
      <div class="timeline-items" id="timeline">
        <div class="timeline-item">
          <div class="timeline-file">No history yet</div>
          <div class="timeline-time">Start editing to see history</div>
        </div>
      </div>
    </section>
  </div>
  
  <script>
    const WS_PORT = ${this.config.wsPort};
    let ws = null;
    let graphData = null;
    
    // Connect to WebSocket
    function connect() {
      ws = new WebSocket('ws://localhost:' + WS_PORT);
      
      ws.onopen = () => {
        document.getElementById('status-text').textContent = 'Connected';
        document.querySelector('.status-dot').style.background = '#A3BE8C';
      };
      
      ws.onclose = () => {
        document.getElementById('status-text').textContent = 'Disconnected';
        document.querySelector('.status-dot').style.background = '#BF616A';
        setTimeout(connect, 3000);
      };
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };
    }
    
    function handleMessage(message) {
      switch (message.type) {
        case 'graph_update':
          graphData = message.payload;
          renderGraph(graphData);
          updateUI(graphData);
          break;
        case 'context_update':
          updateContext(message.payload.context);
          break;
      }
    }
    
    function updateUI(data) {
      // Metrics
      document.getElementById('m-nodes').textContent = data.metrics.totalNodes;
      document.getElementById('m-links').textContent = data.metrics.totalLinks;
      document.getElementById('m-orphans').textContent = data.metrics.orphanCount;
      document.getElementById('m-health').textContent = data.metrics.healthGrade;
      
      // Context
      const ctx = data.context;
      document.getElementById('ctx-file').textContent = ctx.activeFile 
        ? ctx.activeFile.split('/').pop() 
        : '-';
      document.getElementById('ctx-task').textContent = ctx.taskDescription || '-';
      document.getElementById('ctx-modified').textContent = ctx.modifiedFiles.length + ' files';
      
      // Timeline
      const timeline = document.getElementById('timeline');
      if (ctx.history.length > 0) {
        timeline.innerHTML = ctx.history.slice(-5).reverse().map(h => \`
          <div class="timeline-item">
            <div class="timeline-file">\${h.file.split('/').pop()}</div>
            <div class="timeline-time">\${h.action} - \${new Date(h.timestamp).toLocaleTimeString()}</div>
          </div>
        \`).join('');
      }
    }
    
    function updateContext(ctx) {
      document.getElementById('ctx-file').textContent = ctx.activeFile 
        ? ctx.activeFile.split('/').pop() 
        : '-';
    }
    
    function renderGraph(data) {
      const svg = document.getElementById('graph-canvas');
      const width = svg.clientWidth || 800;
      const height = svg.clientHeight || 600;
      
      // Clear previous
      svg.innerHTML = '';
      
      // Create groups for links and nodes
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', 'translate(' + (width/2 - 500) + ',' + (height/2 - 400) + ')');
      svg.appendChild(g);
      
      // Render links
      data.links.forEach(link => {
        const sourceNode = data.nodes.find(n => n.id === link.source);
        const targetNode = data.nodes.find(n => n.id === link.target);
        
        if (sourceNode && targetNode && sourceNode.x && targetNode.x) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', sourceNode.x);
          line.setAttribute('y1', sourceNode.y);
          line.setAttribute('x2', targetNode.x);
          line.setAttribute('y2', targetNode.y);
          line.setAttribute('stroke', link.color);
          line.setAttribute('stroke-width', link.width);
          line.setAttribute('stroke-opacity', link.opacity);
          if (link.dashed) {
            line.setAttribute('stroke-dasharray', '4,4');
          }
          line.classList.add('link');
          g.appendChild(line);
        }
      });
      
      // Render nodes
      data.nodes.forEach(node => {
        if (!node.x || !node.y) return;
        
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', 'translate(' + node.x + ',' + node.y + ')');
        group.classList.add('node');
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', node.size);
        circle.setAttribute('fill', node.color);
        circle.setAttribute('opacity', node.opacity);
        
        if (node.isActive) {
          circle.setAttribute('stroke', '#A3BE8C');
          circle.setAttribute('stroke-width', '3');
        }
        
        group.appendChild(circle);
        
        // Add label for larger nodes
        if (node.size > 10) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('dy', node.size + 12);
          text.setAttribute('text-anchor', 'middle');
          text.classList.add('node-label');
          text.textContent = node.name.length > 15 ? node.name.slice(0, 15) + '...' : node.name;
          group.appendChild(text);
        }
        
        // Tooltip on hover
        group.addEventListener('mouseenter', (e) => showTooltip(e, node));
        group.addEventListener('mouseleave', hideTooltip);
        group.addEventListener('click', () => focusNode(node.id));
        
        g.appendChild(group);
      });
    }
    
    function showTooltip(event, node) {
      const tooltip = document.getElementById('tooltip');
      tooltip.innerHTML = \`
        <strong>\${node.name}</strong><br>
        Type: \${node.type}<br>
        File: \${node.filePath.split('/').pop()}<br>
        Dependencies: \${node.dependencies}<br>
        Dependents: \${node.dependents}
        \${node.isOrphan ? '<br><span style="color:#BF616A">⚠️ Orphan (unused)</span>' : ''}
      \`;
      tooltip.style.left = event.pageX + 10 + 'px';
      tooltip.style.top = event.pageY + 10 + 'px';
      tooltip.style.display = 'block';
    }
    
    function hideTooltip() {
      document.getElementById('tooltip').style.display = 'none';
    }
    
    function focusNode(nodeId) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'node_focus',
          payload: { nodeId },
          timestamp: Date.now()
        }));
      }
    }
    
    // Start
    connect();
    
    // Handle resize
    window.addEventListener('resize', () => {
      if (graphData) renderGraph(graphData);
    });
  </script>
</body>
</html>`;
  }
}

// ============================================
// SINGLETON
// ============================================

let serverInstance: VisualizerServer | null = null;

export function getVisualizerServer(config?: Partial<VisualizerConfig>): VisualizerServer {
  if (!serverInstance) {
    serverInstance = new VisualizerServer(config);
  }
  return serverInstance;
}

export function createVisualizerServer(config?: Partial<VisualizerConfig>): VisualizerServer {
  return new VisualizerServer(config);
}

