# 🎵 Spotify Integration for Genre Recommendations

This document explains how to set up Spotify API integration for enhanced music recommendations.

## Features

With Spotify integration enabled, the application can:

- **Genre Classification**: Automatically identify music genres for tracks
- **Audio Features Analysis**: Get detailed audio metrics (danceability, energy, tempo, valence, etc.)
- **Smart Recommendations**: Generate similarity-based recommendations using audio features
- **Genre Browsing**: Browse your library by genre
- **Better Matching**: Match YouTube tracks with official Spotify catalog

## Setup Instructions

### 1. Create Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account (free account works)
3. Click **"Create App"**
4. Fill in the details:
   - **App Name**: Home Media Center (or any name you like)
   - **App Description**: Personal music library management
   - **Redirect URIs**: `http://localhost:3001/callback` (not used for Client Credentials flow, but required)
   - **APIs Used**: Web API
5. Click **"Save"**

### 2. Get API Credentials

1. In your app dashboard, click **"Settings"**
2. Copy your **Client ID**
3. Click **"View client secret"** and copy your **Client Secret**
4. Keep these credentials secure!

### 3. Configure Environment Variables

Edit your `backend/.env` file:

```bash
# Spotify API Configuration
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
```

### 4. Restart the Backend

```bash
cd backend
npm run dev
```

You should see this log message if configured correctly:
```
✅ Spotify access token obtained
```

If not configured, you'll see:
```
⚠️ Spotify API credentials not configured. Recommendation features will be limited.
```

## API Endpoints

### Check Configuration Status

```bash
GET /api/spotify/status
```

Response:
```json
{
  "configured": true,
  "message": "Spotify API is configured and ready"
}
```

### Enrich a Single Track

```bash
POST /api/spotify/enrich/:videoId
```

This will:
1. Search for the track on Spotify
2. Get genres from artist metadata
3. Fetch audio features (13 metrics)
4. Store in database for future recommendations

Response:
```json
{
  "message": "Track enriched successfully",
  "videoId": "dQw4w9WgXcQ",
  "spotifyId": "4PTG3Z6ehGkBFwjybzWkR8",
  "matchScore": 0.95,
  "genres": ["pop", "dance pop"],
  "audioFeatures": {
    "danceability": 0.748,
    "energy": 0.652,
    "valence": 0.543,
    "tempo": 113.0,
    ...
  }
}
```

### Batch Enrich Multiple Tracks

```bash
POST /api/spotify/enrich-batch
Content-Type: application/json

{
  "videoIds": ["dQw4w9WgXcQ", "9bZkp7q19f0", ...]
}
```

Response:
```json
{
  "total": 50,
  "enriched": 42,
  "skipped": 5,
  "failed": 3,
  "details": [...]
}
```

### Get Track Metadata

```bash
GET /api/spotify/track/:videoId
```

Returns all stored metadata including Spotify genres and audio features.

### Get Similar Tracks (Recommendations)

```bash
GET /api/recommendations/similar/:videoId?limit=10
```

Returns tracks with similar genres and audio features.

Response:
```json
{
  "recommendations": [
    {
      "videoId": "abc123",
      "title": "Similar Song",
      "channelName": "Artist Name",
      "thumbnail": "https://...",
      "score": 0.85,
      "reasons": ["共同曲風: pop, dance pop", "音樂特徵相似"]
    },
    ...
  ]
}
```

### Browse by Genre

```bash
GET /api/recommendations/genre/pop?limit=20
```

Returns tracks in a specific genre.

### Get All Genres

```bash
GET /api/recommendations/genres
```

Returns all available genres with track counts:

```json
{
  "genres": [
    { "genre": "pop", "count": 150 },
    { "genre": "rock", "count": 87 },
    ...
  ],
  "total": 45
}
```

## How It Works

### 1. Track Matching

When enriching a track:
1. Clean YouTube title (remove "Official Video", "Lyrics", etc.)
2. Search Spotify: `track:{title} artist:{channel_name}`
3. Calculate match scores using string similarity
4. Accept matches with score > 0.5

### 2. Audio Features

Spotify provides 13 audio analysis metrics:

- **Danceability** (0.0 - 1.0): How suitable for dancing
- **Energy** (0.0 - 1.0): Intensity and activity
- **Valence** (0.0 - 1.0): Musical positiveness (happiness)
- **Tempo** (BPM): Speed of the track
- **Acousticness** (0.0 - 1.0): Acoustic vs electric
- **Instrumentalness** (0.0 - 1.0): Vocal vs instrumental
- **Speechiness** (0.0 - 1.0): Presence of spoken words
- **Liveness** (0.0 - 1.0): Audience presence
- **Loudness** (dB): Overall loudness
- **Key** (0-11): Musical key
- **Mode** (0-1): Major or minor
- **Duration** (ms): Track length
- **Time Signature**: Beats per bar

### 3. Similarity Calculation

Recommendations are scored using:

- **40%** - Genre matching (Jaccard index)
- **30%** - Audio features distance (Euclidean)
- **20%** - Tag overlap
- **10%** - Same channel bonus

## Usage Workflow

### Initial Setup

1. Configure Spotify API credentials
2. Play some songs in your app (build up cached_tracks)
3. Enrich tracks with Spotify metadata:

```bash
# Get all video IDs from your library
GET /api/history/searches

# Batch enrich (example with curl)
curl -X POST http://localhost:3001/api/spotify/enrich-batch \
  -H "Content-Type: application/json" \
  -d '{"videoIds": ["video1", "video2", ...]}'
```

### Using Recommendations

Once tracks are enriched:

```bash
# Get similar tracks
GET /api/recommendations/similar/dQw4w9WgXcQ?limit=10

# Browse by genre
GET /api/recommendations/genres
GET /api/recommendations/genre/pop?limit=20
```

## Limitations

### Rate Limits

- **Free Spotify Account**: 
  - Client Credentials flow: No specific limit, but stay reasonable
  - Approximately 100 requests per minute is safe
  
- **Batch enrichment**: Built-in 100ms delay between requests

### Matching Accuracy

- **High accuracy** (>0.8): Official releases, popular tracks
- **Medium accuracy** (0.5-0.8): Covers, remixes, alternate versions
- **No match** (<0.5 or not found): 
  - Unreleased tracks
  - Regional exclusives
  - User-generated content
  - Non-music content (podcasts, audiobooks)

### Audio Features Not Available For

- Podcasts and audiobooks
- Very new releases (before Spotify analysis)
- Tracks without Spotify catalog entry

## Troubleshooting

### "Spotify API not configured"

**Solution**: Check `.env` file has both `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` set.

### "Failed to authenticate with Spotify"

**Possible causes**:
- Invalid credentials
- Network issues
- Spotify API down

**Solution**: 
1. Verify credentials on developer dashboard
2. Check server logs for detailed error
3. Test credentials manually:

```bash
curl -X POST "https://accounts.spotify.com/api/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -u "CLIENT_ID:CLIENT_SECRET"
```

### "No matching track found on Spotify"

This is normal for:
- Non-music content
- Unreleased tracks
- Regional exclusives

The app will continue working without Spotify enrichment for these tracks.

### Low match scores

If getting many low match scores (<0.6):
- YouTube title format may be unusual
- Check `channel_name` is correct
- Manual enrichment may be needed

## Optional: Manual Enrichment

If automatic matching fails, you can manually set Spotify IDs in the database:

```sql
UPDATE cached_tracks 
SET spotify_id = 'actual_spotify_track_id'
WHERE video_id = 'youtube_video_id';
```

Then call `/api/spotify/enrich/:videoId` again to fetch audio features.

## Privacy & Data

- **What's sent to Spotify**: Track title and artist name (for search)
- **What's stored**: Spotify track ID, genres, audio features
- **No user data**: Client Credentials flow doesn't access user playlists
- **Offline**: Once enriched, recommendations work without Spotify API

## Future Enhancements

Potential improvements:
- Auto-enrichment on track add
- Playlist generation by mood (using valence + energy)
- Tempo-based workout playlists
- Genre explorer UI
- "Discover Weekly" style recommendations
- Audio feature visualization (radar charts)

---

For more info, see:
- [Spotify Web API Docs](https://developer.spotify.com/documentation/web-api)
- [Audio Features Reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features)
