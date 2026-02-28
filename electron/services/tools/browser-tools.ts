/**
 * Browser Tools - URL opening and screenshot capabilities for the agent
 */

import { shell, BrowserWindow } from 'electron';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Tool, ToolResult, defineTool } from './registry';

/**
 * Open a URL in the default browser
 */
export const openUrl = defineTool<{
  url: string;
}>(
  'open_url',
  'Open a URL in the user\'s default web browser. Supports http, https, and file protocols.',
  {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to open (e.g., "https://example.com" or "http://localhost:3000")'
      }
    },
    required: ['url']
  },
  async (params, _context): Promise<ToolResult> => {
    try {
      // Validate URL format
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(params.url);
      } catch {
        return {
          success: false,
          error: {
            message: `Invalid URL format: "${params.url}". Must be a valid URL with protocol (e.g., https://example.com).`,
            code: 'INVALID_URL',
            recoverable: false
          }
        };
      }

      // Only allow safe protocols
      const allowedProtocols = ['http:', 'https:', 'file:'];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        return {
          success: false,
          error: {
            message: `Protocol "${parsedUrl.protocol}" is not allowed. Supported protocols: ${allowedProtocols.join(', ')}`,
            code: 'BLOCKED_PROTOCOL',
            recoverable: false
          }
        };
      }

      await shell.openExternal(params.url);

      return {
        success: true,
        data: {
          url: params.url,
          protocol: parsedUrl.protocol,
          host: parsedUrl.host,
          message: `Opened ${params.url} in default browser`
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Failed to open URL: ${error.message}`,
          code: 'OPEN_URL_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * Take a screenshot of the app window
 */
export const screenshot = defineTool<{
  savePath?: string;
  format?: string;
  quality?: number;
}>(
  'screenshot',
  'Capture a screenshot of the current application window. Returns the image as a base64 string and optionally saves to disk.',
  {
    type: 'object',
    properties: {
      savePath: {
        type: 'string',
        description: 'File path to save the screenshot (relative to project root). If omitted, returns base64 data only.'
      },
      format: {
        type: 'string',
        description: 'Image format: "png" (default) or "jpeg"',
        default: 'png',
        enum: ['png', 'jpeg']
      },
      quality: {
        type: 'number',
        description: 'JPEG quality (0-100, default: 90). Only applies when format is "jpeg".',
        default: 90
      }
    }
  },
  async (params, context): Promise<ToolResult> => {
    try {
      // Get the focused window or the first available window
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

      if (!win) {
        return {
          success: false,
          error: {
            message: 'No application window found to capture',
            code: 'NO_WINDOW',
            recoverable: false
          }
        };
      }

      // Capture the page
      const image = await win.capturePage();

      if (image.isEmpty()) {
        return {
          success: false,
          error: {
            message: 'Captured image is empty. The window may be minimized or hidden.',
            code: 'EMPTY_CAPTURE',
            recoverable: true
          }
        };
      }

      const format = params.format || 'png';
      const quality = params.quality ?? 90;

      // Convert to the requested format
      let buffer: Buffer;
      let mimeType: string;

      if (format === 'jpeg') {
        buffer = image.toJPEG(quality);
        mimeType = 'image/jpeg';
      } else {
        buffer = image.toPNG();
        mimeType = 'image/png';
      }

      const base64 = buffer.toString('base64');
      const size = image.getSize();

      const result: any = {
        format,
        mimeType,
        width: size.width,
        height: size.height,
        sizeBytes: buffer.length,
        base64
      };

      // Save to disk if path is provided
      if (params.savePath) {
        const fullPath = path.isAbsolute(params.savePath)
          ? params.savePath
          : path.join(context.projectRoot, params.savePath);

        // Ensure the parent directory exists
        await mkdir(path.dirname(fullPath), { recursive: true });

        await writeFile(fullPath, buffer);
        result.savedTo = fullPath;
        result.message = `Screenshot saved to ${fullPath}`;
      } else {
        result.message = 'Screenshot captured (base64 data included)';
      }

      return {
        success: true,
        data: result
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          message: `Screenshot failed: ${error.message}`,
          code: 'SCREENSHOT_ERROR',
          recoverable: true
        }
      };
    }
  }
);

/**
 * All browser tools
 */
export const BROWSER_TOOLS: Tool[] = [
  openUrl,
  screenshot
];

/**
 * Register all browser tools with a registry
 */
export function registerBrowserTools(registry: import('./registry').ToolRegistry): void {
  for (const tool of BROWSER_TOOLS) {
    registry.register(tool);
  }
}

export default BROWSER_TOOLS;
