import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface AgentRow {
  server_id: string;
  secret_key: string;
  created_at: string;
}

export interface PermissionRow {
  id: number;
  username: string;
  server_id: string;
  path: string;
  permissions: string;
  created_at: string;
}

export class GatewayDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const targetDbPath = dbPath || path.join(dataDir, 'gateway.db');
    this.db = new Database(targetDbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agents (
        server_id TEXT PRIMARY KEY,
        secret_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        server_id TEXT NOT NULL,
        path TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(username, server_id, path)
      );
    `);
  }

  // --- Users ---
  public addUser(username: string, passwordPlain: string): boolean {
    const cleanUser = username.trim();
    if (!cleanUser || !passwordPlain) return false;
    const saltRounds = 10;
    const hash = bcrypt.hashSync(passwordPlain, saltRounds);

    try {
      const stmt = this.db.prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)`);
      stmt.run(cleanUser, hash);
      return true;
    } catch (err) {
      return false;
    }
  }

  public updateUserPassword(username: string, newPasswordPlain: string): boolean {
    const cleanUser = username.trim();
    if (!cleanUser || !newPasswordPlain) return false;
    const saltRounds = 10;
    const hash = bcrypt.hashSync(newPasswordPlain, saltRounds);

    const stmt = this.db.prepare(`UPDATE users SET password_hash = ? WHERE username = ?`);
    const res = stmt.run(hash, cleanUser);
    return res.changes > 0;
  }

  public deleteUser(username: string): boolean {
    const stmtUser = this.db.prepare(`DELETE FROM users WHERE username = ?`);
    const stmtPerms = this.db.prepare(`DELETE FROM permissions WHERE username = ?`);
    const res = stmtUser.run(username);
    stmtPerms.run(username);
    return res.changes > 0;
  }

  public validateUserPassword(username: string, passwordPlain?: string): boolean {
    const stmt = this.db.prepare(`SELECT * FROM users WHERE username = ?`);
    const user = stmt.get(username) as UserRow | undefined;
    if (!user) return false;

    if (!passwordPlain) return false;
    return bcrypt.compareSync(passwordPlain, user.password_hash);
  }

  public getUsers(): UserRow[] {
    const stmt = this.db.prepare(`SELECT * FROM users ORDER BY username ASC`);
    return stmt.all() as UserRow[];
  }

  // --- Agents ---
  public addAgent(serverId: string, secretKey: string): boolean {
    const cleanId = serverId.trim();
    const cleanKey = secretKey.trim();
    if (!cleanId || !cleanKey) return false;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO agents (server_id, secret_key) VALUES (?, ?)
        ON CONFLICT(server_id) DO UPDATE SET secret_key = excluded.secret_key
      `);
      stmt.run(cleanId, cleanKey);
      return true;
    } catch {
      return false;
    }
  }

  public updateAgentSecret(serverId: string, newSecretKey: string): boolean {
    const cleanId = serverId.trim();
    const cleanKey = newSecretKey.trim();
    if (!cleanId || !cleanKey) return false;

    const stmt = this.db.prepare(`UPDATE agents SET secret_key = ? WHERE server_id = ?`);
    const res = stmt.run(cleanKey, cleanId);
    return res.changes > 0;
  }

  public deleteAgent(serverId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM agents WHERE server_id = ?`);
    const res = stmt.run(serverId);
    const stmtPerms = this.db.prepare(`DELETE FROM permissions WHERE server_id = ?`);
    stmtPerms.run(serverId);
    return res.changes > 0;
  }

  public validateAgentSecret(serverId: string, secretKey: string): boolean {
    const stmt = this.db.prepare(`SELECT secret_key FROM agents WHERE server_id = ?`);
    const row = stmt.get(serverId) as { secret_key: string } | undefined;
    if (!row) return false;

    const expectedBuf = Buffer.from(row.secret_key);
    const actualBuf = Buffer.from(secretKey);

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }

  public getAgents(): AgentRow[] {
    const stmt = this.db.prepare(`SELECT * FROM agents ORDER BY server_id ASC`);
    return stmt.all() as AgentRow[];
  }

  // --- Permissions ---
  public grantPermission(username: string, serverId: string, itemPath: string, permissions: string): boolean {
    const cleanUser = username.trim();
    const cleanServer = serverId.trim();
    let normPath = itemPath.trim();
    if (!normPath.startsWith('/')) normPath = '/' + normPath;
    if (normPath.length > 1 && normPath.endsWith('/')) normPath = normPath.slice(0, -1);

    const cleanPerms = permissions.trim().toUpperCase();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO permissions (username, server_id, path, permissions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, server_id, path) DO UPDATE SET permissions = excluded.permissions
      `);
      stmt.run(cleanUser, cleanServer, normPath, cleanPerms);
      return true;
    } catch {
      return false;
    }
  }

  public revokePermission(username: string, serverId: string, itemPath: string): boolean {
    const cleanUser = username.trim();
    const cleanServer = serverId.trim();
    let normPath = itemPath.trim();
    if (!normPath.startsWith('/')) normPath = '/' + normPath;
    if (normPath.length > 1 && normPath.endsWith('/')) normPath = normPath.slice(0, -1);

    const stmt = this.db.prepare(`DELETE FROM permissions WHERE username = ? AND server_id = ? AND path = ?`);
    const res = stmt.run(cleanUser, cleanServer, normPath);
    return res.changes > 0;
  }

  public getUserPermissions(username: string): PermissionRow[] {
    const stmt = this.db.prepare(`SELECT * FROM permissions WHERE username = ?`);
    return stmt.all(username) as PermissionRow[];
  }

  public getAllPermissions(): PermissionRow[] {
    const stmt = this.db.prepare(`SELECT * FROM permissions ORDER BY username, server_id, path`);
    return stmt.all() as PermissionRow[];
  }

  public close(): void {
    this.db.close();
  }
}
