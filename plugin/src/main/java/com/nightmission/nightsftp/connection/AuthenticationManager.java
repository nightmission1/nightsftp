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
        json.addProperty("version", "2.0.0");
        
        com.google.gson.JsonArray caps = new com.google.gson.JsonArray();
        caps.add("STATVFS");
        json.add("capabilities", caps);
        return json.toString();
    }
}
