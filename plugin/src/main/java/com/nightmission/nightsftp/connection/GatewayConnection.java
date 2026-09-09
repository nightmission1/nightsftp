package com.nightmission.nightsftp.connection;

import com.nightmission.nightsftp.config.AgentConfig;
import com.nightmission.nightsftp.filesystem.FileService;
import com.nightmission.nightsftp.filesystem.FileTransferService;
import com.nightmission.nightsftp.protocol.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.logging.Level;

public class GatewayConnection {

    private final JavaPlugin plugin;
    private final AgentConfig config;
    private final FileService fileService;
    private final FileTransferService transferService;
    private final ReconnectManager reconnectManager;
    private final AuthenticationManager authManager;
    private AgentWebSocketClient client;

    public GatewayConnection(JavaPlugin plugin, AgentConfig config, FileService fileService,
                             FileTransferService transferService, ReconnectManager reconnectManager) {
        this.plugin = plugin;
        this.config = config;
        this.fileService = fileService;
        this.transferService = transferService;
        this.reconnectManager = reconnectManager;
        this.authManager = new AuthenticationManager(config);
    }

    public synchronized void connect() {
        if (client != null && client.isOpen()) {
            return;
        }

        try {
            String protocol = config.isTls() ? "wss" : "ws";
            URI uri = new URI(protocol + "://" + config.getHost() + ":" + config.getPort() + "/agent");
            reconnectManager.setState(ReconnectManager.ConnectionState.CONNECTING);

            client = new AgentWebSocketClient(uri);

            if (config.isTls()) {
                javax.net.ssl.SSLContext sslContext = javax.net.ssl.SSLContext.getInstance("TLS");
                sslContext.init(null, null, null);
                client.setSocketFactory(sslContext.getSocketFactory());
            }

            client.connect();
        } catch (Exception e) {

            plugin.getLogger().severe("[NightSFTP] Failed to initialize WebSocket connection: " + e.getMessage());
            reconnectManager.scheduleReconnect(this::connect);
        }
    }

    public synchronized void disconnect() {
        reconnectManager.cancelReconnectTask();
        if (client != null) {
            try {
                client.close();
            } catch (Exception ignored) {}
            client = null;
        }
        reconnectManager.setState(ReconnectManager.ConnectionState.DISCONNECTED);
    }

    public void send(String payload) {
        if (client != null && client.isOpen()) {
            client.send(payload);
        }
    }

    private class AgentWebSocketClient extends WebSocketClient {

        public AgentWebSocketClient(URI serverUri) {
            super(serverUri);
        }

        @Override
        public void onOpen(ServerHandshake handshakedata) {
            plugin.getLogger().info("[NightSFTP] Connected to Gateway agent endpoint. Sending auth handshake...");
            reconnectManager.setState(ReconnectManager.ConnectionState.AUTHENTICATING);
            send(authManager.createAuthHandshakeMessage());
        }

        @Override
        public void onMessage(String messageStr) {
            try {
                Message msg = ProtocolHandler.parseMessage(messageStr);
                if (msg == null) return;

                if ("auth_response".equalsIgnoreCase(msg.getType())) {
                    Response res = ProtocolHandler.parseMessage(messageStr) instanceof Response 
                        ? (Response) ProtocolHandler.parseMessage(messageStr) : null;
                    if (res != null && res.isSuccess()) {
                        reconnectManager.setState(ReconnectManager.ConnectionState.READY);
                        plugin.getLogger().info("[NightSFTP] Successfully authenticated with Gateway as agent: " + config.getAgentId());
                    } else {
                        plugin.getLogger().severe("[NightSFTP] Authentication failed: " + (res != null ? res.getError() : "Unknown error"));
                        close();
                    }
                    return;
                }

                if ("request".equalsIgnoreCase(msg.getType()) && msg instanceof Request req) {
                    handleIncomingRequest(req);
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[NightSFTP] Error handling message: " + e.getMessage(), e);
            }
        }

        private void handleIncomingRequest(Request req) {
            String op = req.getOperation();
            String reqId = req.getRequestId();
            if (op == null) return;

            switch (op.toLowerCase()) {
                case "list" -> fileService.listDirectory(reqId, req.getPath())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "stat" -> fileService.statFile(reqId, req.getPath())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "mkdir" -> fileService.mkdir(reqId, req.getPath())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "rmdir" -> fileService.rmdir(reqId, req.getPath())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "delete" -> fileService.delete(reqId, req.getPath())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "rename" -> fileService.rename(reqId, req.getPath(), req.getTargetPath())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "read" -> transferService.readChunk(reqId, req.getPath(), req.getOffset(), req.getLength())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "write" -> transferService.writeChunk(reqId, req.getPath(), req.getOffset(), req.getData())
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                case "get_disk_space" -> fileService.getDiskSpace(reqId)
                        .thenAccept(res -> send(ProtocolHandler.serialize(res)));

                default -> send(ProtocolHandler.serialize(Response.fail(reqId, "INVALID_OPERATION")));
            }
        }

        @Override
        public void onClose(int code, String reason, boolean remote) {
            plugin.getLogger().warning("[NightSFTP] Gateway connection closed (Code: " + code + ", Reason: " + reason + ")");
            reconnectManager.scheduleReconnect(GatewayConnection.this::connect);
        }

        @Override
        public void onError(Exception ex) {
            plugin.getLogger().warning("[NightSFTP] WebSocket error: " + ex.getMessage());
        }
    }
}
