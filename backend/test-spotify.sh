#!/bin/bash

# Spotify API Integration Test Script
# This script tests the Spotify API endpoints

BASE_URL="http://localhost:3001/api"

echo "🎵 Testing Spotify API Integration"
echo "=================================="

# 1. Check Spotify configuration status
echo ""
echo "1️⃣ Checking Spotify API status..."
curl -s "${BASE_URL}/spotify/status" | json_pp

# 2. Get available genres (if any tracks are enriched)
echo ""
echo "2️⃣ Fetching available genres..."
curl -s "${BASE_URL}/recommendations/genres" | json_pp

# Example: Enrich a specific track (uncomment and replace VIDEO_ID)
# VIDEO_ID="dQw4w9WgXcQ"
# echo ""
# echo "3️⃣ Enriching track ${VIDEO_ID}..."
# curl -X POST -s "${BASE_URL}/spotify/enrich/${VIDEO_ID}" | json_pp

# Example: Get recommendations for a track (uncomment and replace VIDEO_ID)
# VIDEO_ID="dQw4w9WgXcQ"
# echo ""
# echo "4️⃣ Getting recommendations for ${VIDEO_ID}..."
# curl -s "${BASE_URL}/recommendations/similar/${VIDEO_ID}?limit=5" | json_pp

# Example: Get tracks by genre (uncomment and replace GENRE)
# GENRE="pop"
# echo ""
# echo "5️⃣ Getting tracks in genre: ${GENRE}..."
# curl -s "${BASE_URL}/recommendations/genre/${GENRE}?limit=10" | json_pp

echo ""
echo "✅ Test complete!"
echo ""
echo "To test enrichment, first play some songs in the app, then:"
echo "  1. Get video IDs from /api/history/searches"
echo "  2. Call POST /api/spotify/enrich/:videoId for each track"
echo "  3. Or use batch enrichment: POST /api/spotify/enrich-batch with {\"videoIds\": [...]}"
echo ""
echo "For detailed setup instructions, see: backend/SPOTIFY_INTEGRATION.md"
