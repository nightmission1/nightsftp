import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export interface GatewayConfig {
  sftp: {
    port: number;
    host: string;
  };
  tunnel: {
    port: number;
    host: string;
  };
}

export const DEFAULT_CONFIG_YAML = `sftp:
  port: 2222
  host: 0.0.0.0

tunnel:
  port: 8080
  host: 0.0.0.0
`;

export function loadOrGenerateConfig(configPath?: string): GatewayConfig {
  const targetPath = configPath || path.resolve(process.cwd(), 'config.yml');

  if (!fs.existsSync(targetPath)) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] [Config] Configuration file not found. Generating default config at "${targetPath}"...`);
    try {
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, DEFAULT_CONFIG_YAML, 'utf8');
      console.log(`[${new Date().toISOString()}] [INFO] [Config] Default configuration created successfully.`);
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] [ERROR] [Config] Failed to generate configuration file: ${err.message}`);
    }
  }

  if (fs.existsSync(targetPath)) {
    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      const parsed = YAML.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as GatewayConfig;
      }
    } catch (err: any) {
      console.error(`[Gateway] Error parsing config.yml, falling back to defaults:`, err.message);
    }
  }

  return YAML.parse(DEFAULT_CONFIG_YAML) as GatewayConfig;
}
