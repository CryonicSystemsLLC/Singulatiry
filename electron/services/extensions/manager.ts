/**
 * Extension Manager — Downloads, installs, and tracks VS Code extensions from Open VSX.
 *
 * Extensions are stored in ~/.singularity/extensions/{namespace}.{name}/
 * Metadata is tracked in electron-store.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import Store from 'electron-store';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ============================================================
// Types
// ============================================================

export interface ExtensionContribution {
  commands: { command: string; title: string; icon?: string }[];
  viewsContainers: { id: string; title: string; icon?: string }[];
  themes: { label: string; uiTheme: string; path: string }[];
  languages: { id: string; extensions?: string[]; aliases?: string[] }[];
}

export interface InstalledExtension {
  id: string;              // namespace.name
  namespace: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  publisher: string;
  iconUrl?: string;
  installedAt: string;
  extensionPath: string;
  contributions?: ExtensionContribution;
}

interface ExtensionStoreSchema {
  installed: Record<string, InstalledExtension>;
  trustedPublishers: string[];
  hiddenActivityBarIcons: string[];
}

// ============================================================
// Extension Manager
// ============================================================

class ExtensionManager {
  private store: Store<ExtensionStoreSchema>;
  private extensionsDir: string;

  constructor() {
    this.store = new Store<ExtensionStoreSchema>({
      name: 'singularity-extensions',
      defaults: { installed: {}, trustedPublishers: [], hiddenActivityBarIcons: [] },
    });

    // Use app userData path for extensions
    const userDataPath = app.getPath('userData');
    this.extensionsDir = path.join(userDataPath, 'extensions');
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Backfill contributions for extensions installed before contribution parsing was added
   */
  async backfillContributions(): Promise<void> {
    const installed = this.store.get('installed', {});
    let changed = false;
    for (const [id, ext] of Object.entries(installed)) {
      if (!ext.contributions) {
        const contributions = await this.getContributions(id);
        if (contributions) {
          ext.contributions = contributions;
          changed = true;
        }
      }
    }
    if (changed) {
      this.store.set('installed', installed);
    }
  }

  /**
   * Get all installed extensions
   */
  getInstalled(): InstalledExtension[] {
    const installed = this.store.get('installed', {});
    return Object.values(installed);
  }

  /**
   * Check if a specific extension is installed
   */
  isInstalled(id: string): boolean {
    const installed = this.store.get('installed', {});
    return id in installed;
  }

  /**
   * Install an extension from Open VSX
   */
  async install(ext: {
    namespace: string;
    name: string;
    displayName: string;
    version: string;
    description: string;
    publisher: string;
    downloadUrl: string;
    iconUrl?: string;
  }): Promise<InstalledExtension> {
    const id = `${ext.namespace}.${ext.name}`;
    const extDir = path.join(this.extensionsDir, id);

    await this.ensureDir(this.extensionsDir);

    // Download the VSIX (save as .zip so Expand-Archive accepts it)
    const vsixPath = path.join(this.extensionsDir, `${id}-${ext.version}.zip`);

    // Try to get a platform-specific download (win32-x64) for extensions with native binaries
    let downloadUrl = ext.downloadUrl;
    try {
      const platformResp = await fetch(
        `https://open-vsx.org/api/${ext.namespace}/${ext.name}/win32-x64/${ext.version}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (platformResp.ok) {
        const platformData = await platformResp.json() as any;
        if (platformData.files?.download) {
          downloadUrl = platformData.files.download;
        }
      }
    } catch {
      // Platform-specific version not available, use default
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    try {
      const resp = await fetch(downloadUrl, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      if (!resp.body) throw new Error('No response body');

      // Stream to file
      const fileStream = createWriteStream(vsixPath);
      await pipeline(Readable.fromWeb(resp.body as any), fileStream);
    } finally {
      clearTimeout(timeout);
    }

    // Extract VSIX (it's a ZIP file)
    // Remove old version if exists
    if (existsSync(extDir)) {
      try {
        await fs.rm(extDir, { recursive: true, force: true });
      } catch (e: any) {
        if (e.code === 'EPERM' || e.code === 'EBUSY') {
          // Retry after a short delay (Windows file handle release)
          await new Promise(resolve => setTimeout(resolve, 1000));
          await fs.rm(extDir, { recursive: true, force: true });
        } else {
          throw e;
        }
      }
    }
    await this.ensureDir(extDir);

    // Use PowerShell to extract (available on Windows)
    try {
      await execAsync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${vsixPath}' -DestinationPath '${extDir}' -Force"`,
        { timeout: 30000, windowsHide: true }
      );
    } catch (e: any) {
      // Cleanup on failure
      await fs.rm(extDir, { recursive: true, force: true }).catch(() => {});
      await fs.unlink(vsixPath).catch(() => {});
      throw new Error(`Failed to extract extension: ${e.message}`);
    }

    // Clean up VSIX file
    await fs.unlink(vsixPath).catch(() => {});

    // Parse contributions from extracted package.json
    const contributions = await this.getContributions(id);

    // Save metadata
    const installed: InstalledExtension = {
      id,
      namespace: ext.namespace,
      name: ext.name,
      displayName: ext.displayName,
      version: ext.version,
      description: ext.description,
      publisher: ext.publisher,
      iconUrl: ext.iconUrl,
      installedAt: new Date().toISOString(),
      extensionPath: extDir,
      contributions: contributions || undefined,
    };

    const allInstalled = this.store.get('installed', {});
    allInstalled[id] = installed;
    this.store.set('installed', allInstalled);

    return installed;
  }

  /**
   * Check if a publisher is trusted
   */
  isPublisherTrusted(publisher: string): boolean {
    const trusted = this.store.get('trustedPublishers', []);
    return trusted.includes(publisher.toLowerCase());
  }

  /**
   * Trust a publisher
   */
  trustPublisher(publisher: string): void {
    const trusted = this.store.get('trustedPublishers', []);
    const normalized = publisher.toLowerCase();
    if (!trusted.includes(normalized)) {
      trusted.push(normalized);
      this.store.set('trustedPublishers', trusted);
    }
  }

  /**
   * Get all trusted publishers
   */
  getTrustedPublishers(): string[] {
    return this.store.get('trustedPublishers', []);
  }

  /**
   * Parse an extension's package.json to extract contributions
   */
  async getContributions(id: string): Promise<ExtensionContribution | null> {
    const pkgPath = path.join(this.extensionsDir, id, 'extension', 'package.json');
    try {
      const raw = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      const contribs = pkg.contributes || {};

      return {
        commands: (contribs.commands || []).map((c: any) => ({
          command: c.command,
          title: c.title,
          icon: c.icon?.dark || c.icon?.light || (typeof c.icon === 'string' ? c.icon : undefined),
        })),
        viewsContainers: [
          ...(contribs.viewsContainers?.activitybar || []),
          ...(contribs.viewsContainers?.secondarySidebar || []),
        ].map((vc: any) => ({
          id: vc.id,
          title: vc.title,
          icon: vc.icon,
        })),
        themes: (contribs.themes || []).map((t: any) => ({
          label: t.label,
          uiTheme: t.uiTheme,
          path: t.path,
        })),
        languages: (contribs.languages || []).map((l: any) => ({
          id: l.id,
          extensions: l.extensions,
          aliases: l.aliases,
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the absolute path to an extension's resource file
   */
  getResourcePath(id: string, relativePath: string): string {
    return path.join(this.extensionsDir, id, 'extension', relativePath);
  }

  /**
   * Check what webview assets an extension has and return info for loading it
   */
  async getWebviewInfo(id: string): Promise<{
    hasWebview: boolean;
    url?: string;
    type?: 'html' | 'generated';
  }> {
    const extDir = path.join(this.extensionsDir, id, 'extension');

    // Check for webview/index.html first (e.g. ChatGPT/Codex)
    const htmlPath = path.join(extDir, 'webview', 'index.html');
    if (existsSync(htmlPath)) {
      return { hasWebview: true, url: `singularity-ext://${id}/webview/index.html`, type: 'html' };
    }

    // Check for webview/index.js + index.css (e.g. Claude Code)
    const jsPath = path.join(extDir, 'webview', 'index.js');
    if (existsSync(jsPath)) {
      // Generate an HTML wrapper and write it to the extension dir
      const cssPath = path.join(extDir, 'webview', 'index.css');
      const hasCSS = existsSync(cssPath);
      const generatedHtml = this.generateWebviewHtml(id, hasCSS);
      const generatedPath = path.join(extDir, 'webview', '_singularity_webview.html');
      await fs.writeFile(generatedPath, generatedHtml, 'utf-8');
      return { hasWebview: true, url: `singularity-ext://${id}/webview/_singularity_webview.html`, type: 'generated' };
    }

    return { hasWebview: false };
  }

  /**
   * Generate an HTML wrapper for extensions that only have JS/CSS (no index.html)
   */
  private generateWebviewHtml(extId: string, hasCSS: boolean): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${extId}</title>
  ${hasCSS ? '<link rel="stylesheet" href="./index.css" />' : ''}
</head>
<body style="margin: 0; padding: 0; overflow: hidden;">
  <div id="root"></div>
  <script src="./index.js"></script>
</body>
</html>`;
  }

  /**
   * Check if an extension's activity bar icon is hidden
   */
  isActivityBarIconHidden(id: string): boolean {
    return this.store.get('hiddenActivityBarIcons', []).includes(id);
  }

  /**
   * Get all hidden activity bar icon IDs
   */
  getHiddenActivityBarIcons(): string[] {
    return this.store.get('hiddenActivityBarIcons', []);
  }

  /**
   * Toggle an extension's activity bar icon visibility
   */
  setActivityBarIconHidden(id: string, hidden: boolean): void {
    const list = this.store.get('hiddenActivityBarIcons', []);
    const idx = list.indexOf(id);
    if (hidden && idx === -1) {
      list.push(id);
    } else if (!hidden && idx >= 0) {
      list.splice(idx, 1);
    }
    this.store.set('hiddenActivityBarIcons', list);
  }

  /**
   * Check Open VSX for available updates for all installed extensions.
   * Returns list of extensions that have newer versions available.
   */
  async checkForUpdates(): Promise<{ id: string; currentVersion: string; latestVersion: string; downloadUrl: string }[]> {
    const installed = this.store.get('installed', {});
    const updates: { id: string; currentVersion: string; latestVersion: string; downloadUrl: string }[] = [];

    const checks = Object.values(installed).map(async (ext) => {
      try {
        const resp = await fetch(
          `https://open-vsx.org/api/${ext.namespace}/${ext.name}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!resp.ok) return;
        const data = await resp.json() as any;
        const latestVersion = data.version;
        if (latestVersion && latestVersion !== ext.version) {
          // Compare versions (simple semver: newer if different and greater)
          if (this.isNewerVersion(ext.version, latestVersion)) {
            const dlUrl = data.files?.download ||
              `https://open-vsx.org/api/${ext.namespace}/${ext.name}/${latestVersion}/file/${ext.namespace}.${ext.name}-${latestVersion}.vsix`;
            updates.push({
              id: ext.id,
              currentVersion: ext.version,
              latestVersion,
              downloadUrl: dlUrl,
            });
          }
        }
      } catch {
        // Skip extensions that fail to check
      }
    });

    await Promise.allSettled(checks);
    return updates;
  }

  /**
   * Update a single extension to the latest version.
   */
  async updateExtension(id: string): Promise<InstalledExtension | null> {
    const installed = this.store.get('installed', {});
    const ext = installed[id];
    if (!ext) return null;

    // Stop the extension host first — executables/native modules are locked on Windows
    try {
      const { getExtensionHostManager } = await import('./host');
      const hostMgr = getExtensionHostManager();
      if (hostMgr.isRunning(id)) {
        hostMgr.stop(id);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch {}

    // Get latest version info from Open VSX
    const resp = await fetch(
      `https://open-vsx.org/api/${ext.namespace}/${ext.name}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!resp.ok) throw new Error(`Failed to fetch extension info: ${resp.status}`);
    const data = await resp.json() as any;

    const downloadUrl = data.files?.download ||
      `https://open-vsx.org/api/${ext.namespace}/${ext.name}/${data.version}/file/${ext.namespace}.${ext.name}-${data.version}.vsix`;

    // Reuse the install method (it removes old version first)
    return this.install({
      namespace: ext.namespace,
      name: ext.name,
      displayName: ext.displayName,
      version: data.version,
      description: data.description || ext.description,
      publisher: ext.publisher,
      downloadUrl,
      iconUrl: ext.iconUrl,
    });
  }

  /**
   * Simple semver comparison: returns true if `latest` is newer than `current`
   */
  private isNewerVersion(current: string, latest: string): boolean {
    const a = current.split('.').map(Number);
    const b = latest.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (bv > av) return true;
      if (bv < av) return false;
    }
    return false;
  }

  /**
   * Uninstall an extension
   */
  async uninstall(id: string): Promise<void> {
    const allInstalled = this.store.get('installed', {});
    const ext = allInstalled[id];

    if (ext) {
      // Stop the extension host first — native .node modules are locked on Windows while running
      try {
        const { getExtensionHostManager } = await import('./host');
        const hostMgr = getExtensionHostManager();
        if (hostMgr.isRunning(id)) {
          hostMgr.stop(id);
          // Give Windows time to release file handles after process kill
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch {}

      // Remove files (retry once after a short delay if EPERM)
      if (existsSync(ext.extensionPath)) {
        try {
          await fs.rm(ext.extensionPath, { recursive: true, force: true });
        } catch (e: any) {
          if (e.code === 'EPERM' || e.code === 'EBUSY') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await fs.rm(ext.extensionPath, { recursive: true, force: true });
          } else {
            throw e;
          }
        }
      }

      // Remove from store
      delete allInstalled[id];
      this.store.set('installed', allInstalled);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance: ExtensionManager | null = null;

function getExtensionManager(): ExtensionManager {
  if (!instance) {
    instance = new ExtensionManager();
  }
  return instance;
}

// ============================================================
// IPC Handlers
// ============================================================

export const extensionIpcHandlers: Record<string, (...args: any[]) => any> = {
  'extensions:list-installed': async (): Promise<InstalledExtension[]> => {
    return getExtensionManager().getInstalled();
  },

  'extensions:is-installed': async (_event: any, id: string): Promise<boolean> => {
    return getExtensionManager().isInstalled(id);
  },

  'extensions:install': async (
    _event: any,
    ext: {
      namespace: string;
      name: string;
      displayName: string;
      version: string;
      description: string;
      publisher: string;
      downloadUrl: string;
      iconUrl?: string;
    }
  ): Promise<InstalledExtension> => {
    return getExtensionManager().install(ext);
  },

  'extensions:uninstall': async (_event: any, id: string): Promise<void> => {
    return getExtensionManager().uninstall(id);
  },

  'extensions:get-contributions': async (_event: any, id: string): Promise<ExtensionContribution | null> => {
    return getExtensionManager().getContributions(id);
  },

  'extensions:is-publisher-trusted': async (_event: any, publisher: string): Promise<boolean> => {
    return getExtensionManager().isPublisherTrusted(publisher);
  },

  'extensions:trust-publisher': async (_event: any, publisher: string): Promise<void> => {
    return getExtensionManager().trustPublisher(publisher);
  },

  'extensions:get-trusted-publishers': async (): Promise<string[]> => {
    return getExtensionManager().getTrustedPublishers();
  },

  'extensions:get-resource-path': async (_event: any, id: string, relativePath: string): Promise<string> => {
    return getExtensionManager().getResourcePath(id, relativePath);
  },

  'extensions:backfill-contributions': async (): Promise<void> => {
    return getExtensionManager().backfillContributions();
  },

  'extensions:get-hidden-icons': async (): Promise<string[]> => {
    return getExtensionManager().getHiddenActivityBarIcons();
  },

  'extensions:set-icon-hidden': async (_event: any, id: string, hidden: boolean): Promise<void> => {
    return getExtensionManager().setActivityBarIconHidden(id, hidden);
  },

  'extensions:get-webview-info': async (_event: any, id: string): Promise<{
    hasWebview: boolean;
    url?: string;
    type?: 'html' | 'generated';
  }> => {
    return getExtensionManager().getWebviewInfo(id);
  },

  'extensions:check-updates': async (): Promise<{ id: string; currentVersion: string; latestVersion: string; downloadUrl: string }[]> => {
    return getExtensionManager().checkForUpdates();
  },

  'extensions:update': async (_event: any, id: string): Promise<InstalledExtension | null> => {
    return getExtensionManager().updateExtension(id);
  },
};
