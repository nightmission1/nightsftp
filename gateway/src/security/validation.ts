import path from 'path';

export function sanitizePath(inputPath: string): string {
  if (!inputPath) return '/';
  let cleaned = inputPath.trim().replace(/\0/g, '').replace(/\\/g, '/');
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  let normalized = path.posix.normalize(cleaned);
  return normalized;
}

export function isValidAgentId(agentId: string): boolean {
  return typeof agentId === 'string' && /^[a-zA-Z0-9_-]{3,64}$/.test(agentId);
}

