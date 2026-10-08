const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const ts = require('typescript');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const prefix = Buffer.from('0000ftypM4A progressive-audio');
function modules(mocks = {}) {
  const cache = new Map();
  const src = path.resolve(__dirname, '../src');
  function load(relative) {
    const filename = path.resolve(src, relative);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports:module.exports, module, Buffer, process, AbortController, setTimeout, clearTimeout, console:{log(){},warn(){},error(){}}, require(name) {
      if (Object.hasOwn(mocks,name)) return mocks[name];
      if (name.startsWith('.')) return load(path.relative(src,path.resolve(path.dirname(filename),name)+'.ts'));
      return require(name);
    } }, {filename});
    cache.set(filename,module.exports);return module.exports;
  }
  return load;
}
class Response extends Writable {
  constructor(blocked=false) { super({highWaterMark:1});this.blocked=blocked;this.headersSent=false;this.statusCode=200;this.headers={};this.chunks=[];this.pending=[];this.on('error',()=>{}); }
  _write(chunk,_encoding,callback) { this.chunks.push(Buffer.from(chunk)); if(this.blocked)this.pending.push(callback);else callback(); }
  status(status){this.statusCode=status;return this;}
  setHeader(name,value){this.headers[name]=value;}
  write(chunk){this.headersSent=true;return super.write(chunk);}
  json(body){this.body=body;this.end(JSON.stringify(body));return this;}
}
const request = (videoId='fixture1234',range) => {const req=new EventEmitter();req.params={videoId};req.headers=range?{range}:{};return req;};
async function until(check) {const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw new Error('fixture condition timed out');await tick();}}
function fixture(t,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audio-spool-'));const children=[];const jobs=[];const entered=deferred(),release=deferred();
  const cachePath=id=>path.join(dir,id+'.m4a');
  const load=modules({
    '../utils/logger':{info(){},warn(){},error(){}},
    '../services/youtube.service':{async validateVideoId(){return true},getYtDlpPath(){return 'mock'},getYtDlpBaseArgs(){return []}},
    '../services/audio-cache.service':{has:id=>fs.existsSync(cachePath(id)),getCachePath:cachePath,async remuxIfNeeded(file){entered.resolve();if(options.remuxBlocked)await release.promise;if(options.replaceOnRemux){fs.writeFileSync(file+'.new',Buffer.from('0000ftypM4A final-cache'));fs.renameSync(file+'.new',file)}}},
    '../services/download-manager.service':{abortForVideoId(){}},
    child_process:{spawn(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kills=[];p.kill=signal=>{p.kills.push(signal);queueMicrotask(()=>p.emit('close',null));return true};children.push(p);return p}},
  });
  const create=load('services/audio-cache-writer.ts').createAudioCacheWriter;
  const response=load('services/audio-progressive-response.ts');
  const subject=load('controllers/youtube.controller.ts').default;
  function writer(id='direct') {const p=new EventEmitter();p.stdout=new PassThrough();p.kills=[];p.kill=s=>{p.kills.push(s);queueMicrotask(()=>p.emit('close',null));return true};const job=create(p,cachePath(id),async()=>{});jobs.push(job);return{p,job};}
  t.after(async()=>{release.resolve();for(const j of jobs){j.cancel();await j.completion;}for(const p of children){p.stdout.end();p.emit('close',1);}await tick();fs.rmSync(dir,{recursive:true,force:true});});
  return{dir,children,subject,writer,response,cachePath,entered,release};
}
test('same-song reader and Safari byte probe share one producer and stream before remux publication',async t=>{
 const f=fixture(t,{remuxBlocked:true,replaceOnRemux:true});const first=new Response();
 await f.subject.streamAudio(request('fixture1234','bytes=0-1'),first);
 f.children[0].stdout.write(prefix);await until(()=>first.chunks.length>0);
 first.destroy();await tick();assert.deepEqual(f.children[0].kills,[],'probe disconnect must not kill the owned cache producer');
 const second=new Response();const secondStream=f.subject.streamAudio(request(),second);await until(()=>second.chunks.length>0);
 assert.equal(f.children.length,1);assert.equal(second.statusCode,200);assert.equal(second.headers['Accept-Ranges'],'none');assert.equal(second.headers['Content-Type'],'audio/mp4');assert.equal(fs.existsSync(f.cachePath('fixture1234')),false);
 const raw=Buffer.concat([prefix,Buffer.from(' remaining-media')]);f.children[0].stdout.end(Buffer.from(' remaining-media'));f.children[0].emit('close',0);await f.entered.promise;await secondStream;
 assert.deepEqual(Buffer.concat(second.chunks),raw);assert.equal(second.writableEnded,true);assert.equal(f.subject.inFlightStreams.size,1,'only atomic final cache publication releases producer ownership');
 const late=new Response();const lateStream=f.subject.streamAudio(request('fixture1234','bytes=12-'),late);await lateStream;
 assert.equal(late.statusCode,200);assert.equal(late.headers['Content-Range'],undefined);assert.deepEqual(Buffer.concat(late.chunks),raw,'unknown Range is ignored honestly, not advertised as 206');
 f.release.resolve();await until(()=>f.subject.inFlightStreams.size===0);assert.equal(fs.readFileSync(f.cachePath('fixture1234'),'utf8'),'0000ftypM4A final-cache');assert.equal(f.response.progressiveAudioReaderCount(),0);
});
test('backpressure preserves chunk contents and disconnect releases only the reader',async t=>{
 const f=fixture(t);const{p,job}=f.writer();const res=new Response(true);const stream=f.response.streamProgressiveAudio(request(),res,job.spool);
 p.stdout.write(prefix);await until(()=>res.chunks.length===1);p.stdout.write(Buffer.alloc(128,0x41));await tick();assert.equal(res.chunks.length,1,'no more reads while HTTP backpressure is active');assert.deepEqual(res.chunks[0],prefix);
 res.destroy();await stream;assert.equal(f.response.progressiveAudioReaderCount(),0);assert.deepEqual(p.kills,[]);assert.equal(job.spool.snapshot().failed,false);
});
test('readers are bounded per producer and globally; overflow returns explicit retryable 503',async t=>{
 const f=fixture(t);const records=[];
 for(let i=0;i<4;i++){const{p,job}=f.writer('bound'+i);p.stdout.write(prefix);for(let j=0;j<8;j++){const res=new Response(true);const promise=f.response.streamProgressiveAudio(request(),res,job.spool);records.push({res,promise});}}
 await until(()=>f.response.progressiveAudioReaderCount()===32);
 const ninth=new Response();await f.response.streamProgressiveAudio(request(),ninth,f.writer('overflow').job.spool,{firstByteTimeoutMs:50});assert.equal(ninth.statusCode,503);assert.equal(ninth.body.retryable,true);
 for(const record of records)record.res.destroy();await Promise.all(records.map(r=>r.promise));assert.equal(f.response.progressiveAudioReaderCount(),0);
});
test('no-data timeout and producer failure never become empty successful responses',async t=>{
 const f=fixture(t);const{job}=f.writer();const timeout=new Response();await f.response.streamProgressiveAudio(request(),timeout,job.spool,{firstByteTimeoutMs:15});assert.equal(timeout.statusCode,503);assert.equal(timeout.body.retryable,true);assert.equal(f.response.progressiveAudioReaderCount(),0);
 const failed=f.writer('failed');failed.p.stdout.end();failed.p.emit('close',1);await failed.job.completion;const res=new Response();await f.response.streamProgressiveAudio(request(),res,failed.job.spool);assert.equal(res.statusCode,503);
});
test('an aborted reader waiting for its descriptor releases its reservation and cannot kill playback',async t=>{
 const f=fixture(t);const{p,job}=f.writer();const req=request();const res=new Response();const stream=f.response.streamProgressiveAudio(req,res,job.spool);req.emit('aborted');await stream;assert.equal(f.response.progressiveAudioReaderCount(),0);assert.deepEqual(p.kills,[]);
 p.stdout.write(prefix);await until(()=>job.spool.snapshot().bytes>0);p.stdout.end();p.emit('close',0);await job.completion;
});
test('HTTP reader MIME is derived from actual bytes and a post-header producer failure destroys the response',async t=>{
 const f=fixture(t);const{p,job}=f.writer();const res=new Response();const stream=f.response.streamProgressiveAudio(request(),res,job.spool);p.stdout.write(Buffer.from([0x1a,0x45,0xdf,0xa3,1,2,3,4,5]));await until(()=>res.chunks.length>0);assert.equal(res.headers['Content-Type'],'audio/webm');p.stdout.end();p.emit('close',1);await stream;assert.equal(res.destroyed,true);assert.equal(fs.existsSync(f.cachePath('direct')),false);assert.equal(f.response.progressiveAudioReaderCount(),0);
});
test('live producer ownership is capped and only close plus finalization frees the slot',async t=>{
 const f=fixture(t,{remuxBlocked:true});const responses=[];
 for(let i=0;i<4;i++){const r=new Response();responses.push(r);await f.subject.streamAudio(request('owner00000'+i),r);}
 const overflow=new Response();await f.subject.streamAudio(request('owner000004'),overflow);assert.equal(overflow.statusCode,503);assert.equal(overflow.headers['Retry-After'],'2');assert.equal(f.children.length,4);
 for(const p of f.children){p.stdout.end(prefix);p.emit('close',0);}await f.entered.promise;assert.equal(f.subject.activeStreamOwners,4);f.release.resolve();await until(()=>f.subject.activeStreamOwners===0);assert.equal(f.subject.inFlightStreams.size,0);
});
test('first owner has bounded HTTP buffering; a stalled client cannot stop another reader or cache publication',async t=>{
 const f=fixture(t);const first=new Response(true);await f.subject.streamAudio(request(),first);
 const p=f.children[0];p.stdout.write(prefix);await until(()=>first.chunks.length===1);
 const second=new Response();const reading=f.subject.streamAudio(request(),second);
 for(let i=0;i<10;i++){p.stdout.write(Buffer.alloc(1024*1024,0x41));await tick();}
 await until(()=>first.destroyed);
 assert.equal(first.writableEnded,false,'stalled owner is disconnected, never clean-ended');
 assert.ok(first.writableLength<=64*1024,'HTTP retained bytes are bounded to one 64KiB write');
 assert.equal(first.chunks.length,1);assert.deepEqual(p.kills,[]);
 p.stdout.end();p.emit('close',0);await reading;await until(()=>f.subject.inFlightStreams.size===0);
 assert.equal(second.writableEnded,true);assert.equal(fs.statSync(f.cachePath('fixture1234')).size,prefix.length+10*1024*1024);
});
test('first owner waits for process outcome and destroys a truncated 200 after nonzero exit',async t=>{
 const f=fixture(t);const res=new Response();await f.subject.streamAudio(request(),res);
 const p=f.children[0];p.stdout.end(prefix);await until(()=>res.chunks.length>0);await tick();
 assert.equal(res.writableEnded,false,'stdout end cannot masquerade as successful process completion');
 p.emit('close',1);await until(()=>res.destroyed);
 assert.equal(res.writableEnded,false);assert.equal(fs.existsSync(f.cachePath('fixture1234')),false);
});
test('producer body budget cancels oversize work and cannot publish a partial cache',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audio-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const p=new EventEmitter();p.stdout=new PassThrough();p.kills=[];p.kill=s=>{p.kills.push(s);queueMicrotask(()=>p.emit('close',null));return true};
 const load=modules();const job=load('services/audio-cache-writer.ts').createAudioCacheWriter(p,path.join(dir,'audio.m4a'),async()=>{throw new Error('must not remux')},{maxBytes:64});
 p.stdout.write(Buffer.alloc(65));assert.equal(await job.completion,null);assert.deepEqual(p.kills,['SIGTERM']);assert.equal(job.spool.snapshot().failed,true);assert.deepEqual(fs.readdirSync(dir),[]);
});
