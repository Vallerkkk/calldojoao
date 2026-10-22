// Public HTTP endpoint; authentication is the per-channel random secret, hashed in SQL.
// No API/service key is included in the webhook URL or returned to its creator.
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
Deno.serve(async(req:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'},reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method!=='POST')return reply({error:'Use POST'},405);
 try{
  const url=new URL(req.url),id=url.searchParams.get('id')||'',secret=url.searchParams.get('key')||'';
  if(!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f]{64}$/.test(secret))return reply({error:'Webhook indisponível'},404);
  if(Number(req.headers.get('content-length')||0)>16384)return reply({error:'Envie até 16 KB'},413);
  const reader=req.body?.getReader();if(!reader)return reply({error:'Envie JSON'},400);let text='',bytes=0;const decoder=new TextDecoder();
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384)return reply({error:'Envie até 16 KB'},413);text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel();}
  const body=JSON.parse(text);let content=body.content||body.text||body.message;
  if(req.headers.get('x-github-event')==='push'&&typeof body.repository?.full_name==='string')content='GitHub · '+body.repository.full_name+'\n'+String(body.head_commit?.message||'Novo push')+'\n'+String(body.compare||'');
  if(typeof content!=='string'||!content.trim()||content.length>2000)return reply({error:'Envie content com 1–2000 caracteres'},400);
  const result=await fetch(base+'/rest/v1/rpc/ingest_webhook',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({hook_id:id,secret,content}),signal:AbortSignal.timeout(8000)});
  if(!result.ok)return reply({error:'Webhook indisponível, revogado ou temporariamente limitado'},429);
  return reply({ok:true},202);
 }catch{return reply({error:'Não foi possível receber essa mensagem'},400);}
});
