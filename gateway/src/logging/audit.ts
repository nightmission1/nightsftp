import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export interface AuditLogEntry {
  timestamp: string;
  username: string;
  ip: string;
  action: 'LOGIN' | 'READ' | 'WRITE' | 'DELETE' | 'EXECUTE' | 'PERMISSION_DENIED' | 'DISCONNECT';
  targetServer?: string;
  filePath?: string;
  details?: string;
}

export class AuditLogger {
  private logDir: string;
  private latestLogPath: string;
  private writeQueue: string[] = [];
  private isWriting: boolean = false;
  private currentSizeBytes: number = 0;
  private readonly SIZE_THRESHOLD_BYTES = 51 * 1024 * 1024; // 51 MB
  private readonly MAX_RETAINED_ARCHIVES = 30;

  constructor() {
    this.logDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.latestLogPath = path.join(this.logDir, 'latest.log');

    // Startup Trigger Rotation
    this.handleStartupRotation();

    // Initialize size check
    if (fs.existsSync(this.latestLogPath)) {
      const stats = fs.statSync(this.latestLogPath);
      this.currentSizeBytes = stats.size;
    }
  }

  private handleStartupRotation(): void {
    if (fs.existsSync(this.latestLogPath)) {
      const stats = fs.statSync(this.latestLogPath);
      if (stats.size > 0) {
        const timestampStr = this.formatDateForFilename(new Date());
        const archiveName = `${timestampStr}-session.log`;
        const archivePath = path.join(this.logDir, archiveName);

        try {
          fs.renameSync(this.latestLogPath, archivePath);
          this.compressFileInBackground(archivePath);
        } catch (err) {
          console.error('[AuditLogger] Startup rotation rename failed:', err);
        }
      }
    }
    // Touch fresh latest.log
    fs.writeFileSync(this.latestLogPath, '', 'utf8');
    this.currentSizeBytes = 0;
    this.cleanOldArchives();
  }

  public log(entry: AuditLogEntry): void {
    const formatted = `[${entry.timestamp}] [${entry.action}] user=${entry.username} ip=${entry.ip}${
      entry.targetServer ? ` server=${entry.targetServer}` : ''
    }${entry.filePath ? ` path="${entry.filePath}"` : ''}${entry.details ? ` details="${entry.details}"` : ''}\n`;

    this.writeQueue.push(formatted);
    this.processQueue();
  }

  private processQueue(): void {
    if (this.isWriting || this.writeQueue.length === 0) return;
    this.isWriting = true;

    const chunk = this.writeQueue.join('');
    this.writeQueue = [];

    const chunkBytes = Buffer.byteLength(chunk, 'utf8');

    fs.appendFile(this.latestLogPath, chunk, 'utf8', (err) => {
      this.isWriting = false;
      if (err) {
        console.error('[AuditLogger] Failed to write audit log:', err);
      } else {
        this.currentSizeBytes += chunkBytes;
        if (this.currentSizeBytes >= this.SIZE_THRESHOLD_BYTES) {
          this.handleSizeRotation();
        }
      }

      if (this.writeQueue.length > 0) {
        this.processQueue();
      }
    });
  }

  private handleSizeRotation(): void {
    const timestampStr = this.formatDateForFilename(new Date());
    const randomSuffix = Math.floor(Math.random() * 1000);
    const archiveName = `${timestampStr}-${randomSuffix}.log`;
    const archivePath = path.join(this.logDir, archiveName);

    try {
      if (fs.existsSync(this.latestLogPath)) {
        fs.renameSync(this.latestLogPath, archivePath);
        fs.writeFileSync(this.latestLogPath, '', 'utf8');
        this.currentSizeBytes = 0;
        this.compressFileInBackground(archivePath);
        this.cleanOldArchives();
      }
    } catch (err) {
      console.error('[AuditLogger] Size-triggered log rotation failed:', err);
    }
  }

  private compressFileInBackground(filePath: string): void {process.nextTick(() => {
      const gzPath = `${filePath}.gz`;
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(gzPath);
      const gzip = zlib.createGzip();

      readStream
        .pipe(gzip)
        .pipe(writeStream)
        .on('finish', () => {
          fs.unlink(filePath, () => {});
        })
        .on('error', (err) => {
          console.error(`[AuditLogger] Compression error for ${filePath}:`, err);
        });
    });
  }

  private cleanOldArchives(): void {
    try {
      const files = fs.readdirSync(this.logDir);
      const archives = files
        .filter((f) => f.endsWith('.log.gz') || f.endsWith('.tar.gz'))
        .map((f) => ({
          name: f,
          path: path.join(this.logDir, f),
          mtime: fs.statSync(path.join(this.logDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      if (archives.length > this.MAX_RETAINED_ARCHIVES) {
        const toDelete = archives.slice(this.MAX_RETAINED_ARCHIVES);
        for (const file of toDelete) {
          fs.unlink(file.path, () => {});
        }
      }
    } catch (err) {
      console.error('[AuditLogger] Clean old archives failed:', err);
    }
  }

  private formatDateForFilename(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  }
}
