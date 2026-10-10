import test from 'node:test';
import assert from 'node:assert/strict';
import { canReuseLyricsForTrack } from '../../src/services/lyrics-match-cache';
import type { Lyrics } from '../../src/types/lyrics.types';
const track={id:'fixture',videoId:'fixture',title:'Fixture Song (Official Audio)',channel:'Fixture Artist',thumbnail:'',duration:133};
// Synthetic fixtures, not real song content.
const lyric: Lyrics={videoId:'fixture',source:'lrclib',isSynced:true,lines:[{time:38,text:'Synthetic phrase'}]};
const proof={provenance:{selection:'automatic',evidence:'metadata',title:'Fixture Song',artist:'Fixture Artist',duration:133},matchContext:{policy:'metadata-v1',title:track.title,artist:track.channel,duration:track.duration}};
test('an old videoId-only cache is not proof that lyrics match the song',()=>{assert.equal(canReuseLyricsForTrack(lyric,track),false);});
test('validated source context permits permanent reuse, not reuse for changed song metadata',()=>{
 const good={...lyric,...proof} as Lyrics;
 assert.equal(canReuseLyricsForTrack(good,track),true);
 assert.equal(canReuseLyricsForTrack(good,{...track,title:'Different Fixture Song'}),false);
 assert.equal(canReuseLyricsForTrack(good,{...track,channel:'Other Fixture Artist'}),false);
 assert.equal(canReuseLyricsForTrack(good,{...track,duration:200}),false);
});
test('timestamps beyond the actual song or out of order are not valid synced lyrics',()=>{
 assert.equal(canReuseLyricsForTrack({...lyric,...proof,lines:[{time:149,text:'Synthetic phrase'}]} as Lyrics,track),false);
 assert.equal(canReuseLyricsForTrack({...lyric,...proof,lines:[{time:40,text:'A'},{time:20,text:'B'}]} as Lyrics,track),false);
});
test('explicit user-selected lyrics remain reusable but impossible timelines are rejected',()=>{
 const manual={...lyric,source:'manual' as const};assert.equal(canReuseLyricsForTrack(manual,track),true);
 assert.equal(canReuseLyricsForTrack({...manual,lines:[{time:149,text:'Synthetic phrase'}]},track),false);
});
