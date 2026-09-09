package com.nightmission.nightsftp.security;

public class TokenManager {

    private final String agentId;
    private final String token;

    public TokenManager(String agentId, String token) {
        this.agentId = agentId;
        this.token = token;
    }

    public String getAgentId() {
        return agentId;
    }

    public String getToken() {
        return token;
    }

    public boolean validateToken(String candidate) {
        return token != null && token.equals(candidate);
    }
}
