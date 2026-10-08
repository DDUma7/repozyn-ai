/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const GITHUB_TOKEN_REGEX = /^[A-Za-z0-9_]{1,255}$/

/**
 * Serves /api/github/* in development with the SAME request handler as production (server.js).
 *
 * There is deliberately no separate development proxy. A second implementation would have to
 * re-create every protection (public-only checks before the server token reads repository data,
 * response field allowlists, token isolation, rate limits, size caps, redirect refusal), and any
 * gap would let an unauthenticated request on the dev port read private data with the
 * developer's token. Reusing the production handler keeps the two environments identical.
 */
function githubProxy(apiBase: string, serverToken: string): Plugin {
  return {
    name: 'repozyn-github-proxy',
    async configureServer(server) {
      // The handler reads its configuration from the environment once, when it is first loaded.
      // The token is passed to it this way only; it is never exposed to browser code.
      if (serverToken) process.env.GITHUB_TOKEN = serverToken
      else delete process.env.GITHUB_TOKEN
      process.env.GITHUB_API_BASE_URL = apiBase

      const { handleGitHubApiRequest } = await import('./server.js')

      server.middlewares.use((req, res, next) => {
        handleGitHubApiRequest(req, res)
          .then((handled) => {
            if (!handled) next()
          })
          .catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
            }
            res.end(JSON.stringify({ error: 'Internal Server Error' }))
          })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // GITHUB_TOKEN may come from the shell or from a git-ignored .env.local. It is read here, in
  // Node, for the proxy only. It has no VITE_ prefix, so Vite never exposes it to browser code.
  const env = loadEnv(mode, process.cwd(), '')
  const rawServerToken = (env.GITHUB_TOKEN || '').trim()
  const serverToken = GITHUB_TOKEN_REGEX.test(rawServerToken) ? rawServerToken : ''
  const apiBase = (env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '')

  return {
    // The proxy plugin is not needed (and its handler is not loaded) while running unit tests
    plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : [githubProxy(apiBase, serverToken)])],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
