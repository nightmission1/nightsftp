import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import net from 'net';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AuthManager } from './auth/auth.js';
import { AgentRegistry } from './agents/registry.js';
import { AgentConnection } from './agents/connection.js';
import { SftpServer } from './sftp/server.js';
import { parseMessage, serializeMessage, AuthMessage } from './protocol/protocol.js';

async function bootstrap() {
  const configPath = path.resolve(process.cwd(), 'config.yml');
  let config: any = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = YAML.parse(raw);
  } else {
    console.warn('[Gateway] config.yml not found, using default configuration.');
  }

  const sftpHost = config.sftp?.host || '0.0.0.0';
  const sftpPort = Number(process.env.GATEWAY_PORT || process.env.PORT || config.sftp?.port || 25628);
  const agentHost = config.agent?.host || '0.0.0.0';
  const agentPort = Number(config.agent?.port) || sftpPort;

  const authManager = new AuthManager();
  authManager.loadFromConfig(config.agents);

  const agentRegistry = new AgentRegistry();

  const isSinglePort = (sftpPort === agentPort && sftpHost === agentHost);

  let wss: WebSocketServer;
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NightSFTP Gateway Running');
  });

  wss = new WebSocketServer({ noServer: true });

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
        if (authManager.validateAgentToken(authMsg.agentId, authMsg.token)) {
          currentConnection = new AgentConnection(authMsg.agentId, ws);
          agentRegistry.registerAgent(currentConnection);

          console.log(`[Gateway] Agent authenticated successfully: ${authMsg.agentId}`);
          ws.send(serializeMessage({
            type: 'auth_response',
            requestId: authMsg.requestId,
            success: true,
            error: 'OK',
          }));
        } else {
          console.warn(`[Gateway] Authentication failed for agent: ${authMsg.agentId}`);
          ws.send(serializeMessage({
            type: 'auth_response',
            requestId: authMsg.requestId,
            success: false,
            error: 'AUTH_FAILED',
          }));
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
        console.log(`[Gateway] Agent disconnected: ${currentConnection.agentId}`);
        agentRegistry.unregisterAgent(currentConnection.agentId);
      }
    });
  });

  if (isSinglePort) {
    console.log(`[Gateway] Single-port loopback mode active on port ${sftpPort}...`);

    const internalSftpPort = 25599;
    const internalAgentPort = 25598;

    // Start real SFTP server on internal loopback port
    const sftpServer = new SftpServer('127.0.0.1', internalSftpPort, authManager, agentRegistry);
    await sftpServer.listen();

    // Start real HTTP/WS server on internal loopback port
    httpServer.listen(internalAgentPort, '127.0.0.1');

    // Single public port demuxer
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

      // If no HTTP data within 40ms -> forward to SFTP SSH server
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
      console.log(`[Gateway] Single-port demuxer listening on ${sftpHost}:${sftpPort}`);
      console.log(`[Gateway] SFTP (WinSCP) & Agent Tunnel (Minecraft) are BOTH active on port ${sftpPort}!`);
    });

  } else {
    // Separate ports mode
    const sftpServer = new SftpServer(sftpHost, sftpPort, authManager, agentRegistry);
    await sftpServer.listen();
    httpServer.listen(agentPort, agentHost, () => {
      console.log(`[Gateway] Agent tunnel listening on ${agentHost}:${agentPort}`);
    });
  }

  console.log('[Gateway] NightSFTP Gateway running smoothly.');
}

bootstrap().catch((err) => {
  console.error('[Gateway] Fatal startup error:', err);
});
