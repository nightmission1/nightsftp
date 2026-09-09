import { utils } from 'ssh2';
import { AgentConnection } from '../agents/connection.js';
import { sanitizePath } from '../security/validation.js';

export class SftpSessionHandler {
  private agent: AgentConnection;
  private sftp: any;
  private handleCounter: number = 0;
  private handles: Map<string, { path: string; flags: number; readDone?: boolean }> = new Map();

  constructor(agent: AgentConnection, sftp: any) {
    this.agent = agent;
    this.sftp = sftp;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    const sftp = this.sftp;

    // REALPATH
    sftp.on('REALPATH', async (reqId: number, path: string) => {
      let cleaned = sanitizePath(path);
      if (!cleaned || cleaned === '.') cleaned = '/';
      if (!cleaned.startsWith('/')) cleaned = '/' + cleaned;
      sftp.name(reqId, [{ filename: cleaned, longname: cleaned, attrs: {} }]);
    });

    // STAT / LSTAT / FSTAT
    sftp.on('STAT', async (reqId: number, path: string) => {
      this.handleStat(reqId, path);
    });
    sftp.on('LSTAT', async (reqId: number, path: string) => {
      this.handleStat(reqId, path);
    });
    sftp.on('FSTAT', async (reqId: number, handleBuffer: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }
      this.handleStat(reqId, info.path);
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

      const res = await this.agent.sendRequest('list', info.path);
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

      sftp.name(reqId, list);
    });


    // OPEN
    sftp.on('OPEN', async (reqId: number, filename: string, flags: number, attrs: any) => {
      const cleaned = sanitizePath(filename);
      const handleStr = (++this.handleCounter).toString(16).padStart(8, '0');
      const handleBuf = Buffer.from(handleStr, 'hex');

      console.log(`[SFTP OPEN] path: "${cleaned}", flags: ${flags}`);
      this.handles.set(handleStr, { path: cleaned, flags });
      sftp.handle(reqId, handleBuf);
    });

    // OPENDIR
    sftp.on('OPENDIR', async (reqId: number, path: string) => {
      const cleaned = sanitizePath(path);
      const handleStr = (++this.handleCounter).toString(16).padStart(8, '0');
      const handleBuf = Buffer.from(handleStr, 'hex');

      this.handles.set(handleStr, { path: cleaned, flags: 0 });
      sftp.handle(reqId, handleBuf);
    });

    // READ
    sftp.on('READ', async (reqId: number, handleBuffer: Buffer, offset: number, length: number) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info) {
        console.warn(`[SFTP READ] Invalid handle: ${handleStr}`);
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      console.log(`[SFTP READ] Requesting path: "${info.path}", offset: ${offset}, length: ${length}`);
      const res = await this.agent.sendRequest('read', info.path, { offset, length });
      if (!res.success) {
        console.warn(`[SFTP READ] Agent request failed for "${info.path}": ${res.error}`);
        return sftp.status(reqId, this.mapErrorCode(res.error));
      }

      const chunk = res.data?.chunk;
      const buf = chunk ? Buffer.from(chunk, 'base64') : Buffer.alloc(0);

      console.log(`[SFTP READ] Received ${buf.length} bytes for "${info.path}" (eof: ${res.data?.eof})`);
      if (buf.length === 0) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.EOF);
      }

      sftp.data(reqId, buf);
    });

    // WRITE
    sftp.on('WRITE', async (reqId: number, handleBuffer: Buffer, offset: number, data: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      const info = this.handles.get(handleStr);
      if (!info) {
        return sftp.status(reqId, utils.sftp.STATUS_CODE.FAILURE);
      }

      const base64Data = data.toString('base64');
      const res = await this.agent.sendRequest('write', info.path, { offset, data: base64Data });
      if (!res.success) {
        return sftp.status(reqId, this.mapErrorCode(res.error));
      }

      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });

    // CLOSE
    sftp.on('CLOSE', async (reqId: number, handleBuffer: Buffer) => {
      const handleStr = handleBuffer.toString('hex');
      this.handles.delete(handleStr);
      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });

    // MKDIR
    sftp.on('MKDIR', async (reqId: number, path: string) => {
      const cleaned = sanitizePath(path);
      const res = await this.agent.sendRequest('mkdir', cleaned);
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // RMDIR
    sftp.on('RMDIR', async (reqId: number, path: string) => {
      const cleaned = sanitizePath(path);
      const res = await this.agent.sendRequest('rmdir', cleaned);
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // REMOVE / UNLINK
    sftp.on('REMOVE', async (reqId: number, path: string) => {
      const cleaned = sanitizePath(path);
      const res = await this.agent.sendRequest('delete', cleaned);
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });

    // SETSTAT / FSETSTAT (WinSCP timestamp & permissions setting)
    sftp.on('SETSTAT', async (reqId: number, path: string, attrs: any) => {
      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });
    sftp.on('FSETSTAT', async (reqId: number, handleBuffer: Buffer, attrs: any) => {
      sftp.status(reqId, utils.sftp.STATUS_CODE.OK);
    });

    // RENAME
    sftp.on('RENAME', async (reqId: number, oldPath: string, newPath: string) => {
      const src = sanitizePath(oldPath);
      const dest = sanitizePath(newPath);
      const res = await this.agent.sendRequest('rename', src, { targetPath: dest });
      sftp.status(reqId, res.success ? utils.sftp.STATUS_CODE.OK : this.mapErrorCode(res.error));
    });


  }

  private async handleStat(reqId: number, path: string): Promise<void> {
    const cleaned = sanitizePath(path);
    const res = await this.agent.sendRequest('stat', cleaned);
    if (!res.success || !res.data) {
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
      case 'ALREADY_EXISTS':
        return utils.sftp.STATUS_CODE.FAILURE;
      default:
        return utils.sftp.STATUS_CODE.FAILURE;
    }
  }
}
