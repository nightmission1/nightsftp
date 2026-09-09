import { Server, ClientChannel } from 'ssh2';
import { generateKeyPairSync } from 'crypto';
import { AuthManager } from '../auth/auth.js';
import { AgentRegistry } from '../agents/registry.js';
import { SftpSessionHandler } from './session.js';

export class SftpServer {
  private server: Server;
  private host: string;
  private port: number;

  constructor(host: string, port: number, authManager: AuthManager, agentRegistry: AgentRegistry) {
    this.host = host;
    this.port = port;

    // Generate a temporary host RSA key pair for SFTP SSH authentication (pkcs1 format required by ssh2)
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });


    this.server = new Server({ hostKeys: [privateKey] }, (client) => {
      let targetAgentId: string | null = null;

      client.on('authentication', (ctx) => {
        if (ctx.method === 'password') {
          const agentId = authManager.validateSftpUser(ctx.username, ctx.password);
          if (agentId) {
            targetAgentId = agentId;
            return ctx.accept();
          }
        } else if (ctx.method === 'none') {
          const agentId = authManager.validateSftpUser(ctx.username);
          if (agentId) {
            targetAgentId = agentId;
            return ctx.accept();
          }
        }
        return ctx.reject(['password', 'none']);
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('sftp', (acceptSftp) => {
            const sftpStream = acceptSftp();
            if (!targetAgentId) {
              sftpStream.end();
              return;
            }

            const agentConn = agentRegistry.getAgent(targetAgentId);
            if (!agentConn) {
              console.log(`[Gateway] SFTP request rejected. Agent ${targetAgentId} is offline.`);
              sftpStream.end();
              return;
            }

            new SftpSessionHandler(agentConn, sftpStream);
          });
        });
      });

      client.on('error', (err) => {
        // Ignore connection aborts
      });
    });
  }

  public listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        console.log(`[Gateway] SFTP server listening on ${this.host}:${this.port}`);
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

