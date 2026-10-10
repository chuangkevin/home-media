export function isLyricsWithinAudioDuration(lines: Array<{ time: number; text: string }>, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(lines) || !lines.length) return false;
  return lines.every((line, index) => typeof line.text === 'string' && !!line.text.trim()
    && Number.isFinite(line.time) && line.time >= 0 && line.time <= duration + 3
    && (index === 0 || line.time >= lines[index - 1].time));
}
