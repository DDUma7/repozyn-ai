import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Handles a request for the GitHub proxy (/api/github/*) with the production rules.
 * Resolves to false when the request is for something else.
 */
export function handleGitHubApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
