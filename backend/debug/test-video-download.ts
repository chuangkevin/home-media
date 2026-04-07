import videoCacheService from '../src/services/video-cache.service';
import youtubeService from '../src/services/youtube.service';
import * as fs from 'fs';
import * as path from 'path';

async function test() {
  const videoId = 'dQw4w9WgXcQ'; // Rickroll
  console.log(`🧪 Testing video download for ${videoId}...`);
  
  const result = await videoCacheService.download(videoId);
  if (result) {
    console.log(`✅ Success! Video saved at: ${result}`);
    const stats = fs.statSync(result);
    console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log(`❌ Failed to download video.`);
  }
}

test().catch(console.error);
