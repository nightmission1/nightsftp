import { AgentConnection } from './connection.js';
import { EventEmitter } from 'events';

export interface DiskSpaceCache {
  totalBytes: number;
  usableBytes: number;
  cachedAt: number;
}

export class AgentRegistry extends EventEmitter {
  private activeAgents: Map<string, AgentConnection> = new Map();
  private diskCache: Map<string, DiskSpaceCache> = new Map();
  private readonly CACHE_TTL_MS = 45000; // 45 sec cache TTL

  public registerAgent(agent: AgentConnection): void {
    if (this.activeAgents.has(agent.agentId)) {
      const existing = this.activeAgents.get(agent.agentId);
      existing?.close();
    }
    this.activeAgents.set(agent.agentId, agent);
    this.emit('agent_registered', agent.agentId);
  }

  public unregisterAgent(agentId: string): void {
    if (this.activeAgents.has(agentId)) {
      const agent = this.activeAgents.get(agentId);
      agent?.close();
      this.activeAgents.delete(agentId);
      this.diskCache.delete(agentId);
      this.emit('agent_unregistered', agentId);
    }
  }

  public getAgent(agentId: string): AgentConnection | undefined {
    return this.activeAgents.get(agentId);
  }

  public isAgentOnline(agentId: string): boolean {
    return this.activeAgents.has(agentId);
  }

  public getOnlineAgentIds(): string[] {
    return Array.from(this.activeAgents.keys());
  }

  public async getAgentDiskSpace(agentId: string): Promise<{ totalBytes: number; usableBytes: number }> {
    const cached = this.diskCache.get(agentId);
    const now = Date.now();

    if (cached && (now - cached.cachedAt < this.CACHE_TTL_MS)) {
      return { totalBytes: cached.totalBytes, usableBytes: cached.usableBytes };
    }

    const agent = this.getAgent(agentId);
    if (!agent) {
      return { totalBytes: 0, usableBytes: 0 };
    }

    const space = await agent.getDiskSpace();
    this.diskCache.set(agentId, {
      totalBytes: space.totalBytes,
      usableBytes: space.usableBytes,
      cachedAt: now,
    });

    return space;
  }

  public async getAggregatedDiskSpace(agentIds: string[]): Promise<{ totalBytes: number; usableBytes: number }> {
    let aggregateTotal = 0;
    let aggregateUsable = 0;

    for (const id of agentIds) {
      if (this.isAgentOnline(id)) {
        const space = await this.getAgentDiskSpace(id);
        aggregateTotal += space.totalBytes;
        aggregateUsable += space.usableBytes;
      }
    }

    // Default fallback if no online agents
    if (aggregateTotal === 0) {
      aggregateTotal = 100 * 1024 * 1024 * 1024;
      aggregateUsable = 80 * 1024 * 1024 * 1024;
    }

    return { totalBytes: aggregateTotal, usableBytes: aggregateUsable };
  }
}
