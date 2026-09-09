package com.nightmission.nightsftp.connection;

import com.google.gson.JsonObject;
import com.nightmission.nightsftp.config.AgentConfig;

public class AuthenticationManager {

    private final AgentConfig config;

    public AuthenticationManager(AgentConfig config) {
        this.config = config;
    }

    public String createAuthHandshakeMessage() {
        JsonObject json = new JsonObject();
        json.addProperty("type", "auth");
        json.addProperty("agentId", config.getAgentId());
        json.addProperty("token", config.getToken());
        json.addProperty("version", "1.0.0");
        return json.toString();
    }
}
