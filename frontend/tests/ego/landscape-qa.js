// Run with the real ego-lite browser, not Playwright or a synthetic DOM:
// ego-browser nodejs -e 'globalThis.egoQaSpaceId=<existing-space>; await import("file:///absolute/path/to/tests/ego/landscape-qa.js")'
// Open the local app and select a real song first. No playback or server data is
// fabricated here; the test only resizes the existing page and reads its DOM.
const fs = await import('node:fs/promises');
const spaceId = Number(globalThis.egoQaSpaceId);
if (!Number.isInteger(spaceId) || spaceId <= 0) throw new Error('Set globalThis.egoQaSpaceId to the existing QA space.');
const page = (await taskSpace(spaceId)).page(globalThis.egoQaPageLabel || 'p1');
if (!(await page.evaluate(() => !!document.querySelector('.audio-player')))) throw new Error('Select a real song in the local test app before running player QA.');
await page.evaluate(() => { window.__qaAudioNodes = [...document.querySelectorAll('audio')]; });
const results = [];
for (const [name,width,height,mobile] of [['phone-393',852,393,true],['phone-300',852,300,true],['phone-260',852,260,true],['phone-small',667,300,true],['tablet-720',1920,720,false],['tablet-600',1920,600,false],['tablet-standard',1024,768,false],['portrait',393,852,true]]) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await page.waitForFunction(({width,height}) => innerWidth === width && innerHeight === height, {width,height},{timeout:10000});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const result = await page.evaluate(() => {
    const rect = s => document.querySelector(s)?.getBoundingClientRect().toJSON();
    const buttons = [...document.querySelectorAll('.audio-player button,.mobile-navigation button,header button')].filter(e => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden').map(e => ({label:e.getAttribute('aria-label') || e.innerText, rect:e.getBoundingClientRect().toJSON()}));
    const audioNodes = [...document.querySelectorAll('audio')];
    return {width:innerWidth,height:innerHeight,layout:document.querySelector('.app-shell')?.dataset.layout,main:rect('.app-main'),dock:rect('.player-dock'),sameAudioNodes:window.__qaAudioNodes.length === audioNodes.length && window.__qaAudioNodes.every((node,i) => node === audioNodes[i]),horizontalOverflow:document.documentElement.scrollWidth > innerWidth,clippedControls:buttons.filter(({rect:r}) => r.left < -.5 || r.right > innerWidth+.5 || r.top < -.5 || r.bottom > innerHeight+.5),smallControls:buttons.filter(({rect:r}) => r.width < 43.5 || r.height < 43.5),audio:audioNodes.map(a => ({ready:a.readyState,paused:a.paused,currentTime:a.currentTime,error:a.error?.message}))};
  });
  const screenshot = `/tmp/home-media-${name}.png`;
  await page.screenshot({path:screenshot});
  results.push({name,...result,screenshot});
}
await fs.writeFile('/tmp/home-media-ego-matrix.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
const failures = results.filter(r => r.horizontalOverflow || r.clippedControls.length || r.smallControls.length || !r.sameAudioNodes || r.main.height < 100);
if (failures.length) throw new Error('Landscape QA failures: ' + failures.map(r => r.name).join(', '));
console.log('PASS: all eight viewport cases; controls visible; >=44px hit areas; both audio nodes retained.');
