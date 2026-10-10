import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMatchingLyricsTranslation } from '../../src/utils/lyricsTranslationIdentity';
import type { Lyrics } from '../../src/types/lyrics.types';
// Synthetic lyrics fixture: not production song data.
const current: Lyrics = { videoId: 'fixture-song', source: 'manual', isSynced: true, lines: [{time:0,text:'fixture source B'}] };
const event = {videoId:'fixture-song',sourceLines:['fixture source B'],translations:['測試譯文'],targetLanguage:'zh-TW'};
test('translation broadcast belongs to the exact song and source version', () => {
  assert.equal(isMatchingLyricsTranslation(current,event),true);
  assert.equal(isMatchingLyricsTranslation(current,{...event,videoId:'fixture-other'}),false);
  assert.equal(isMatchingLyricsTranslation(current,{...event,sourceLines:['fixture source A']}),false);
});
test('unversioned, incomplete or other-language broadcast cannot replace translations', () => {
  assert.equal(isMatchingLyricsTranslation(current,{...event,sourceLines:undefined}),false);
  assert.equal(isMatchingLyricsTranslation(current,{...event,translations:[]}),false);
  assert.equal(isMatchingLyricsTranslation(current,{...event,targetLanguage:'ja'}),false);
  assert.equal(isMatchingLyricsTranslation(null,event),false);
});
