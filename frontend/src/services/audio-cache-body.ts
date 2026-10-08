export const MAX_AUDIO_BODY_BYTES = 128 * 1024 * 1024

/** Bound optional background downloads before constructing an in-memory Blob. */
export async function readAudioCacheBody(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_AUDIO_BODY_BYTES
): Promise<Blob> {
  const advertised = Number(response.headers.get('content-length'))
  if (advertised > maxBytes) {
    await response.body?.cancel()
    throw new Error('Audio download exceeds body budget')
  }
  if (!response.body) throw new Error('Audio download body unavailable')
  const reader = response.body.getReader()
  const parts: ArrayBuffer[] = []
  let size = 0
  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Audio download cancelled', 'AbortError')
      const { value, done } = await reader.read()
      if (signal.aborted) throw new DOMException('Audio download cancelled', 'AbortError')
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('Audio download exceeds body budget')
      parts.push(new Uint8Array(value).buffer)
    }
    return new Blob(parts, { type: response.headers.get('content-type') || '' })
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
