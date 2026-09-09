export function sanitizePath(inputPath: string): string {
  if (!inputPath) return '.';
  let cleaned = inputPath.trim().replace(/\0/g, '');
  if (cleaned.startsWith('/') || cleaned.startsWith('\\')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned || '.';
}

export function isValidAgentId(agentId: string): boolean {
  return typeof agentId === 'string' && /^[a-zA-Z0-9_-]{3,64}$/.test(agentId);
}
