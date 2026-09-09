import { Server, ClientChannel } from 'ssh2';
import { generateKeyPairSync } from 'crypto';
import { GatewayDatabase } from '../db/database.js';
import { PermissionManager } from '../security/permissions.js';
import { AgentRegistry } from '../agents/registry.js';
import { AuditLogger } from '../logging/audit.js';
import { SftpSessionHandler } from './session.js';

export class SftpServer {
  private server: Server;
  private host: string;
  private port: number;

  constructor(
    host: string,
    port: number,
    db: GatewayDatabase,
    permManager: PermissionManager,
    agentRegistry: AgentRegistry,
    auditLogger: AuditLogger
  ) {
    this.host = host;
    this.port = port;

    // Generate a temporary host RSA key pair for SFTP SSH authentication
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });

    this.server = new Server({ hostKeys: [privateKey] }, (client, info) => {
      let authenticatedUser: string | null = null;
      const clientIp = info?.ip || '127.0.0.1';

      client.on('authentication', (ctx) => {
        if (ctx.method === 'password') {
          if (db.validateUserPassword(ctx.username, ctx.password)) {
            authenticatedUser = ctx.username;
            auditLogger.log({
              timestamp: new Date().toISOString(),
              username: ctx.username,
              ip: clientIp,
              action: 'LOGIN',
              details: 'Password authentication successful',
            });
            return ctx.accept();
          }
        }
        return ctx.reject(['password']);
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('sftp', (acceptSftp) => {
            const sftpStream = acceptSftp();
            if (!authenticatedUser) {
              sftpStream.end();
              return;
            }

            new SftpSessionHandler(
              agentRegistry,
              permManager,
              auditLogger,
              { username: authenticatedUser, clientIp },
              sftpStream
            );
          });
        });
      });

      client.on('end', () => {
        if (authenticatedUser) {
          auditLogger.log({
            timestamp: new Date().toISOString(),
            username: authenticatedUser,
            ip: clientIp,
            action: 'DISCONNECT',
          });
        }
      });

      client.on('error', () => {
        // Suppress connection reset errors
      });
    });
  }

  public listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] [SFTP] SFTP server listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  public injectSocket(socket: any): void {
    if (typeof (this.server as any)._onConnection === 'function') {
      (this.server as any)._onConnection(socket);
    } else {
      this.server.emit('connection', socket);
    }
  }

  public close(): void {
    this.server.close();
  }
}
