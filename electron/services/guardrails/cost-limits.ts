/**
 * Cost Limits Guardrail
 *
 * Per-session/daily cost caps and enforcement.
 */

import { EventEmitter } from 'events';
import { getCostTracker } from '../telemetry/cost-tracker';

export interface CostLimitConfig {
  // Hard limits (block requests when exceeded)
  hardLimits: {
    perRequest?: number;
    perSession?: number;
    perDay?: number;
    perMonth?: number;
  };
  // Soft limits (warn but allow)
  softLimits: {
    perRequest?: number;
    perSession?: number;
    perDay?: number;
    perMonth?: number;
  };
  // Alert thresholds (percentage of hard limit to trigger warning)
  alertThreshold: number;
  // Actions to take when limits are hit
  actions: {
    onSoftLimit: 'warn' | 'confirm' | 'none';
    onHardLimit: 'block' | 'downgrade' | 'warn';
  };
  // Model to downgrade to when limit hit
  downgradeModel?: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  warnings: string[];
  errors: string[];
  suggestedModel?: string;
  estimatedCost?: number;
  remainingBudget?: {
    session?: number;
    daily?: number;
    monthly?: number;
  };
}

const DEFAULT_CONFIG: CostLimitConfig = {
  hardLimits: {
    perRequest: 1.00,    // $1 per request
    perSession: 10.00,   // $10 per session
    perDay: 50.00,       // $50 per day
    perMonth: 500.00     // $500 per month
  },
  softLimits: {
    perRequest: 0.50,
    perSession: 5.00,
    perDay: 25.00,
    perMonth: 250.00
  },
  alertThreshold: 0.8,
  actions: {
    onSoftLimit: 'warn',
    onHardLimit: 'block'
  },
  downgradeModel: 'gpt-4o-mini'
};

export class CostLimitGuardrail extends EventEmitter {
  private config: CostLimitConfig;
  private monthlyCosts: Map<string, number> = new Map(); // Keyed by YYYY-MM
  private bypassEnabled = false;

  constructor(config: Partial<CostLimitConfig> = {}) {
    super();
    this.config = this.mergeConfig(DEFAULT_CONFIG, config);
  }

  /**
   * Merge configuration with defaults
   */
  private mergeConfig(defaults: CostLimitConfig, overrides: Partial<CostLimitConfig>): CostLimitConfig {
    return {
      hardLimits: { ...defaults.hardLimits, ...overrides.hardLimits },
      softLimits: { ...defaults.softLimits, ...overrides.softLimits },
      alertThreshold: overrides.alertThreshold ?? defaults.alertThreshold,
      actions: { ...defaults.actions, ...overrides.actions },
      downgradeModel: overrides.downgradeModel ?? defaults.downgradeModel
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CostLimitConfig>): void {
    this.config = this.mergeConfig(this.config, config);
    this.emit('config:updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): CostLimitConfig {
    return { ...this.config };
  }

  /**
   * Enable/disable bypass mode (for admins)
   */
  setBypass(enabled: boolean): void {
    this.bypassEnabled = enabled;
    this.emit('bypass:changed', enabled);
  }

  /**
   * Check if a request is allowed
   */
  async checkRequest(estimatedCost: number): Promise<LimitCheckResult> {
    const result: LimitCheckResult = {
      allowed: true,
      warnings: [],
      errors: [],
      estimatedCost
    };

    if (this.bypassEnabled) {
      return result;
    }

    const costTracker = getCostTracker();
    const sessionCosts = costTracker.getSessionCosts();
    const dailyCosts = costTracker.getDailyCosts();
    const monthlyCosts = this.getMonthlyCosts();

    // Calculate remaining budgets
    result.remainingBudget = {
      session: this.config.hardLimits.perSession
        ? this.config.hardLimits.perSession - sessionCosts.totalCost
        : undefined,
      daily: this.config.hardLimits.perDay
        ? this.config.hardLimits.perDay - dailyCosts.totalCost
        : undefined,
      monthly: this.config.hardLimits.perMonth
        ? this.config.hardLimits.perMonth - monthlyCosts
        : undefined
    };

    // Check per-request limit
    if (this.config.hardLimits.perRequest && estimatedCost > this.config.hardLimits.perRequest) {
      result.errors.push(`Request cost ($${estimatedCost.toFixed(4)}) exceeds per-request limit ($${this.config.hardLimits.perRequest})`);
      result.allowed = false;
    } else if (this.config.softLimits.perRequest && estimatedCost > this.config.softLimits.perRequest) {
      result.warnings.push(`Request cost ($${estimatedCost.toFixed(4)}) exceeds soft limit ($${this.config.softLimits.perRequest})`);
    }

    // Check session limit
    const projectedSessionCost = sessionCosts.totalCost + estimatedCost;
    if (this.config.hardLimits.perSession && projectedSessionCost > this.config.hardLimits.perSession) {
      result.errors.push(`Session cost would exceed limit ($${projectedSessionCost.toFixed(2)} > $${this.config.hardLimits.perSession})`);
      result.allowed = false;
    } else if (this.config.softLimits.perSession && projectedSessionCost > this.config.softLimits.perSession) {
      result.warnings.push(`Session cost approaching limit ($${projectedSessionCost.toFixed(2)} / $${this.config.hardLimits.perSession})`);
    }

    // Check daily limit
    const projectedDailyCost = dailyCosts.totalCost + estimatedCost;
    if (this.config.hardLimits.perDay && projectedDailyCost > this.config.hardLimits.perDay) {
      result.errors.push(`Daily cost would exceed limit ($${projectedDailyCost.toFixed(2)} > $${this.config.hardLimits.perDay})`);
      result.allowed = false;
    } else if (this.config.softLimits.perDay && projectedDailyCost > this.config.softLimits.perDay) {
      result.warnings.push(`Daily cost approaching limit ($${projectedDailyCost.toFixed(2)} / $${this.config.hardLimits.perDay})`);
    }

    // Check monthly limit
    const projectedMonthlyCost = monthlyCosts + estimatedCost;
    if (this.config.hardLimits.perMonth && projectedMonthlyCost > this.config.hardLimits.perMonth) {
      result.errors.push(`Monthly cost would exceed limit ($${projectedMonthlyCost.toFixed(2)} > $${this.config.hardLimits.perMonth})`);
      result.allowed = false;
    } else if (this.config.softLimits.perMonth && projectedMonthlyCost > this.config.softLimits.perMonth) {
      result.warnings.push(`Monthly cost approaching limit ($${projectedMonthlyCost.toFixed(2)} / $${this.config.hardLimits.perMonth})`);
    }

    // Handle hard limit action
    if (!result.allowed && this.config.actions.onHardLimit === 'downgrade' && this.config.downgradeModel) {
      result.allowed = true;
      result.suggestedModel = this.config.downgradeModel;
      result.warnings.push(`Automatically downgrading to ${this.config.downgradeModel} to stay within budget`);
    }

    // Emit events
    if (result.errors.length > 0) {
      this.emit('limit:exceeded', { result, sessionCosts, dailyCosts });
    } else if (result.warnings.length > 0) {
      this.emit('limit:warning', { result, sessionCosts, dailyCosts });
    }

    return result;
  }

  /**
   * Get monthly costs
   */
  private getMonthlyCosts(): number {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    return this.monthlyCosts.get(monthKey) || 0;
  }

  /**
   * Record monthly cost
   */
  recordMonthlyCost(cost: number): void {
    const monthKey = new Date().toISOString().slice(0, 7);
    const current = this.monthlyCosts.get(monthKey) || 0;
    this.monthlyCosts.set(monthKey, current + cost);
  }

  /**
   * Get cost status summary
   */
  getCostStatus(): {
    session: { current: number; limit?: number; percentage?: number; status: 'ok' | 'warning' | 'exceeded' };
    daily: { current: number; limit?: number; percentage?: number; status: 'ok' | 'warning' | 'exceeded' };
    monthly: { current: number; limit?: number; percentage?: number; status: 'ok' | 'warning' | 'exceeded' };
  } {
    const costTracker = getCostTracker();
    const sessionCosts = costTracker.getSessionCosts();
    const dailyCosts = costTracker.getDailyCosts();
    const monthlyCosts = this.getMonthlyCosts();

    const getStatus = (current: number, hardLimit?: number, softLimit?: number): 'ok' | 'warning' | 'exceeded' => {
      if (hardLimit && current >= hardLimit) return 'exceeded';
      if (softLimit && current >= softLimit) return 'warning';
      if (hardLimit && current >= hardLimit * this.config.alertThreshold) return 'warning';
      return 'ok';
    };

    return {
      session: {
        current: sessionCosts.totalCost,
        limit: this.config.hardLimits.perSession,
        percentage: this.config.hardLimits.perSession
          ? (sessionCosts.totalCost / this.config.hardLimits.perSession) * 100
          : undefined,
        status: getStatus(sessionCosts.totalCost, this.config.hardLimits.perSession, this.config.softLimits.perSession)
      },
      daily: {
        current: dailyCosts.totalCost,
        limit: this.config.hardLimits.perDay,
        percentage: this.config.hardLimits.perDay
          ? (dailyCosts.totalCost / this.config.hardLimits.perDay) * 100
          : undefined,
        status: getStatus(dailyCosts.totalCost, this.config.hardLimits.perDay, this.config.softLimits.perDay)
      },
      monthly: {
        current: monthlyCosts,
        limit: this.config.hardLimits.perMonth,
        percentage: this.config.hardLimits.perMonth
          ? (monthlyCosts / this.config.hardLimits.perMonth) * 100
          : undefined,
        status: getStatus(monthlyCosts, this.config.hardLimits.perMonth, this.config.softLimits.perMonth)
      }
    };
  }

  /**
   * Reset monthly tracking
   */
  resetMonthly(): void {
    this.monthlyCosts.clear();
    this.emit('monthly:reset');
  }
}

// Singleton instance
let guardrailInstance: CostLimitGuardrail | null = null;

export function getCostLimitGuardrail(): CostLimitGuardrail {
  if (!guardrailInstance) {
    guardrailInstance = new CostLimitGuardrail();
  }
  return guardrailInstance;
}

export default CostLimitGuardrail;
