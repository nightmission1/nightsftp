import readline from 'readline';
import { GatewayDatabase } from '../db/database.js';
import { PermissionManager } from '../security/permissions.js';
import { AgentRegistry } from '../agents/registry.js';

export class InteractiveCLI {
  private db: GatewayDatabase;
  private permManager: PermissionManager;
  private registry: AgentRegistry;
  private rl: readline.Interface | null = null;

  constructor(db: GatewayDatabase, permManager: PermissionManager, registry: AgentRegistry) {
    this.db = db;
    this.permManager = permManager;
    this.registry = registry;
  }

  public start(): void {
    if (!process.stdin.isTTY) {
      console.log('[CLI] Non-TTY environment detected. Interactive CLI disabled.');
      return;
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'NightSFTP> ',
    });

    console.log('[CLI] Interactive Terminal CLI started. Type "help" for commands.');
    this.rl.prompt();

    this.rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.handleCommand(trimmed);
      }
      if (this.rl) {
        this.rl.prompt();
      }
    });

    this.rl.on('close', () => {
      console.log('[CLI] Interactive CLI session closed.');
    });
  }

  private handleCommand(line: string): void {
    const args = line.split(/\s+/);
    const cmd = args[0].toLowerCase();

    switch (cmd) {
      case 'help':
        console.log(`
Available Commands:
  addagent <server_id> <secret_key>
  passagent <server_id> <new_token>
  delagent <server_id>
  adduser <username> <password>
  passuser <username> <new_password>
  deluser <username>
  grant <username> <server_id> <path> <PERMISSIONS> (e.g. READ,WRITE,DELETE or ALL)
  revoke <username> <server_id> <path>
  list
  help
`);
        break;

      case 'addagent': {
        if (args.length < 3) {
          console.log('Usage: addagent <server_id> <secret_key>');
          return;
        }
        const serverId = args[1];
        const secretKey = args[2];
        const ok = this.db.addAgent(serverId, secretKey);
        if (ok) {
          console.log(`[CLI] Agent "${serverId}" added/updated successfully.`);
        } else {
          console.log(`[CLI] Failed to add agent "${serverId}".`);
        }
        break;
      }

      case 'passagent':
      case 'settoken': {
        if (args.length < 3) {
          console.log('Usage: passagent <server_id> <new_token>');
          return;
        }
        const serverId = args[1];
        const newToken = args[2];
        const ok = this.db.updateAgentSecret(serverId, newToken);
        if (ok) {
          console.log(`[CLI] Token updated successfully for agent "${serverId}".`);
        } else {
          console.log(`[CLI] Agent "${serverId}" not found.`);
        }
        break;
      }

      case 'delagent': {
        if (args.length < 2) {
          console.log('Usage: delagent <server_id>');
          return;
        }
        const serverId = args[1];
        const ok = this.db.deleteAgent(serverId);
        if (ok) {
          console.log(`[CLI] Agent "${serverId}" deleted successfully.`);
        } else {
          console.log(`[CLI] Agent "${serverId}" not found.`);
        }
        break;
      }

      case 'adduser': {
        if (args.length < 3) {
          console.log('Usage: adduser <username> <password>');
          return;
        }
        const username = args[1];
        const password = args[2];
        const ok = this.db.addUser(username, password);
        if (ok) {
          console.log(`[CLI] User "${username}" added successfully.`);
        } else {
          console.log(`[CLI] Failed to add user "${username}" (user may already exist).`);
        }
        break;
      }

      case 'passuser':
      case 'passwd': {
        if (args.length < 3) {
          console.log('Usage: passuser <username> <new_password>');
          return;
        }
        const username = args[1];
        const newPassword = args[2];
        const ok = this.db.updateUserPassword(username, newPassword);
        if (ok) {
          console.log(`[CLI] Password updated successfully for user "${username}".`);
        } else {
          console.log(`[CLI] User "${username}" not found.`);
        }
        break;
      }

      case 'deluser': {
        if (args.length < 2) {
          console.log('Usage: deluser <username>');
          return;
        }
        const username = args[1];
        const ok = this.db.deleteUser(username);
        if (ok) {
          this.permManager.reloadUserCache(username);
          console.log(`[CLI] User "${username}" deleted successfully.`);
        } else {
          console.log(`[CLI] User "${username}" not found.`);
        }
        break;
      }

      case 'grant': {
        if (args.length < 5) {
          console.log('Usage: grant <username> <server_id> <path> <PERMISSIONS>');
          console.log('Example: grant alice server-001 / READ,WRITE,DELETE');
          return;
        }
        const username = args[1];
        const serverId = args[2];
        const itemPath = args[3];
        const perms = args.slice(4).join(' ');

        const ok = this.db.grantPermission(username, serverId, itemPath, perms);
        if (ok) {
          this.permManager.reloadUserCache(username);
          console.log(`[CLI] Granted [${perms}] to "${username}" on "${serverId}:${itemPath}".`);
        } else {
          console.log(`[CLI] Failed to grant permission.`);
        }
        break;
      }

      case 'revoke': {
        if (args.length < 4) {
          console.log('Usage: revoke <username> <server_id> <path>');
          return;
        }
        const username = args[1];
        const serverId = args[2];
        const itemPath = args[3];

        const ok = this.db.revokePermission(username, serverId, itemPath);
        if (ok) {
          this.permManager.reloadUserCache(username);
          console.log(`[CLI] Revoked permission for "${username}" on "${serverId}:${itemPath}".`);
        } else {
          console.log(`[CLI] Permission record not found.`);
        }
        break;
      }

      case 'list': {
        console.log('\n--- Active Agents (Online) ---');
        const onlineIds = this.registry.getOnlineAgentIds();
        if (onlineIds.length === 0) {
          console.log('No online agents currently connected.');
        } else {
          for (const id of onlineIds) {
            console.log(` - ${id} (Online)`);
          }
        }

        console.log('\n--- Registered Agents (DB) ---');
        const dbAgents = this.db.getAgents();
        for (const a of dbAgents) {
          const isOnline = this.registry.isAgentOnline(a.server_id);
          console.log(` - ${a.server_id} [Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}]`);
        }

        console.log('\n--- Registered Users (DB) ---');
        const dbUsers = this.db.getUsers();
        for (const u of dbUsers) {
          const perms = this.db.getUserPermissions(u.username);
          console.log(` - User: ${u.username} (${perms.length} grants)`);
          for (const p of perms) {
            console.log(`     -> ${p.server_id}:${p.path} [${p.permissions}]`);
          }
        }
        console.log('');
        break;
      }

      default:
        console.log(`Unknown command: "${cmd}". Type "help" for command list.`);
        break;
    }
  }
}
