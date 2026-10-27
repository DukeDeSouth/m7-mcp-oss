/**
 * M7 Mesh Transport — Abstract interface for local and remote mesh communication
 */

export interface MeshTransportState {
  workstation: string;
  current_task?: string;
  current_task_id?: string;
  module?: string;
  blockers?: string[];
  recently_changed?: string[];
  last_heartbeat: number;
  status: 'active' | 'idle' | 'offline';
}

export interface MeshTransportFile {
  path: string;
  content: string;
  author: string;
  updated_at: number;
  size: number;
}

export interface MeshTransportFileChange {
  id: string;
  path: string;
  action: 'created' | 'modified' | 'deleted' | 'renamed';
  summary: string;
  workstation: string;
  timestamp: number;
}

export interface MeshTransportMessage {
  id: string;
  from: string;
  to: string;
  type: 'question' | 'answer' | 'note' | 'broadcast';
  content: string;
  parent_id?: string;
  status: 'unread' | 'read';
  created_at: number;
}

export interface MeshTransportTask {
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

export interface MeshSyncResult {
  peers: MeshTransportState[];
  newChanges: MeshTransportFileChange[];
  unreadMessages: MeshTransportMessage[];
}

export interface MeshTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // State
  publishState(state: Partial<MeshTransportState>): Promise<void>;
  getAllStates(): Promise<MeshTransportState[]>;

  // Files
  pushFile(path: string, content: string): Promise<void>;
  pullFile(path: string): Promise<MeshTransportFile | null>;
  listFiles(since?: number): Promise<MeshTransportFile[]>;

  // Changes
  notifyChange(path: string, action: string, summary: string): Promise<void>;
  getChanges(since?: number): Promise<MeshTransportFileChange[]>;

  // Messages
  sendMessage(to: string, type: string, content: string, parentId?: string): Promise<string>;
  getMessages(opts?: { unread?: boolean }): Promise<MeshTransportMessage[]>;
  replyToMessage(messageId: string, content: string): Promise<string>;
  markRead(messageId: string): Promise<void>;

  // Tasks
  logTask(task: MeshTransportTask): Promise<void>;
  getTasks(opts?: { status?: string; limit?: number }): Promise<MeshTransportTask[]>;
}
