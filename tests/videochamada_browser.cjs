const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER}=require('./fixtures/supabase_fixture.cjs');
const assert=require('node:assert/strict');
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
  const bodies=[],errors=[];
  await context.route('**/*',async route=>{const url=route.request().url();
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
   if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,videochamadaConfigured:true,storageConfigured:true}});
   if(url.endsWith('/videochamada')){bodies.push(route.request().postDataJSON());return route.fulfill(bodies.length===1?{status:503,json:{detail:'Falha temporária do provedor'}}:{json:{url:'https://orbita.videochamada.com.br/chamada/private-fixture',expiresAt:bodies[0].expires_at}});}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  await page.evaluate(({USER,OTHER})=>{window.__qaData.friendships.push({id:crypto.randomUUID(),requester_id:USER,recipient_id:OTHER,status:'accepted'});window.__qaData.conversations.push({id:crypto.randomUUID(),user_a:USER,user_b:OTHER});for(const subscription of window.__qaSubscriptions.filter(s=>!s.removed))for(const [kind,filter,callback]of subscription.handlers||[])if(kind==='postgres_changes'&&filter.table==='friendships')callback({eventType:'INSERT'});},{USER,OTHER});
  if(mobile)await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();
  await page.locator('#friends-nav').click();await page.locator('.friend-card').getByRole('button',{name:'Mensagem',exact:true}).click();
  await page.locator('#message-input').fill('rascunho anterior');await page.locator('#private-call').click();
  await page.getByRole('button',{name:'Chamada integrada — LiveKit',exact:true}).waitFor();
  await page.getByRole('button',{name:'Chamada no Brasil — criar convite',exact:true}).click();
  await page.getByRole('button',{name:'Criar convite privado',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Falha temporária do provedor'}).waitFor();
  await page.getByRole('button',{name:'Criar convite privado',exact:true}).click();
  const open=page.getByRole('link',{name:'Abrir chamada em outra aba ↗',exact:true});await open.waitFor();
  assert.equal(await open.getAttribute('target'),'_blank');assert.equal(await open.getAttribute('rel'),'noopener noreferrer');
  assert.deepEqual(bodies[0],bodies[1]);
  await page.getByRole('button',{name:'Inserir convite na conversa',exact:true}).click();
  const draft=await page.locator('#message-input').inputValue();assert(draft.startsWith('rascunho anterior\n📹 Chamada privada'));assert(draft.includes('https://orbita.videochamada.com.br/chamada/private-fixture'));
  // Invitation is a draft until the user chooses to send it via the normal outbox.
  assert.equal(await page.evaluate(()=>window.__qaData.direct_messages?.length||0),0);
  await page.locator('#message-form').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>window.__qaData.direct_messages?.some(m=>m.content.includes('private-fixture')));
  await page.locator('#message-list a[href="https://orbita.videochamada.com.br/chamada/private-fixture"]').first().waitFor();
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth)>(mobile?391:1441),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mobile,invite:true,retry_same_request:true,private_message:true,errors:0}));await context.close();
 }
 await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exit(1)});
