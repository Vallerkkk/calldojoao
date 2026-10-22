import {previewURL,publicIP,parseOG} from './og-core.js';
const cache=new Map(),rates=new Map();
const origins=new Set(['https://orbita-8nwu.onrender.com','http://127.0.0.1:8766','http://localhost:8766']);
async function limitedBody(req:Request,limit:number){const reader=req.body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let text='',bytes=0;try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw new RangeError('Solicitação grande demais');text+=decoder.decode(value,{stream:true});}return text;}finally{await reader.cancel();}}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('Origin')||'https://orbita-8nwu.onrender.com';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://orbita-8nwu.onrender.com','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST'||!origins.has(origin))return reply({error:'Solicitação indisponível'},403);
  try{
    if(Number(req.headers.get('content-length')||0)>4096)return reply({error:'Solicitação grande demais'},413);
    const token=req.headers.get('Authorization')||'';if(!token.startsWith('Bearer '))return reply({error:'Entre na sua conta'},401);
    const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')||'',Authorization:token},signal:AbortSignal.timeout(4000)});
    if(!auth.ok)return reply({error:'Sessão inválida'},401);const user=await auth.json();
    const bucket=Math.floor(Date.now()/60000),rate=rates.get(user.id);if(rate?.bucket===bucket&&rate.count>=12)return reply({error:'Aguarde para carregar mais prévias'},429);
    rates.set(user.id,{bucket,count:rate?.bucket===bucket?rate.count+1:1});while(rates.size>500)rates.delete(rates.keys().next().value);
    const raw=await limitedBody(req,4096);if(raw.length>4096)return reply({error:'Solicitação grande demais'},413);let url=previewURL(JSON.parse(raw).url),key=url.href;
    if(url.hostname==='orbita-8nwu.onrender.com'&&/^\/p\/[0-9a-f-]{36}$/i.test(url.pathname)){
      const postId=url.pathname.slice(3),response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/social_posts?id=eq.'+postId+'&select=content,profiles!author_id(display_name)',{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')||'',Authorization:token},signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw Error();const rows=await response.json();if(!rows[0])throw Error();return reply({url:url.href,title:'Publicação de '+String(rows[0].profiles?.display_name||'participante'),description:String(rows[0].content||'').slice(0,500),image:''});
    }
    const prior=cache.get(key);if(prior&&prior.until>Date.now())return reply(prior.data);
    const signal=AbortSignal.timeout(8000);
    for(let redirects=0;redirects<=3;redirects++){
      const resolved=await Promise.allSettled([Deno.resolveDns(url.hostname,'A'),Deno.resolveDns(url.hostname,'AAAA')]);
      const addresses=resolved.flatMap(result=>result.status==='fulfilled'?result.value:[]);if(!addresses.length||addresses.some(ip=>!publicIP(ip)))throw Error('Endereço indisponível');
      const response=await fetch(url,{redirect:'manual',signal,headers:{Accept:'text/html','User-Agent':'OrbitaLinkPreview/1.0'}});
      if(response.status>=300&&response.status<400){response.body?.cancel();url=previewURL(new URL(response.headers.get('location')||'',url).href);continue;}
      if(!response.ok||!response.headers.get('content-type')?.includes('text/html')||Number(response.headers.get('content-length')||0)>524288){response.body?.cancel();throw Error('Página indisponível');}
      const reader=response.body?.getReader();if(!reader)throw Error();const decoder=new TextDecoder();let html='',bytes=0;
      try{while(bytes<262144){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>262144)throw Error('Página grande demais');html+=decoder.decode(value,{stream:true});if(/<\/head\s*>/i.test(html))break;}}finally{await reader.cancel();}
      const data=parseOG(html,url);cache.set(key,{data,until:Date.now()+3600000});while(cache.size>128)cache.delete(cache.keys().next().value);return reply(data);
    }
    throw Error('Redirecionamentos demais');
  }catch{return reply({error:'Prévia indisponível para este link'},422);}
});
