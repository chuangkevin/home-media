import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { store } from '../../src/store';
import { setCurrentTrack, clearPlaybackSession } from '../../src/store/playerSlice';
import { setCurrentLyrics, resetTimeOffset, setTimeOffset, setTrackTimeOffset } from '../../src/store/lyricsSlice';
// Synthetic regression fixtures; execute the actual legacy production callback.
const track = (id: string) => ({id,videoId:id,title:'Synthetic track',channel:'Fixture',thumbnail:'',duration:180});
const lyrics = (id: string) => ({videoId:id,source:'manual' as const,isSynced:true,lines:[{time:0,text:'Synthetic lyrics'}]});
function deferred() { let resolve!: () => void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve}; }
function actualHandler(name: string, context: Record<string,any>) {
  const source=ts.createSourceFile('LyricsView.tsx',readFileSync(path.resolve(process.cwd(),'src/components/Player/LyricsView.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  function visit(node: ts.Node) {if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)initializer=node.initializer;ts.forEachChild(node,visit);}
  visit(source);assert.ok(initializer);
  const code=ts.transpileModule(`const handler=${initializer.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  return new Function(...Object.keys(context),`${code};return handler;`)(...Object.values(context));
}
test('legacy reload cannot reset a confirmed new song offset after cache await',async()=>{
  store.dispatch(clearPlaybackSession());store.dispatch(setCurrentTrack(track('fixture-A')));
  const write=deferred();const activeTrackVideoIdRef={current:'fixture-A'};let generation=0;
  const context={track:track('fixture-A'),activeTrackVideoIdRef,dispatch:store.dispatch,setCurrentLyrics,resetTimeOffset,setTrackTimeOffset,
    beginLyricsOperation:()=>{const token=++generation;return ()=>generation===token&&activeTrackVideoIdRef.current==='fixture-A';},
    setIsReloadingLyrics(){},setSearchOpen(){},setSearchError(){},emitSourceUpdate(){},emitOffsetUpdate(){},
    apiService:{getLyrics:async()=>lyrics('fixture-A'),updateLyricsPreferences(){}},
    lyricsCacheService:{delete:async()=>{},clearPreference:async()=>{},set:()=>write.promise},console:{log(){},warn(){},error(){}}};
  const reload=actualHandler('handleReloadOriginalLyrics',context);const request=reload();
  for(let i=0;i<8;i++)await Promise.resolve();
  generation++;activeTrackVideoIdRef.current='fixture-B';store.dispatch(setCurrentTrack(track('fixture-B')));store.dispatch(setTimeOffset(2));
  write.resolve();await request;
  assert.equal(store.getState().lyrics.timeOffset,2,'old cache completion must not reset B offset');
});
