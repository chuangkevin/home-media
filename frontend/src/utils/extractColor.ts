/**
 * Extract dominant color from an image URL using Canvas API.
 * Returns hex color string or null on failure.
 */

const colorCache = new Map<string, string | null>();

export async function extractDominantColor(imageUrl: string, cacheKey?: string): Promise<string | null> {
  const key = cacheKey || imageUrl;
  if (colorCache.has(key)) {
    return colorCache.get(key)!;
  }

  try {
    const color = await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 50; // Sample at small size for performance
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }

          ctx.drawImage(img, 0, 0, size, size);
          const imageData = ctx.getImageData(0, 0, size, size).data;

          // Count hue buckets (12 buckets of 30 degrees each)
          const hueBuckets = new Array(12).fill(0);
          const hueColors: string[][] = Array.from({ length: 12 }, () => []);

          for (let i = 0; i < imageData.length; i += 16) { // Sample every 4th pixel
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];

            // Skip near-black and near-white
            if (r < 30 && g < 30 && b < 30) continue;
            if (r > 225 && g > 225 && b > 225) continue;

            // Skip low saturation (grayscale)
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max - min < 30) continue;

            // Compute hue
            const d = max - min;
            let h = 0;
            if (max === r) h = ((g - b) / d + 6) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;

            const bucket = Math.floor(h / 30) % 12;
            hueBuckets[bucket]++;
            hueColors[bucket].push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
          }

          // Find the most common hue bucket
          let maxBucket = 0;
          let maxCount = 0;
          for (let i = 0; i < 12; i++) {
            if (hueBuckets[i] > maxCount) {
              maxCount = hueBuckets[i];
              maxBucket = i;
            }
          }

          if (maxCount === 0) {
            resolve(null);
            return;
          }

          // Return the middle color from the winning bucket
          const colors = hueColors[maxBucket];
          resolve(colors[Math.floor(colors.length / 2)]);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);

      // Timeout after 3 seconds
      setTimeout(() => resolve(null), 3000);
      img.src = imageUrl;
    });

    colorCache.set(key, color);
    return color;
  } catch {
    colorCache.set(key, null);
    return null;
  }
}
