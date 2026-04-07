import { Response } from 'express';
import { ChildProcess, spawn, execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import audioCacheService from './audio-cache.service';
import youtubeService from './youtube.service';
import logger from '../utils/logger';

export interface QueueTrack {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
}

interface Session {
  id: string;
  queue: QueueTrack[];
  currentTrack: QueueTrack | null;
  streamResponse: Response | null;
  ffmpegProcess: ChildProcess | null;
  sseClients: Set<Response>;
  /** Date.now() when current ffmpeg segment started */
  segmentStartedAt: number | null;
  /** seek offset at start of current segment */
  seekOffset: number;
  isActive: boolean;
  positionTimer: ReturnType<typeof setInterval> | null;
}

class ContinuousStreamService {
  private sessions = new Map<string, Session>();
  private ffmpegPath: string | null = null;

  constructor() {
    this.detectFfmpeg();
  }

  private detectFfmpeg(): void {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'pipe', timeout: 3000 });
      this.ffmpegPath = 'ffmpeg';
      logger.info('[ContinuousStream] Using system ffmpeg');
    } catch {
      try {
        this.ffmpegPath = require('ffmpeg-static') as string;
        logger.info(`[ContinuousStream] Using ffmpeg-static: ${this.ffmpegPath}`);
      } catch {
        logger.warn('[ContinuousStream] ffmpeg not found — continuous stream unavailable');
      }
    }
  }

  createSession(): string {
    const id = randomUUID();
    const session: Session = {
      id,
      queue: [],
      currentTrack: null,
      streamResponse: null,
      ffmpegProcess: null,
      sseClients: new Set(),
      segmentStartedAt: null,
      seekOffset: 0,
      isActive: true,
      positionTimer: null,
    };
    this.sessions.set(id, session);

    session.positionTimer = setInterval(() => this.broadcastPosition(session), 1000);

    logger.info(`[ContinuousStream] Session created: ${id}`);
    return id;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  addToQueue(sessionId: string, tracks: QueueTrack[]): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return false;

    session.queue.push(...tracks);
    logger.info(`[ContinuousStream] +${tracks.length} tracks → ${sessionId} (queue: ${session.queue.length})`);

    // Auto-start if stream is attached and nothing playing
    if (!session.currentTrack && session.streamResponse) {
      this.playNext(session).catch(err => logger.error('[ContinuousStream] playNext error:', err));
    }
    return true;
  }

  attachStream(sessionId: string, res: Response): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return false;

    // Close any previous stream
    if (session.streamResponse && !session.streamResponse.writableEnded) {
      session.streamResponse.end();
    }
    // Kill ffmpeg so it restarts with new response
    this.killFfmpeg(session);

    session.streamResponse = res;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200);

    res.on('close', () => {
      if (session.streamResponse === res) {
        session.streamResponse = null;
        this.killFfmpeg(session);
        logger.info(`[ContinuousStream] Stream disconnected: ${sessionId}`);
      }
    });

    if (session.queue.length > 0 && !session.currentTrack) {
      this.playNext(session).catch(err => logger.error('[ContinuousStream] playNext error:', err));
    } else if (session.currentTrack) {
      // Resume current track from estimated position
      const pos = this.getCurrentPosition(session);
      this.startFfmpeg(session, session.currentTrack, pos)
        .catch(err => logger.error('[ContinuousStream] startFfmpeg error:', err));
    }

    return true;
  }

  addSseClient(sessionId: string, res: Response): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return false;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200);

    session.sseClients.add(res);

    // Send current state immediately
    if (session.currentTrack) {
      const pos = this.getCurrentPosition(session);
      this.sendSse(res, 'track-change', { track: session.currentTrack, position: pos });
    }

    // Keep-alive ping every 25s (nginx default proxy_read_timeout is 60s)
    const keepAlive = setInterval(() => {
      if (res.writableEnded) { clearInterval(keepAlive); return; }
      res.write(': ping\n\n');
    }, 25000);

    res.on('close', () => {
      session.sseClients.delete(res);
      clearInterval(keepAlive);
    });

    return true;
  }

  async manualNext(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return false;

    this.killFfmpeg(session);
    session.currentTrack = null;
    session.segmentStartedAt = null;
    session.seekOffset = 0;

    await this.playNext(session);
    return true;
  }

  async seek(sessionId: string, position: number): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.currentTrack) return false;

    this.killFfmpeg(session);
    await this.startFfmpeg(session, session.currentTrack, position);
    return true;
  }

  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isActive = false;
    this.killFfmpeg(session);

    if (session.positionTimer) {
      clearInterval(session.positionTimer);
      session.positionTimer = null;
    }
    if (session.streamResponse && !session.streamResponse.writableEnded) {
      session.streamResponse.end();
    }
    for (const client of session.sseClients) {
      if (!client.writableEnded) {
        this.sendSse(client, 'session-ended', {});
        client.end();
      }
    }
    session.sseClients.clear();
    this.sessions.delete(sessionId);
    logger.info(`[ContinuousStream] Session deleted: ${sessionId}`);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private getCurrentPosition(session: Session): number {
    if (!session.segmentStartedAt) return session.seekOffset;
    return session.seekOffset + (Date.now() - session.segmentStartedAt) / 1000;
  }

  private killFfmpeg(session: Session): void {
    if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
      session.ffmpegProcess.kill('SIGTERM');
      session.ffmpegProcess = null;
    }
  }

  private async playNext(session: Session): Promise<void> {
    if (!session.isActive) return;

    const track = session.queue.shift();
    if (!track) {
      logger.info(`[ContinuousStream] Queue empty: ${session.id}`);
      if (session.streamResponse && !session.streamResponse.writableEnded) {
        session.streamResponse.end();
      }
      this.broadcastSse(session, 'queue-empty', {});
      session.currentTrack = null;
      return;
    }

    session.currentTrack = track;
    session.seekOffset = 0;
    session.segmentStartedAt = Date.now();

    this.broadcastSse(session, 'track-change', { track, position: 0 });
    this.fetchAndSendLyrics(session, track);

    await this.startFfmpeg(session, track, 0);
  }

  private async startFfmpeg(session: Session, track: QueueTrack, seekPosition: number): Promise<void> {
    if (!session.isActive) return;
    if (!this.ffmpegPath) {
      logger.error('[ContinuousStream] ffmpeg not available, skipping track');
      await this.playNext(session);
      return;
    }

    let audioInput: string;
    try {
      if (audioCacheService.has(track.videoId)) {
        audioInput = audioCacheService.getCachePath(track.videoId);
        logger.info(`[ContinuousStream] Cache hit: ${track.videoId}`);
      } else {
        audioInput = await youtubeService.getAudioStreamUrl(track.videoId);
        logger.info(`[ContinuousStream] Stream URL: ${track.videoId}`);
      }
    } catch (err) {
      logger.error(`[ContinuousStream] Failed to get audio for ${track.videoId}:`, err);
      await this.playNext(session);
      return;
    }

    if (!session.isActive || !session.streamResponse) return;

    const args: string[] = [];
    if (seekPosition > 0) {
      args.push('-ss', String(Math.floor(seekPosition)));
    }
    args.push(
      '-i', audioInput,
      '-vn',
      '-f', 'mp3',
      '-acodec', 'libmp3lame',
      '-ab', '192k',
      '-y',
      'pipe:1',
    );

    logger.info(`[ContinuousStream] ffmpeg: ${track.videoId} seek=${seekPosition.toFixed(1)}`);
    const proc = spawn(this.ffmpegPath, args);
    session.ffmpegProcess = proc;
    session.segmentStartedAt = Date.now();
    session.seekOffset = seekPosition;

    proc.stdout.on('data', (chunk: Buffer) => {
      if (session.streamResponse && !session.streamResponse.writableEnded) {
        session.streamResponse.write(chunk);
      }
    });

    // Drain ffmpeg's stderr so the process doesn't block
    proc.stderr.resume();

    proc.on('close', async (code) => {
      if (session.ffmpegProcess === proc) session.ffmpegProcess = null;
      if (!session.isActive) return;

      if (code === 0 || code === null) {
        logger.info(`[ContinuousStream] Track done: ${track.videoId}`);
        await this.playNext(session);
      } else {
        logger.warn(`[ContinuousStream] ffmpeg exit ${code} for ${track.videoId}, skipping`);
        await this.playNext(session);
      }
    });

    proc.on('error', async (err) => {
      logger.error(`[ContinuousStream] ffmpeg error for ${track.videoId}:`, err);
      if (session.ffmpegProcess === proc) session.ffmpegProcess = null;
      if (session.isActive) await this.playNext(session);
    });
  }

  private fetchAndSendLyrics(session: Session, track: QueueTrack): void {
    // Fire-and-forget; errors are non-fatal
    import('./lyrics.service').then(({ default: lyricsService }) => {
      return lyricsService.getLyrics(track.videoId, track.title, track.artist);
    }).then(lyrics => {
      if (lyrics?.lines?.length) {
        this.broadcastSse(session, 'lyrics', { data: lyrics.lines, videoId: track.videoId });
      }
    }).catch(() => {
      // Lyrics are non-critical
    });
  }

  private broadcastPosition(session: Session): void {
    if (!session.currentTrack || session.sseClients.size === 0) return;
    const pos = this.getCurrentPosition(session);
    this.broadcastSse(session, 'position', {
      currentTime: Math.round(pos * 10) / 10,
      duration: session.currentTrack.duration,
    });
  }

  private sendSse(res: Response, type: string, data: object): void {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
  }

  private broadcastSse(session: Session, type: string, data: object): void {
    for (const client of session.sseClients) {
      this.sendSse(client, type, data);
    }
  }
}

export default new ContinuousStreamService();
