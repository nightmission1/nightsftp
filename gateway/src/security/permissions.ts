import { GatewayDatabase, PermissionRow } from '../db/database.js';

export type AccessRight = 'READ' | 'WRITE' | 'DELETE' | 'EXECUTE';

export interface GrantRule {
  path: string;
  rights: Set<AccessRight>;
}

export class PermissionManager {
  private db: GatewayDatabase;
  // username -> serverId -> array of GrantRules
  private userPermissionsCache: Map<string, Map<string, GrantRule[]>> = new Map();

  constructor(db: GatewayDatabase) {
    this.db = db;
    this.reloadCache();
  }

  public reloadCache(): void {
    this.userPermissionsCache.clear();
    const rows = this.db.getAllPermissions();

    for (const row of rows) {
      this.cacheRow(row);
    }
  }

  public reloadUserCache(username: string): void {
    this.userPermissionsCache.delete(username);
    const rows = this.db.getUserPermissions(username);
    for (const row of rows) {
      this.cacheRow(row);
    }
  }

  private cacheRow(row: PermissionRow): void {
    let userMap = this.userPermissionsCache.get(row.username);
    if (!userMap) {
      userMap = new Map();
      this.userPermissionsCache.set(row.username, userMap);
    }

    let rules = userMap.get(row.server_id);
    if (!rules) {
      rules = [];
      userMap.set(row.server_id, rules);
    }

    const rightsSet = new Set<AccessRight>();
    const tokens = row.permissions.split(',').map((t) => t.trim().toUpperCase());

    if (tokens.includes('ALL')) {
      rightsSet.add('READ');
      rightsSet.add('WRITE');
      rightsSet.add('DELETE');
      rightsSet.add('EXECUTE');
    } else {
      for (const t of tokens) {
        if (t === 'READ' || t === 'WRITE' || t === 'DELETE' || t === 'EXECUTE') {
          rightsSet.add(t);
        }
      }
    }

    rules.push({
      path: row.path,
      rights: rightsSet,
    });

    // Sort rules by path length descending so longer/more specific path rules take precedence
    rules.sort((a, b) => b.path.length - a.path.length);
  }

  public getAuthorizedServerIds(username: string): string[] {
    const userMap = this.userPermissionsCache.get(username);
    if (!userMap) return [];
    return Array.from(userMap.keys());
  }

  public isServerAuthorized(username: string, serverId: string): boolean {
    let userMap = this.userPermissionsCache.get(username);
    if (!userMap) {
      this.reloadUserCache(username);
      userMap = this.userPermissionsCache.get(username);
    }
    if (!userMap) return false;
    const rules = userMap.get(serverId);
    return !!rules && rules.length > 0;
  }

  public checkPermission(username: string, serverId: string, itemPath: string, requiredRight: AccessRight): boolean {
    let userMap = this.userPermissionsCache.get(username);
    if (!userMap) {
      this.reloadUserCache(username);
      userMap = this.userPermissionsCache.get(username);
    }
    if (!userMap) return false;

    const rules = userMap.get(serverId);
    if (!rules || rules.length === 0) return false;

    let targetPath = itemPath.trim();
    if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;
    if (targetPath.length > 1 && targetPath.endsWith('/')) targetPath = targetPath.slice(0, -1);

    // Find the longest matching path rule that prefixes targetPath
    for (const rule of rules) {
      if (rule.path === '/' || targetPath === rule.path || targetPath.startsWith(rule.path + '/')) {
        return rule.rights.has(requiredRight);
      }
    }

    return false;
  }
}
