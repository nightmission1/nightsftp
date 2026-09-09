package com.nightmission.nightsftp.protocol;

public class Request extends Message {

    private String operation; // "list", "stat", "read", "write", "mkdir", "rmdir", "delete", "rename"
    private String path;
    private String targetPath; // For rename
    private long offset;
    private int length;
    private String data; // Base64 chunk data for write, or parameters

    public Request() {
        setType("request");
    }

    public String getOperation() {
        return operation;
    }

    public void setOperation(String operation) {
        this.operation = operation;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getTargetPath() {
        return targetPath;
    }

    public void setTargetPath(String targetPath) {
        this.targetPath = targetPath;
    }

    public long getOffset() {
        return offset;
    }

    public void setOffset(long offset) {
        this.offset = offset;
    }

    public int getLength() {
        return length;
    }

    public void setLength(int length) {
        this.length = length;
    }

    public String getData() {
        return data;
    }

    public void setData(String data) {
        this.data = data;
    }
}
