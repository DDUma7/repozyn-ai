import { useState } from 'react';
import type React from 'react';
import {
  FolderGit2,
  Star,
  ExternalLink,
  Shield,
  Globe,
  AlertCircle,
  Search,
} from 'lucide-react';
import type { GitHubRepo } from '../types/github';
import { recommendRepository } from '../utils/repozynVerdict';

interface RepositoryExplorerProps {
  repos: GitHubRepo[];
}

export const RepositoryExplorer: React.FC<RepositoryExplorerProps> = ({ repos }) => {
  const [filter, setFilter] = useState<'all' | 'original' | 'forks' | 'no-desc' | 'has-demo'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'stars' | 'updated' | 'name'>('stars');

  const filteredRepos = repos
    .filter((repo) => {
      if (filter === 'original') return !repo.fork;
      if (filter === 'forks') return repo.fork;
      if (filter === 'no-desc') return !repo.description || repo.description.trim().length === 0;
      if (filter === 'has-demo') return Boolean((repo.homepage && repo.homepage.trim().length > 0) || repo.has_pages);
      return true;
    })
    .filter((repo) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        repo.name.toLowerCase().includes(q) ||
        (repo.description && repo.description.toLowerCase().includes(q)) ||
        (repo.language && repo.language.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      if (sortBy === 'stars') return (b.stargazers_count || 0) - (a.stargazers_count || 0);
      if (sortBy === 'updated') {
        const timeA = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
        const timeB = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
        return timeB - timeA;
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl p-6 sm:p-8 backdrop-blur-xl relative">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl sm:text-2xl font-extrabold text-white">Repository Health Explorer</h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Auditing {repos.length} public repositories. Click any repo to view directly on GitHub.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Recommendation labels reflect metadata only; code and links are not verified.</p>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Quick Search */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repos..."
              aria-label="Filter repositories by keyword or language"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Sort repositories by criteria"
            className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none"
          >
            <option value="stars">Sort by Stars</option>
            <option value="updated">Sort by Recent Push</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6 text-xs">
        {[
          { id: 'all', label: `All (${repos.length})` },
          { id: 'original', label: `Not Forks (${repos.filter((r) => !r.fork).length})` },
          { id: 'forks', label: `Forks (${repos.filter((r) => r.fork).length})` },
          {
            id: 'no-desc',
            label: `Missing Description (${repos.filter((r) => !r.description || !r.description.trim()).length})`,
          },
          {
            id: 'has-demo',
            label: `Live Demos (${repos.filter((r) => r.homepage || r.has_pages).length})`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={filter === tab.id}
            onClick={() => setFilter(tab.id as any)}
            className={`px-3 py-1.5 rounded-xl transition ${
              filter === tab.id
                ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30'
                : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Repo List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1">
        {filteredRepos.length === 0 ? (
          <div className="col-span-2 p-8 text-center rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 text-sm">
            No repositories match this filter.
          </div>
        ) : (
          filteredRepos.map((repo) => {
            const recommendation = recommendRepository(repo);
            const hasDescription = Boolean(repo.description && repo.description.trim().length > 0);
            const hasLicense = Boolean(repo.license);
            const hasDemo = Boolean((repo.homepage && repo.homepage.trim().length > 0) || repo.has_pages);
            const pushedDate = repo.pushed_at
              ? new Date(repo.pushed_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Unknown';

            return (
              <div
                key={repo.id}
                className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between group"
              >
                <div>
                  {recommendation && (
                    <span className={`mb-2 inline-block rounded-md border px-2 py-1 text-[11px] font-semibold ${recommendation.label === 'Showcase candidate' ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/25 bg-amber-500/10 text-amber-300'}`}>
                      {recommendation.label}<span className="sr-only">: {recommendation.reason}</span>
                    </span>
                  )}
                  {/* Repo title + GitHub Link */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-sm text-indigo-300 hover:text-indigo-200 group-hover:underline flex items-center gap-1.5 truncate"
                    >
                      <span>{repo.name}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>

                    <div className="flex items-center gap-2 shrink-0">
                      {repo.fork && (
                        <span className="px-1.5 py-0.5 rounded text-[11px] bg-slate-800 text-slate-400 font-medium">
                          Fork
                        </span>
                      )}
                      <div className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                        <Star className="w-3 h-3 fill-amber-400" />
                        <span>{repo.stargazers_count}</span>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <p
                    className={`text-xs leading-relaxed line-clamp-2 mb-3 ${
                      hasDescription ? 'text-slate-300' : 'text-slate-400 italic'
                    }`}
                  >
                    {hasDescription ? (
                      repo.description
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-400/90">
                        <AlertCircle className="w-3 h-3" />
                        No description provided (recruiter friction)
                      </span>
                    )}
                  </p>
                </div>

                {/* Footer Badges & Metadata */}
                <div className="pt-3 border-t border-slate-900 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-3">
                    {repo.language && (
                      <span className="font-medium text-slate-300">{repo.language}</span>
                    )}
                    {hasLicense ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Shield className="w-3 h-3" />
                        {repo.license?.spdx_id || 'Licensed'}
                      </span>
                    ) : (
                      <span className="text-slate-400">No license</span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {hasDemo && (
                      <a
                        href={repo.homepage || repo.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-cyan-400 hover:underline"
                        title="Live Demo Preview"
                      >
                        <Globe className="w-3 h-3" />
                        <span>Demo</span>
                      </a>
                    )}
                    <span className="text-[11px] text-slate-400">Pushed {pushedDate}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
