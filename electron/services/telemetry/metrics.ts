/**
 * Telemetry Metrics
 *
 * Token counts, request counts, latency tracking.
 */

import { EventEmitter } from 'events';

export interface RequestMetrics {
  id: string;
  provider: string;
  model: string;
  timestamp: Date;
  duration: number; // ms
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  success: boolean;
  error?: string;
  cached?: boolean;
}

export interface AggregatedMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  tokensPerSecond: number;
  requestsByProvider: Record<string, number>;
  requestsByModel: Record<string, number>;
  errorsByType: Record<string, number>;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  metrics: AggregatedMetrics;
  requests: RequestMetrics[];
}

export interface ProjectMetrics {
  projectId: string;
  totalSessions: number;
  metrics: AggregatedMetrics;
  sessionHistory: Array<{
    sessionId: string;
    startTime: Date;
    endTime?: Date;
    totalTokens: number;
    totalRequests: number;
  }>;
}

const MAX_REQUEST_HISTORY = 1000;
const MAX_SESSION_HISTORY = 100;

export class MetricsCollector extends EventEmitter {
  private currentSession: SessionMetrics | null = null;
  private projectMetrics: Map<string, ProjectMetrics> = new Map();
  private globalMetrics: AggregatedMetrics = this.createEmptyMetrics();

  constructor() {
    super();
  }

  /**
   * Start a new session
   */
  startSession(projectId?: string): string {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // End previous session if exists
    if (this.currentSession) {
      this.endSession();
    }

    this.currentSession = {
      sessionId,
      startTime: new Date(),
      metrics: this.createEmptyMetrics(),
      requests: []
    };

    this.emit('session:started', { sessionId, projectId });
    return sessionId;
  }

  /**
   * End current session
   */
  endSession(projectId?: string): SessionMetrics | null {
    if (!this.currentSession) return null;

    this.currentSession.endTime = new Date();
    const session = this.currentSession;

    // Save to project metrics if project ID provided
    if (projectId) {
      this.saveSessionToProject(projectId, session);
    }

    this.emit('session:ended', { session, projectId });
    this.currentSession = null;

    return session;
  }

  /**
   * Record a request
   */
  recordRequest(metrics: Omit<RequestMetrics, 'id' | 'timestamp'>): RequestMetrics {
    const record: RequestMetrics = {
      ...metrics,
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date()
    };

    // Update session metrics
    if (this.currentSession) {
      this.currentSession.requests.push(record);
      this.updateAggregatedMetrics(this.currentSession.metrics, record);

      // Trim request history if needed
      if (this.currentSession.requests.length > MAX_REQUEST_HISTORY) {
        this.currentSession.requests = this.currentSession.requests.slice(-MAX_REQUEST_HISTORY);
      }
    }

    // Update global metrics
    this.updateAggregatedMetrics(this.globalMetrics, record);

    this.emit('request:recorded', record);
    return record;
  }

  /**
   * Update aggregated metrics with a new request
   */
  private updateAggregatedMetrics(metrics: AggregatedMetrics, request: RequestMetrics): void {
    metrics.totalRequests++;

    if (request.success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
      if (request.error) {
        metrics.errorsByType[request.error] = (metrics.errorsByType[request.error] || 0) + 1;
      }
    }

    metrics.totalInputTokens += request.inputTokens;
    metrics.totalOutputTokens += request.outputTokens;
    metrics.totalTokens += request.totalTokens;

    // Update latency metrics
    const latencies = this.currentSession?.requests
      .filter(r => r.success)
      .map(r => r.duration) || [request.duration];

    if (latencies.length > 0) {
      const sorted = [...latencies].sort((a, b) => a - b);
      metrics.averageLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      metrics.p50Latency = sorted[Math.floor(sorted.length * 0.5)];
      metrics.p95Latency = sorted[Math.floor(sorted.length * 0.95)];
      metrics.p99Latency = sorted[Math.floor(sorted.length * 0.99)];
    }

    // Calculate tokens per second
    const sessionDuration = this.currentSession
      ? (Date.now() - this.currentSession.startTime.getTime()) / 1000
      : 1;
    metrics.tokensPerSecond = metrics.totalTokens / Math.max(1, sessionDuration);

    // Update breakdown by provider/model
    metrics.requestsByProvider[request.provider] = (metrics.requestsByProvider[request.provider] || 0) + 1;
    metrics.requestsByModel[request.model] = (metrics.requestsByModel[request.model] || 0) + 1;
  }

  /**
   * Save session to project metrics
   */
  private saveSessionToProject(projectId: string, session: SessionMetrics): void {
    let project = this.projectMetrics.get(projectId);

    if (!project) {
      project = {
        projectId,
        totalSessions: 0,
        metrics: this.createEmptyMetrics(),
        sessionHistory: []
      };
      this.projectMetrics.set(projectId, project);
    }

    project.totalSessions++;

    // Merge session metrics into project metrics
    project.metrics.totalRequests += session.metrics.totalRequests;
    project.metrics.successfulRequests += session.metrics.successfulRequests;
    project.metrics.failedRequests += session.metrics.failedRequests;
    project.metrics.totalInputTokens += session.metrics.totalInputTokens;
    project.metrics.totalOutputTokens += session.metrics.totalOutputTokens;
    project.metrics.totalTokens += session.metrics.totalTokens;

    // Merge provider/model breakdowns
    for (const [provider, count] of Object.entries(session.metrics.requestsByProvider)) {
      project.metrics.requestsByProvider[provider] = (project.metrics.requestsByProvider[provider] || 0) + count;
    }
    for (const [model, count] of Object.entries(session.metrics.requestsByModel)) {
      project.metrics.requestsByModel[model] = (project.metrics.requestsByModel[model] || 0) + count;
    }

    // Add to session history
    project.sessionHistory.push({
      sessionId: session.sessionId,
      startTime: session.startTime,
      endTime: session.endTime,
      totalTokens: session.metrics.totalTokens,
      totalRequests: session.metrics.totalRequests
    });

    // Trim session history if needed
    if (project.sessionHistory.length > MAX_SESSION_HISTORY) {
      project.sessionHistory = project.sessionHistory.slice(-MAX_SESSION_HISTORY);
    }
  }

  /**
   * Get current session metrics
   */
  getCurrentSessionMetrics(): SessionMetrics | null {
    return this.currentSession;
  }

  /**
   * Get project metrics
   */
  getProjectMetrics(projectId: string): ProjectMetrics | null {
    return this.projectMetrics.get(projectId) || null;
  }

  /**
   * Get global metrics
   */
  getGlobalMetrics(): AggregatedMetrics {
    return { ...this.globalMetrics };
  }

  /**
   * Get metrics for a specific time range
   */
  getMetricsForRange(startTime: Date, endTime: Date): AggregatedMetrics {
    const metrics = this.createEmptyMetrics();

    if (!this.currentSession) return metrics;

    const filtered = this.currentSession.requests.filter(
      r => r.timestamp >= startTime && r.timestamp <= endTime
    );

    for (const request of filtered) {
      this.updateAggregatedMetrics(metrics, request);
    }

    return metrics;
  }

  /**
   * Get recent requests
   */
  getRecentRequests(count = 10): RequestMetrics[] {
    if (!this.currentSession) return [];
    return this.currentSession.requests.slice(-count);
  }

  /**
   * Create empty aggregated metrics
   */
  private createEmptyMetrics(): AggregatedMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      averageLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      tokensPerSecond: 0,
      requestsByProvider: {},
      requestsByModel: {},
      errorsByType: {}
    };
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): {
    global: AggregatedMetrics;
    currentSession: SessionMetrics | null;
    projects: ProjectMetrics[];
  } {
    return {
      global: this.globalMetrics,
      currentSession: this.currentSession,
      projects: Array.from(this.projectMetrics.values())
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.currentSession = null;
    this.projectMetrics.clear();
    this.globalMetrics = this.createEmptyMetrics();
    this.emit('metrics:reset');
  }
}

// Singleton instance
let metricsInstance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new MetricsCollector();
  }
  return metricsInstance;
}

export default MetricsCollector;
