#!/bin/bash
# Deploy script for Raspberry Pi (arm64)
# Run this script on your Raspberry Pi

set -e

echo "=== Home Media - RPi Deployment ==="

# Pull latest images and start containers
echo "Pulling latest images and starting containers..."
docker compose -f docker-compose.rpi.yml pull
docker compose -f docker-compose.rpi.yml up -d

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=== Deployment Complete ==="
echo "Frontend: http://${LOCAL_IP}"
echo "Backend API: http://${LOCAL_IP}:3001 (internal use)"
echo ""
echo "Data volumes:"
echo "  - home-media-cache (music cache)"
echo "  - home-media-db (database)"
echo ""
echo "View logs: docker compose -f docker-compose.rpi.yml logs -f"
echo "Stop: docker compose -f docker-compose.rpi.yml down"
