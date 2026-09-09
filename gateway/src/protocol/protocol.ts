export interface BaseMessage {
  type: string;
  requestId?: string;
}

export interface AuthMessage extends BaseMessage {
  type: 'auth';
  agentId: string;
  token: string;
  version?: string;
}

export interface RequestMessage extends BaseMessage {
  type: 'request';
  requestId: string;
  operation: 'list' | 'stat' | 'read' | 'write' | 'mkdir' | 'rmdir' | 'delete' | 'rename';
  path: string;
  targetPath?: string;
  offset?: number;
  length?: number;
  data?: string; // Base64
}

export interface ResponseMessage extends BaseMessage {
  type: 'response' | 'auth_response';
  requestId: string;
  success: boolean;
  error?: string;
  data?: any;
}

export function parseMessage(raw: string): BaseMessage | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function serializeMessage(msg: any): string {
  return JSON.stringify(msg);
}
