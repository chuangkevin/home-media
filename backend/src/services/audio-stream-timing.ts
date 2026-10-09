import { performance } from 'perf_hooks';

/** Bounded numeric phase evidence only. Never expose child output, URLs,
 * cookies, paths, video IDs or process identifiers in response diagnostics. */
export class AudioStreamTiming {
  private readonly started: number;
  private readonly phases = new Map<string, number>();
  private stderrTail = '';
  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = now();
  }
  mark(phase: 'validated' | 'lookup' | 'admitted' | 'spawned' | 'producer_data'): void {
    if (!this.phases.has(phase)) this.phases.set(phase, this.now());
  }
  observeStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString()).slice(-1024);
    const labels: Array<[string, RegExp]> = [
      ['yt_page', /Downloading webpage/i],
      ['yt_player', /Downloading .*player (?:API )?JSON/i],
      ['yt_js', /(?:Downloading player|\[jsc[^\]]*\]|JavaScript challenge)/i],
      ['yt_download', /\[download\].*Destination:/i],
    ];
    for (const [label, pattern] of labels) {
      if (pattern.test(this.stderrTail) && !this.phases.has(label)) this.phases.set(label, this.now());
    }
  }
  header(mode: 'live' | 'shared' | 'cache' | 'busy', producer?: AudioStreamTiming): string {
    const parts = [`audio;desc="${mode}"`];
    const duration = (name: string, end: number | undefined, start: number | undefined) => {
      if (end === undefined || start === undefined) return;
      const ms = Math.min(330000, Math.max(0, end - start));
      if (Number.isFinite(ms)) parts.push(`${name};dur=${ms.toFixed(1)}`);
    };
    duration('validate', this.phases.get('validated'), this.started);
    duration('lookup', this.phases.get('lookup'), this.phases.get('validated'));
    duration('admission', this.phases.get('admitted'), this.phases.get('lookup'));
    duration('route_to_bytes', this.now(), this.started);
    const owner = producer ?? this;
    duration('producer_output', owner.phases.get('producer_data'), owner.phases.get('spawned'));
    for (const phase of ['yt_page', 'yt_player', 'yt_js', 'yt_download']) {
      duration(phase, owner.phases.get(phase), owner.phases.get('spawned'));
    }
    duration('media_wait', owner.phases.get('producer_data'), owner.phases.get('yt_download'));
    return parts.join(', ');
  }
}
