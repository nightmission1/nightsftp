package com.nightmission.nightsftp.command;

import com.nightmission.nightsftp.config.AgentConfig;
import com.nightmission.nightsftp.connection.GatewayConnection;
import com.nightmission.nightsftp.connection.ReconnectManager;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;

import java.util.ArrayList;
import java.util.List;

public class NightSFTPCommand implements CommandExecutor, TabCompleter {

    private final AgentConfig config;
    private final GatewayConnection gatewayConnection;
    private final ReconnectManager reconnectManager;

    public NightSFTPCommand(AgentConfig config, GatewayConnection gatewayConnection, ReconnectManager reconnectManager) {
        this.config = config;
        this.gatewayConnection = gatewayConnection;
        this.reconnectManager = reconnectManager;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("nightsftp.admin")) {
            sender.sendMessage(ChatColor.RED + "You do not have permission to execute this command.");
            return true;
        }

        if (args.length == 0 || args[0].equalsIgnoreCase("status")) {
            sender.sendMessage(ChatColor.DARK_PURPLE + "=== NightSFTP Agent Status ===");
            sender.sendMessage(ChatColor.GOLD + "Status: " + ChatColor.GREEN + reconnectManager.getState().name());
            sender.sendMessage(ChatColor.GOLD + "Agent ID: " + ChatColor.WHITE + config.getAgentId());
            sender.sendMessage(ChatColor.GOLD + "Gateway: " + ChatColor.WHITE + config.getHost() + ":" + config.getPort());
            sender.sendMessage(ChatColor.GOLD + "TLS: " + ChatColor.WHITE + (config.isTls() ? "enabled" : "disabled"));
            return true;
        }

        if (args[0].equalsIgnoreCase("reconnect")) {
            sender.sendMessage(ChatColor.YELLOW + "[NightSFTP] Reconnecting to Gateway...");
            gatewayConnection.disconnect();
            gatewayConnection.connect();
            sender.sendMessage(ChatColor.GREEN + "[NightSFTP] Reconnect request dispatched.");
            return true;
        }

        if (args[0].equalsIgnoreCase("info")) {
            sender.sendMessage(ChatColor.DARK_PURPLE + "=== NightSFTP Plugin Information ===");
            sender.sendMessage(ChatColor.GOLD + "Version: " + ChatColor.WHITE + "1.0.0");
            sender.sendMessage(ChatColor.GOLD + "Chunk Size: " + ChatColor.WHITE + config.getChunkSize() + " bytes");
            sender.sendMessage(ChatColor.GOLD + "Reconnect Delay: " + ChatColor.WHITE + config.getReconnectDelayMs() + " ms");
            return true;
        }

        sender.sendMessage(ChatColor.RED + "Unknown sub-command. Usage: /nightsftp [status|reconnect|info]");
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        List<String> completions = new ArrayList<>();
        if (args.length == 1) {
            String partial = args[0].toLowerCase();
            for (String sub : List.of("status", "reconnect", "info")) {
                if (sub.startsWith(partial)) {
                    completions.add(sub);
                }
            }
        }
        return completions;
    }
}
