import { useState } from 'react';
import type React from 'react';
import { X, Copy, Check, FileDown } from 'lucide-react';
import type { PortfolioReport } from '../types/analysis';
import { formatReportToMarkdown } from '../utils/markdownReport';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface MarkdownReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PortfolioReport;
}

export const MarkdownReportModal: React.FC<MarkdownReportModalProps> = ({
  isOpen,
  onClose,
  report,
}) => {
  const [copied, setCopied] = useState(false);
  const { containerRef } = useDialogAccessibility({ isOpen, onClose });

  if (!isOpen) return null;

  const markdownContent = formatReportToMarkdown(report);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(markdownContent);
      } else {
        const temp = document.createElement('textarea');
        temp.value = markdownContent;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.focus();
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write errors
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repozyn-audit-${report.facts.username}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore download errors
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" role="presentation">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        className="w-full max-w-3xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div>
            <h3 id="report-modal-title" className="text-xl font-bold text-white">Export Audit Report</h3>
            <p className="text-xs text-slate-400">
              Clean GitHub Flavored Markdown ready to paste into READMEs, reviews, or issues.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close export dialog"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content Preview */}
        <div className="my-4 flex-1 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-slate-300">
          <pre className="whitespace-pre-wrap leading-relaxed select-all">{markdownContent}</pre>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-800 shrink-0">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition"
          >
            <FileDown className="w-4 h-4" />
            <span>Download .md</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              Close
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md transition"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied to Clipboard!' : 'Copy Markdown'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
