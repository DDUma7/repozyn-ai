# Multi-stage build for Google Cloud Run
# Stage 1: Build the Vite React TypeScript application
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies (utilizing layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build production assets
COPY . .
RUN npm run build

# Stage 2: Production runner with minimal image footprint
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy production static server and compiled static assets
COPY server.js ./
COPY --from=builder /app/dist ./dist

# Run as non-root user for container security
USER node

# Expose default Cloud Run port
EXPOSE 8080

# Health check compatible with Cloud Run container lifecycle
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

CMD ["node", "server.js"]
