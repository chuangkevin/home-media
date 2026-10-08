import fs from 'fs';
import { FileHandle } from 'fs/promises';
import { WriteStream } from 'fs';

export interface AudioSpoolState {
  bytes: number;
  done: boolean;
  failed: boolean;
}

export interface AudioSpoolReader {
  read: (buffer: Buffer, length: number, position: number) => Promise<number>;
  release: () => void;
}

/** Readers share one read-only descriptor for the original producer inode.
 * Remux/rename may replace the pathname, but cannot replace these live bytes. */
export class AudioProgressiveSpool {
  private readonly handle: Promise<FileHandle>;
  private state: AudioSpoolState = { bytes: 0, done: false, failed: false };
  private listeners = new Set<() => void>();
  private readers = 0;
  private closedForNewReaders = false;
  private closeStarted = false;

  constructor(writer: WriteStream, temporaryPath: string) {
    this.handle = new Promise<FileHandle>((resolve, reject) => {
      const onError = (error: Error) => {
        writer.removeListener('open', onOpen);
        writer.removeListener('close', onClose);
        reject(error);
      };
      const onClose = () => onError(new Error('Audio spool closed before opening'));
      const onOpen = () => {
        writer.removeListener('error', onError);
        writer.removeListener('close', onClose);
        void fs.promises.open(temporaryPath, 'r').then(resolve, reject);
      };
      writer.once('open', onOpen);
      writer.once('error', onError);
      writer.once('close', onClose);
    });
    // A cache-only write failure must not create an unhandled rejection when
    // no later HTTP request asked to read this spool.
    void this.handle.catch(() => {});
  }

  update(state: AudioSpoolState): void {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }

  snapshot(): AudioSpoolState { return this.state; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async acquire(): Promise<AudioSpoolReader> {
    if (this.closedForNewReaders || this.state.failed) throw new Error('Audio spool unavailable');
    this.readers++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.readers--;
      this.closeIfUnused();
    };
    try {
      const handle = await this.handle;
      return {
        read: async (buffer, length, position) => {
          if (released) throw new Error('Audio spool reader released');
          const result = await handle.read(buffer, 0, length, position);
          return result.bytesRead;
        },
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  finish(): void {
    this.closedForNewReaders = true;
    this.closeIfUnused();
  }

  private closeIfUnused(): void {
    if (!this.closedForNewReaders || this.readers !== 0 || this.closeStarted) return;
    this.closeStarted = true;
    void this.handle.then(handle => handle.close()).catch(() => {});
  }
}
