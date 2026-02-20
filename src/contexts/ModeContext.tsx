import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ModeConfig, PRO_MODE, KID_MODE, getModeConfig } from '../types/modes';

interface ModeContextValue {
  mode: ModeConfig;
  modeId: 'pro' | 'kid';
  setMode: (modeId: 'pro' | 'kid') => void;
  toggleMode: () => void;
  isKidMode: boolean;
  isProMode: boolean;
  canAccessFeature: (feature: keyof ModeConfig['features']) => boolean;
  requiresApproval: (action: keyof ModeConfig['restrictions']['requireApproval']) => boolean;
}

const ModeContext = createContext<ModeContextValue | null>(null);

const STORAGE_KEY = 'singularity-mode';

interface ModeProviderProps {
  children: React.ReactNode;
  defaultMode?: 'pro' | 'kid';
}

export function ModeProvider({ children, defaultMode = 'pro' }: ModeProviderProps) {
  const [modeId, setModeId] = useState<'pro' | 'kid'>(() => {
    // Try to load from storage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'pro' || stored === 'kid') {
        return stored;
      }
    }
    return defaultMode;
  });

  const mode = getModeConfig(modeId);

  // Persist mode changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, modeId);

    // Notify electron main process
    if (window.agent?.setMode) {
      window.agent.setMode(modeId).catch(console.error);
    }
  }, [modeId]);

  const setMode = useCallback((newModeId: 'pro' | 'kid') => {
    setModeId(newModeId);
  }, []);

  const toggleMode = useCallback(() => {
    setModeId(prev => prev === 'pro' ? 'kid' : 'pro');
  }, []);

  const canAccessFeature = useCallback((feature: keyof ModeConfig['features']) => {
    return mode.features[feature];
  }, [mode]);

  const requiresApproval = useCallback((action: keyof ModeConfig['restrictions']['requireApproval']) => {
    return mode.restrictions.requireApproval[action];
  }, [mode]);

  const value: ModeContextValue = {
    mode,
    modeId,
    setMode,
    toggleMode,
    isKidMode: modeId === 'kid',
    isProMode: modeId === 'pro',
    canAccessFeature,
    requiresApproval
  };

  return (
    <ModeContext.Provider value={value}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}

// Mode-aware component wrapper
interface ModeGateProps {
  children: React.ReactNode;
  feature?: keyof ModeConfig['features'];
  mode?: 'pro' | 'kid';
  fallback?: React.ReactNode;
}

export function ModeGate({ children, feature, mode: requiredMode, fallback = null }: ModeGateProps) {
  const { modeId, canAccessFeature } = useMode();

  // Check mode requirement
  if (requiredMode && modeId !== requiredMode) {
    return <>{fallback}</>;
  }

  // Check feature requirement
  if (feature && !canAccessFeature(feature)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// Hook for checking permissions
export function usePermission(action: keyof ModeConfig['restrictions']['requireApproval']) {
  const { requiresApproval, isKidMode } = useMode();

  const needsApproval = requiresApproval(action);

  const checkPermission = useCallback(async (): Promise<boolean> => {
    if (!needsApproval) {
      return true;
    }

    // In kid mode, show confirmation dialog
    if (isKidMode) {
      return new Promise((resolve) => {
        const confirmed = window.confirm(
          `This action requires approval. Do you want to continue?`
        );
        resolve(confirmed);
      });
    }

    return true;
  }, [needsApproval, isKidMode]);

  return { needsApproval, checkPermission };
}

export { PRO_MODE, KID_MODE };
export default ModeContext;
