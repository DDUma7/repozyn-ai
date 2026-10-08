import type { RateLimitInfo } from '../types/github';

export function quotaLabel(info: RateLimitInfo): string {
  switch (info.source) {
    case 'proxy-request': return 'App per-IP request budget';
    case 'proxy-ip': return 'App per-IP lookup budget';
    case 'proxy-global': return 'App shared lookup budget';
    case 'proxy-concurrency': return 'App concurrency limit';
    case 'unknown': return 'Quota unavailable';
    default: return info.authSource === 'server' ? 'Shared server GitHub quota' : info.authSource === 'client' ? 'Your GitHub quota' : info.authSource === 'anonymous' ? 'Anonymous GitHub quota' : 'GitHub API';
  }
}

export function quotaDeadline(info: RateLimitInfo): number {
  return Math.max(info.retryAt || 0, info.limitKind === 'secondary' ? 0 : info.reset * 1000);
}

export function quotaIsFresh(info: RateLimitInfo): boolean {
  return info.known !== false && !info.cached && (!info.observedAt || Date.now() - info.observedAt < 60_000) && (!info.reset || info.reset * 1000 > Date.now());
}

export function repositoryQuotaMatches(info: RateLimitInfo): boolean {
  return !info.repositoryAuthSource || (info.repositoryAuthSource !== 'unknown' && info.repositoryAuthSource === info.authSource);
}

export function canInspectWithQuota(info: RateLimitInfo | null | undefined, cost: number): boolean {
  if (!info) return true;
  // A confirmed backoff is respected even when the numeric primary quota is unknown/stale.
  if (info.retryAt && info.retryAt > Date.now()) return false;
  if (!repositoryQuotaMatches(info) || !quotaIsFresh(info)) return true;
  return info.remaining >= cost;
}

export function mergeQuotaObservation(current: RateLimitInfo | null, incoming: RateLimitInfo): RateLimitInfo {
  // An in-flight success or periodic quota answer is not permission to ignore confirmed backoff.
  if (current?.retryAt && current.retryAt > Date.now() && (!incoming.retryAt || incoming.retryAt < current.retryAt)) return current;
  if (incoming.cached) return current ?? incoming;
  if (current?.observedAt && incoming.observedAt && incoming.observedAt < current.observedAt) return current;
  return incoming;
}

export function quotaMessage(info: RateLimitInfo): string {
  if (info.limitKind === 'permission') return 'GitHub denied access to this resource; this is not a confirmed rate-limit failure.';
  const seconds = Math.max(0, Math.ceil((quotaDeadline(info) - Date.now()) / 1000));
  const wait = seconds ? ` Retry in ${seconds < 60 ? `${seconds} seconds` : `about ${Math.ceil(seconds / 60)} min`}${info.limitKind !== 'secondary' && info.resetTimeFormatted ? ` (at ${info.resetTimeFormatted})` : ''}.` : ' Retry later; no reset time was supplied.';
  if (info.limitKind === 'secondary') return `GitHub secondary rate limiting temporarily paused requests.${wait} Primary quota last reported: ${info.known !== false ? info.remaining : 'unknown'}.`;
  if (info.limitKind === 'primary' && info.retryAt && info.retryAt > Date.now()) return `${quotaLabel(info)} rate limit exceeded: ${info.remaining}/${info.limit} requests last observed remaining.${wait} Try instant Demo Personas while waiting.`;
  if (info.source?.startsWith('proxy-')) return `${quotaLabel(info)} reached.${wait} This is an application limit, not GitHub's primary quota.`;
  if (!quotaIsFresh(info)) return `Current GitHub quota is unknown${info.cached ? ' because this is cached audit data' : ''}.${wait}`;
  return `${quotaLabel(info)}${info.limitKind === 'primary' || info.remaining === 0 ? ' rate limit exceeded' : ''}: ${info.remaining}/${info.limit} requests remaining.${wait} Try instant Demo Personas while waiting.`;
}
