// Run with node --test tests/video-cache-stream.test.cjs (uses the existing TypeScript dev dependency).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { Writable } = require('node:stream')
const ts = require('typescript')

const logger = { info() {}, warn() {}, error() {} }

function loadService(root, fsModule = fs) {
  const filename = path.join(__dirname, '../src/services/video-cache.service.ts')
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  const module = { exports }
  const mocks = {
    fs: fsModule,
    child_process: {
      spawn() {
        throw new Error('video downloader should not be used in stream tests')
      },
    },
    './youtube.service': {},
    '../utils/logger': logger,
    '../config/database': {
      getDatabase() {
        throw new Error('database should not be used in stream tests')
      },
    },
  }
  vm.runInNewContext(
    code,
    {
      exports,
      module,
      Buffer,
      process: { cwd: () => root },
      console: { log() {}, error() {}, warn() {} },
      require(name) {
        return Object.hasOwn(mocks, name) ? mocks[name] : require(name)
      },
    },
    { filename }
  )
  return module.exports.default
}

class TestResponse extends Writable {
  constructor() {
    super()
    this.headersSent = false
    this.statusCode = 200
    this.headers = {}
    this.chunks = []
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode
    this.headers = headers
    this.headersSent = true
    return this
  }

  status(statusCode) {
    this.statusCode = statusCode
    return this
  }

  json(body) {
    this.body = body
    this.headersSent = true
    this.end(JSON.stringify(body))
    return this
  }

  destroy(error) {
    this.destroyError = error
    return super.destroy()
  }

  get text() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function fixture(t, fsModule = fs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cache-stream-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const service = loadService(root, fsModule)
  const cacheDir = path.join(root, 'data', 'video-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const filePath = path.join(cacheDir, 'video.mp4')
  service.getPath = () => filePath
  const request = (range) => {
    const req = new EventEmitter()
    req.headers = range === undefined ? {} : { range }
    return req
  }
  const stream = (range) => {
    const req = request(range)
    const res = new TestResponse()
    const complete = new Promise((resolve, reject) => {
      res.once('finish', resolve)
      res.once('error', reject)
    })
    service.streamVideo('video', req, res)
    return { req, res, complete }
  }
  return { root, service, cacheDir, filePath, stream }
}

test('serves an open-ended byte range with exact headers and bytes', async (t) => {
  const f = fixture(t)
  fs.writeFileSync(f.filePath, '0123456789')
  const { res, complete } = f.stream('bytes=2-')
  await complete
  assert.equal(res.statusCode, 206)
  assert.equal(res.headers['Content-Range'], 'bytes 2-9/10')
  assert.equal(res.headers['Content-Length'], 8)
  assert.equal(res.headers['Accept-Ranges'], 'bytes')
  assert.equal(res.text, '23456789')
})

test('supports suffix and clamped byte ranges without integer overflow', async (t) => {
  const f = fixture(t)
  fs.writeFileSync(f.filePath, '0123456789')
  const suffix = f.stream('bytes=-3')
  await suffix.complete
  assert.equal(suffix.res.statusCode, 206)
  assert.equal(suffix.res.headers['Content-Range'], 'bytes 7-9/10')
  assert.equal(suffix.res.text, '789')

  const clamped = f.stream('bytes=0-999999999999999999999999999999999999')
  await clamped.complete
  assert.equal(clamped.res.statusCode, 206)
  assert.equal(clamped.res.headers['Content-Range'], 'bytes 0-9/10')
  assert.equal(clamped.res.text, '0123456789')
})

test('malformed, unsupported, and multi-range headers safely fall back to a full response', async (t) => {
  const f = fixture(t)
  fs.writeFileSync(f.filePath, '0123456789')
  for (const range of ['bytes=bad', 'items=0-1', 'bytes=0-1,4-5', 'bytes=-']) {
    const { res, complete } = f.stream(range)
    await complete
    assert.equal(res.statusCode, 200, range)
    assert.equal(res.headers['Content-Length'], 10, range)
    assert.equal(res.text, '0123456789', range)
  }
})

test('returns 416 with Content-Range for valid but unsatisfiable byte ranges', (t) => {
  const f = fixture(t)
  fs.writeFileSync(f.filePath, '0123456789')
  const { res } = f.stream('bytes=10-')
  assert.equal(res.statusCode, 416)
  assert.equal(res.headers['Content-Range'], 'bytes */10')
  assert.equal(res.headers['Accept-Ranges'], 'bytes')
  assert.equal(res.writableEnded, true)
})

test('zero-byte cache files are not reported or streamed as playable', async (t) => {
  const f = fixture(t)
  fs.writeFileSync(f.filePath, '')
  assert.equal(f.service.has('video'), false)
  const { res, complete } = f.stream('bytes=0-')
  await complete
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.error, 'Video not cached')
  assert.equal(fs.existsSync(f.filePath), true) // Lookups do not delete cache files.
})

test('non-file cache paths are not reported or streamed as playable', async (t) => {
  const f = fixture(t)
  fs.mkdirSync(f.filePath)
  assert.equal(f.service.has('video'), false)
  const { res, complete } = f.stream()
  await complete
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.error, 'Video not cached')
})

test('read failure before headers produces a clean error response', async (t) => {
  const stream = new EventEmitter()
  stream.destroy = () => {
    stream.destroyed = true
  }
  stream.destroyed = false
  const fsModule = {
    ...fs,
    createReadStream() {
      return stream
    },
  }
  const f = fixture(t, fsModule)
  fs.writeFileSync(f.filePath, '0123456789')
  const { res, complete } = f.stream()
  stream.emit('error', Object.assign(new Error('disk read failed'), { code: 'EIO' }))
  await complete
  assert.equal(res.statusCode, 500)
  assert.equal(res.body.error, 'Unable to stream cached video')
})

test('file disappearing between stat and open returns 404 before stream headers', async (t) => {
  const stream = new EventEmitter()
  stream.destroy = () => {
    stream.destroyed = true
  }
  stream.destroyed = false
  const fsModule = {
    ...fs,
    createReadStream() {
      return stream
    },
  }
  const f = fixture(t, fsModule)
  fs.writeFileSync(f.filePath, '0123456789')
  const { res, complete } = f.stream('bytes=0-1')
  fs.unlinkSync(f.filePath)
  stream.emit('error', Object.assign(new Error('file removed'), { code: 'ENOENT' }))
  await complete
  assert.equal(res.statusCode, 404)
  assert.equal(res.headersSent, true)
  assert.equal(res.body.error, 'Video not cached')
})

test('read failure after headers destroys the partial response', (t) => {
  const stream = new EventEmitter()
  stream.pipe = () => {}
  stream.destroy = () => {
    stream.destroyed = true
  }
  stream.destroyed = false
  const fsModule = {
    ...fs,
    createReadStream() {
      return stream
    },
  }
  const f = fixture(t, fsModule)
  fs.writeFileSync(f.filePath, '0123456789')
  const { res } = f.stream('bytes=0-4')
  stream.emit('open')
  assert.equal(res.statusCode, 206)
  assert.equal(res.headersSent, true)
  const error = Object.assign(new Error('disk read failed'), { code: 'EIO' })
  res.once('error', () => {})
  stream.emit('error', error)
  assert.equal(res.destroyed, true)
  assert.equal(res.destroyError, error)
})

test('client disconnect destroys the file read stream', (t) => {
  const stream = new EventEmitter()
  stream.pipe = () => {}
  stream.destroy = () => {
    stream.destroyed = true
  }
  stream.destroyed = false
  const fsModule = {
    ...fs,
    createReadStream() {
      return stream
    },
  }
  const f = fixture(t, fsModule)
  fs.writeFileSync(f.filePath, '0123456789')
  const { res } = f.stream()
  stream.emit('open')
  res.emit('close')
  assert.equal(stream.destroyed, true)
})

test('aborted request destroys the read stream and removes its abort listener', (t) => {
  const stream = new EventEmitter()
  stream.pipe = () => {}
  stream.destroy = () => {
    stream.destroyed = true
  }
  stream.destroyed = false
  const fsModule = {
    ...fs,
    createReadStream() {
      return stream
    },
  }
  const f = fixture(t, fsModule)
  fs.writeFileSync(f.filePath, '0123456789')
  const { req } = f.stream()
  stream.emit('open')
  req.emit('aborted')
  assert.equal(stream.destroyed, true)
  assert.equal(req.listenerCount('aborted'), 0)
})
