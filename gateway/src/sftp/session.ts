import path from 'path';
import { utils } from 'ssh2';
import { AgentRegistry } from '../agents/registry.js';
import { PermissionManager, AccessRight } from '../security/permissions.js';
import { AuditLogger } from '../logging/audit.js';
import { sanitizePath } from '../security/validation.js';

export interface SftpSessionContext {
  username: string;
  clientIp: string;
}

export class SftpSessionHandler {
  private registry: AgentRegistry;
  private permManager: PermissionManager;
  private auditLogger: AuditLogger;
  private context: SftpSessionContext;
  private sftp: any;

  private readonly MAX_HANDLES_PER_SESSION: number = 500;
  private readonly MAX_WRITE_CHUNK_SIZE: number = 4 * 1024 * 1024; // 4MB

  private handleCounter: number = 0;
  private handles: Map<
    string,
    {
      handleType: 'VIRTUAL_ROOT' | 'SERVER_PATH';
      serverId?: string;
      innerPath?: string;
      flags?: number;
      readDone?: boolean;
    }
  > = new Map();

  constructor(
    registry: AgentRegistry,
    permManager: PermissionManager,
    auditLogger: AuditLogger,
    context: SftpSessionContext,
    sftp: any
  ) {
    this.registry = registry;
    this.permManager = permManager;
    this.auditLogger = auditLogger;
    this.context = context;
    this.sftp = sftp;

    this.setupHandlers();
    this.setupAgentDisconnectListener();
  }

  private setupAgentDisconnectListener(): void {
    const onAgentUnregistered = (unregisteredId: string) => {
      // Abort inflight handles linked to the disconnected server
      for (const [handleStr, info] of this.handles.entries()) {
        if (info.serverId === unregisteredId) {
          this.handles.delete(handleStr);
        }
      }
    };

    this.registry.on('agent_unregistered', onAgentUnregistered);
    this.sftp.on('close', () => {
      this.registry.removeListener('agent_unregistered', onAgentUnregistered);
    });
  }

  private parseVirtualPath(rawPath: string): { isRoot: boolean; serverId: string | null; innerPath: string } {
    let cleaned = sanitizePath(rawPath);
    if (!cleaned || cleaned === '/') {
      return { isRoot: true, serverId: null, innerPath: '/' };
    }

    // Path format: /<server_id> or /<server_id>/...
    const parts = cleaned.substring(1).split('/');
    const serverId = parts[0];
    const rest = parts.slice(1).join('/');
    let innerPath = path.posix.normalize('/' + rest);
    if (!innerPath.startsWith('/')) {
      innerPath = '/' + innerPath;
    }

    return { isRoot: false, serverId, innerPath };
  }

  private setupHandlers(): void {
    const sftp = this.sftp;

    // REALPATH
    sftp.on('REALPATH', async (reqId: number, pathStr: string) => {
      const parsed = this.parseVirtualPath(pathStr);
      let canonical = '/';

      if (!parsed.isRoot && parsed.serverId) {
        canonical = `/${parsed.serverId}${parsed.innerPath === '/' ? '' : parsed.innerPath}`;
        if (canonical.endsWith('/') && canonical.length > 1) {
          canonical = canonical.slice(0, -1);
        }
      }

      const attrs = parsed.isRoot || parsed.innerPath === '/'
        ? { mode: 0o40755, size: 4096, mtime: Math.floor(Date.now() / 1000), atime: Math.floor(Date.now() / 1000) }
        : { mode: 0o100644, size: 0, mtime: Math.floor(Date.now() / 1000), atime: Math.floor(Date.now() / 1000) };

      sftp.name(reqId, [{ filename: canonical, longname: canonical, attrs }]);
    });

    // STAT / LSTAT
    sftp.on('STAT', async (reqId: number, pathStr: string) => {
      this.handleStat(reqId, pathStr);
    });

    sftp.on('LSTAT', async (reqId: number, pathStr: string) => {
      this.handleStat(reqId, pathStr);
    });

    sftp.on('FSTAT', async (reqId: number, handleBuffer: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      if (info.handleType === 'VIRTUAL_ROOT') {
        const mode = 0o40755;
        return sftp.attrs(reqId, {
          mode,
          size: 4096,
          mtime: Math.floor(Date.now() / 1000),
          atime: Math.floor(Date.now() / 1000),
        });
      }

      const fullPath = `/${info.serverId}${info.innerPath}`;
      const isCreate = info.flags ? (info.flags & (utils.sftp.OPEN_MODE.CREAT | utils.sftp.OPEN_MODE.TRUNC)) !== 0 : false;
      this.handleStat(reqId, fullPath, isCreate);
    });

    // STATVFS / FSTATVFS (RaiDrive / Windows Mount Compatibility)
    const handleStatvfs = async (reqId: number, pathStr?: string, serverIdHint?: string) => {
      const parsed = pathStr ? this.parseVirtualPath(pathStr) : { isRoot: false, serverId: serverIdHint, innerPath: '/' };

      let diskSpace: { totalBytes: number; usableBytes: number };

      if (parsed.isRoot || !parsed.serverId) {
        const authorized = this.permManager.getAuthorizedServerIds(this.context.username);
        diskSpace = await this.registry.getAggregatedDiskSpace(authorized);
      } else {
        if (!this.permManager.isServerAuthorized(this.context.username, parsed.serverId)) {
          return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        }
        diskSpace = await this.registry.getAgentDiskSpace(parsed.serverId);
      }

      const bsize = 4096;
      const blocks = Math.floor(diskSpace.totalBytes / bsize);
      const bfree = Math.floor(diskSpace.usableBytes / bsize);
      const bavail = bfree;

      sftp.statvfs(reqId, {
        bsize,
        frsize: bsize,
        blocks,
        bfree,
        bavail,
        files: 1000000,
        ffree: 800000,
        favail: 800000,
        fsid: 1,
        flag: 0,
        namemax: 255,
      });
    };

    sftp.on('STATVFS', async (reqId: number, pathStr: string) => {
      handleStatvfs(reqId, pathStr);
    });

    sftp.on('FSTATVFS', async (reqId: number, handleBuffer: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }
      handleStatvfs(reqId, undefined, info.serverId);
    });

    // OPENDIR
    sftp.on('OPENDIR', async (reqId: number, pathStr: string) => {
      if (this.handles.size >= this.MAX_HANDLES_PER_SESSION) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      const parsed = this.parseVirtualPath(pathStr);
      const handleStr = (++this.handleCounter).toString(16).padStart(8, '0');
      const handleBuf = Buffer.from(handleStr, 'hex');

      if (parsed.isRoot) {
        this.handles.set(handleStr, { handleType: 'VIRTUAL_ROOT' });
        return sftp.handle(reqId, handleBuf);
      }

      if (!parsed.serverId || !this.permManager.isServerAuthorized(this.context.username, parsed.serverId)) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: parsed.serverId || 'UNKNOWN',
          filePath: parsed.innerPath,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      if (!this.permManager.checkPermission(this.context.username, parsed.serverId, parsed.innerPath, 'READ')) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      this.handles.set(handleStr, {
        handleType: 'SERVER_PATH',
        serverId: parsed.serverId,
        innerPath: parsed.innerPath,
      });
      sftp.handle(reqId, handleBuf);
    });

    // READDIR
    sftp.on('READDIR', async (reqId: number, handleBuffer: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      if (info.readDone) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.EOF);
      }

      info.readDone = true;

      // Virtual Root Listing
      if (info.handleType === 'VIRTUAL_ROOT') {
        const authorizedIds = this.permManager.getAuthorizedServerIds(this.context.username);
        const list = authorizedIds.map((srvId) => {
          const isOnline = this.registry.isAgentOnline(srvId);
          return {
            filename: srvId,
            longname: `drwxr-xr-x 1 minecraft minecraft 4096 Jan 1 00:00 ${srvId}`,
            attrs: {
              mode: 0o40755,
              size: 4096,
              mtime: Math.floor(Date.now() / 1000),
              atime: Math.floor(Date.now() / 1000),
            },
          };
        });

        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'READ',
          filePath: '/',
          details: `Virtual root list returned ${list.length} servers`,
        });

        return sftp.name(reqId, list);
      }

      // Server directory listing
      const agent = this.registry.getAgent(info.serverId!);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const res = await agent.sendRequest('list', info.innerPath!);
      if (!res.success || !Array.isArray(res.data)) {
        return sftp.status(reqId, this.mapErrorCode(res.error));
      }

      const list = res.data.map((item: any) => {
        const mode = item.isDirectory ? 0o40755 : 0o100644;
        return {
          filename: item.name,
          longname: `${item.isDirectory ? 'd' : '-'}rw-r--r-- 1 minecraft minecraft ${item.size} Jan 1 00:00 ${item.name}`,
          attrs: {
            mode,
            size: item.size,
            mtime: Math.floor((item.lastModified || Date.now()) / 1000),
            atime: Math.floor((item.lastModified || Date.now()) / 1000),
          },
        };
      });

      this.auditLogger.log({
        timestamp: new Date().toISOString(),
        username: this.context.username,
        ip: this.context.clientIp,
        action: 'READ',
        targetServer: info.serverId,
        filePath: info.innerPath,
      });

      sftp.name(reqId, list);
    });

    // OPEN
    sftp.on('OPEN', async (reqId: number, filename: string, flags: number, attrs: any) => {
      if (this.handles.size >= this.MAX_HANDLES_PER_SESSION) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      const parsed = this.parseVirtualPath(filename);

      if (parsed.isRoot || !parsed.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const isWrite = (flags & (utils.sftp.OPEN_MODE.WRITE | utils.sftp.OPEN_MODE.APPEND | utils.sftp.OPEN_MODE.CREAT | utils.sftp.OPEN_MODE.TRUNC)) !== 0;
      const isCreate = (flags & (utils.sftp.OPEN_MODE.CREAT | utils.sftp.OPEN_MODE.TRUNC)) !== 0;
      const requiredRight: AccessRight = isWrite ? 'WRITE' : 'READ';

      if (!this.permManager.checkPermission(this.context.username, parsed.serverId, parsed.innerPath, requiredRight)) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(parsed.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      // If CREAT or TRUNC flags are present, notify agent to create/clear file asynchronously or touch it
      if (isCreate) {
        agent.sendRequest('write', parsed.innerPath, { offset: 0, data: '' }).catch(() => {});
      }

      const handleStr = (++this.handleCounter).toString(16).padStart(8, '0');
      const handleBuf = Buffer.from(handleStr, 'hex');

      this.handles.set(handleStr, {
        handleType: 'SERVER_PATH',
        serverId: parsed.serverId,
        innerPath: parsed.innerPath,
        flags,
      });

      sftp.handle(reqId, handleBuf);
    });

    // READ
    sftp.on('READ', async (reqId: number, handleBuffer: Buffer, offset: number, length: number) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info || info.handleType !== 'SERVER_PATH' || !info.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      // Re-verify permission on every read to prevent cache invalidation bypass / race conditions
      if (!this.permManager.checkPermission(this.context.username, info.serverId, info.innerPath!, 'READ')) {
        this.handles.delete(handleStr);
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(info.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const res = await agent.sendRequest('read', info.innerPath!, { offset, length });
      if (!res.success) {
        return sftp.status(reqId, this.mapErrorCode(res.error));
      }

      const chunk = res.data?.chunk;
      const buf = chunk ? Buffer.from(chunk, 'base64') : Buffer.alloc(0);

      if (buf.length === 0) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.EOF);
      }

      this.auditLogger.log({
        timestamp: new Date().toISOString(),
        username: this.context.username,
        ip: this.context.clientIp,
        action: 'READ',
        targetServer: info.serverId,
        filePath: info.innerPath,
        details: `read ${buf.length} bytes at offset ${offset}`,
      });

      sftp.data(reqId, buf);
    });

    // WRITE
    sftp.on('WRITE', async (reqId: number, handleBuffer: Buffer, offset: number, data: Buffer) => {
      if (data.length > this.MAX_WRITE_CHUNK_SIZE) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info || info.handleType !== 'SERVER_PATH' || !info.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      // Re-verify permission on every write to prevent revoked permission bypass
      if (!this.permManager.checkPermission(this.context.username, info.serverId, info.innerPath!, 'WRITE')) {
        this.handles.delete(handleStr);
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(info.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const base64Data = data.toString('base64');
      const res = await agent.sendRequest('write', info.innerPath!, { offset, data: base64Data });
      if (!res.success) {
        return sftp.status(reqId, this.mapErrorCode(res.error));
      }

      this.auditLogger.log({
        timestamp: new Date().toISOString(),
        username: this.context.username,
        ip: this.context.clientIp,
        action: 'WRITE',
        targetServer: info.serverId,
        filePath: info.innerPath,
        details: `wrote ${data.length} bytes at offset ${offset}`,
      });

      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });

    // CLOSE
    sftp.on('CLOSE', async (reqId: number, handleBuffer: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      this.handles.delete(handleStr);
      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });

    // MKDIR
    sftp.on('MKDIR', async (reqId: number, pathStr: string) => {
      const parsed = this.parseVirtualPath(pathStr);
      if (parsed.isRoot || !parsed.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      if (!this.permManager.checkPermission(this.context.username, parsed.serverId, parsed.innerPath, 'WRITE')) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(parsed.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const res = await agent.sendRequest('mkdir', parsed.innerPath);
      if (res.success) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'WRITE',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
          details: 'mkdir',
        });
      }
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // RMDIR
    sftp.on('RMDIR', async (reqId: number, pathStr: string) => {
      const parsed = this.parseVirtualPath(pathStr);
      if (parsed.isRoot || !parsed.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      if (!this.permManager.checkPermission(this.context.username, parsed.serverId, parsed.innerPath, 'DELETE')) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(parsed.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const res = await agent.sendRequest('rmdir', parsed.innerPath);
      if (res.success) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'DELETE',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
          details: 'rmdir',
        });
      }
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // REMOVE / UNLINK
    sftp.on('REMOVE', async (reqId: number, pathStr: string) => {
      const parsed = this.parseVirtualPath(pathStr);
      if (parsed.isRoot || !parsed.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      if (!this.permManager.checkPermission(this.context.username, parsed.serverId, parsed.innerPath, 'DELETE')) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(parsed.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const res = await agent.sendRequest('delete', parsed.innerPath);
      if (res.success) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'DELETE',
          targetServer: parsed.serverId,
          filePath: parsed.innerPath,
          details: 'delete file',
        });
      }
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // RENAME (Supports atomic save: requires WRITE permission on src and dest, DELETE permission is NOT required for overwrite)
    sftp.on('RENAME', async (reqId: number, oldPathStr: string, newPathStr: string) => {
      const src = this.parseVirtualPath(oldPathStr);
      const dest = this.parseVirtualPath(newPathStr);

      if (src.isRoot || dest.isRoot || !src.serverId || !dest.serverId || src.serverId !== dest.serverId) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      // Check WRITE permission on both source and destination paths for atomic save support
      if (
        !this.permManager.checkPermission(this.context.username, src.serverId, src.innerPath, 'WRITE') ||
        !this.permManager.checkPermission(this.context.username, dest.serverId, dest.innerPath, 'WRITE')
      ) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'PERMISSION_DENIED',
          targetServer: src.serverId,
          filePath: src.innerPath,
          details: `rename to ${dest.innerPath}`,
        });
        return sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
      }

      const agent = this.registry.getAgent(src.serverId);
      if (!agent) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.CONNECTION_LOST);
      }

      const res = await agent.sendRequest('rename', src.innerPath, { targetPath: dest.innerPath });
      if (res.success) {
        this.auditLogger.log({
          timestamp: new Date().toISOString(),
          username: this.context.username,
          ip: this.context.clientIp,
          action: 'WRITE',
          targetServer: src.serverId,
          filePath: src.innerPath,
          details: `rename to ${dest.innerPath}`,
        });
      }
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // SETSTAT / FSETSTAT
    sftp.on('SETSTAT', async (reqId: number, pathStr: string, attrs: any) => {
      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });
    sftp.on('FSETSTAT', async (reqId: number, handleBuffer: Buffer, attrs: any) => {
      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });
  }

  private async handleStat(reqId: number, pathStr: string, isCreateFallback = false): Promise<void> {
    const parsed = this.parseVirtualPath(pathStr);

    if (parsed.isRoot) {
      const mode = 0o40755;
      return this.sftp.attrs(reqId, {
        mode,
        size: 4096,
        mtime: Math.floor(Date.now() / 1000),
        atime: Math.floor(Date.now() / 1000),
      });
    }

    if (!parsed.serverId || !this.permManager.isServerAuthorized(this.context.username, parsed.serverId)) {
      return this.sftp.status(reqId, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
    }

    // Check if stat is for top-level server folder (/server-001)
    if (parsed.innerPath === '/') {
      const mode = 0o40755;
      return this.sftp.attrs(reqId, {
        mode,
        size: 4096,
        mtime: Math.floor(Date.now() / 1000),
        atime: Math.floor(Date.now() / 1000),
      });
    }

    const agent = this.registry.getAgent(parsed.serverId);
    if (!agent) {
      if (isCreateFallback) {
        return this.sftp.attrs(reqId, {
          mode: 0o100644,
          size: 0,
          mtime: Math.floor(Date.now() / 1000),
          atime: Math.floor(Date.now() / 1000),
        });
      }
      return this.sftp.status(reqId, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
    }

    const res = await agent.sendRequest('stat', parsed.innerPath);
    if (!res.success || !res.data) {
      if (isCreateFallback) {
        return this.sftp.attrs(reqId, {
          mode: 0o100644,
          size: 0,
          mtime: Math.floor(Date.now() / 1000),
          atime: Math.floor(Date.now() / 1000),
        });
      }
      return this.sftp.status(reqId, this.mapErrorCode(res.error));
    }

    const item = res.data;
    const mode = item.isDirectory ? 0o40755 : 0o100644;
    this.sftp.attrs(reqId, {
      mode,
      size: item.size || 0,
      mtime: Math.floor((item.lastModified || Date.now()) / 1000),
      atime: Math.floor((item.lastModified || Date.now()) / 1000),
    });
  }

  private mapErrorCode(err?: string): number {
    switch (err) {
      case 'NOT_FOUND':
        return utils.sftp.STATUS_CODE.NO_SUCH_FILE;
      case 'FORBIDDEN':
      case 'ROOT_ESCAPE':
        return utils.sftp.STATUS_CODE.PERMISSION_DENIED;
      case 'AGENT_OFFLINE':
      case 'CONNECTION_LOST':
        return utils.sftp.STATUS_CODE.CONNECTION_LOST;
      default:
        return utils.sftp.STATUS_CODE.FAILURE;
    }
  }
}
