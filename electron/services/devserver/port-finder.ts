/**
 * Port Finder
 *
 * Finds available ports and avoids conflicts with running services.
 */

import { createServer, Server } from 'node:net';

/**
 * Common development ports and their typical uses
 */
export const COMMON_PORTS: Record<number, string> = {
  3000: 'Next.js / React',
  3001: 'Backend API',
  4000: 'GraphQL',
  5000: 'Flask / .NET',
  5173: 'Vite',
  5432: 'PostgreSQL',
  6379: 'Redis',
  8000: 'FastAPI / Django',
  8080: 'HTTP Alt / Tomcat',
  8888: 'Jupyter',
  27017: 'MongoDB'
};

/**
 * Port range for dynamic allocation
 */
const PORT_RANGE = {
  min: 3000,
  max: 9000
};

/**
 * Check if a port is available
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find an available port starting from the preferred port
 */
export async function findAvailablePort(
  preferredPort: number,
  maxAttempts: number = 100
): Promise<number> {
  let port = preferredPort;

  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;

    // Wrap around if we exceed the range
    if (port > PORT_RANGE.max) {
      port = PORT_RANGE.min;
    }
  }

  throw new Error(`Could not find available port after ${maxAttempts} attempts`);
}

/**
 * Find multiple available ports
 */
export async function findAvailablePorts(
  count: number,
  startPort: number = 3000
): Promise<number[]> {
  const ports: number[] = [];
  let currentPort = startPort;

  while (ports.length < count && currentPort <= PORT_RANGE.max) {
    if (await isPortAvailable(currentPort)) {
      ports.push(currentPort);
    }
    currentPort++;
  }

  if (ports.length < count) {
    throw new Error(`Could only find ${ports.length} available ports out of ${count} requested`);
  }

  return ports;
}

/**
 * Get the typical port for a framework/stack
 */
export function getDefaultPort(framework: string): number {
  const portMap: Record<string, number> = {
    'next': 3000,
    'nextjs': 3000,
    'react': 5173,
    'vite': 5173,
    'vue': 5173,
    'express': 3001,
    'fastapi': 8000,
    'django': 8000,
    'flask': 5000,
    'nest': 3000,
    'postgresql': 5432,
    'postgres': 5432,
    'redis': 6379,
    'mongodb': 27017
  };

  return portMap[framework.toLowerCase()] || 3000;
}

/**
 * Get suggested ports for a full-stack project
 */
export async function getSuggestedPorts(stack: {
  frontend?: string;
  backend?: string;
  database?: string;
}): Promise<{
  frontend?: number;
  backend?: number;
  database?: number;
}> {
  const result: {
    frontend?: number;
    backend?: number;
    database?: number;
  } = {};

  if (stack.frontend) {
    const preferred = getDefaultPort(stack.frontend);
    result.frontend = await findAvailablePort(preferred);
  }

  if (stack.backend) {
    const preferred = getDefaultPort(stack.backend);
    // Make sure backend port is different from frontend
    let backendPort = preferred;
    if (result.frontend && backendPort === result.frontend) {
      backendPort = preferred + 1;
    }
    result.backend = await findAvailablePort(backendPort);
  }

  if (stack.database) {
    result.database = getDefaultPort(stack.database);
    // Don't check availability for databases - they're usually pre-configured
  }

  return result;
}

/**
 * Check which common ports are in use
 */
export async function scanCommonPorts(): Promise<Array<{
  port: number;
  description: string;
  available: boolean;
}>> {
  const results = await Promise.all(
    Object.entries(COMMON_PORTS).map(async ([port, description]) => ({
      port: parseInt(port),
      description,
      available: await isPortAvailable(parseInt(port))
    }))
  );

  return results.sort((a, b) => a.port - b.port);
}

/**
 * Reserve ports by holding them temporarily
 */
export class PortReserver {
  private servers: Map<number, Server> = new Map();

  /**
   * Reserve a port
   */
  async reserve(port: number): Promise<boolean> {
    if (this.servers.has(port)) {
      return true; // Already reserved by us
    }

    return new Promise((resolve) => {
      const server = createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        this.servers.set(port, server);
        resolve(true);
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Release a reserved port
   */
  release(port: number): void {
    const server = this.servers.get(port);
    if (server) {
      server.close();
      this.servers.delete(port);
    }
  }

  /**
   * Release all reserved ports
   */
  releaseAll(): void {
    for (const [, server] of this.servers) {
      server.close();
    }
    this.servers.clear();
  }

  /**
   * Get reserved ports
   */
  getReserved(): number[] {
    return Array.from(this.servers.keys());
  }
}

export default {
  isPortAvailable,
  findAvailablePort,
  findAvailablePorts,
  getDefaultPort,
  getSuggestedPorts,
  scanCommonPorts,
  COMMON_PORTS,
  PortReserver
};
