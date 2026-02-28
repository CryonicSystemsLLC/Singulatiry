/**
 * Platform detection utilities for cross-platform keyboard shortcuts and display.
 */

export const isMac = typeof navigator !== 'undefined'
  && navigator.platform.toUpperCase().includes('MAC');

export const modKey = isMac ? 'Cmd' : 'Ctrl';

/**
 * Convert a shortcut string for display on the current platform.
 * On macOS: Ctrl → ⌘, Alt → ⌥, Shift → ⇧
 * On other platforms: returned as-is.
 */
export function shortcutLabel(key: string): string {
  if (!isMac) return key;
  return key
    .replace(/Ctrl\+/gi, '⌘')
    .replace(/Alt\+/gi, '⌥')
    .replace(/Shift\+/gi, '⇧');
}
