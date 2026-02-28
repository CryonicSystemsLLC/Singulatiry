import { defineConfig, Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

/**
 * Vite plugin that copies extension host .cjs files to dist-electron/.
 * These files are spawned as child processes (fork()) and cannot be bundled
 * into main.js. They must exist as standalone files on disk, especially
 * in packaged builds where the source electron/ directory is not included.
 */
function copyExtensionHostFiles(): Plugin {
  const filesToCopy = [
    'electron/services/extensions/extension-host.cjs',
    'electron/services/extensions/vscode-shim.cjs',
  ];
  const destDir = path.join(__dirname, 'dist-electron');

  function doCopy() {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of filesToCopy) {
      const src = path.join(__dirname, file);
      const dest = path.join(destDir, path.basename(file));
      fs.copyFileSync(src, dest);
    }
  }

  return {
    name: 'copy-extension-host-files',
    // Copy after the main electron build writes dist-electron/
    writeBundle() {
      doCopy();
    },
    // Also copy during dev server startup
    buildStart() {
      doCopy();
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['ssh2'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
    copyExtensionHostFiles(),
  ],
})
