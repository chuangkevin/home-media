# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install all dependencies (including devDependencies for TypeScript)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install required dependencies:
# - ffmpeg: audio processing (yt-dlp)
# - python3, py3-pip: for installing latest yt-dlp
# - make, g++: native module compilation (better-sqlite3)
# - ca-certificates: SSL/TLS support
# - curl, gcompat: for Deno installation (JS runtime required by yt-dlp for YouTube)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    make \
    g++ \
    ca-certificates \
    curl \
    gcompat \
    && update-ca-certificates \
    && pip3 install --break-system-packages "yt-dlp[default]" \
    && (curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh || echo "⚠️ Deno install failed, will use Node.js as JS runtime fallback")

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

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
