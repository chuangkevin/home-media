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
  const timingClock={time:0};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audio-spool-'));const children=[];const jobs=[];const entered=deferred(),release=deferred();
  const cachePath=id=>path.join(dir,id+'.m4a');
  const mocks={
    perf_hooks:{performance:{now:()=>timingClock.time}},
    '../utils/logger':{info(){},warn(){},error(){}},
    '../services/youtube.service':{async validateVideoId(){return true},getYtDlpPath(){return 'mock'},getYtDlpBaseArgs(){return []}},
    '../services/audio-cache.service':{has:id=>fs.existsSync(cachePath(id)),getCachePath:cachePath,getCacheDir:()=>dir,getFileSize:id=>fs.statSync(cachePath(id)).size,createReadStream:(id,options)=>fs.createReadStream(cachePath(id),options),async remuxIfNeeded(file){entered.resolve();if(options.remuxBlocked)await release.promise;if(options.replaceOnRemux){fs.writeFileSync(file+'.new',Buffer.from('0000ftypM4A final-cache'));fs.renameSync(file+'.new',file)}}},
    '../services/download-manager.service':{abortForVideoId(){},precache(){}},
    child_process:{spawn(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kills=[];p.kill=signal=>{p.kills.push(signal);if(!options.holdClose)queueMicrotask(()=>p.emit('close',null));return true};p.existingTempsAtSpawn=fs.readdirSync(dir).filter(name=>name.endsWith('.tmp'));children.push(p);return p}},
  };
  mocks['./audio-cache.service']=mocks['../services/audio-cache.service'];
  mocks['./youtube.service']=mocks['../services/youtube.service'];
  if(options.realManager)delete mocks['../services/download-manager.service'];
  const load=modules(mocks);
  const create=load('services/audio-cache-writer.ts').createAudioCacheWriter;
  const response=load('services/audio-progressive-response.ts');
  const subject=load('controllers/youtube.controller.ts').default;
  function writer(id='direct') {const p=new EventEmitter();p.stdout=new PassThrough();p.kills=[];p.kill=s=>{p.kills.push(s);queueMicrotask(()=>p.emit('close',null));return true};const job=create(p,cachePath(id),async()=>{});jobs.push(job);return{p,job};}
  t.after(async()=>{release.resolve();for(const j of jobs){j.cancel();await j.completion;}for(const p of children){p.stdout.end();p.emit('close',1);}await tick();fs.rmSync(dir,{recursive:true,force:true});});
  return{dir,children,subject,writer,response,cachePath,entered,release,timingClock,manager:options.realManager?load('services/download-manager.service.ts').default:null};
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

test('four cancelled cold requests relinquish only reaped owners and a new foreground starts within the bounded admission wait',async t=>{
 const f=fixture(t);const old=[];
 for(let i=0;i<4;i++){const res=new Response();old.push(res);await f.subject.streamAudio(request('cancel0000'+i),res);res.destroy();await tick();}
 const started=Date.now();const next=new Response();await f.subject.streamAudio(request('latest00000'),next);
 assert.equal(f.children.length,5);assert.ok(Date.now()-started<1500);await until(()=>f.subject.activeStreamOwners===1);
 assert.deepEqual(f.children.slice(0,4).map(p=>p.kills),[['SIGTERM'],['SIGTERM'],['SIGTERM'],['SIGTERM']]);
 assert.equal(f.subject.waitingStreamAdmissions,0);assert.equal(next.headersSent,false,'new producer starts without masquerading as empty completed200');
 f.children[4].stdout.end(prefix);f.children[4].emit('close',0);await until(()=>next.writableEnded);
});
test('a waiting shared reader is a live consumer before any bytes or descriptor readiness',async t=>{
 const f=fixture(t);const first=new Response();await f.subject.streamAudio(request(),first);
 const second=new Response();const stream=f.subject.streamAudio(request(),second);await tick();first.destroy();await tick();
 await new Promise(resolve=>setTimeout(resolve,300));assert.deepEqual(f.children[0].kills,[]);assert.equal(f.subject.inFlightOwners.get('fixture1234').isIdle(),false);
 f.children[0].stdout.end(prefix);f.children[0].emit('close',0);await stream;assert.equal(second.writableEnded,true);assert.equal(f.children.length,1);
});
test('Safari byte probe can rejoin during the covered grace without restarting its producer',async t=>{
 const f=fixture(t);const probe=new Response();await f.subject.streamAudio(request('fixture1234','bytes=0-1'),probe);
 f.children[0].stdout.write(prefix);await until(()=>probe.chunks.length>0);probe.destroy();await tick();
 await new Promise(resolve=>setTimeout(resolve,220));const res=new Response();const stream=f.subject.streamAudio(request(),res);await until(()=>res.chunks.length>0);
 assert.equal(f.children.length,1);assert.deepEqual(f.children[0].kills,[]);f.children[0].stdout.end();f.children[0].emit('close',0);await stream;
});
test('same-song rejoin after retirement waits for close and cleanup before a replacement writer starts',async t=>{
 const f=fixture(t,{holdClose:true});const first=new Response();await f.subject.streamAudio(request(),first);first.destroy();await tick();
 await until(()=>f.children[0].kills.length>0);const next=new Response();const waiting=f.subject.streamAudio(request(),next);await tick();
 assert.equal(f.children.length,1);assert.equal(f.subject.activeStreamOwners,1);
 f.children[0].stdout.emit('data',Buffer.from('late discarded bytes'));f.children[0].emit('close',1);await waiting;
 assert.equal(f.children.length,2);assert.equal(f.subject.activeStreamOwners,1);assert.deepEqual(f.children[1].existingTempsAtSpawn,[],'old temporary path is cleaned before replacement spawn');
 f.children[1].stdout.end(prefix);f.children[1].emit('close',0);await until(()=>next.writableEnded);
});
test('explicit preload owns finalization after all HTTP consumers leave and never creates a duplicate writer',async t=>{
 const f=fixture(t,{remuxBlocked:true});const res=new Response();await f.subject.streamAudio(request(),res);
 const accepted=new Response();await f.subject.preloadAudio(request(),accepted);assert.equal(accepted.statusCode,202);res.destroy();await tick();
 await new Promise(resolve=>setTimeout(resolve,300));assert.deepEqual(f.children[0].kills,[]);assert.equal(f.children.length,1);
 f.children[0].stdout.end(prefix);f.children[0].emit('close',0);await f.entered.promise;
 await new Promise(resolve=>setTimeout(resolve,300));assert.equal(f.subject.activeStreamOwners,1);assert.equal(f.subject.inFlightOwners.get('fixture1234').isIdle(),false);
 f.release.resolve();await until(()=>f.subject.activeStreamOwners===0);assert.equal(fs.existsSync(f.cachePath('fixture1234')),true);
});
test('request cancellation while waiting for capacity cannot start a later foreground producer',async t=>{
 const f=fixture(t,{holdClose:true});
 for(let i=0;i<4;i++){const res=new Response();await f.subject.streamAudio(request('abort00000'+i),res);res.destroy();await tick();}
 const req=request('never000000'),res=new Response();const waiting=f.subject.streamAudio(req,res);await until(()=>f.subject.waitingStreamAdmissions===1);req.aborted=true;req.emit('aborted');await waiting;
 assert.equal(f.children.length,4);assert.equal(f.subject.waitingStreamAdmissions,0);assert.equal(res.headersSent,false);
});
test('queued foreground admissions are capped and concurrent wakeups never overbook four live slots',async t=>{
 const f=fixture(t,{holdClose:true});
 for(let i=0;i<4;i++){const res=new Response();await f.subject.streamAudio(request('queue00000'+i),res);res.destroy();await tick();}
 const waits=[],responses=[];for(let i=0;i<8;i++){const res=new Response();responses.push(res);waits.push(f.subject.streamAudio(request('newqueue00'+i),res));}
 await until(()=>f.subject.waitingStreamAdmissions===8);const overflow=new Response();await f.subject.streamAudio(request('overflow001'),overflow);assert.equal(overflow.statusCode,503);assert.equal(f.subject.waitingStreamAdmissions,8);
 f.children.slice(0,4).forEach(p=>p.emit('close',1));await Promise.all(waits);assert.equal(f.children.length,8);assert.equal(f.subject.activeStreamOwners,4);assert.equal(f.subject.waitingStreamAdmissions,0);assert.equal(responses.filter(r=>r.statusCode===503).length,4);
});
test('concurrent requests for the same new song still share one owner after reclaim',async t=>{
 const f=fixture(t,{holdClose:true});
 for(let i=0;i<4;i++){const res=new Response();await f.subject.streamAudio(request('samequeue0'+i),res);res.destroy();await tick();}
 const a=new Response(),b=new Response();const first=f.subject.streamAudio(request('sharednew01'),a),second=f.subject.streamAudio(request('sharednew01'),b);await until(()=>f.subject.waitingStreamAdmissions===2);
 f.children.slice(0,4).forEach(p=>p.emit('close',1));await first;await until(()=>f.children.length===5);await tick();assert.equal(f.children.length,5);
 f.children[4].stdout.end(prefix);f.children[4].emit('close',0);await second;assert.equal(b.writableEnded,true);
});
test('an explicit manager background job shares its live spool with foreground instead of spawning a second path writer',async t=>{
 const f=fixture(t,{realManager:true});f.manager.precache(['fixture1234']);assert.equal(f.children.length,1);
 const res=new Response();const streaming=f.subject.streamAudio(request(),res);await tick();assert.equal(f.children.length,1);assert.deepEqual(f.children[0].kills,[]);
 f.children[0].stdout.end(prefix);f.children[0].emit('close',0);await streaming;assert.equal(res.writableEnded,true);assert.equal(f.subject.activeStreamOwners,0);
});
test('manager preload while a foreground owner exists retains that owner and cannot start another writer',async t=>{
 const f=fixture(t,{realManager:true});const res=new Response();await f.subject.streamAudio(request(),res);f.manager.precache(['fixture1234']);res.destroy();await tick();
 await new Promise(resolve=>setTimeout(resolve,300));assert.equal(f.children.length,1);assert.deepEqual(f.children[0].kills,[]);
 f.children[0].stdout.end(prefix);f.children[0].emit('close',0);await until(()=>f.subject.activeStreamOwners===0);
});
test('a new explicit cache request cannot interrupt a foreground reader borrowing an existing manager job',async t=>{
 const f=fixture(t,{realManager:true});const old=f.manager.playNow('fixture1234');assert.equal(f.children.length,1);
 const res=new Response();const stream=f.subject.streamAudio(request(),res);await tick();const next=f.manager.playNow('background1');assert.equal(f.children.length,2);assert.deepEqual(f.children[0].kills,[]);
 f.children[0].stdout.end(prefix);f.children[0].emit('close',0);await stream;await old;assert.equal(res.writableEnded,true);
 f.children[1].stdout.end(prefix);f.children[1].emit('close',0);await next;
});
test('cache producers including preserved and reaping jobs stay capped at four',async t=>{
 const f=fixture(t,{realManager:true});f.manager.precache(['cache000001','cache000002','cache000003']);const fourth=f.manager.playNow('cache000004');assert.equal(f.children.length,4);
 const fifth=f.manager.playNow('cache000005');await tick();assert.equal(f.children.length,4);assert.ok(f.children.every(p=>p.kills.length===0));
 f.children[0].stdout.end(prefix);f.children[0].emit('close',0);await until(()=>f.children.length===5);assert.equal(f.manager.cacheProducerCount(),4);
 for(const p of f.children.slice(1)){p.stdout.end(prefix);p.emit('close',0)}await Promise.all([fourth,fifth]);
});
test('foreground cancellation while a manager path is reaping removes admission and cannot later spawn',async t=>{
 const f=fixture(t,{realManager:true,holdClose:true});f.manager.precache(['fixture1234']);const retiring=f.manager.abortForVideoId('fixture1234');assert.ok(retiring);
 const req=request(),res=new Response();const waiting=f.subject.streamAudio(req,res);await until(()=>f.subject.waitingStreamAdmissions===1);
 req.aborted=true;req.emit('aborted');await waiting;assert.equal(f.subject.waitingStreamAdmissions,0);assert.equal(f.children.length,1);assert.equal(res.headersSent,false);
 assert.equal(f.manager.cacheProducerCount(),1);f.children[0].emit('close',1);await retiring;await until(()=>f.manager.cacheProducerCount()===0);
});
test('a manager retirement timeout returns retryable503 without releasing an unreaped path or starting another writer',async t=>{
 const f=fixture(t,{realManager:true,holdClose:true});f.manager.precache(['fixture1234']);const retiring=f.manager.abortForVideoId('fixture1234');
 const res=new Response();await f.subject.streamAudio(request(),res);assert.equal(res.statusCode,503);assert.equal(res.body?.retryable,true);assert.equal(f.subject.waitingStreamAdmissions,0);assert.equal(f.children.length,1);assert.equal(f.manager.cacheProducerCount(),1);
 f.children[0].emit('close',1);await retiring;await until(()=>f.manager.cacheProducerCount()===0);
});


test('an early grace callback rechecks its deadline and a stale lease timer cannot retire a rejoined reader',()=>{
 const filename=path.resolve(__dirname,'../src/services/audio-stream-owner.ts');
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 let now=0,next=0;const timers=new Map();const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Date:{now:()=>now},setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)}});
 const owner=new module.exports.AudioStreamOwner(250);let cancellations=0;owner.setCancellation(()=>cancellations++);
 const first=owner.acquireHTTP(request(),new Response());first();
 const early=[...timers.entries()][0];timers.delete(early[0]);now=249;early[1].fn();
 assert.equal(cancellations,0);assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,1);
 const remaining=[...timers.entries()][0];timers.delete(remaining[0]);now=250;remaining[1].fn();
 assert.equal(cancellations,1);assert.equal(owner.cancelling,true);assert.equal(timers.size,0);
 const joined=new module.exports.AudioStreamOwner(250);joined.setCancellation(()=>cancellations++);
 const release=joined.acquireHTTP(request(),new Response());release();const stale=[...timers.values()][0].fn;
 now=300;const releaseSecond=joined.acquireHTTP(request(),new Response());releaseSecond();
 const current=[...timers.entries()][0];now=500;stale();assert.equal(cancellations,1);assert.equal(timers.size,1,'old callback cannot clear the new lease timer');
 timers.delete(current[0]);now=550;current[1].fn();assert.equal(cancellations,2);
});
test('explicit play cache intent arriving during foreground retirement waits for cleanup then retries once',async t=>{
 const f=fixture(t,{realManager:true,holdClose:true});const res=new Response();await f.subject.streamAudio(request(),res);res.destroy();await tick();
 await until(()=>f.children[0].kills.length>0);const caching=f.manager.playNow('fixture1234');await tick();assert.equal(f.children.length,1);
 f.children[0].emit('close',1);await until(()=>f.children.length===2);assert.deepEqual(f.children[1].existingTempsAtSpawn,[]);
 f.children[1].stdout.end(prefix);f.children[1].emit('close',0);assert.equal(await caching,f.cachePath('fixture1234'));assert.equal(fs.existsSync(f.cachePath('fixture1234')),true);
});
test('a retained foreground extraction failure returns failed cache intent without automatic retries',async t=>{
 const f=fixture(t,{realManager:true});const res=new Response();await f.subject.streamAudio(request(),res);const caching=f.manager.playNow('fixture1234');
 f.children[0].stdout.end();f.children[0].emit('close',1);assert.equal(await caching,null);await tick();assert.equal(f.children.length,1);
});

test('first-byte phases separate live producer wait from a shared reader wait without remux or admission queue',async t=>{
 const f=fixture(t,{remuxBlocked:true});const first=new Response();await f.subject.streamAudio(request(),first);
 assert.equal(f.children.length,1,'cold route starts producer immediately, not after metadata fetch or a queue');
 assert.equal(first.headers['Server-Timing'],undefined,'diagnostics cannot send headers early and fake a faster first byte');
 f.timingClock.time=300;const second=new Response();const reading=f.subject.streamAudio(request(),second);
 f.timingClock.time=1500;f.children[0].stderr.write(Buffer.from('[youtube] Downloading webpage\n'));
 f.timingClock.time=4000;f.children[0].stderr.write(Buffer.from('[youtube] Downloading ios player API JSON\n'));
 f.timingClock.time=9350;f.children[0].stderr.write(Buffer.from('[download] Destination: -\n'));
 f.timingClock.time=10400;f.children[0].stdout.write(prefix);await until(()=>first.chunks.length>0&&second.chunks.length>0);
 assert.match(first.headers['Server-Timing'],/audio;desc="live"/);assert.match(first.headers['Server-Timing'],/producer_output;dur=10400.0/);
 assert.match(first.headers['Server-Timing'],/admission;dur=0.0/);assert.match(first.headers['Server-Timing'],/media_wait;dur=1050.0/);
 assert.match(second.headers['Server-Timing'],/audio;desc="shared"/);assert.match(second.headers['Server-Timing'],/route_to_bytes;dur=10100.0/);
 assert.match(second.headers['Server-Timing'],/producer_output;dur=10400.0/);assert.equal(f.children.length,1);
 assert.equal(fs.existsSync(f.cachePath('fixture1234')),false);f.children[0].stdout.end();f.children[0].emit('close',0);await reading;f.release.resolve();await until(()=>f.subject.inFlightStreams.size===0);assert.equal(f.subject.inFlightTimings.size,0);
});
test('timing diagnostics are bounded numeric phases and never reveal child stderr or secrets',()=>{
 const load=modules();const Timing=load('services/audio-stream-timing.ts').AudioStreamTiming;let now=0;const trace=new Timing(()=>now);
 trace.mark('validated');trace.mark('lookup');trace.mark('admitted');trace.mark('spawned');now=120;
 trace.observeStderr(Buffer.from('[youtube] Downloading webpage https://example.invalid/private?token=SECRET cookie=/private/cookie\n'));
 now=300;trace.mark('producer_data');const header=trace.header('live');assert.match(header,/yt_page;dur=120.0/);assert.doesNotMatch(header,/SECRET|cookie|private|https/);assert.ok(header.length<500);
});


test('timing composition retains cancelled-owner close gate and attributes retirement wait to admission',async t=>{
 const f=fixture(t,{holdClose:true});
 for(let i=0;i<4;i++){const res=new Response();await f.subject.streamAudio(request('phaseold00'+i),res);res.destroy();await tick();}
 const res=new Response();const pending=f.subject.streamAudio(request('phaselatest'),res);await until(()=>f.subject.waitingStreamAdmissions===1);
 assert.equal(res.headers['Server-Timing'],undefined);assert.equal(f.children.length,4);
 f.timingClock.time=120;f.children.slice(0,4).forEach(p=>p.emit('close',1));await pending;
 assert.equal(f.children.length,5);await until(()=>f.subject.activeStreamOwners===1);assert.equal(res.headers['Server-Timing'],undefined);
 f.timingClock.time=750;f.children[4].stdout.end(prefix);f.children[4].emit('close',0);await until(()=>res.writableEnded);
 assert.match(res.headers['Server-Timing'],/admission;dur=120.0/);assert.match(res.headers['Server-Timing'],/producer_output;dur=630.0/);
 await until(()=>f.subject.activeStreamOwners===0);assert.equal(f.subject.inFlightTimings.size,0);
});
