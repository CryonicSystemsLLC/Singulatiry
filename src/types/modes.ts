/**
 * Mode Configuration Types
 *
 * Defines the structure for Kid mode and Pro mode settings.
 */

export interface ModeConfig {
  id: 'pro' | 'kid';
  name: string;
  description: string;
  allowedStacks: string[] | '*';
  maxTasks: number;
  defaultModel: string;
  features: ModeFeatures;
  restrictions: ModeRestrictions;
}

export interface ModeFeatures {
  codeEditor: boolean;
  terminal: boolean;
  fileExplorer: boolean;
  aiChat: boolean;
  recipes: boolean;
  presets: boolean;
  visualBuilder: boolean;
  storyboard: boolean;
}

export interface ModeRestrictions {
  networkAccess: 'full' | 'localhost-only' | 'none';
  commandAllowlist: string[] | '*';
  commandBlocklist: string[];
  maxExecutionTime: number; // ms
  maxMemory: number; // bytes
  maxFileSize: number; // bytes
  allowedPaths: 'project-only' | 'workspace' | '*';
  requireApproval: {
    fileDelete: boolean;
    databaseReset: boolean;
    networkRequests: boolean;
    systemCommands: boolean;
  };
}

export const PRO_MODE: ModeConfig = {
  id: 'pro',
  name: 'Pro Mode',
  description: 'Full access to all features for experienced developers',
  allowedStacks: '*',
  maxTasks: 100,
  defaultModel: 'gpt-4o',
  features: {
    codeEditor: true,
    terminal: true,
    fileExplorer: true,
    aiChat: true,
    recipes: true,
    presets: false,
    visualBuilder: false,
    storyboard: false
  },
  restrictions: {
    networkAccess: 'full',
    commandAllowlist: '*',
    commandBlocklist: [
      'rm -rf /',
      'format',
      'del /s /q',
      'shutdown',
      'reboot'
    ],
    maxExecutionTime: 300000, // 5 minutes
    maxMemory: 2147483648, // 2GB
    maxFileSize: 104857600, // 100MB
    allowedPaths: '*',
    requireApproval: {
      fileDelete: false,
      databaseReset: true,
      networkRequests: false,
      systemCommands: false
    }
  }
};

export const KID_MODE: ModeConfig = {
  id: 'kid',
  name: 'Kid Mode',
  description: 'Simplified interface with guided project creation',
  allowedStacks: ['nextjs-prisma'],
  maxTasks: 20,
  defaultModel: 'gpt-3.5-turbo',
  features: {
    codeEditor: false,
    terminal: false,
    fileExplorer: false,
    aiChat: true,
    recipes: false,
    presets: true,
    visualBuilder: true,
    storyboard: true
  },
  restrictions: {
    networkAccess: 'localhost-only',
    commandAllowlist: [
      'npm run dev',
      'npm run build',
      'npm install',
      'npx prisma generate',
      'npx prisma migrate dev'
    ],
    commandBlocklist: [
      'rm',
      'del',
      'rmdir',
      'format',
      'shutdown',
      'reboot',
      'curl',
      'wget',
      'ssh',
      'git push',
      'git remote'
    ],
    maxExecutionTime: 30000, // 30 seconds
    maxMemory: 536870912, // 512MB
    maxFileSize: 10485760, // 10MB
    allowedPaths: 'project-only',
    requireApproval: {
      fileDelete: true,
      databaseReset: true,
      networkRequests: true,
      systemCommands: true
    }
  }
};

export type Mode = typeof PRO_MODE | typeof KID_MODE;

export function getModeConfig(modeId: 'pro' | 'kid'): ModeConfig {
  return modeId === 'pro' ? PRO_MODE : KID_MODE;
}

export function isAllowedCommand(command: string, mode: ModeConfig): boolean {
  // Check blocklist first
  for (const blocked of mode.restrictions.commandBlocklist) {
    if (command.toLowerCase().includes(blocked.toLowerCase())) {
      return false;
    }
  }

  // Check allowlist
  if (mode.restrictions.commandAllowlist === '*') {
    return true;
  }

  return mode.restrictions.commandAllowlist.some(
    allowed => command.toLowerCase().startsWith(allowed.toLowerCase())
  );
}

export function isAllowedPath(filePath: string, projectRoot: string, mode: ModeConfig): boolean {
  if (mode.restrictions.allowedPaths === '*') {
    return true;
  }

  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = projectRoot.replace(/\\/g, '/').toLowerCase();

  if (mode.restrictions.allowedPaths === 'project-only') {
    return normalizedPath.startsWith(normalizedRoot);
  }

  // workspace - would check against workspace folders
  return true;
}

export default { PRO_MODE, KID_MODE, getModeConfig, isAllowedCommand, isAllowedPath };
