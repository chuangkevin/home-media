import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-media-yt-child-'))
const fakeYtDlp = path.join(fixtureRoot, 'fake-ytdlp.cjs')
const eventLog = path.join(fixtureRoot, 'children.log')
const spawnOptionsSeen: Array<Record<string, unknown>> = []

const channels = Array.from({ length: 12 }, (_, index) => ({
  channelName: `Fixture Channel ${index}`,
  channelThumbnail: '',
  watchCount: 1,
  lastWatchedAt: Date.now(),
  firstWatchedAt: Date.now(),
}))

const db = {
  prepare: vi.fn(() => ({
    all: () => [],
    get: () => undefined,
    run: () => ({ changes: 0 }),
  })),
}

vi.doMock('../config/database', () => ({ db }))
vi.doMock('../services/history.service', () => ({
  default: { getWatchedChannels: () => channels },
}))
vi.doMock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.doMock('youtube-dl-exec', async () => {
  const actual = await vi.importActual<any>('youtube-dl-exec')
  const runner = actual.create(fakeYtDlp)
  const exec = runner.exec
  runner.exec = (...args: any[]) => {
    spawnOptionsSeen.push(args[2])
    return exec(...args)
  }
  return { ...actual, default: runner }
})

let recommendations: any

beforeAll(async () => {
  fs.writeFileSync(
    fakeYtDlp,
    `#!/usr/bin/env node
const fs = require('node:fs');
const mode = process.env.HOME_MEDIA_FIXTURE_MODE || 'hang';
const log = process.env.HOME_MEDIA_FIXTURE_LOG;
fs.appendFileSync(log, 'start ' + process.pid + '\\n');
if (mode === 'success') {
  process.stdout.write(JSON.stringify({entries:[{id:'abc12345678',title:'Fixture Song',channel:'Fixture Channel 0',duration:180,thumbnail:'fixture',upload_date:'20261008'}]}));
  process.exit(0);
} else if (mode === 'error') {
  process.stderr.write('fixture failure');
  process.exit(3);
} else {
  // A real child process that ignores the graceful signal. The production
  // runner must enforce its deadline, wait for close, and free only that slot.
  process.on('SIGTERM', () => fs.appendFileSync(log, 'term ' + process.pid + '\\n'));
  setInterval(() => {}, 1000);
}
`
  )
  fs.chmodSync(fakeYtDlp, 0o755)
  const { RecommendationService } = await import('../services/recommendation.service')
  recommendations = new RecommendationService(300)
})

afterAll(() => {
  delete process.env.HOME_MEDIA_FIXTURE_MODE
  delete process.env.HOME_MEDIA_FIXTURE_LOG
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
})

function pidsFromLog(): number[] {
  return fs
    .readFileSync(eventLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('start '))
    .map((line) => Number(line.slice(6)))
    .filter(Number.isInteger)
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

describe('recommendation yt-dlp child ownership', () => {
  it('kills and reaps timed-out children before releasing one of five slots', async () => {
    fs.writeFileSync(eventLog, '')
    process.env.HOME_MEDIA_FIXTURE_MODE = 'hang'
    process.env.HOME_MEDIA_FIXTURE_LOG = eventLog

    let maxActive = 0
    const monitor = setInterval(() => {
      maxActive = Math.max(maxActive, pidsFromLog().filter(pidIsAlive).length)
    }, 5)
    const result = await recommendations.getChannelRecommendations(0, 5)
    clearInterval(monitor)
    const pids = pidsFromLog()

    expect(result.recommendations).toHaveLength(0)
    expect(pids).toHaveLength(12)
    expect(maxActive).toBeGreaterThan(0)
    expect(maxActive).toBeLessThanOrEqual(5)
    expect(pids.every((pid) => !pidIsAlive(pid))).toBe(true)
    expect(fs.readFileSync(eventLog, 'utf8')).not.toContain('term ')
  }, 10_000)

  it('preserves successful results and releases the slot after child close', async () => {
    fs.writeFileSync(eventLog, '')
    process.env.HOME_MEDIA_FIXTURE_MODE = 'success'
    process.env.HOME_MEDIA_FIXTURE_LOG = eventLog

    const youtubeService = (await import('../services/youtube.service')).default
    const result = await youtubeService.getChannelVideos('Fixture Channel 0', 1)

    expect(result[0]?.title).toBe('Fixture Song')
    expect(spawnOptionsSeen[spawnOptionsSeen.length - 1]?.timeout).toBe(30_000)
    expect(pidsFromLog()).toHaveLength(1)
    expect(pidsFromLog().every((pid) => !pidIsAlive(pid))).toBe(true)
  })

  it('cleans up a nonzero child exit without blocking the next fetch', async () => {
    fs.writeFileSync(eventLog, '')
    process.env.HOME_MEDIA_FIXTURE_MODE = 'error'
    process.env.HOME_MEDIA_FIXTURE_LOG = eventLog

    const youtubeService = (await import('../services/youtube.service')).default
    const failed = await youtubeService.getChannelVideos('Error Channel', 1, { timeoutMs: 300 })
    expect(failed).toEqual([])

    process.env.HOME_MEDIA_FIXTURE_MODE = 'success'
    const succeeded = await youtubeService.getChannelVideos('Fixture Channel 0', 1, {
      timeoutMs: 300,
    })
    expect(succeeded[0]?.title).toBe('Fixture Song')
    expect(pidsFromLog()).toHaveLength(2)
    expect(pidsFromLog().every((pid) => !pidIsAlive(pid))).toBe(true)
  })

  it('waits for a signal-cancelled child to close before settling', async () => {
    fs.writeFileSync(eventLog, '')
    process.env.HOME_MEDIA_FIXTURE_MODE = 'hang'
    process.env.HOME_MEDIA_FIXTURE_LOG = eventLog
    const youtubeService = (await import('../services/youtube.service')).default
    const controller = new AbortController()
    const request = youtubeService.getChannelVideos('Cancelled Channel', 1, {
      signal: controller.signal,
      timeoutMs: 2_000,
    })
    const startDeadline = Date.now() + 1_000
    while (pidsFromLog().length === 0 && Date.now() < startDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(pidsFromLog()).toHaveLength(1)
    controller.abort()
    await expect(request).resolves.toEqual([])
    expect(pidsFromLog().every((pid) => !pidIsAlive(pid))).toBe(true)
  })
})
