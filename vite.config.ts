/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { ClientRequest, IncomingMessage } from 'node:http'

const GITHUB_TOKEN_REGEX = /^[A-Za-z0-9_]{1,255}$/

/**
 * Mirrors the production proxy (server.js): a token the user entered in the app arrives as
 * `x-github-token` and is forwarded to GitHub as `Authorization`, taking priority over the
 * optional server-side GITHUB_TOKEN. The token is never logged or stored.
 */
export function forwardClientGitHubToken(
  proxyReq: Pick<ClientRequest, 'setHeader' | 'removeHeader'>,
  req: Pick<IncomingMessage, 'headers'>,
) {
  const raw = req.headers['x-github-token']
  const clientToken = (Array.isArray(raw) ? raw[0] : raw || '').trim()
  proxyReq.removeHeader('x-github-token')
  if (clientToken && GITHUB_TOKEN_REGEX.test(clientToken)) {
    proxyReq.setHeader('Authorization', `Bearer ${clientToken}`)
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api/github': {
        target: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
        changeOrigin: true,
        rewrite: (path) => {
          if (path === '/api/github/rate_limit') return '/rate_limit';
          if (path.startsWith('/api/github/user/')) return `/users/${path.replace('/api/github/user/', '')}`;
          if (path.startsWith('/api/github/repos/')) return `/users/${path.replace('/api/github/repos/', '')}/repos?per_page=100&sort=updated&direction=desc`;
          return path.replace(/^\/api\/github/, '');
        },
        headers: process.env.GITHUB_TOKEN ? {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        } : {},
        configure: (proxy) => {
          proxy.on('proxyReq', forwardClientGitHubToken);
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
