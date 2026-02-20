/**
 * Retry Logic
 *
 * Exponential backoff and circuit breaker for API calls.
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  retryableStatusCodes: number[];
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'ENOTFOUND',
    'ENETUNREACH',
    'EAI_AGAIN'
  ],
  retryableStatusCodes: [429, 500, 502, 503, 504]
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  halfOpenRequests: 3
};

export class RetryHandler {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: {
      onRetry?: (attempt: number, error: Error, delayMs: number) => void;
      shouldRetry?: (error: Error) => boolean;
    } = {}
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.config.initialDelayMs;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Check if we should retry
        if (attempt >= this.config.maxRetries) {
          break;
        }

        const shouldRetry = options.shouldRetry
          ? options.shouldRetry(error)
          : this.isRetryable(error);

        if (!shouldRetry) {
          break;
        }

        // Notify caller of retry
        options.onRetry?.(attempt + 1, error, delay);

        // Wait before retrying
        await this.sleep(delay);

        // Increase delay for next retry (exponential backoff with jitter)
        delay = Math.min(
          this.config.maxDelayMs,
          delay * this.config.backoffMultiplier * (0.5 + Math.random())
        );
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable
   */
  isRetryable(error: any): boolean {
    // Check error code
    if (error.code && this.config.retryableErrors.includes(error.code)) {
      return true;
    }

    // Check HTTP status code
    if (error.status && this.config.retryableStatusCodes.includes(error.status)) {
      return true;
    }

    // Check response status
    if (error.response?.status && this.config.retryableStatusCodes.includes(error.response.status)) {
      return true;
    }

    // Check for rate limit error messages
    const message = error.message?.toLowerCase() || '';
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return true;
    }

    return false;
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenSuccesses: number = 0;
  private stateChangeCallbacks: Array<(state: CircuitState) => void> = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.transitionTo('half-open');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenRequests) {
        this.transitionTo('closed');
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Immediately open on half-open failure
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.failures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      this.state = newState;

      if (newState === 'closed') {
        this.failures = 0;
        this.halfOpenSuccesses = 0;
      } else if (newState === 'half-open') {
        this.halfOpenSuccesses = 0;
      }

      for (const callback of this.stateChangeCallbacks) {
        callback(newState);
      }
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    lastFailureTime: number | null;
    halfOpenSuccesses: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime || null,
      halfOpenSuccesses: this.halfOpenSuccesses
    };
  }

  /**
   * Register a state change callback
   */
  onStateChange(callback: (state: CircuitState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('closed');
  }

  /**
   * Force the circuit open
   */
  trip(): void {
    this.transitionTo('open');
  }
}

/**
 * Combined retry with circuit breaker
 */
export class ResilientExecutor {
  private retryHandler: RetryHandler;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryHandler = new RetryHandler(retryConfig);
  }

  /**
   * Get or create circuit breaker for a provider
   */
  private getCircuitBreaker(provider: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(provider);
    if (!breaker) {
      breaker = new CircuitBreaker();
      this.circuitBreakers.set(provider, breaker);
    }
    return breaker;
  }

  /**
   * Execute with retry and circuit breaker
   */
  async execute<T>(
    provider: string,
    fn: () => Promise<T>,
    options: {
      onRetry?: (attempt: number, error: Error, delayMs: number) => void;
      shouldRetry?: (error: Error) => boolean;
    } = {}
  ): Promise<T> {
    const circuitBreaker = this.getCircuitBreaker(provider);

    return circuitBreaker.execute(() =>
      this.retryHandler.execute(fn, options)
    );
  }

  /**
   * Get circuit breaker state for a provider
   */
  getCircuitState(provider: string): CircuitState {
    return this.getCircuitBreaker(provider).getState();
  }

  /**
   * Get all circuit breaker states
   */
  getAllCircuitStates(): Record<string, CircuitState> {
    const states: Record<string, CircuitState> = {};
    for (const [provider, breaker] of this.circuitBreakers) {
      states[provider] = breaker.getState();
    }
    return states;
  }

  /**
   * Reset circuit breaker for a provider
   */
  resetCircuit(provider: string): void {
    this.getCircuitBreaker(provider).reset();
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuits(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
  }
}

// Singleton instance
let executorInstance: ResilientExecutor | null = null;

export function getResilientExecutor(): ResilientExecutor {
  if (!executorInstance) {
    executorInstance = new ResilientExecutor();
  }
  return executorInstance;
}

export default ResilientExecutor;
