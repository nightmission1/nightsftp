import crypto from 'crypto';

export interface AgentCredentials {
  token: string;
  sftpUsername: string;
  sftpPassword?: string;
}

export class AuthManager {
  private agentConfigs: Map<string, AgentCredentials> = new Map();

  public loadFromConfig(rawConfigAgents: Record<string, any>): void {
    this.agentConfigs.clear();
    if (!rawConfigAgents) return;

    for (const [agentId, info] of Object.entries(rawConfigAgents)) {
      this.agentConfigs.set(agentId, {
        token: info.token,
        sftpUsername: info['sftp-username'] || agentId,
        sftpPassword: info['sftp-password'],
      });
    }
  }

  public validateAgentToken(agentId: string, token: string): boolean {
    if (!agentId || !token) return false;
    const cleanAgentId = agentId.trim();
    const cleanToken = token.trim();

    const creds = this.agentConfigs.get(cleanAgentId);
    if (!creds) {
      console.warn(`[Gateway] Agent ID "${cleanAgentId}" not found in registered agents. Registered: [${Array.from(this.agentConfigs.keys()).join(', ')}]`);
      return false;
    }

    const expectedToken = creds.token ? String(creds.token).trim() : '';
    const expectedBuf = Buffer.from(expectedToken);
    const actualBuf = Buffer.from(cleanToken);

    if (expectedBuf.length !== actualBuf.length) {
      console.warn(`[Gateway] Token length mismatch for agent "${cleanAgentId}".`);
      return false;
    }

    const isMatch = crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!isMatch) {
      console.warn(`[Gateway] Token mismatch for agent "${cleanAgentId}".`);
    }
    return isMatch;
  }


  public validateSftpUser(username: string, password?: string): string | null {
    for (const [agentId, creds] of this.agentConfigs.entries()) {
      if (creds.sftpUsername === username) {
        if (!creds.sftpPassword || creds.sftpPassword === password) {
          return agentId;
        }
      }
    }
    return null;
  }
}
