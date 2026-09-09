import { AgentConnection } from './connection.js';

export class AgentRegistry {
  private activeAgents: Map<string, AgentConnection> = new Map();

  public registerAgent(agent: AgentConnection): void {
    if (this.activeAgents.has(agent.agentId)) {
      const existing = this.activeAgents.get(agent.agentId);
      existing?.close();
    }
    this.activeAgents.set(agent.agentId, agent);
  }

  public unregisterAgent(agentId: string): void {
    if (this.activeAgents.has(agentId)) {
      const agent = this.activeAgents.get(agentId);
      agent?.close();
      this.activeAgents.delete(agentId);
    }
  }

  public getAgent(agentId: string): AgentConnection | undefined {
    return this.activeAgents.get(agentId);
  }

  public isAgentOnline(agentId: string): boolean {
    return this.activeAgents.has(agentId);
  }
}
