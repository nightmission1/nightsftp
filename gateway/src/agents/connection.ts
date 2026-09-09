import { WebSocket } from 'ws';
import { ResponseMessage, serializeMessage } from '../protocol/protocol.js';

export class AgentConnection {
  public readonly agentId: string;
  public readonly capabilities: Set<string>;
  private socket: WebSocket;
  private pendingRequests: Map<string, { resolve: (res: ResponseMessage) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }> = new Map();

  constructor(agentId: string, socket: WebSocket, capabilities: string[] = []) {
    this.agentId = agentId;
    this.socket = socket;
    this.capabilities = new Set(capabilities.map((c) => c.toUpperCase()));
  }

  public hasCapability(cap: string): boolean {
    return this.capabilities.has(cap.toUpperCase());
  }

  public async getDiskSpace(): Promise<{ totalBytes: number; usableBytes: number }> {
    if (!this.hasCapability('STATVFS')) {
      // Legacy v1 agent fallback quota: 100 GB total, 80 GB usable
      return {
        totalBytes: 100 * 1024 * 1024 * 1024,
        usableBytes: 80 * 1024 * 1024 * 1024,
      };
    }

    const res = await this.sendRequest('get_disk_space', '/');
    if (res.success && res.data) {
      return {
        totalBytes: Number(res.data.totalBytes) || 0,
        usableBytes: Number(res.data.usableBytes) || 0,
      };
    }

    return {
      totalBytes: 100 * 1024 * 1024 * 1024,
      usableBytes: 80 * 1024 * 1024 * 1024,
    };
  }

  public handleIncomingMessage(msg: ResponseMessage): void {
    if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
      const pending = this.pendingRequests.get(msg.requestId)!;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
    }
  }

  public sendRequest(op: string, path: string, params: Record<string, any> = {}, timeoutMs: number = 30000): Promise<ResponseMessage> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(2, 12);

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve({
            type: 'response',
            requestId,
            success: false,
            error: 'TIMEOUT',
          });
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout: timer });

      const payload = serializeMessage({
        type: 'request',
        requestId,
        operation: op,
        path,
        ...params,
      });

      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(payload);
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        resolve({
          type: 'response',
          requestId,
          success: false,
          error: 'AGENT_OFFLINE',
        });
      }
    });
  }

  public close(): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve({
        type: 'response',
        requestId: id,
        success: false,
        error: 'AGENT_OFFLINE',
      });
    }
    this.pendingRequests.clear();
    try {
      this.socket.close();
    } catch {}
  }
}
