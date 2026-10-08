import { useState, useId, useMemo } from 'react';
import type React from 'react';
import {
  X,
  Copy,
  Check,
  FileDown,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  Info,
  Code2,
  Eye,
  ExternalLink,
} from 'lucide-react';
import type { PortfolioReport } from '../types/analysis';
import { generateProfileReadme, sanitizeUrl } from '../utils/profileMakeover';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface ProfileMakeoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PortfolioReport;
}

const SafeMarkdownPreview: React.FC<{ markdown: string }> = ({ markdown }) => {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const flushTable = (key: number) => {
    if (tableRows.length > 0) {
      const header = tableRows[0];
      const dataRows = tableRows.slice(1);
      elements.push(
        <div key={`table-${key}`} className="overflow-x-auto my-3 rounded-xl border border-slate-800">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900 text-slate-300 font-mono border-b border-slate-800">
              <tr>
                {header.map((col, cIdx) => (
                  <th key={cIdx} className="px-3 py-2 font-semibold">
                    {col.replace(/\\\|/g, '|').trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
              {dataRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-900/30">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-slate-300 font-mono">
                      {cell.replace(/\\\|/g, '|').trim()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cols = trimmed
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim());
      if (cols.some((c) => /^:?-+:?$/.test(c))) {
        continue;
      }
      tableRows.push(cols);
      inTable = true;
      continue;
    } else if (inTable) {
      flushTable(i);
    }

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
      const suggestionText = trimmed.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
      elements.push(
        <div
          key={i}
          className="my-2 p-2.5 rounded-xl bg-amber-950/20 border border-amber-600/30 text-amber-300 text-[11px] flex items-center gap-2"
        >
          <Info className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>{suggestionText}</span>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={i} className="text-xl sm:text-2xl font-black text-white tracking-tight pb-2 border-b border-slate-800">
          {trimmed.replace(/^#\s+/, '')}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith('### ')) {
      const linkMatch = trimmed.match(/^###\s+(?:🚀\s+)?\[(.*?)\]\((.*?)\)/);
      if (linkMatch) {
        const title = linkMatch[1];
        const safeUrl = sanitizeUrl(linkMatch[2]);
        elements.push(
          <div key={i} className="mt-4 mb-1">
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-bold text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1.5"
            >
              <span>🚀 {title}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        );
      } else {
        elements.push(
          <h3 key={i} className="text-sm font-bold text-slate-200 mt-4 mb-2">
            {trimmed.replace(/^###\s+/, '')}
          </h3>
        );
      }
      continue;
    }

    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote
          key={i}
          className="my-2 p-3 rounded-xl bg-slate-900 border-l-4 border-indigo-500 text-slate-300 italic text-xs sm:text-sm"
        >
          {trimmed.replace(/^>\s*/, '')}
        </blockquote>
      );
      continue;
    }

    if (trimmed.includes('img.shields.io')) {
      const badgeMatches = Array.from(trimmed.matchAll(/!\[(.*?)\]\((https:\/\/img\.shields\.io\/[^\s)]+)\)/g));
      if (badgeMatches.length > 0) {
        elements.push(
          <div key={i} className="flex flex-wrap gap-2 my-2">
            {badgeMatches.map((m, bIdx) => (
              <img key={bIdx} src={m[2]} alt={m[1]} className="h-6 rounded" loading="lazy" />
            ))}
          </div>
        );
        continue;
      }
    }

    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-slate-300 text-xs my-1">
          {trimmed.replace(/^[-*]\s+/, '')}
        </li>
      );
      continue;
    }

    elements.push(
      <p key={i} className="text-xs sm:text-sm text-slate-300 my-1 leading-relaxed">
        {trimmed}
      </p>
    );
  }

  if (inTable) {
    flushTable(lines.length);
  }

  return <div className="space-y-2">{elements}</div>;
};

export const ProfileMakeoverModal: React.FC<ProfileMakeoverModalProps> = ({
  isOpen,
  onClose,
  report,
}) => {
  const modalTitleId = useId();
  const textareaId = useId();

  const { containerRef } = useDialogAccessibility({ isOpen, onClose });

  // Generate initial markdown & suggestions from verified facts
  const generatedResult = useMemo(() => {
    return generateProfileReadme(report.facts, { isMockData: report.isMockData });
  }, [report.facts, report.isMockData]);

  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [markdown, setMarkdown] = useState<string>(generatedResult.markdown);
  const [copied, setCopied] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  // Edits belong to one profile: never carry a previous profile's README into a new one
  const [factsForDraft, setFactsForDraft] = useState(report.facts);
  if (factsForDraft !== report.facts) {
    setFactsForDraft(report.facts);
    setMarkdown(generatedResult.markdown);
    setActiveTab('editor');
    setCopied(false);
    setShowSuggestions(true);
  }

  if (!isOpen) return null;

  const isModified = markdown !== generatedResult.markdown;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(markdown);
      } else {
        // Fallback for non-secure contexts or strict iframe environments
        const tempTextarea = document.createElement('textarea');
        tempTextarea.value = markdown;
        tempTextarea.style.position = 'fixed';
        tempTextarea.style.opacity = '0';
        document.body.appendChild(tempTextarea);
        tempTextarea.focus();
        tempTextarea.select();
        document.execCommand('copy');
        document.body.removeChild(tempTextarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback failed
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'README.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Delayed URL revocation ensures browser processes the download pipeline
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch {
      // Ignore download errors
    }
  };

  const handleReset = () => {
    setMarkdown(generatedResult.markdown);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
      role="presentation"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={modalTitleId}
        className="w-full max-w-4xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-7 flex flex-col max-h-[92vh] overflow-hidden focus:outline-none"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id={modalTitleId} className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  GitHub Profile Makeover
                </h3>
                {report.isMockData ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/60 border border-amber-600/40 text-amber-300">
                    SAMPLE DEMO DATA
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/60 border border-emerald-600/40 text-emerald-300">
                    VERIFIED DATA ONLY
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Personalized, copy-ready <code className="text-indigo-300 font-mono">README.md</code> for{' '}
                <span className="text-slate-200 font-semibold font-mono">@{report.facts.username}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close Profile Makeover dialog"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Missing Information & Optimization Callout Banner */}
        {generatedResult.missingSuggestions.length > 0 && (
          <div className="mt-4 p-3.5 rounded-2xl bg-amber-950/30 border border-amber-600/40 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {generatedResult.missingSuggestions.length} Recommended Profile Optimization
                  {generatedResult.missingSuggestions.length > 1 ? 's' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSuggestions(!showSuggestions)}
                className="text-[11px] text-amber-300/80 hover:text-amber-200 underline"
              >
                {showSuggestions ? 'Hide details' : 'Show details'}
              </button>
            </div>

            {showSuggestions && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {generatedResult.missingSuggestions.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-start gap-2"
                  >
                    <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-slate-200 text-[11px]">{item.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{item.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Controls & Editor Header */}
        <div className="flex items-center justify-between pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition ${
                activeTab === 'editor'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Editable Markdown</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition ${
                activeTab === 'preview'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Live Preview</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            {isModified && (
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition px-2 py-1 rounded-lg hover:bg-slate-800"
                title="Reset edits to original generated template"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
            <span className="font-mono text-[11px] text-slate-400">
              {markdown.length} chars • {markdown.split('\n').length} lines
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div className="my-2 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 flex flex-col">
          {activeTab === 'editor' ? (
            <div className="relative flex-1 flex flex-col h-full">
              <label htmlFor={textareaId} className="sr-only">
                Editable GitHub Profile README Markdown
              </label>
              <textarea
                id={textareaId}
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                spellCheck="false"
                className="w-full flex-1 p-4 bg-transparent font-mono text-xs sm:text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-0 leading-relaxed overflow-y-auto selection:bg-indigo-600/30"
              />
            </div>
          ) : (
            <div className="p-5 overflow-y-auto h-full text-slate-200 text-xs sm:text-sm space-y-4 leading-relaxed">
              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-800/40 text-xs text-indigo-200 flex items-center justify-between">
                <span>
                  Previewing rendered GitHub Profile README. Switch to <strong>Editable Markdown</strong> to tweak.
                </span>
                <span className="font-mono text-[11px] text-indigo-400">README.md</span>
              </div>
              <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 font-sans">
                <SafeMarkdownPreview markdown={markdown} />
              </div>
            </div>
          )}
        </div>

        {/* Activation Guide Tip */}
        <div className="pt-2 pb-1 shrink-0 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-indigo-400">How to activate:</span>
            <span className="truncate">
              Create a public repo named <code className="text-slate-200 font-mono">@{report.facts.username}</code> and push this <code className="text-slate-200 font-mono">README.md</code>.
            </span>
          </div>
          <a
            href={`https://github.com/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 shrink-0 ml-2"
          >
            <span>Create repo</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            <FileDown className="w-4 h-4 text-indigo-400" />
            <span>Download README.md</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md transition"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied to Clipboard!' : 'Copy README.md'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
