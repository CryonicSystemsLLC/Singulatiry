/**
 * Migration Manager
 *
 * Tracks migration state, supports rollback, and manages database lifecycle.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);

export interface Migration {
  id: string;
  name: string;
  createdAt: Date;
  appliedAt?: Date;
  status: 'pending' | 'applied' | 'failed' | 'rolled_back';
  checksum?: string;
  sqlUp?: string;
  sqlDown?: string;
}

export interface MigrationHistory {
  migrations: Migration[];
  lastApplied?: string;
  projectRoot: string;
}

export interface MigrationResult {
  success: boolean;
  migration?: Migration;
  error?: string;
  output?: string;
}

/**
 * Migration Manager Class
 */
export class MigrationManager {
  private projectRoot: string;
  private prismaDir: string;
  private migrationsDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.prismaDir = path.join(projectRoot, 'prisma');
    this.migrationsDir = path.join(this.prismaDir, 'migrations');
  }

  /**
   * Get all migrations (both applied and pending)
   */
  async getMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];

    try {
      const entries = await readdir(this.migrationsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('_')) {
          const migrationDir = path.join(this.migrationsDir, entry.name);
          const migration = await this.parseMigrationDir(entry.name, migrationDir);
          if (migration) {
            migrations.push(migration);
          }
        }
      }

      // Sort by timestamp (migration names start with timestamp)
      migrations.sort((a, b) => a.id.localeCompare(b.id));

      // Check applied status from _prisma_migrations table
      const appliedMigrations = await this.getAppliedMigrations();
      for (const migration of migrations) {
        const applied = appliedMigrations.find(m => m.name === migration.name);
        if (applied) {
          migration.status = 'applied';
          migration.appliedAt = applied.appliedAt;
          migration.checksum = applied.checksum;
        }
      }

      return migrations;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []; // No migrations directory yet
      }
      throw error;
    }
  }

  /**
   * Parse a migration directory
   */
  private async parseMigrationDir(dirName: string, dirPath: string): Promise<Migration | null> {
    try {
      // Migration name format: 20231215123456_migration_name
      const match = dirName.match(/^(\d{14})_(.+)$/);
      if (!match) return null;

      const [, timestamp, name] = match;
      const createdAt = this.parseTimestamp(timestamp);

      // Read migration.sql
      let sqlUp: string | undefined;
      try {
        sqlUp = await readFile(path.join(dirPath, 'migration.sql'), 'utf-8');
      } catch {
        // No migration.sql file
      }

      return {
        id: dirName,
        name,
        createdAt,
        status: 'pending',
        sqlUp
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse Prisma timestamp format
   */
  private parseTimestamp(ts: string): Date {
    // Format: YYYYMMDDHHMMSS
    const year = parseInt(ts.slice(0, 4));
    const month = parseInt(ts.slice(4, 6)) - 1;
    const day = parseInt(ts.slice(6, 8));
    const hour = parseInt(ts.slice(8, 10));
    const minute = parseInt(ts.slice(10, 12));
    const second = parseInt(ts.slice(12, 14));

    return new Date(year, month, day, hour, minute, second);
  }

  /**
   * Get applied migrations from database
   */
  private async getAppliedMigrations(): Promise<Array<{
    name: string;
    appliedAt: Date;
    checksum: string;
  }>> {
    try {
      // Use prisma migrate status and parse output
      // Prisma migrate status doesn't output JSON, so we need to parse text
      // For now, return empty array - in production we'd query the database directly
      await execAsync('npx prisma migrate status', {
        cwd: this.projectRoot,
        timeout: 30000
      });
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get migration status summary
   */
  async getStatus(): Promise<{
    total: number;
    applied: number;
    pending: number;
    failed: number;
    isInSync: boolean;
  }> {
    const migrations = await this.getMigrations();

    const applied = migrations.filter(m => m.status === 'applied').length;
    const pending = migrations.filter(m => m.status === 'pending').length;
    const failed = migrations.filter(m => m.status === 'failed').length;

    return {
      total: migrations.length,
      applied,
      pending,
      failed,
      isInSync: pending === 0 && failed === 0
    };
  }

  /**
   * Create a new migration
   */
  async createMigration(name: string): Promise<MigrationResult> {
    try {
      // Sanitize name
      const sanitizedName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

      const { stdout } = await execAsync(
        `npx prisma migrate dev --name ${sanitizedName} --create-only`,
        {
          cwd: this.projectRoot,
          timeout: 60000
        }
      );

      // Find the created migration
      const migrations = await this.getMigrations();
      const newMigration = migrations.find(m => m.name.includes(sanitizedName));

      return {
        success: true,
        migration: newMigration,
        output: stdout
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stderr
      };
    }
  }

  /**
   * Apply pending migrations
   */
  async applyMigrations(): Promise<MigrationResult> {
    try {
      const { stdout, stderr } = await execAsync('npx prisma migrate dev', {
        cwd: this.projectRoot,
        timeout: 120000
      });

      return {
        success: true,
        output: stdout + (stderr ? '\n' + stderr : '')
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stderr
      };
    }
  }

  /**
   * Reset database and re-apply all migrations
   */
  async resetDatabase(): Promise<MigrationResult> {
    try {
      const { stdout, stderr } = await execAsync('npx prisma migrate reset --force', {
        cwd: this.projectRoot,
        timeout: 120000
      });

      return {
        success: true,
        output: stdout + (stderr ? '\n' + stderr : '')
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stderr
      };
    }
  }

  /**
   * Mark a migration as rolled back
   * Note: Prisma doesn't support true rollbacks, this is for tracking
   */
  async markRolledBack(migrationId: string): Promise<void> {
    // In a real implementation, you'd update the _prisma_migrations table
    // For now, we just track this locally
    const historyFile = path.join(this.prismaDir, '.migration_history.json');

    let history: any = { rolledBack: [] };
    try {
      const content = await readFile(historyFile, 'utf-8');
      history = JSON.parse(content);
    } catch {
      // File doesn't exist
    }

    if (!history.rolledBack.includes(migrationId)) {
      history.rolledBack.push(migrationId);
    }

    await writeFile(historyFile, JSON.stringify(history, null, 2));
  }

  /**
   * Generate a rollback script for a migration
   */
  async generateRollbackScript(migrationId: string): Promise<string | null> {
    const migrations = await this.getMigrations();
    const migration = migrations.find(m => m.id === migrationId);

    if (!migration || !migration.sqlUp) {
      return null;
    }

    // Attempt to generate inverse operations
    // This is a simplified version - proper rollback requires understanding the SQL
    const lines: string[] = [
      `-- Rollback script for migration: ${migration.name}`,
      '-- WARNING: This is auto-generated and may require manual review',
      '',
      '-- Original migration SQL:',
      ...migration.sqlUp.split('\n').map(l => `-- ${l}`),
      '',
      '-- Suggested rollback operations:'
    ];

    // Parse CREATE TABLE statements and generate DROP TABLE
    const createTableMatch = migration.sqlUp.match(/CREATE TABLE "?(\w+)"?/gi);
    if (createTableMatch) {
      for (const match of createTableMatch) {
        const tableName = match.match(/CREATE TABLE "?(\w+)"?/i)?.[1];
        if (tableName) {
          lines.push(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
        }
      }
    }

    // Parse ALTER TABLE ADD COLUMN and generate DROP COLUMN
    const addColumnMatch = migration.sqlUp.match(/ALTER TABLE "?(\w+)"? ADD COLUMN "?(\w+)"?/gi);
    if (addColumnMatch) {
      for (const match of addColumnMatch) {
        const parts = match.match(/ALTER TABLE "?(\w+)"? ADD COLUMN "?(\w+)"?/i);
        if (parts) {
          lines.push(`ALTER TABLE "${parts[1]}" DROP COLUMN IF EXISTS "${parts[2]}";`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Verify schema is in sync with database
   */
  async verifySync(): Promise<{
    inSync: boolean;
    drift?: string;
  }> {
    try {
      const { stdout } = await execAsync('npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script', {
        cwd: this.projectRoot,
        timeout: 30000
      });

      const isEmpty = !stdout.trim() || stdout.includes('-- There is no difference');

      return {
        inSync: isEmpty,
        drift: isEmpty ? undefined : stdout
      };
    } catch (error: any) {
      // If the command fails, assume not in sync
      return {
        inSync: false,
        drift: error.message
      };
    }
  }

  /**
   * Get the database URL from environment
   */
  async getDatabaseUrl(): Promise<string | null> {
    try {
      const envPath = path.join(this.projectRoot, '.env');
      const envContent = await readFile(envPath, 'utf-8');

      const match = envContent.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
      return match ? match[1] : null;
    } catch {
      return process.env.DATABASE_URL || null;
    }
  }

  /**
   * Parse database URL
   */
  parseDatabaseUrl(url: string): {
    provider: string;
    host: string;
    port: number;
    database: string;
    user?: string;
  } | null {
    try {
      // postgresql://user:pass@host:port/database
      const parsed = new URL(url);

      return {
        provider: parsed.protocol.replace(':', ''),
        host: parsed.hostname,
        port: parseInt(parsed.port) || 5432,
        database: parsed.pathname.slice(1),
        user: parsed.username || undefined
      };
    } catch {
      return null;
    }
  }
}

/**
 * Create a migration manager instance
 */
export function createMigrationManager(projectRoot: string): MigrationManager {
  return new MigrationManager(projectRoot);
}

export default MigrationManager;
