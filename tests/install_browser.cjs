const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
const temporary=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(temporary,{recursive:true});process.env.TEMP=temporary;process.env.TMP=temporary;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',downloadsPath:temporary});
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('/instalar',base).href,{waitUntil:'networkidle'});
  const button=page.getByRole('button',{name:'Instalar Órbita',exact:true});await button.waitFor();
  await button.click();await page.getByRole('status').filter({hasText:'Use a opção de instalar'}).waitFor();
  assert.equal(await page.locator('#install-help').evaluate(node=>node===document.activeElement),true);
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.__promptCalls=(window.__promptCalls||0)+1;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
  await button.click();await page.getByRole('status').filter({hasText:'Instalação cancelada'}).waitFor();
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.__promptCalls++;};event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event);});
  await button.click();await page.getByRole('status').filter({hasText:'Solicitação aceita'}).waitFor();
  assert.equal(await button.isDisabled(),false); // acceptance isn't proof of completed installation
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  await page.getByRole('button',{name:'Órbita instalado neste navegador',exact:true}).waitFor();assert.equal(await page.locator('#install-app').isDisabled(),true);
  const download=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:/Baixar atalho para Windows/}).click()]);
  assert.equal(download[0].suggestedFilename(),'Orbita-Windows.zip');assert.equal(await download[0].failure(),null);
  assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth)>width+1,false);assert.deepEqual(errors,[]);
  const out=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'install-'+width+'.png'),fullPage:true});
  console.log(JSON.stringify({width,install_states:true,download:true,overflow:false,errors:0}));await context.close();
 }
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exit(1)});
