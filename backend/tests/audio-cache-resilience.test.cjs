// Run with node --test tests/audio-cache-resilience.test.cjs (uses existing TypeScript dev dependency).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const ts = require('typescript');
const logger = { info() {}, warn() {}, error() {} };
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function load(relative, mocks = {}, extra = {}) {
  const filename = path.join(__dirname, '../src', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const module = { exports };
  vm.runInNewContext(code, { exports, module, Buffer, process, AbortController,
    setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {} },
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('.')) {
        const local = path.resolve(path.dirname(filename), name) + '.ts';
        if (fs.existsSync(local)) return load(path.relative(path.join(__dirname, '../src'), local), mocks, extra);
      }
      return require(name);
    }, ...extra,
  }, { filename });
  return module.exports;
}
function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cache-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const create = load('services/audio-cache-writer.ts', overrides).createAudioCacheWriter;
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kills = [];
  proc.kill = signal => { proc.kills.push(signal); queueMicrotask(() => proc.emit('close', null)); return true; };
  const dest = path.join(dir, 'video.m4a');
  const send = async (code = 0, data = Buffer.from('0000ftypM4A audio')) => {
    proc.stdout.end(data);
    await tick();
    proc.emit('close', code);
  };
  return { dir, create, proc, dest, send };
}

test('publication waits for process success and remux, while timers remain responsive', async t => {
  const f = fixture(t);
  const entered = deferred(), release = deferred();
  const job = f.create(f.proc, f.dest, async () => { entered.resolve(); await release.promise; });
  await f.send();
  await entered.promise;
  assert.equal(fs.existsSync(f.dest), false);
  let heartbeat = false;
  await new Promise(resolve => setTimeout(() => { heartbeat = true; resolve(); }, 1));
  assert.equal(heartbeat, true);
  release.resolve();
  assert.equal(await job.completion, f.dest);
  assert.deepEqual(fs.readdirSync(f.dir), ['video.m4a']);
});

test('stdout end alone never publishes and nonzero exit discards partial output', async t => {
  const f = fixture(t);
  const job = f.create(f.proc, f.dest, async () => assert.fail('must not remux failed producer'));
  f.proc.stdout.end(Buffer.alloc(40));
  await tick();
  assert.equal(fs.existsSync(f.dest), false);
  f.proc.emit('close', 1);
  assert.equal(await job.completion, null);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

test('disk error is handled, cleans owned temp, kills background producer, never publishes', async t => {
  const f = fixture(t);
  const job = f.create(f.proc, path.join(f.dir, 'missing', 'video.m4a'), async () => {});
  f.proc.stdout.write(Buffer.alloc(32));
  assert.equal(await job.completion, null);
  assert.deepEqual(f.proc.kills, ['SIGTERM']);
  assert.deepEqual(fs.readdirSync(f.dir), []);
  // A late producer error remains handled rather than becoming uncaught.
  assert.doesNotThrow(() => f.proc.emit('error', new Error('late error')));
});

test('ENOSPC cache write failure resumes live stdout without killing playback', async t => {
  let fakeWriter;
  const f = fixture(t, { fs: { ...fs, createWriteStream() {
    fakeWriter = new Writable({ write(_chunk, _encoding, cb) {
      const err = new Error('disk full'); err.code = 'ENOSPC'; cb(err);
    } });
    return fakeWriter;
  } } });
  const job = f.create(f.proc, f.dest, async () => {}, { keepStreamingOnError: true });
  f.proc.stdout.write(Buffer.alloc(65536));
  assert.equal(await job.completion, null);
  assert.equal(fakeWriter.destroyed, true);
  assert.equal(f.proc.stdout.isPaused(), false);
  assert.deepEqual(f.proc.kills, []);
  f.proc.emit('close', 1);
  assert.equal(fs.existsSync(f.dest), false);
});

test('cancellation during remux cannot publish or remove a replacement producer file', async t => {
  const f = fixture(t), entered = deferred(), release = deferred();
  let signal;
  const old = f.create(f.proc, f.dest, async (_p, s) => { signal = s; entered.resolve(); await release.promise; });
  await f.send(); await entered.promise;
  old.cancel();
  assert.equal(signal.aborted, true);
  fs.writeFileSync(f.dest, 'replacement');
  release.resolve();
  assert.equal(await old.completion, null);
  assert.equal(fs.readFileSync(f.dest, 'utf8'), 'replacement');
  assert.deepEqual(fs.readdirSync(f.dir), ['video.m4a']);
});

test('remux rejection preserves previously published file and cleans temp', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.dest, 'existing');
  const job = f.create(f.proc, f.dest, async () => { throw new Error('remux timed out'); });
  await f.send();
  assert.equal(await job.completion, null);
  assert.equal(fs.readFileSync(f.dest, 'utf8'), 'existing');
  assert.deepEqual(fs.readdirSync(f.dir), ['video.m4a']);
});

function remuxFixture(t, impl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-remux-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'video.tmp');
  fs.writeFileSync(file, Buffer.from('0000ftypdash original data'));
  const service = load('services/audio-cache.service.ts', {
    '../utils/logger': logger, './youtube.service': {}, './audio-cache-writer': {},
    child_process: { execFile(command, args, options, cb) {
      if (args[0] === '-version') queueMicrotask(() => cb(null, '', ''));
      else impl(command, args, options, cb);
    } },
  }, { process: { env: { AUDIO_CACHE_DIR: dir }, cwd: () => dir } }).default;
  return { file, dir, service };
}

test('actual remux method is asynchronous, bounded, and atomically replaces only completed output', async t => {
  const entered = deferred(); let finish, output;
  const f = remuxFixture(t, (_cmd, args, options, cb) => {
    assert.equal(options.timeout, 30000); assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.maxBuffer, 1024 * 1024);
    output = args.at(-1); finish = cb; entered.resolve();
  });
  const operation = f.service.remuxIfNeeded(f.file);
  await entered.promise;
  let heartbeat = false;
  await new Promise(resolve => setTimeout(() => { heartbeat = true; resolve(); }, 1));
  assert.equal(heartbeat, true);
  assert.match(fs.readFileSync(f.file, 'utf8'), /original/);
  fs.writeFileSync(output, '0000ftypM4A converted');
  finish(null, '', ''); await operation;
  assert.match(fs.readFileSync(f.file, 'utf8'), /converted/);
  assert.deepEqual(fs.readdirSync(f.dir), ['video.tmp']);
});

test('remux child timeout rejects and removes its real output temp without deleting input', async t => {
  const f = remuxFixture(t, (_cmd, args, _opts, cb) => {
    fs.writeFileSync(args.at(-1), 'partial output');
    setImmediate(() => cb(Object.assign(new Error('timeout'), { killed: true }), '', ''));
  });
  await assert.rejects(f.service.remuxIfNeeded(f.file), /timeout/);
  assert.match(fs.readFileSync(f.file, 'utf8'), /original/);
  assert.deepEqual(fs.readdirSync(f.dir), ['video.tmp']);
});

test('short/corrupt cache and empty remux output are never accepted', async t => {
  const f = remuxFixture(t, (_cmd, args, _opts, cb) => {
    fs.writeFileSync(args.at(-1), ''); cb(null, '', '');
  });
  await assert.rejects(f.service.remuxIfNeeded(f.file), /Empty remux output/);
  fs.writeFileSync(f.file, 'short');
  await assert.rejects(f.service.remuxIfNeeded(f.file), /Incomplete audio cache header/);
});

function controllerFixture() {
  const subject = load('controllers/youtube.controller.ts', {
    '../utils/logger': logger,
    '../services/youtube.service': { async validateVideoId() { return true; } },
    '../services/audio-cache.service': { has() { return false; } },
    '../services/download-manager.service': { abortForVideoId() {} },
    '../services/audio-cache-writer': {},
  }).default;
  const starts = [];
  subject.streamWithYtDlp = (_req, _res, _id, complete) => starts.push({ complete });
  const request = () => Object.assign(new EventEmitter(), { params: { videoId: 'Iy2VkSFxhRk' }, headers: {} });
  return { subject, starts, request };
}

test('concurrent waiters start only one replacement extractor when prior cache failed', async () => {
  const f = controllerFixture();
  await f.subject.streamAudio(f.request(), new EventEmitter());
  const b = f.subject.streamAudio(f.request(), new EventEmitter());
  const c = f.subject.streamAudio(f.request(), new EventEmitter());
  await tick(); f.starts[0].complete(); await tick();
  assert.equal(f.starts.length, 2);
  f.starts[1].complete(); await Promise.all([b, c]);
  assert.equal(f.starts.length, 3); // Sequential retry, never two simultaneous owners.
  f.starts[2].complete();
});

test('late completion from old stream cannot delete newer in-flight owner', async () => {
  const f = controllerFixture();
  await f.subject.streamAudio(f.request(), new EventEmitter());
  f.starts[0].complete();
  await f.subject.streamAudio(f.request(), new EventEmitter());
  f.starts[0].complete();
  assert.equal(f.subject.inFlightStreams.size, 1);
  f.starts[1].complete();
  assert.equal(f.subject.inFlightStreams.size, 0);
});

test('optional cache failure retains live stream owner until producer closes', async () => {
  const children = [], cacheDone = deferred();
  const subject = load('controllers/youtube.controller.ts', {
    '../utils/logger': logger,
    '../services/youtube.service': { async validateVideoId() { return true; }, getYtDlpPath() { return 'mock'; }, getYtDlpBaseArgs() { return []; } },
    '../services/audio-cache.service': { has() { return false; }, getCachePath() { return '/unused'; } },
    '../services/download-manager.service': { abortForVideoId() {} },
    '../services/audio-cache-writer': { createAudioCacheWriter() { return { completion: cacheDone.promise, cancel() {} }; } },
    child_process: { spawn() { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; children.push(child); return child; } },
  }).default;
  const request = () => Object.assign(new EventEmitter(), { params: { videoId: 'Iy2VkSFxhRk' }, headers: {} });
  const response = () => { const r = new EventEmitter(); r.status = () => r; r.json = () => { r.writableEnded = true; }; return r; };
  await subject.streamAudio(request(), response());
  cacheDone.resolve(null); await tick();
  const waiter = subject.streamAudio(request(), response());
  await tick(); assert.equal(children.length, 1);
  assert.equal(subject.inFlightStreams.size, 1);
  children[0].emit('close', 1); await waiter;
  assert.equal(children.length, 2);
  children[1].emit('close', 1);
});

test('DownloadManager holds queue slot and same-video waiters through remux completion', async () => {
  const jobs = [];
  const service = load('services/download-manager.service.ts', {
    fs: { readdirSync() { return []; } },
    './youtube.service': { getYtDlpPath() { return 'mock'; }, getYtDlpBaseArgs() { return []; } },
    './audio-cache.service': { has() { return false; }, getCachePath(id) { return id; }, getCacheDir() { return '/unused'; } },
    './audio-cache-writer': { createAudioCacheWriter() { const d = deferred(); const job = { completion: d.promise, cancel() { d.resolve(null); }, resolve: d.resolve }; jobs.push(job); return job; } },
    child_process: { spawn() { return { stderr: { resume() {} } }; } },
  }).default;
  const a = service.playNow('same'), b = service.playNow('same');
  service.precache(['next']);
  assert.equal(jobs.length, 1);
  assert.equal(service.getStatus('same').status, 'downloading-high');
  assert.equal(service.awaitDownload('same'), jobs[0].completion);
  jobs[0].resolve('/cached/same');
  assert.deepEqual(await Promise.all([a, b]), ['/cached/same', '/cached/same']);
  await tick(); assert.equal(jobs.length, 2);
  jobs[1].resolve(null);
});

test('cancelled old writer ignores late chunks and cannot consume newer temporary file', async t => {
  const f = fixture(t);
  const first = f.create(f.proc, f.dest, async () => {});
  f.proc.stdout.write(Buffer.from('old partial'));
  first.cancel(); await first.completion;
  f.proc.stdout.emit('data', Buffer.from('late old data'));
  assert.deepEqual(fs.readdirSync(f.dir), []);
  assert.doesNotThrow(() => f.proc.stdout.emit('error', new Error('late stdout error')));
});
