/**
 * Rate Limiter
 *
 * Per-provider request throttling to prevent quota exhaustion.
 */

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
  tokensPerHour?: number;
  burstLimit?: number;
  burstWindow?: number; // ms
}

interface RequestRecord {
  timestamp: number;
  tokens?: number;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  'openai': {
    requestsPerMinute: 60,
    requestsPerHour: 3500,
    tokensPerMinute: 90000,
    burstLimit: 10,
    burstWindow: 1000
  },
  'anthropic': {
    requestsPerMinute: 50,
    requestsPerHour: 1000,
    tokensPerMinute: 100000,
    burstLimit: 5,
    burstWindow: 1000
  },
  'gemini': {
    requestsPerMinute: 60,
    requestsPerHour: 1500,
    tokensPerMinute: 100000,
    burstLimit: 10,
    burstWindow: 1000
  },
  'xai': {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    burstLimit: 10,
    burstWindow: 1000
  },
  'deepseek': {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    burstLimit: 10,
    burstWindow: 1000
  },
  'kimi': {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    burstLimit: 5,
    burstWindow: 1000
  },
  'qwen': {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    burstLimit: 10,
    burstWindow: 1000
  }
};

export class RateLimiter {
  private requests: Map<string, RequestRecord[]> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();
  private waitingQueue: Map<string, Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    tokens?: number;
  }>> = new Map();

  constructor() {
    // Load default configs
    for (const [provider, config] of Object.entries(DEFAULT_CONFIGS)) {
      this.configs.set(provider, config);
    }

    // Cleanup old records periodically
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Set custom rate limit config for a provider
   */
  setConfig(provider: string, config: Partial<RateLimitConfig>): void {
    const existing = this.configs.get(provider) || DEFAULT_CONFIGS['openai'];
    this.configs.set(provider, { ...existing, ...config });
  }

  /**
   * Get current rate limit config for a provider
   */
  getConfig(provider: string): RateLimitConfig {
    return this.configs.get(provider) || DEFAULT_CONFIGS['openai'];
  }

  /**
   * Check if a request can be made
   */
  canMakeRequest(provider: string, tokens?: number): { allowed: boolean; waitTime?: number; reason?: string } {
    const config = this.getConfig(provider);
    const records = this.requests.get(provider) || [];
    const now = Date.now();

    // Check burst limit
    if (config.burstLimit && config.burstWindow) {
      const burstStart = now - config.burstWindow;
      const burstCount = records.filter(r => r.timestamp > burstStart).length;
      if (burstCount >= config.burstLimit) {
        const oldestBurst = records.find(r => r.timestamp > burstStart);
        const waitTime = oldestBurst ? (oldestBurst.timestamp + config.burstWindow - now) : config.burstWindow;
        return { allowed: false, waitTime, reason: 'Burst limit exceeded' };
      }
    }

    // Check requests per minute
    const minuteStart = now - 60000;
    const minuteCount = records.filter(r => r.timestamp > minuteStart).length;
    if (minuteCount >= config.requestsPerMinute) {
      const oldestMinute = records.find(r => r.timestamp > minuteStart);
      const waitTime = oldestMinute ? (oldestMinute.timestamp + 60000 - now) : 60000;
      return { allowed: false, waitTime, reason: 'Rate limit exceeded (requests/minute)' };
    }

    // Check requests per hour
    if (config.requestsPerHour) {
      const hourStart = now - 3600000;
      const hourCount = records.filter(r => r.timestamp > hourStart).length;
      if (hourCount >= config.requestsPerHour) {
        const oldestHour = records.find(r => r.timestamp > hourStart);
        const waitTime = oldestHour ? (oldestHour.timestamp + 3600000 - now) : 3600000;
        return { allowed: false, waitTime, reason: 'Rate limit exceeded (requests/hour)' };
      }
    }

    // Check tokens per minute
    if (config.tokensPerMinute && tokens) {
      const minuteTokens = records
        .filter(r => r.timestamp > minuteStart)
        .reduce((sum, r) => sum + (r.tokens || 0), 0);
      if (minuteTokens + tokens > config.tokensPerMinute) {
        return { allowed: false, waitTime: 60000, reason: 'Token limit exceeded (tokens/minute)' };
      }
    }

    return { allowed: true };
  }

  /**
   * Acquire permission to make a request (waits if necessary)
   */
  async acquire(provider: string, tokens?: number, timeoutMs = 30000): Promise<void> {
    const check = this.canMakeRequest(provider, tokens);

    if (check.allowed) {
      this.recordRequest(provider, tokens);
      return;
    }

    // Wait in queue
    return new Promise((resolve, reject) => {
      const queue = this.waitingQueue.get(provider) || [];

      const timeoutId = setTimeout(() => {
        const index = queue.findIndex(item => item.resolve === resolve);
        if (index >= 0) {
          queue.splice(index, 1);
        }
        reject(new Error(`Rate limit timeout: ${check.reason}`));
      }, timeoutMs);

      queue.push({
        resolve: () => {
          clearTimeout(timeoutId);
          this.recordRequest(provider, tokens);
          resolve();
        },
        reject,
        tokens
      });

      this.waitingQueue.set(provider, queue);

      // Schedule retry after wait time
      if (check.waitTime) {
        setTimeout(() => this.processQueue(provider), check.waitTime);
      }
    });
  }

  /**
   * Record a request
   */
  recordRequest(provider: string, tokens?: number): void {
    const records = this.requests.get(provider) || [];
    records.push({ timestamp: Date.now(), tokens });
    this.requests.set(provider, records);
  }

  /**
   * Process waiting queue for a provider
   */
  private processQueue(provider: string): void {
    const queue = this.waitingQueue.get(provider);
    if (!queue || queue.length === 0) return;

    const next = queue[0];
    const check = this.canMakeRequest(provider, next.tokens);

    if (check.allowed) {
      queue.shift();
      next.resolve();

      // Process more if possible
      if (queue.length > 0) {
        setTimeout(() => this.processQueue(provider), 10);
      }
    } else if (check.waitTime) {
      // Retry later
      setTimeout(() => this.processQueue(provider), check.waitTime);
    }
  }

  /**
   * Clean up old records
   */
  private cleanup(): void {
    const hourAgo = Date.now() - 3600000;

    for (const [provider, records] of this.requests) {
      const filtered = records.filter(r => r.timestamp > hourAgo);
      if (filtered.length !== records.length) {
        this.requests.set(provider, filtered);
      }
    }
  }

  /**
   * Get current usage stats for a provider
   */
  getUsageStats(provider: string): {
    requestsLastMinute: number;
    requestsLastHour: number;
    tokensLastMinute: number;
    tokensLastHour: number;
    queueLength: number;
  } {
    const records = this.requests.get(provider) || [];
    const now = Date.now();
    const minuteStart = now - 60000;
    const hourStart = now - 3600000;

    const lastMinute = records.filter(r => r.timestamp > minuteStart);
    const lastHour = records.filter(r => r.timestamp > hourStart);

    return {
      requestsLastMinute: lastMinute.length,
      requestsLastHour: lastHour.length,
      tokensLastMinute: lastMinute.reduce((sum, r) => sum + (r.tokens || 0), 0),
      tokensLastHour: lastHour.reduce((sum, r) => sum + (r.tokens || 0), 0),
      queueLength: (this.waitingQueue.get(provider) || []).length
    };
  }

  /**
   * Reset rate limit tracking for a provider
   */
  reset(provider: string): void {
    this.requests.delete(provider);
    const queue = this.waitingQueue.get(provider);
    if (queue) {
      for (const item of queue) {
        item.reject(new Error('Rate limiter reset'));
      }
      this.waitingQueue.delete(provider);
    }
  }

  /**
   * Reset all rate limit tracking
   */
  resetAll(): void {
    for (const provider of this.requests.keys()) {
      this.reset(provider);
    }
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

export default RateLimiter;
