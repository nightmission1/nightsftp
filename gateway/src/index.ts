import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import net from 'net';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GatewayDatabase } from './db/database.js';
import { PermissionManager } from './security/permissions.js';
import { AgentRegistry } from './agents/registry.js';
import { AgentConnection } from './agents/connection.js';
import { SftpServer } from './sftp/server.js';
import { AuditLogger } from './logging/audit.js';
import { InteractiveCLI } from './cli/terminal.js';
import { parseMessage, serializeMessage, AuthMessage } from './protocol/protocol.js';
import { loadOrGenerateConfig } from './config.js';

function formatLog(level: 'INFO' | 'WARN' | 'ERROR', component: string, message: string): string {
  return `[${new Date().toISOString()}] [${level}] [${component}] ${message}`;
}

async function bootstrap() {
  const config = loadOrGenerateConfig();

  const sftpHost = config.sftp?.host || '0.0.0.0';
  const sftpPort = Number(process.env.SFTP_PORT || process.env.GATEWAY_PORT || config.sftp?.port || 2222);
  const agentHost = (config as any).tunnel?.host || (config as any).agent?.host || '0.0.0.0';
  const agentPort = Number(process.env.AGENT_PORT || (config as any).tunnel?.port || (config as any).agent?.port || 8080);

  // Initialize DB, Security, Audit Logger, Agent Registry
  const db = new GatewayDatabase();
  const permManager = new PermissionManager(db);
  const auditLogger = new AuditLogger();
  const agentRegistry = new AgentRegistry();

  // Default admin fallback if DB is empty
  if (db.getUsers().length === 0) {
    db.addUser('admin', 'admin123');
    const agents = db.getAgents();
    for (const a of agents) {
      db.grantPermission('admin', a.server_id, '/', 'ALL');
    }
    permManager.reloadCache();
  }

  const isSinglePort = sftpPort === agentPort && sftpHost === agentHost;

  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NightSFTP Gateway Server');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let currentConnection: AgentConnection | null = null;

    ws.on('message', (data: any) => {
      const raw = data.toString();
      const msg = parseMessage(raw);
      if (!msg) return;

      if (msg.type === 'auth') {
        const authMsg = msg as AuthMessage;
        const secretKey = authMsg.token;

        if (db.validateAgentSecret(authMsg.agentId, secretKey)) {
          const capabilities = Array.isArray(authMsg.capabilities) ? authMsg.capabilities : [];
          currentConnection = new AgentConnection(authMsg.agentId, ws, capabilities);
          agentRegistry.registerAgent(currentConnection);

          console.log(
            formatLog(
              'INFO',
              'AgentTunnel',
              `Agent authenticated successfully: ${authMsg.agentId} (Capabilities: [${capabilities.join(', ')}])`
            )
          );

          ws.send(
            serializeMessage({
              type: 'auth_response',
              requestId: authMsg.requestId,
              success: true,
              error: 'OK',
            })
          );
        } else {
          console.warn(formatLog('WARN', 'AgentTunnel', `Authentication failed for agent: ${authMsg.agentId}`));
          ws.send(
            serializeMessage({
              type: 'auth_response',
              requestId: authMsg.requestId,
              success: false,
              error: 'AUTH_FAILED',
            })
          );
          ws.close();
        }
        return;
      }

      if (currentConnection) {
        currentConnection.handleIncomingMessage(msg as any);
      }
    });

    ws.on('close', () => {
      if (currentConnection) {
        console.log(formatLog('INFO', 'AgentTunnel', `Agent session terminated: ${currentConnection.agentId}`));
        agentRegistry.unregisterAgent(currentConnection.agentId);
      }
    });
  });

  if (isSinglePort) {
    const internalSftpPort = 25599;
    const internalAgentPort = 25598;

    const sftpServer = new SftpServer('127.0.0.1', internalSftpPort, db, permManager, agentRegistry, auditLogger);
    await sftpServer.listen();

    httpServer.listen(internalAgentPort, '127.0.0.1');

    const demuxServer = net.createServer((socket) => {
      let dataReceived = false;

      const forwardTo = (targetPort: number, initialChunk?: Buffer) => {
        const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
          if (initialChunk) {
            proxySocket.write(initialChunk);
          }
          socket.pipe(proxySocket);
          proxySocket.pipe(socket);
        });

        proxySocket.on('error', () => socket.destroy());
        socket.on('error', () => proxySocket.destroy());
      };

      const timer = setTimeout(() => {
        if (!dataReceived) {
          socket.removeAllListeners('data');
          forwardTo(internalSftpPort);
        }
      }, 40);

      socket.once('data', (chunk) => {
        dataReceived = true;
        clearTimeout(timer);
        const header = chunk.toString('utf8', 0, 4);

        if (header.startsWith('GET') || header.startsWith('POST') || header.startsWith('HTTP')) {
          forwardTo(internalAgentPort, chunk);
        } else {
          forwardTo(internalSftpPort, chunk);
        }
      });
    });

    demuxServer.listen(sftpPort, sftpHost, () => {
      console.log(formatLog('INFO', 'Gateway', `Single-port multiplexer listening on ${sftpHost}:${sftpPort}`));
    });
  } else {
    // Separate ports mode
    const sftpServer = new SftpServer(sftpHost, sftpPort, db, permManager, agentRegistry, auditLogger);
    await sftpServer.listen();
    httpServer.listen(agentPort, agentHost, () => {
      console.log(formatLog('INFO', 'Tunnel', `Agent WebSocket tunnel listening on ${agentHost}:${agentPort}`));
    });
  }

  console.log(formatLog('INFO', 'Gateway', 'NightSFTP Gateway service initialization complete.'));

  // Start Interactive Terminal CLI AFTER service startup logs complete
  const cli = new InteractiveCLI(db, permManager, agentRegistry);
  cli.start();

  // Keep event loop active continuously even when stdin is closed or connections end
  if (process.stdin) {
    process.stdin.resume();
  }
  const keepAliveTimer = setInterval(() => {}, 1000 * 60 * 60);

  // Graceful shutdown listeners
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(formatLog('INFO', 'Gateway', 'Shutdown signal received. Terminating services and releasing resources...'));
    clearInterval(keepAliveTimer);
    try {
      db.close();
    } catch (_) {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error(formatLog('ERROR', 'Gateway', `Fatal startup error: ${err.message || err}`));
  process.exit(1);
});

