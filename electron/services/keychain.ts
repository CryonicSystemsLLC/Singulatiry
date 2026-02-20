/**
 * Secure Key Storage - Encrypted API key management using Electron's safeStorage
 *
 * Uses OS-level encryption (macOS Keychain, Windows DPAPI, Linux libsecret)
 * with fallback to electron-store encryption for unsupported platforms.
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';

export interface StoredKey {
  provider: string;
  encryptedKey: string;
  createdAt: string;
  lastUsed?: string;
}

export interface KeyMetadata {
  provider: string;
  createdAt: string;
  lastUsed?: string;
  hasKey: boolean;
}

/**
 * Secure storage for API keys using Electron's safeStorage API
 * with fallback to encrypted electron-store
 */
class SecureKeyStorage {
  private store: Store;
  private encryptionAvailable: boolean;

  constructor() {
    this.store = new Store({
      name: 'singularity-secure-keys',
      // electron-store's built-in encryption as fallback
      encryptionKey: 'singularity-fallback-encryption-v1'
    });

    // Check if OS-level encryption is available
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();

    if (!this.encryptionAvailable) {
      console.warn(
        'OS-level encryption not available. Using electron-store encryption as fallback.'
      );
    }
  }

  /**
   * Check if secure storage encryption is available
   */
  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable;
  }

  /**
   * Store an API key securely
   */
  async setKey(provider: string, apiKey: string): Promise<void> {
    const normalizedProvider = provider.toLowerCase().trim();

    let encryptedKey: string;

    if (this.encryptionAvailable) {
      // Use OS-level encryption
      const encrypted = safeStorage.encryptString(apiKey);
      encryptedKey = encrypted.toString('base64');
    } else {
      // Fallback: store with electron-store's encryption
      // Add a marker to distinguish fallback encryption
      encryptedKey = `fallback:${Buffer.from(apiKey).toString('base64')}`;
    }

    const storedKey: StoredKey = {
      provider: normalizedProvider,
      encryptedKey,
      createdAt: new Date().toISOString()
    };

    const keys = this.getStoredKeys();
    keys[normalizedProvider] = storedKey;
    this.store.set('keys', keys);
  }

  /**
   * Retrieve an API key
   */
  async getKey(provider: string): Promise<string | null> {
    const normalizedProvider = provider.toLowerCase().trim();
    const keys = this.getStoredKeys();
    const storedKey = keys[normalizedProvider];

    if (!storedKey) {
      return null;
    }

    try {
      let apiKey: string;

      if (storedKey.encryptedKey.startsWith('fallback:')) {
        // Fallback decryption
        const base64 = storedKey.encryptedKey.slice('fallback:'.length);
        apiKey = Buffer.from(base64, 'base64').toString('utf-8');
      } else if (this.encryptionAvailable) {
        // OS-level decryption
        const buffer = Buffer.from(storedKey.encryptedKey, 'base64');
        apiKey = safeStorage.decryptString(buffer);
      } else {
        // Encryption was available when stored but not now - can't decrypt
        console.error(
          `Cannot decrypt key for ${provider}: OS encryption state changed`
        );
        return null;
      }

      // Update last used timestamp
      storedKey.lastUsed = new Date().toISOString();
      keys[normalizedProvider] = storedKey;
      this.store.set('keys', keys);

      return apiKey;
    } catch (error) {
      console.error(`Failed to decrypt key for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Delete an API key
   */
  async deleteKey(provider: string): Promise<boolean> {
    const normalizedProvider = provider.toLowerCase().trim();
    const keys = this.getStoredKeys();

    if (!keys[normalizedProvider]) {
      return false;
    }

    delete keys[normalizedProvider];
    this.store.set('keys', keys);
    return true;
  }

  /**
   * Check if a key exists for a provider
   */
  async hasKey(provider: string): Promise<boolean> {
    const normalizedProvider = provider.toLowerCase().trim();
    const keys = this.getStoredKeys();
    return normalizedProvider in keys;
  }

  /**
   * List all providers with stored keys
   */
  async listProviders(): Promise<string[]> {
    const keys = this.getStoredKeys();
    return Object.keys(keys);
  }

  /**
   * Get metadata for all stored keys (without exposing the keys themselves)
   */
  async getKeyMetadata(): Promise<KeyMetadata[]> {
    const keys = this.getStoredKeys();

    return Object.values(keys).map(storedKey => ({
      provider: storedKey.provider,
      createdAt: storedKey.createdAt,
      lastUsed: storedKey.lastUsed,
      hasKey: true
    }));
  }

  /**
   * Validate that a key can be decrypted (useful after OS changes)
   */
  async validateKey(provider: string): Promise<boolean> {
    try {
      const key = await this.getKey(provider);
      return key !== null && key.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clear all stored keys
   */
  async clearAll(): Promise<void> {
    this.store.set('keys', {});
  }

  /**
   * Export key providers (for backup purposes, does not export actual keys)
   */
  async exportProviders(): Promise<string[]> {
    return this.listProviders();
  }

  /**
   * Get the raw stored keys object
   */
  private getStoredKeys(): Record<string, StoredKey> {
    return (this.store.get('keys') as Record<string, StoredKey>) || {};
  }
}

// Singleton instance
let keyStorageInstance: SecureKeyStorage | null = null;

/**
 * Get the secure key storage instance
 */
export function getKeyStorage(): SecureKeyStorage {
  if (!keyStorageInstance) {
    keyStorageInstance = new SecureKeyStorage();
  }
  return keyStorageInstance;
}

/**
 * IPC handlers for key management
 * These should be registered in the main process
 */
export const keyStorageIpcHandlers = {
  'keys:set': async (_event: any, provider: string, apiKey: string): Promise<void> => {
    const storage = getKeyStorage();
    await storage.setKey(provider, apiKey);
  },

  'keys:get': async (_event: any, provider: string): Promise<string | null> => {
    const storage = getKeyStorage();
    return storage.getKey(provider);
  },

  'keys:delete': async (_event: any, provider: string): Promise<boolean> => {
    const storage = getKeyStorage();
    return storage.deleteKey(provider);
  },

  'keys:has': async (_event: any, provider: string): Promise<boolean> => {
    const storage = getKeyStorage();
    return storage.hasKey(provider);
  },

  'keys:list': async (): Promise<string[]> => {
    const storage = getKeyStorage();
    return storage.listProviders();
  },

  'keys:metadata': async (): Promise<KeyMetadata[]> => {
    const storage = getKeyStorage();
    return storage.getKeyMetadata();
  },

  'keys:validate': async (_event: any, provider: string): Promise<boolean> => {
    const storage = getKeyStorage();
    return storage.validateKey(provider);
  },

  'keys:clear-all': async (): Promise<void> => {
    const storage = getKeyStorage();
    await storage.clearAll();
  },

  'keys:encryption-available': (): boolean => {
    const storage = getKeyStorage();
    return storage.isEncryptionAvailable();
  }
};

export default SecureKeyStorage;
