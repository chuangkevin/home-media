/**
 * 格式化秒數為時長字串
 * @param seconds 秒數
 * @returns 格式化的時長字串，例如 "3:45" 或 "1:02:30"
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化數字（例如觀看次數）
 * @param num 數字
 * @returns 格式化的字串，例如 "1.2M", "350K"
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * 格式化檔案大小
 * @param bytes 位元組數
 * @returns 格式化的字串，例如 "1.2 GB", "350.5 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1073741824) { // 1 GB
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }
  if (bytes >= 1048576) { // 1 MB
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  if (bytes >= 1024) { // 1 KB
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * 格式化日期時間
 * @param timestamp Unix 時間戳（毫秒）
 * @returns 格式化的日期字串
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
