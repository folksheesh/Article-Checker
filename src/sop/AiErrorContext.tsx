import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AiFeature, AiErrorInfo } from './errorHandling';

type AiErrorMap = Partial<Record<AiFeature, AiErrorInfo>>;

interface AiErrorContextValue {
  errors: AiErrorMap;
  setError: (feature: AiFeature, error: AiErrorInfo) => void;
  clearError: (feature: AiFeature) => void;
  clearAll: () => void;
  retry: (feature: AiFeature, fn: () => Promise<void>) => Promise<void>;
}

const AiErrorContext = createContext<AiErrorContextValue | null>(null);

export function AiErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<AiErrorMap>({});

  const setError = useCallback((feature: AiFeature, error: AiErrorInfo) => {
    setErrors((prev) => ({ ...prev, [feature]: error }));
  }, []);

  const clearError = useCallback((feature: AiFeature) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[feature];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setErrors({});
  }, []);

  const retry = useCallback(
    async (feature: AiFeature, fn: () => Promise<void>) => {
      clearError(feature);
      try {
        await fn();
      } catch (err) {
        const { classifyAiError, logAiError } = await import('./errorHandling');
        const info = classifyAiError(err);
        logAiError(feature, info);
        setError(feature, info);
      }
    },
    [clearError, setError],
  );

  return (
    <AiErrorContext.Provider value={{ errors, setError, clearError, clearAll, retry }}>
      {children}
    </AiErrorContext.Provider>
  );
}

export function useAiError() {
  const ctx = useContext(AiErrorContext);
  if (!ctx) throw new Error('useAiError must be used within AiErrorProvider');
  return ctx;
}

const ERROR_ICONS: Record<string, string> = {
  rate_limit: '\u23F3',
  quota: '\u26A0\uFE0F',
  timeout: '\u23F0',
  network: '\uD83D\uDCE1',
  unknown: '\u2757',
};

export function AiErrorFallback({
  feature,
  onRetry,
  onDismiss,
}: {
  feature: AiFeature;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { errors, clearError } = useAiError();
  const error = errors[feature];
  if (!error) return null;

  return (
    <div className="p-4 rounded-xl bg-yellow-50 border border-yellow-200 shadow-sm animate-fade-in">
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0 mt-0.5">{ERROR_ICONS[error.type] || '\u2757'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-yellow-900 mb-1 leading-snug">
            {error.userMessage}
          </p>
          <p className="text-[10px] text-yellow-600 leading-relaxed">
            {(onRetry || onDismiss) && 'Silakan coba lagi atau tutup pesan ini.'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 text-[10px] font-semibold text-yellow-900 bg-yellow-200/70 hover:bg-yellow-300/70 rounded-lg transition flex items-center gap-1.5"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Coba Lagi
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={() => { clearError(feature); onDismiss?.(); }}
            className="px-3 py-1.5 text-[10px] font-medium text-yellow-700 hover:text-yellow-900 hover:bg-yellow-100 rounded-lg transition"
          >
            Tutup
          </button>
        )}
      </div>
    </div>
  );
}
