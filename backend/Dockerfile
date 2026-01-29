# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3, canvas for jsdom)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    # canvas/jsdom dependencies for youtube-po-token-generator
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev

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
# - python3, make, g++: native module compilation
# - ca-certificates: SSL/TLS support
# - canvas dependencies for youtube-po-token-generator (both build and runtime)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    ca-certificates \
    # canvas build dependencies (for npm ci native module compilation)
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    && update-ca-certificates

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
