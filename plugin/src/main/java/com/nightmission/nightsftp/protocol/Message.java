package com.nightmission.nightsftp.protocol;

public class Message {

    private String type; // "auth", "request", "response", "chunk", "heartbeat"
    private String requestId;

    public Message() {}

    public Message(String type, String requestId) {
        this.type = type;
        this.requestId = requestId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getRequestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }
}
