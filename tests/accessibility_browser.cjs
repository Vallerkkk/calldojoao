const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  await context.route('**/*',r=>{const u=r.request().url();if(u.includes('supabase-js'))return r.fulfill({contentType:'application/javascript',body:stub});if(u.endsWith('/api/config'))return r.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:false,storageConfigured:true}});return r.continue();});
  const page=await context.newPage();await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  async function audit(label){const result=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));const violations=result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})).slice(0,8)}));assert.deepEqual(violations,[],label+' '+JSON.stringify(violations));}
  await audit('chat');if(process.env.ORBITA_SCREENSHOTS==='1'){const dir=path.resolve(__dirname,'../static/screenshots');fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,mobile?'mobile.png':'desktop.png')});}
  if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator('#settings').click();await page.getByLabel('Nickname (também será seu @)',{exact:true}).waitFor();await audit('settings');
  await page.waitForTimeout(200);
  const contrast=await page.evaluate(async()=>{const keys=['orbita','blurple','emerald','nitro','cyber','forest','ocean','sunset','midnight','blood','gold','sakura'],results=[];const {contrast}=await import('/static/theme-accessibility.js');const ctx=document.createElement('canvas').getContext('2d'),rgb=s=>{ctx.fillStyle=s.trim();return [1,3,5].map(i=>parseInt(ctx.fillStyle.slice(i,i+2),16));};for(const mode of ['dark','light'])for(const theme of keys){document.body.dataset.colorMode=mode;document.body.dataset.theme=theme;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const style=getComputedStyle(document.body);for(const fg of ['--text','--text-dim','--text-mut'])for(const bg of ['--bg-main','--bg-input','--bg-sidebar','--bg-floating','--bg-elevated']){const ratio=contrast(rgb(style.getPropertyValue(fg)),rgb(style.getPropertyValue(bg)));if(ratio<4.5)results.push({mode,theme,fg,bg,ratio});}}return results;});assert.deepEqual(contrast,[]);
  await audit('light theme settings');await page.locator('#dialog-close').click();await page.evaluate(()=>{document.body.dataset.colorMode='dark';document.body.dataset.theme='orbita';document.body.classList.remove('mobile-menu-open');});
  if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator('#feed-nav').click();await page.locator('#feed-view').waitFor();await audit('feed');
  report.push({mobile,wcagAA:true,themes:24});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
