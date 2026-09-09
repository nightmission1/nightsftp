package com.nightmission.nightsftp.config;

import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

public class AgentConfig {

    private final String host;
    private final int port;
    private final boolean tls;
    private final String agentId;
    private final String token;
    private final boolean reconnect;
    private final long reconnectDelayMs;
    private final int chunkSize;

    public AgentConfig(FileConfiguration config) {
        this.host = config.getString("gateway.host", "127.0.0.1");
        this.port = config.getInt("gateway.port", 8443);
        this.tls = config.getBoolean("gateway.tls", false);
        this.agentId = config.getString("gateway.agent-id", "server-001");
        this.token = config.getString("gateway.token", "CHANGE_ME_AGENT_TOKEN_123");
        this.reconnect = config.getBoolean("connection.reconnect", true);
        this.reconnectDelayMs = config.getLong("connection.reconnect-delay-ms", 5000L);
        this.chunkSize = config.getInt("connection.chunk-size", 65536);
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public boolean isTls() {
        return tls;
    }

    public String getAgentId() {
        return agentId;
    }

    public String getToken() {
        return token;
    }

    public boolean isReconnect() {
        return reconnect;
    }

    public long getReconnectDelayMs() {
        return reconnectDelayMs;
    }

    public int getChunkSize() {
        return chunkSize;
    }
}
