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
    const isMatch = expectedToken === cleanToken;
    if (!isMatch) {
      console.warn(`[Gateway] Token mismatch for agent "${cleanAgentId}". Expected "${expectedToken}", got "${cleanToken}".`);
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
