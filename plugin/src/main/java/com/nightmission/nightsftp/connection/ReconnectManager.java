package com.nightmission.nightsftp.connection;

import com.nightmission.nightsftp.config.AgentConfig;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;

public class ReconnectManager {

    public enum ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED,
        AUTHENTICATING,
        READY,
        RECONNECTING
    }

    private final JavaPlugin plugin;
    private final AgentConfig config;
    private final Logger logger;
    private final AtomicBoolean isReconnecting = new AtomicBoolean(false);
    private ConnectionState currentState = ConnectionState.DISCONNECTED;
    private BukkitTask reconnectTask;

    public ReconnectManager(JavaPlugin plugin, AgentConfig config) {
        this.plugin = plugin;
        this.config = config;
        this.logger = plugin.getLogger();
    }

    public synchronized ConnectionState getState() {
        return currentState;
    }

    public synchronized void setState(ConnectionState newState) {
        this.currentState = newState;
        logger.info("[NightSFTP] Connection status updated to: " + newState.name());
    }

    public void scheduleReconnect(Runnable connectAction) {
        if (!config.isReconnect()) {
            setState(ConnectionState.DISCONNECTED);
            return;
        }

        if (isReconnecting.compareAndSet(false, true)) {
            setState(ConnectionState.RECONNECTING);
            long delayTicks = Math.max(20L, (config.getReconnectDelayMs() / 1000L) * 20L);
            logger.info("[NightSFTP] Connection lost. Reconnecting in " + (config.getReconnectDelayMs() / 1000L) + "s...");

            cancelReconnectTask();
            reconnectTask = plugin.getServer().getScheduler().runTaskLaterAsynchronously(plugin, () -> {
                isReconnecting.set(false);
                setState(ConnectionState.CONNECTING);
                connectAction.run();
            }, delayTicks);
        }
    }

    public void cancelReconnectTask() {
        if (reconnectTask != null && !reconnectTask.isCancelled()) {
            reconnectTask.cancel();
            reconnectTask = null;
        }
        isReconnecting.set(false);
    }
}
