package com.nightmission.nightsftp.protocol;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

public class ProtocolHandler {

    private static final Gson gson = new Gson();

    public static Message parseMessage(String jsonStr) {
        if (jsonStr == null || jsonStr.trim().isEmpty()) {
            return null;
        }

        try {
            JsonObject obj = JsonParser.parseString(jsonStr).getAsJsonObject();
            String type = obj.has("type") ? obj.get("type").getAsString() : "";

            if ("request".equalsIgnoreCase(type)) {
                return gson.fromJson(obj, Request.class);
            } else if ("response".equalsIgnoreCase(type) || "auth_response".equalsIgnoreCase(type)) {
                return gson.fromJson(obj, Response.class);
            } else {
                return gson.fromJson(obj, Message.class);
            }

        } catch (Exception e) {
            return null;
        }
    }

    public static String serialize(Object messageObj) {
        return gson.toJson(messageObj);
    }
}
