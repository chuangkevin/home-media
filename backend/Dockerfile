# The npm installer uses this verified official release in both stages.
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
ARG YT_DLP_VERSION

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install all dependencies (including devDependencies for TypeScript)
COPY package*.json ./
RUN YOUTUBE_DL_HOST="https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/${YT_DLP_VERSION}" npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app
ARG YT_DLP_VERSION
ARG YT_DLP_SHA256

# Install ffmpeg for audio processing (yt-dlp dependency)
# Also install ca-certificates for SSL/TLS support
RUN apk add --no-cache ffmpeg python3 make g++ ca-certificates && \
    update-ca-certificates

# Copy package files and install production dependencies only
COPY package*.json ./
RUN YOUTUBE_DL_HOST="https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/${YT_DLP_VERSION}" npm ci --omit=dev

# Compile the same downloaded source during image build instead of parsing its
# compressed Python source on every cold playback. Preserve the zip CLI entry.
COPY scripts/prepare-yt-dlp.py ./scripts/prepare-yt-dlp.py
RUN python3 scripts/prepare-yt-dlp.py \
    --archive node_modules/youtube-dl-exec/bin/yt-dlp \
    --sha256 "${YT_DLP_SHA256}" --version "${YT_DLP_VERSION}"

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create data directories
RUN mkdir -p /app/data/cache /app/data/db /app/logs

# Expose ports
EXPOSE 3001 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/server.js"]
