// Real ego-lite regression. Open a real song and its lyrics sheet first.
// ego-browser nodejs -e 'globalThis.egoQaSpaceId=6; globalThis.egoQaPageLabel="p1"; await import("file:///absolute/path/tests/ego/lyrics-switch-qa.js")'
const fs = await import('node:fs/promises');
const page = (await taskSpace(Number(globalThis.egoQaSpaceId))).page(globalThis.egoQaPageLabel || 'p1');
await page.waitForSelector('[role="dialog"][aria-label^="正在播放"]', {state:'visible',timeout:20000});
const found = await page.evaluate(() => {
  const root = document.getElementById('root');
  const key = Object.keys(root).find(k => k.startsWith('__reactContainer'));
  const todo = [root[key]], seen = new Set();
  while (todo.length && seen.size < 3000) {
    const fiber = todo.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    const store = fiber.memoizedProps?.store;
    if (store?.getState) {
      window.__qaLyricsStore = store;
      window.__qaLyricsTrace = [];
      window.__qaLyricsAudioNodes = [...document.querySelectorAll('audio')];
      window.__qaLyricsUnsubscribe?.();
      const capture = () => {
        const state = store.getState();
        const value = {at:performance.now(),track:state.player.currentTrack?.videoId,pending:state.player.pendingTrack?.videoId,owner:state.lyrics.videoId,lyrics:state.lyrics.currentLyrics?.videoId,loading:state.lyrics.isLoading};
        const previous = window.__qaLyricsTrace.at(-1);
        if (!previous || JSON.stringify({...previous,at:0}) !== JSON.stringify({...value,at:0})) window.__qaLyricsTrace.push(value);
      };
      window.__qaLyricsUnsubscribe = store.subscribe(capture);
      capture();
      return true;
    }
    todo.push(fiber.child,fiber.sibling,fiber.alternate);
  }
  return false;
});
if (!found) throw new Error('Could not inspect the actual Redux store.');
const results = [];
for (let index = 0; index < 4; index++) {
  await page.waitForFunction(() => {
    const state=window.__qaLyricsStore.getState();
    return state.lyrics.currentLyrics?.lines.length && state.lyrics.currentLyrics.videoId === state.player.currentTrack?.videoId && !state.lyrics.isLoading;
  },undefined,{timeout:30000});
  const check = await page.evaluate(() => {
    const state = window.__qaLyricsStore.getState();
    const first = state.lyrics.currentLyrics.lines.find(line => line.text.trim())?.text;
    const displayed = document.querySelector('[aria-label="歌曲歌詞"]')?.textContent || '';
    return {track:state.player.currentTrack.videoId,lyrics:state.lyrics.currentLyrics.videoId,firstLineVisible:!!first && displayed.includes(first),sameAudioNodes:window.__qaLyricsAudioNodes.every((node,i) => node === document.querySelectorAll('audio')[i])};
  });
  results.push(check);
  if (!check.firstLineVisible || !check.sameAudioNodes) throw new Error('Displayed lyrics or physical audio ownership mismatch.');
  if (index < 3) {
    await page.click('[role="dialog"] button[aria-label="下一首"]',{label:'驗證下一首歌詞歸屬'});
    await page.waitForFunction(previous => window.__qaLyricsStore.getState().player.currentTrack?.videoId !== previous,check.track,{timeout:30000});
  }
}
const trace = await page.evaluate(() => {window.__qaLyricsUnsubscribe?.();return window.__qaLyricsTrace;});
const mismatches = trace.filter(value => value.lyrics && value.lyrics !== value.track);
await fs.writeFile('/tmp/home-media-lyrics-switch-qa.json',JSON.stringify({results,trace,mismatches},null,2));
console.log(JSON.stringify({results,transitionCount:trace.length,mismatches}));
if (mismatches.length) throw new Error('Confirmed playback retained another song lyrics.');
console.log('PASS: four real songs; displayed lyrics follow playback; no stale lyrics transitions; audio nodes retained.');
