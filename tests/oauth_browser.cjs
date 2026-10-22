const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub}=require('./fixtures/supabase_fixture.cjs');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const fixture=stub.replace("signOut:async()=>({error:null})","signInWithOAuth:async args=>{(window.__qaOAuth||=[]).push(args);return {error:{message:'simulated provider response'}};},signOut:async()=>({error:null})")+'\nwindow.__qaSession=null;';
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const results=[];
 for(const native of [false,true]){
  const context=await browser.newContext(native?{userAgent:'Mozilla/5.0 Chrome/144.0 Electron/44.9.2'}:{});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:fixture});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:false}});if(url.includes('/auth/v1/settings'))return route.fulfill({json:{external:{google:true,discord:true}}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';await page.goto(base+'?invite='+'a'.repeat(40),{waitUntil:'networkidle'});await page.locator('#auth-view').waitFor();
  const google=page.getByRole('button',{name:'Continuar com Google',exact:true}),discord=page.getByRole('button',{name:'Continuar com Discord',exact:true});
  if(native){assert(await google.isDisabled());assert(await discord.isDisabled());await page.getByText('No aplicativo Windows, entre com e-mail.',{exact:false}).waitFor();}
  else{await page.waitForFunction(()=>!document.querySelector('.social-login button').disabled);await google.click();await discord.click();assert.deepEqual(await page.evaluate(()=>window.__qaOAuth.map(v=>v.provider)),['google','discord']);assert.equal(await page.evaluate(()=>window.__qaOAuth[0].options.redirectTo),new URL('/',base).href);assert.match(await page.evaluate(()=>sessionStorage.getItem('orbita-oauth-return')),/invite=/);}
  assert.deepEqual(errors,[]);results.push({native,providersPrepared:true,externalRedirectSafe:true});await context.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
