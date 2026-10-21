import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {youtubeId,youtubeStart}=await import('data:text/javascript;base64,'+readFileSync(new URL('../static/media-utils.js',import.meta.url)).toString('base64'));
const video='M7lc1UVf-VE';
test('YouTube links support watch, share, mobile, Shorts, live and music URLs',()=>{
 for(const value of [`https://youtube.com/watch?v=${video}&si=test`,`https://youtu.be/${video}?si=test`,`https://m.youtube.com/watch?v=${video}`,`https://youtube.com/shorts/${video}`,`https://youtube.com/live/${video}`,`https://music.youtube.com/watch?v=${video}`,`https://www.youtube-nocookie.com/embed/${video}`,`youtube.com/watch?v=${video}`,`http://www.youtube.com/watch?v=${video}`])assert.equal(youtubeId(value),video,value);
});
test('YouTube timestamps support seconds, h/m/s and fragments with a bound',()=>{
 for(const [suffix,seconds]of [['?t=90',90],['?t=1h2m3s',3723],['?start=35',35],['#t=2m',120],['?t=-2',0],['?t=999999999',86400],['?t=hello',0]])assert.equal(youtubeStart(`https://youtu.be/${video}${suffix}`),seconds);
});
test('Lookalike domains, credentials, scripts, playlists and invalid video IDs are rejected',()=>{
 for(const value of [`https://youtube.com.evil.invalid/watch?v=${video}`,`https://youtube.com@evil.invalid/watch?v=${video}`,`https://user:password@youtube.com/watch?v=${video}`,`javascript:alert(1)`,`https://youtube.com/watch?v=short`,`https://youtube.com/playlist?list=anything`,`file:///C:/youtube.com/${video}`])assert.equal(youtubeId(value),null,value);
});
