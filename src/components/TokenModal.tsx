import { useState, useRef } from 'react';
import type React from 'react';
import { X, Key, ShieldCheck, Check, AlertCircle, Trash2, ExternalLink } from 'lucide-react';
import { checkRateLimit } from '../services/github';
import type { RateLimitInfo } from '../types/github';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedToken: string;
  onSaveToken: (token: string) => void;
  onClearToken: () => void;
  onRateLimitUpdate: (info: RateLimitInfo) => void;
}

export const TokenModal: React.FC<TokenModalProps> = ({
  isOpen,
  onClose,
  savedToken,
  onSaveToken,
  onClearToken,
  onRateLimitUpdate,
}) => {
  const [tokenInput, setTokenInput] = useState(savedToken);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { containerRef } = useDialogAccessibility({
    isOpen,
    onClose,
    initialFocusRef: inputRef,
  });

  if (!isOpen) return null;

  const handleVerifyAndSave = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      onClearToken();
      setStatusMsg({ type: 'success', text: 'Token removed. Using anonymous rate limit (60 req/hr).' });
      return;
    }

    setIsVerifying(true);
    setStatusMsg(null);
    try {
      const info = await checkRateLimit(trimmed);
      if (info.limit > 60) {
        onSaveToken(trimmed);
        onRateLimitUpdate(info);
        setStatusMsg({
          type: 'success',
          text: `Success! Token verified with ${info.remaining}/${info.limit} requests available.`,
        });
      } else {
        setStatusMsg({
          type: 'error',
          text: 'Token did not increase rate limit. Ensure it has public repo read access.',
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `Token check failed: ${err.message || 'Invalid token'}` });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClear = () => {
    setTokenInput('');
    onClearToken();
    setStatusMsg({ type: 'success', text: 'Token cleared.' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="presentation">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-modal-title"
        className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 relative"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Key className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h3 id="token-modal-title" className="text-xl font-bold text-white">GitHub API Token</h3>
            <p className="text-xs text-slate-400">Increase rate limit from 60 to 5,000 req/hr</p>
          </div>
        </div>

        {/* Security guarantee */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3 mb-5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p>
            <strong>How your token is handled:</strong> It is kept in this tab's session storage and sent with
            each lookup to the Repozyn server proxy, which forwards it to <code>api.github.com</code>. The proxy
            does not log or store it, and it is cleared when you close the tab. Use a read-only token with no
            extra scopes.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-2 mb-4">
          <label htmlFor="github-token-input" className="text-xs font-semibold text-slate-300 block">
            Personal Access Token (classic or fine-grained)
          </label>
          <input
            id="github-token-input"
            ref={inputRef}
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Status message */}
        {statusMsg && (
          <div
            className={`p-3 rounded-xl text-xs mb-4 flex items-center gap-2 ${
              statusMsg.type === 'success'
                ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50'
                : 'bg-rose-950/40 text-rose-300 border border-rose-800/50'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-slate-400 mb-6">
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:underline flex items-center gap-1"
          >
            <span>Create a token on GitHub</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <span>(Read-only / public repo scope only)</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          {savedToken && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs text-rose-400 hover:bg-rose-950/30 transition mr-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove Token</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            Close
          </button>

          <button
            onClick={handleVerifyAndSave}
            disabled={isVerifying}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
          >
            {isVerifying ? 'Verifying...' : 'Save & Verify'}
          </button>
        </div>
      </div>
    </div>
  );
};
