import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
async function functionHandler(name,{fetch:fetcher=()=>{throw Error('Unexpected outbound request');},env={},dns=['140.82.112.3']}={}){
  const result=await build({entryPoints:[fileURLToPath(new URL('../supabase/functions/'+name+'/index.ts',import.meta.url))],bundle:true,write:false,format:'iife',platform:'neutral'});
  let handler;const values={SUPABASE_URL:'https://project.invalid',SUPABASE_ANON_KEY:'anon-test-only',SUPABASE_SERVICE_ROLE_KEY:'service-test-only',...env};
  const context=vm.createContext({Request,Response,URL,TextDecoder,TextEncoder,AbortSignal,fetch:fetcher,console,Deno:{env:{get:key=>values[key]},resolveDns:async()=>dns,serve:fn=>handler=fn}});
  vm.runInContext(result.outputFiles[0].text,context);return handler;
}
const request=(body,authorization='Bearer user-test')=>new Request('https://functions.invalid/',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
test('account deletion refuses missing confirmation and a new login without deleting anything',async()=>{
  const calls=[];const handler=await functionHandler('delete-account',{fetch:async(url)=>{calls.push(url);return Response.json({id:'user-one',last_sign_in_at:new Date(Date.now()-3600000).toISOString()});}});
  assert.equal((await handler(request({confirmation:'no'}))).status,400);assert.equal(calls.length,0);
  assert.equal((await handler(request({confirmation:'EXCLUIR'}))).status,401);assert.equal(calls.length,1);
});
test('owners cannot delete their account before transferring ownership',async()=>{
  const calls=[];const handler=await functionHandler('delete-account',{fetch:async(url)=>{calls.push(url);return url.endsWith('/user')?Response.json({id:'user-one',last_sign_in_at:new Date().toISOString()}):Response.json({allowed:false});}});
  assert.equal((await handler(request({confirmation:'EXCLUIR'}))).status,409);assert(!calls.some(url=>url.includes('/admin/')));
});
test('failed account deletion never removes files',async()=>{
  const calls=[];const handler=await functionHandler('delete-account',{fetch:async(url,options)=>{
    calls.push({url,method:options?.method});
    if(url.endsWith('/user'))return Response.json({id:'user-one',last_sign_in_at:new Date().toISOString()});
    if(url.endsWith('/can_delete_account'))return Response.json({allowed:true});
    if(url.endsWith('/my_storage_paths'))return Response.json([{bucket:'orbita-feed',path:'user-one/file.webp'}]);
    if(url.includes('/admin/users/'))return Response.json({error:'failed'}, {status:500});
    return new Response(null,{status:204});
  }});
  assert.equal((await handler(request({confirmation:'EXCLUIR'}))).status,503);assert(!calls.some(call=>call.url.includes('/storage/')));
});
test('successful deletion captures cleanup paths first and never returns a server key',async()=>{
  const calls=[];const handler=await functionHandler('delete-account',{fetch:async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/user'))return Response.json({id:'user-one',last_sign_in_at:new Date().toISOString()});
    if(url.endsWith('/can_delete_account'))return Response.json({allowed:true});
    if(url.endsWith('/my_storage_paths'))return Response.json([{bucket:'orbita-feed',path:'user-one/file.webp'}]);
    return new Response(null,{status:204});
  }});
  const result=await handler(request({confirmation:'EXCLUIR'}));assert.equal(result.status,200);const text=await result.text();assert.match(text,/'?deleted"?:true/);assert(!text.includes('service-test-only'));
  assert(calls.findIndex(url=>url.includes('/my_storage_paths'))<calls.findIndex(url=>url.includes('/admin/users/')));
  assert(calls.findIndex(url=>url.includes('/admin/users/'))<calls.findIndex(url=>url.includes('/storage/')));
});
test('Open Graph refuses unauthenticated access and private DNS before fetching a website',async()=>{
  const calls=[];const handler=await functionHandler('link-preview',{dns:['127.0.0.1'],fetch:async(url)=>{calls.push(url);return Response.json({id:'user-one'});}});
  assert.equal((await handler(request({url:'https://github.com/test'},''))).status,401);assert.equal(calls.length,0);
  assert.equal((await handler(request({url:'https://github.com/test'}))).status,422);assert.deepEqual(calls,['https://project.invalid/auth/v1/user']);
});
test('internal post previews obey the user-scoped Data API response',async()=>{
  const handler=await functionHandler('link-preview',{fetch:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer user-test');
    return url.endsWith('/user')?Response.json({id:'user-one'}):Response.json([]);
  }});
  assert.equal((await handler(request({url:'https://orbita-8nwu.onrender.com/p/11111111-1111-4111-8111-111111111111'}))).status,422);
});
test('external email integration remains disabled without configuration',async()=>{
  const handler=await functionHandler('daily-digest');assert.equal((await handler(request({}))).status,503);
});
test('webhooks reject missing keys without touching the database',async()=>{
  const handler=await functionHandler('incoming-webhook');assert.equal((await handler(request({content:'hello'}))).status,404);
});
