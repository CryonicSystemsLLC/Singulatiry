import React from 'react';
import { Gauge } from 'lucide-react';

interface TokenCounterProps {
  usedTokens: number;
  maxTokens: number;
}

const TokenCounter: React.FC<TokenCounterProps> = ({ usedTokens, maxTokens }) => {
  const percentage = Math.min((usedTokens / maxTokens) * 100, 100);

  const formatTokens = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const barColor = percentage > 90 ? 'bg-[var(--error)]' : percentage > 70 ? 'bg-[var(--warning)]' : 'bg-[var(--accent-primary)]';

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
      <Gauge size={10} />
      <div className="flex-1 h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span>~{formatTokens(usedTokens)} / {formatTokens(maxTokens)}</span>
    </div>
  );
};

export default React.memo(TokenCounter);
