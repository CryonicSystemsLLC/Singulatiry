/**
 * Cost Tracker
 *
 * Estimated cost per session/project based on token usage.
 */

import { EventEmitter } from 'events';
import { getMetricsCollector, type RequestMetrics } from './metrics';

// Pricing per 1M tokens (as of late 2024, approximate)
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, cachedInputPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, cachedInputPer1M: 0.075 },
  'gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-3.5-turbo': { inputPer1M: 0.50, outputPer1M: 1.50 },

  // Anthropic
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30 },
  'claude-3-5-haiku-20241022': { inputPer1M: 1.00, outputPer1M: 5.00, cachedInputPer1M: 0.10 },
  'claude-3-opus-20240229': { inputPer1M: 15.00, outputPer1M: 75.00, cachedInputPer1M: 1.50 },
  'claude-3-sonnet-20240229': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },

  // Google Gemini
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },

  // xAI
  'grok-beta': { inputPer1M: 5.00, outputPer1M: 15.00 },
  'grok-2': { inputPer1M: 2.00, outputPer1M: 10.00 },

  // DeepSeek
  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28, cachedInputPer1M: 0.014 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },

  // Kimi
  'moonshot-v1-8k': { inputPer1M: 1.00, outputPer1M: 1.00 },
  'moonshot-v1-32k': { inputPer1M: 2.00, outputPer1M: 2.00 },
  'moonshot-v1-128k': { inputPer1M: 6.00, outputPer1M: 6.00 },

  // Qwen
  'qwen-plus': { inputPer1M: 0.80, outputPer1M: 2.00 },
  'qwen-turbo': { inputPer1M: 0.30, outputPer1M: 0.60 },
  'qwen-max': { inputPer1M: 2.40, outputPer1M: 9.60 }
};

// Default pricing for unknown models
const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 1.00,
  outputPer1M: 3.00
};

export interface CostRecord {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  cached: boolean;
  timestamp: Date;
}

export interface CostSummary {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  costByModel: Record<string, number>;
  costByProvider: Record<string, number>;
  requestCount: number;
  tokenCount: number;
  averageCostPerRequest: number;
  averageCostPerToken: number;
}

export interface CostBudget {
  dailyLimit?: number;
  sessionLimit?: number;
  projectLimit?: number;
  alertThreshold?: number; // Percentage at which to alert (e.g., 0.8 = 80%)
}

export class CostTracker extends EventEmitter {
  private customPricing: Map<string, ModelPricing> = new Map();
  private sessionCosts: CostRecord[] = [];
  private dailyCosts: Map<string, CostRecord[]> = new Map(); // Keyed by date string
  private projectCosts: Map<string, CostRecord[]> = new Map();
  private budget: CostBudget = {};
  private currentProjectId: string | null = null;

  constructor() {
    super();

    // Listen to metrics for automatic cost tracking
    const metrics = getMetricsCollector();
    metrics.on('request:recorded', (request: RequestMetrics) => {
      this.trackRequest(request);
    });
    metrics.on('session:started', () => {
      this.sessionCosts = [];
    });
  }

  /**
   * Set custom pricing for a model
   */
  setModelPricing(model: string, pricing: ModelPricing): void {
    this.customPricing.set(model, pricing);
  }

  /**
   * Get pricing for a model
   */
  getModelPricing(model: string): ModelPricing {
    // Check custom pricing first
    if (this.customPricing.has(model)) {
      return this.customPricing.get(model)!;
    }

    // Check built-in pricing (try exact match, then partial match)
    if (MODEL_PRICING[model]) {
      return MODEL_PRICING[model];
    }

    // Try partial match
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (model.includes(key) || key.includes(model)) {
        return pricing;
      }
    }

    return DEFAULT_PRICING;
  }

  /**
   * Set cost budget
   */
  setBudget(budget: CostBudget): void {
    this.budget = { ...this.budget, ...budget };
    this.emit('budget:updated', this.budget);
  }

  /**
   * Get current budget
   */
  getBudget(): CostBudget {
    return { ...this.budget };
  }

  /**
   * Set current project
   */
  setProject(projectId: string | null): void {
    this.currentProjectId = projectId;
  }

  /**
   * Track cost for a request
   */
  trackRequest(request: RequestMetrics): CostRecord {
    const pricing = this.getModelPricing(request.model);
    const inputRate = request.cached && pricing.cachedInputPer1M
      ? pricing.cachedInputPer1M
      : pricing.inputPer1M;

    const inputCost = (request.inputTokens / 1_000_000) * inputRate;
    const outputCost = (request.outputTokens / 1_000_000) * pricing.outputPer1M;

    const record: CostRecord = {
      requestId: request.id,
      model: request.model,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      cached: request.cached || false,
      timestamp: request.timestamp
    };

    // Add to session costs
    this.sessionCosts.push(record);

    // Add to daily costs
    const dateKey = request.timestamp.toISOString().split('T')[0];
    if (!this.dailyCosts.has(dateKey)) {
      this.dailyCosts.set(dateKey, []);
    }
    this.dailyCosts.get(dateKey)!.push(record);

    // Add to project costs
    if (this.currentProjectId) {
      if (!this.projectCosts.has(this.currentProjectId)) {
        this.projectCosts.set(this.currentProjectId, []);
      }
      this.projectCosts.get(this.currentProjectId)!.push(record);
    }

    this.emit('cost:recorded', record);

    // Check budget alerts
    this.checkBudgetAlerts();

    return record;
  }

  /**
   * Calculate cost for given tokens
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number, cached = false): number {
    const pricing = this.getModelPricing(model);
    const inputRate = cached && pricing.cachedInputPer1M
      ? pricing.cachedInputPer1M
      : pricing.inputPer1M;

    const inputCost = (inputTokens / 1_000_000) * inputRate;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;

    return inputCost + outputCost;
  }

  /**
   * Get session cost summary
   */
  getSessionCosts(): CostSummary {
    return this.calculateSummary(this.sessionCosts);
  }

  /**
   * Get daily cost summary
   */
  getDailyCosts(date?: Date): CostSummary {
    const dateKey = (date || new Date()).toISOString().split('T')[0];
    const costs = this.dailyCosts.get(dateKey) || [];
    return this.calculateSummary(costs);
  }

  /**
   * Get project cost summary
   */
  getProjectCosts(projectId: string): CostSummary {
    const costs = this.projectCosts.get(projectId) || [];
    return this.calculateSummary(costs);
  }

  /**
   * Get all-time cost summary
   */
  getTotalCosts(): CostSummary {
    const allCosts: CostRecord[] = [];
    for (const costs of this.dailyCosts.values()) {
      allCosts.push(...costs);
    }
    return this.calculateSummary(allCosts);
  }

  /**
   * Calculate cost summary from records
   */
  private calculateSummary(records: CostRecord[]): CostSummary {
    const summary: CostSummary = {
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      costByModel: {},
      costByProvider: {},
      requestCount: records.length,
      tokenCount: 0,
      averageCostPerRequest: 0,
      averageCostPerToken: 0
    };

    for (const record of records) {
      summary.totalCost += record.totalCost;
      summary.inputCost += record.inputCost;
      summary.outputCost += record.outputCost;
      summary.tokenCount += record.inputTokens + record.outputTokens;

      // Track by model
      summary.costByModel[record.model] = (summary.costByModel[record.model] || 0) + record.totalCost;

      // Track by provider (extract from model name)
      const provider = this.extractProvider(record.model);
      summary.costByProvider[provider] = (summary.costByProvider[provider] || 0) + record.totalCost;
    }

    if (records.length > 0) {
      summary.averageCostPerRequest = summary.totalCost / records.length;
    }
    if (summary.tokenCount > 0) {
      summary.averageCostPerToken = summary.totalCost / summary.tokenCount;
    }

    return summary;
  }

  /**
   * Extract provider from model name
   */
  private extractProvider(model: string): string {
    const lowerModel = model.toLowerCase();
    if (lowerModel.includes('gpt')) return 'openai';
    if (lowerModel.includes('claude')) return 'anthropic';
    if (lowerModel.includes('gemini')) return 'google';
    if (lowerModel.includes('grok')) return 'xai';
    if (lowerModel.includes('deepseek')) return 'deepseek';
    if (lowerModel.includes('moonshot')) return 'kimi';
    if (lowerModel.includes('qwen')) return 'qwen';
    return 'unknown';
  }

  /**
   * Check budget alerts
   */
  private checkBudgetAlerts(): void {
    const threshold = this.budget.alertThreshold || 0.8;

    // Check session limit
    if (this.budget.sessionLimit) {
      const sessionCost = this.getSessionCosts().totalCost;
      if (sessionCost >= this.budget.sessionLimit) {
        this.emit('budget:exceeded', { type: 'session', limit: this.budget.sessionLimit, current: sessionCost });
      } else if (sessionCost >= this.budget.sessionLimit * threshold) {
        this.emit('budget:warning', { type: 'session', limit: this.budget.sessionLimit, current: sessionCost });
      }
    }

    // Check daily limit
    if (this.budget.dailyLimit) {
      const dailyCost = this.getDailyCosts().totalCost;
      if (dailyCost >= this.budget.dailyLimit) {
        this.emit('budget:exceeded', { type: 'daily', limit: this.budget.dailyLimit, current: dailyCost });
      } else if (dailyCost >= this.budget.dailyLimit * threshold) {
        this.emit('budget:warning', { type: 'daily', limit: this.budget.dailyLimit, current: dailyCost });
      }
    }

    // Check project limit
    if (this.budget.projectLimit && this.currentProjectId) {
      const projectCost = this.getProjectCosts(this.currentProjectId).totalCost;
      if (projectCost >= this.budget.projectLimit) {
        this.emit('budget:exceeded', { type: 'project', limit: this.budget.projectLimit, current: projectCost });
      } else if (projectCost >= this.budget.projectLimit * threshold) {
        this.emit('budget:warning', { type: 'project', limit: this.budget.projectLimit, current: projectCost });
      }
    }
  }

  /**
   * Get budget status
   */
  getBudgetStatus(): {
    session: { limit?: number; current: number; percentage?: number };
    daily: { limit?: number; current: number; percentage?: number };
    project: { limit?: number; current: number; percentage?: number };
  } {
    const sessionCost = this.getSessionCosts().totalCost;
    const dailyCost = this.getDailyCosts().totalCost;
    const projectCost = this.currentProjectId
      ? this.getProjectCosts(this.currentProjectId).totalCost
      : 0;

    return {
      session: {
        limit: this.budget.sessionLimit,
        current: sessionCost,
        percentage: this.budget.sessionLimit ? (sessionCost / this.budget.sessionLimit) * 100 : undefined
      },
      daily: {
        limit: this.budget.dailyLimit,
        current: dailyCost,
        percentage: this.budget.dailyLimit ? (dailyCost / this.budget.dailyLimit) * 100 : undefined
      },
      project: {
        limit: this.budget.projectLimit,
        current: projectCost,
        percentage: this.budget.projectLimit ? (projectCost / this.budget.projectLimit) * 100 : undefined
      }
    };
  }

  /**
   * Export cost data
   */
  export(): {
    sessionCosts: CostRecord[];
    dailyCosts: Record<string, CostRecord[]>;
    projectCosts: Record<string, CostRecord[]>;
    budget: CostBudget;
  } {
    return {
      sessionCosts: [...this.sessionCosts],
      dailyCosts: Object.fromEntries(this.dailyCosts),
      projectCosts: Object.fromEntries(this.projectCosts),
      budget: this.budget
    };
  }

  /**
   * Reset session costs
   */
  resetSession(): void {
    this.sessionCosts = [];
    this.emit('session:reset');
  }

  /**
   * Clear all cost data
   */
  clearAll(): void {
    this.sessionCosts = [];
    this.dailyCosts.clear();
    this.projectCosts.clear();
    this.emit('costs:cleared');
  }
}

// Singleton instance
let costTrackerInstance: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!costTrackerInstance) {
    costTrackerInstance = new CostTracker();
  }
  return costTrackerInstance;
}

export { MODEL_PRICING };
export default CostTracker;
