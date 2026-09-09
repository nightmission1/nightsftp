package com.nightmission.nightsftp;

import com.nightmission.nightsftp.command.NightSFTPCommand;
import com.nightmission.nightsftp.config.AgentConfig;
import com.nightmission.nightsftp.connection.GatewayConnection;
import com.nightmission.nightsftp.connection.ReconnectManager;
import com.nightmission.nightsftp.filesystem.FileService;
import com.nightmission.nightsftp.filesystem.FileTransferService;
import com.nightmission.nightsftp.filesystem.SafePathResolver;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;

public class NightSFTP extends JavaPlugin {

    private AgentConfig config;
    private SafePathResolver pathResolver;
    private FileService fileService;
    private FileTransferService transferService;
    private ReconnectManager reconnectManager;
    private GatewayConnection gatewayConnection;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        this.config = new AgentConfig(getConfig());

        // Root directory is the server root where server.jar resides
        File dataFolder = getDataFolder().getAbsoluteFile();
        File pluginsDir = dataFolder.getParentFile() != null ? dataFolder.getParentFile() : new File("plugins").getAbsoluteFile();
        File serverRootDir = pluginsDir.getParentFile() != null ? pluginsDir.getParentFile() : new File(".").getAbsoluteFile();

        this.pathResolver = new SafePathResolver(serverRootDir);


        getLogger().info("[NightSFTP] Initialized SafePathResolver with Server ROOT: " + pathResolver.getRootPath());

        this.fileService = new FileService(pathResolver);
        this.transferService = new FileTransferService(pathResolver);
        this.reconnectManager = new ReconnectManager(this, config);
        this.gatewayConnection = new GatewayConnection(this, config, fileService, transferService, reconnectManager);

        NightSFTPCommand commandHandler = new NightSFTPCommand(config, gatewayConnection, reconnectManager);
        PluginCommand cmd = getCommand("nightsftp");
        if (cmd != null) {
            cmd.setExecutor(commandHandler);
            cmd.setTabCompleter(commandHandler);
        }

        // Establish outbound tunnel to Gateway
        gatewayConnection.connect();

        getLogger().info("[NightSFTP] NightSFTP agent enabled successfully.");
    }

    @Override
    public void onDisable() {
        if (gatewayConnection != null) {
            gatewayConnection.disconnect();
        }
        if (fileService != null) {
            fileService.shutdown();
        }
        if (transferService != null) {
            transferService.shutdown();
        }
        getLogger().info("[NightSFTP] NightSFTP agent disabled.");
    }

    public AgentConfig getAgentConfig() {
        return config;
    }

    public SafePathResolver getPathResolver() {
        return pathResolver;
    }

    public ReconnectManager getReconnectManager() {
        return reconnectManager;
    }
}
