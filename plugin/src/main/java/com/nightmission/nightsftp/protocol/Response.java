package com.nightmission.nightsftp.protocol;

import java.util.List;
import java.util.Map;

public class Response extends Message {

    private boolean success;
    private String error; // Error code matching Section 23: OK, NOT_FOUND, FORBIDDEN, ROOT_ESCAPE, etc.
    private Object data;  // File list, stat metadata, base64 chunk read, etc.

    public Response() {
        setType("response");
    }

    public Response(String requestId, boolean success, String error, Object data) {
        super("response", requestId);
        this.success = success;
        this.error = error;
        this.data = data;
    }

    public static Response ok(String requestId, Object data) {
        return new Response(requestId, true, "OK", data);
    }

    public static Response fail(String requestId, String errorCode) {
        return new Response(requestId, false, errorCode, null);
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public Object getData() {
        return data;
    }

    public void setData(Object data) {
        this.data = data;
    }
}
