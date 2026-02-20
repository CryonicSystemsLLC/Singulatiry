import { useState } from 'react';
import {
  BarChart3,
  DollarSign,
  Zap,
  Clock,
  AlertTriangle,
  RefreshCw,
  Download,
  Settings,
  ChevronDown,
  Activity
} from 'lucide-react';

export interface UsageMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  tokensPerSecond: number;
  requestsByProvider: Record<string, number>;
  requestsByModel: Record<string, number>;
}

export interface CostMetrics {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  costByModel: Record<string, number>;
  costByProvider: Record<string, number>;
}

export interface BudgetStatus {
  session: { current: number; limit?: number; percentage?: number };
  daily: { current: number; limit?: number; percentage?: number };
  monthly: { current: number; limit?: number; percentage?: number };
}

interface UsageDashboardProps {
  usage: UsageMetrics;
  costs: CostMetrics;
  budget?: BudgetStatus;
  onRefresh?: () => void;
  onExport?: () => void;
  onConfigureBudget?: () => void;
}

type TimeRange = 'session' | 'today' | 'week' | 'month';

export default function UsageDashboard({
  usage,
  costs,
  budget,
  onRefresh,
  onExport,
  onConfigureBudget
}: UsageDashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('session');
  const [showDetails, setShowDetails] = useState(false);

  const successRate = usage.totalRequests > 0
    ? ((usage.successfulRequests / usage.totalRequests) * 100).toFixed(1)
    : '0';

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCost = (cost: number): string => {
    if (cost < 0.01) return '<$0.01';
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatLatency = (ms: number): string => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms.toFixed(0)}ms`;
  };

  const getBudgetColor = (percentage?: number): string => {
    if (!percentage) return 'text-gray-400';
    if (percentage >= 100) return 'text-red-400';
    if (percentage >= 80) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getBudgetBg = (percentage?: number): string => {
    if (!percentage) return 'bg-gray-600';
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-purple-400" />
          <h2 className="text-xl font-semibold text-white">Usage Dashboard</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex bg-[#27272a] rounded-lg p-1">
            {(['session', 'today', 'week', 'month'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 rounded text-sm capitalize transition-colors ${
                  timeRange === range
                    ? 'bg-purple-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 bg-[#27272a] rounded-lg hover:bg-[#3f3f46] transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} className="text-gray-400" />
            </button>
          )}
          {onExport && (
            <button
              onClick={onExport}
              className="p-2 bg-[#27272a] rounded-lg hover:bg-[#3f3f46] transition-colors"
              title="Export"
            >
              <Download size={16} className="text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Budget Alerts */}
      {budget && (
        <div className="bg-[#27272a] rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-300">Budget Status</h3>
            {onConfigureBudget && (
              <button
                onClick={onConfigureBudget}
                className="p-1 hover:bg-[#3f3f46] rounded transition-colors"
              >
                <Settings size={14} className="text-gray-500" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {/* Session Budget */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-500">Session</span>
                <span className={getBudgetColor(budget.session.percentage)}>
                  {formatCost(budget.session.current)}
                  {budget.session.limit && ` / ${formatCost(budget.session.limit)}`}
                </span>
              </div>
              {budget.session.limit && (
                <div className="h-1.5 bg-[#18181b] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getBudgetBg(budget.session.percentage)} transition-all`}
                    style={{ width: `${Math.min(100, budget.session.percentage || 0)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Daily Budget */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-500">Daily</span>
                <span className={getBudgetColor(budget.daily.percentage)}>
                  {formatCost(budget.daily.current)}
                  {budget.daily.limit && ` / ${formatCost(budget.daily.limit)}`}
                </span>
              </div>
              {budget.daily.limit && (
                <div className="h-1.5 bg-[#18181b] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getBudgetBg(budget.daily.percentage)} transition-all`}
                    style={{ width: `${Math.min(100, budget.daily.percentage || 0)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Monthly Budget */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-500">Monthly</span>
                <span className={getBudgetColor(budget.monthly.percentage)}>
                  {formatCost(budget.monthly.current)}
                  {budget.monthly.limit && ` / ${formatCost(budget.monthly.limit)}`}
                </span>
              </div>
              {budget.monthly.limit && (
                <div className="h-1.5 bg-[#18181b] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getBudgetBg(budget.monthly.percentage)} transition-all`}
                    style={{ width: `${Math.min(100, budget.monthly.percentage || 0)}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Budget Warning */}
          {((budget.session.percentage && budget.session.percentage >= 80) ||
            (budget.daily.percentage && budget.daily.percentage >= 80) ||
            (budget.monthly.percentage && budget.monthly.percentage >= 80)) && (
            <div className="flex items-center gap-2 mt-3 p-2 bg-yellow-500/10 rounded-lg">
              <AlertTriangle size={14} className="text-yellow-400" />
              <span className="text-xs text-yellow-400">
                Approaching budget limit. Consider switching to a more cost-effective model.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {/* Total Cost */}
        <div className="bg-[#27272a] rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <DollarSign size={16} />
            <span className="text-xs">Total Cost</span>
          </div>
          <div className="text-2xl font-bold text-white">{formatCost(costs.totalCost)}</div>
          <div className="text-xs text-gray-500 mt-1">
            Input: {formatCost(costs.inputCost)} / Output: {formatCost(costs.outputCost)}
          </div>
        </div>

        {/* Total Tokens */}
        <div className="bg-[#27272a] rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <Zap size={16} />
            <span className="text-xs">Total Tokens</span>
          </div>
          <div className="text-2xl font-bold text-white">{formatNumber(usage.totalTokens)}</div>
          <div className="text-xs text-gray-500 mt-1">
            {formatNumber(usage.totalInputTokens)} in / {formatNumber(usage.totalOutputTokens)} out
          </div>
        </div>

        {/* Requests */}
        <div className="bg-[#27272a] rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <Activity size={16} />
            <span className="text-xs">Requests</span>
          </div>
          <div className="text-2xl font-bold text-white">{usage.totalRequests}</div>
          <div className="flex items-center gap-2 text-xs mt-1">
            <span className="text-green-400">{usage.successfulRequests} success</span>
            {usage.failedRequests > 0 && (
              <span className="text-red-400">{usage.failedRequests} failed</span>
            )}
          </div>
        </div>

        {/* Latency */}
        <div className="bg-[#27272a] rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-2">
            <Clock size={16} />
            <span className="text-xs">Avg Latency</span>
          </div>
          <div className="text-2xl font-bold text-white">{formatLatency(usage.averageLatency)}</div>
          <div className="text-xs text-gray-500 mt-1">
            p50: {formatLatency(usage.p50Latency)} / p95: {formatLatency(usage.p95Latency)}
          </div>
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="bg-[#27272a] rounded-xl overflow-hidden">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full p-4 flex items-center justify-between hover:bg-[#3f3f46] transition-colors"
        >
          <span className="text-sm font-medium text-gray-300">Detailed Breakdown</span>
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform ${showDetails ? 'rotate-180' : ''}`}
          />
        </button>

        {showDetails && (
          <div className="p-4 border-t border-[#18181b] space-y-6">
            {/* By Provider */}
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-3">By Provider</h4>
              <div className="space-y-2">
                {Object.entries(usage.requestsByProvider).map(([provider, count]) => {
                  const cost = costs.costByProvider[provider] || 0;
                  const percentage = (count / usage.totalRequests) * 100;
                  return (
                    <div key={provider} className="flex items-center gap-3">
                      <span className="text-sm text-white w-24">{provider}</span>
                      <div className="flex-1 h-2 bg-[#18181b] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-16 text-right">{count} req</span>
                      <span className="text-xs text-gray-400 w-16 text-right">{formatCost(cost)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By Model */}
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-3">By Model</h4>
              <div className="space-y-2">
                {Object.entries(usage.requestsByModel)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([model, count]) => {
                    const cost = costs.costByModel[model] || 0;
                    const percentage = (count / usage.totalRequests) * 100;
                    return (
                      <div key={model} className="flex items-center gap-3">
                        <span className="text-sm text-white w-40 truncate" title={model}>{model}</span>
                        <div className="flex-1 h-2 bg-[#18181b] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-16 text-right">{count} req</span>
                        <span className="text-xs text-gray-400 w-16 text-right">{formatCost(cost)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Performance Stats */}
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-3">Performance</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-[#18181b] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Success Rate</div>
                  <div className={`text-lg font-semibold ${
                    parseFloat(successRate) >= 95 ? 'text-green-400' :
                    parseFloat(successRate) >= 80 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {successRate}%
                  </div>
                </div>
                <div className="bg-[#18181b] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Tokens/Second</div>
                  <div className="text-lg font-semibold text-white">
                    {usage.tokensPerSecond.toFixed(1)}
                  </div>
                </div>
                <div className="bg-[#18181b] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Cost/Request</div>
                  <div className="text-lg font-semibold text-white">
                    {formatCost(usage.totalRequests > 0 ? costs.totalCost / usage.totalRequests : 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type { TimeRange };
