/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api/github': {
        target: 'https://api.github.com',
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
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
