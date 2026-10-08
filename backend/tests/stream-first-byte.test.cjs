const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const ts = require('typescript');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
  let now = 0, published = false;
  const cacheDone = deferred(), children = [];
  const logger = { info() {}, warn() {}, error() {} };
  const mocks = {
    '../utils/logger': logger,
    '../services/youtube.service': { async validateVideoId() { return true; }, getYtDlpPath() { return 'fake-yt-dlp'; }, getYtDlpBaseArgs() { return []; } },
    '../services/audio-cache.service': { has() { return published; }, getCachePath() { return '/not-used-by-fixture'; }, remuxIfNeeded() {} },
    '../services/download-manager.service': { abortForVideoId() {} },
    '../services/audio-cache-writer': { createAudioCacheWriter() { return { completion: cacheDone.promise, cancel() {} }; } },
    child_process: { spawn() { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; children.push(child); return child; } },
  };
  function load(filename) {
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const exports = {}, module = { exports };
    vm.runInNewContext(code, {
      exports, module, Buffer, process, AbortController, setTimeout, clearTimeout,
      console: { log() {}, warn() {}, error() {} },
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name) + '.ts');
        return require(name);
      },
    }, { filename });
    return module.exports;
  }
  const module = { exports: load(path.resolve(__dirname, '../src/controllers/youtube.controller.ts')) };
  const subject = module.exports.default;
  const request = () => Object.assign(new EventEmitter(), { params: { videoId: 'Iy2VkSFxhRk' }, headers: {} });
  const response = () => {
    const r = new EventEmitter();
    r.chunks = []; r.firstByteAt = null; r.headersSent = false; r.writableEnded = false; r.destroyed = false;
    r.status = status => { r.statusCode = status; return r; };
    r.setHeader = () => {};
    r.write = chunk => { if (r.firstByteAt === null) r.firstByteAt = now; r.headersSent = true; r.chunks.push(Buffer.from(chunk)); return true; };
    r.end = () => { r.writableEnded = true; };
    r.json = body => { r.body = body; r.writableEnded = true; };
    return r;
  };
  subject.streamFromCache = (_req, res) => { res.write(Buffer.from('published-cache')); res.end(); };
  return { subject, request, response, children, setTime: value => { now = value; }, publish() { published = true; cacheDone.resolve('/published'); }, cacheDone };
}

test('first uncached request sends live stdout before full download or remux finishes', async () => {
  const f = fixture(), res = f.response();
  await f.subject.streamAudio(f.request(), res);
  f.setTime(50);
  f.children[0].stdout.write(Buffer.from('ftyp+moov+first-media'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.firstByteAt, 50);
  assert.ok(res.chunks.length > 0);
  assert.equal(res.writableEnded, false);
  assert.equal(f.subject.inFlightStreams.size, 1);
  f.children[0].stdout.end(); f.children[0].emit('close', 0);
  await tick();
  assert.equal(f.subject.inFlightStreams.size, 1, 'cache publication still owns the writer slot');
  f.publish(); await tick();
  assert.equal(f.subject.inFlightStreams.size, 0);
});

test('legacy writer without a progressive spool retains its full-publication fallback', async () => {
  const f = fixture(), first = f.response(), second = f.response();
  await f.subject.streamAudio(f.request(), first);
  f.setTime(50); f.children[0].stdout.write(Buffer.from('first-media'));
  f.setTime(80); const waiter = f.subject.streamAudio(f.request(), second);
  await tick();
  assert.equal(first.firstByteAt, 50);
  assert.equal(second.firstByteAt, null);
  assert.equal(f.children.length, 1);
  f.setTime(1000); f.children[0].stdout.end(); f.children[0].emit('close', 0);
  await tick();
  assert.equal(second.firstByteAt, null, 'producer finished but the pending remux still blocks the waiter');
  f.setTime(20000); f.publish(); await waiter;
  assert.equal(second.firstByteAt, 20000);
  assert.equal(second.firstByteAt - 80, 19920, 'controlled fixture delay, not a live latency measurement');
  assert.equal(f.children.length, 1);
});
