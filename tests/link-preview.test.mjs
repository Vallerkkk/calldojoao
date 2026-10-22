import test from 'node:test';
import assert from 'node:assert/strict';
import {previewURL,publicIP,parseOG} from '../supabase/functions/link-preview/og-core.js';
test('link previews reject credentials, lookalike hosts, internal URLs and tracking secrets',()=>{
  for(const url of ['http://github.com/','https://github.com.evil.invalid/','https://127.0.0.1/','https://github.com:8443/','https://user:secret@github.com/'])assert.throws(()=>previewURL(url));
  assert.equal(previewURL('https://github.com/org/repo?token=secret#anchor').href,'https://github.com/org/repo');
  assert.equal(previewURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=secret').search,'?v=dQw4w9WgXcQ');
});
test('DNS responses reject private, mapped, reserved and metadata addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','198.19.0.1','::1','::ffff:127.0.0.1','2001:db8::1','2002:a00::1'])assert.equal(publicIP(ip),false,ip);
  for(const ip of ['140.82.112.3','8.8.8.8','2606:50c0:8000::153'])assert.equal(publicIP(ip),true,ip);
});
test('Open Graph extraction handles attribute order and entities without returning HTML',()=>{
  const url=previewURL('https://github.com/test/repo'),data=parseOG(`<title>Fallback</title><meta content='A &amp; B' property='og:title'><meta name="description" content="Read &quot;this&quot;"><meta property="og:image" content="https://opengraph.githubassets.com/hash/test/repo">`,url);
  assert.equal(data.title,'A & B');assert.equal(data.description,'Read "this"');assert.match(data.image,/opengraph/);
  assert.equal(parseOG('<meta property="og:image" content="javascript:alert(1)">',url).image,'');
  assert.equal(parseOG('<title>Page</title>',url).image,'');
});
