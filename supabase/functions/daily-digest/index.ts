// Disabled until an operator supplies Resend + a verified sender + a cron secret.
// Never sends message bodies or private conversation content in email.
Deno.serve(async(req:Request)=>{
 const apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RESEND_FROM'),cron=Deno.env.get('DIGEST_CRON_SECRET');
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(!apiKey||!from||!cron||cron.length<32)return reply({enabled:false},503);
 if(req.method!=='POST'||req.headers.get('Authorization')!=='Bearer '+cron)return reply({error:'Acesso negado'},401);
 const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 try{
  const request=async(path:string,options:RequestInit={})=>{const response=await fetch(base+path,{...options,headers,signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();return response;};
  const prefs=await(await request('/rest/v1/notification_preferences?daily_digest=eq.true&select=user_id,time_zone,quiet_start,quiet_end&limit=100')).json();let sent=0;
  for(const pref of prefs){if(sent>=50)break;let hour;try{hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:pref.time_zone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));}catch{continue;}if(hour!==18)continue;if(pref.quiet_start&&pref.quiet_end){const start=pref.quiet_start.slice(0,5),end=pref.quiet_end.slice(0,5),clock='18:00';if(start===end||(start<end?clock>=start&&clock<end:clock>=start||clock<end))continue;}
   const counts=await(await request('/rest/v1/rpc/digest_counts',{method:'POST',body:JSON.stringify({target:pref.user_id})})).json();if(!counts.likes&&!counts.replies&&!counts.messages)continue;
   const user=await(await request('/auth/v1/admin/users/'+encodeURIComponent(pref.user_id))).json();if(!user.email||!user.email_confirmed_at)continue;
   const reserved=await(await request('/rest/v1/rpc/reserve_digest',{method:'POST',body:JSON.stringify({target:pref.user_id})})).json();if(!reserved)continue;
   const day=new Date().toISOString().slice(0,10),result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'orbita-'+pref.user_id+'-'+day},body:JSON.stringify({from,to:[user.email],subject:'Seu resumo da Órbita',text:`Nas últimas 24 horas: ${counts.likes} curtidas, ${counts.replies} respostas e ${counts.messages} mensagens privadas.\n\nAbra a Órbita para ler: https://orbita-8nwu.onrender.com/\n\nVocê pode desativar este resumo em Sua Órbita > Notificações.`}),signal:AbortSignal.timeout(10000)});
   await request('/rest/v1/digest_deliveries?user_id=eq.'+pref.user_id+'&day=eq.'+day,{method:'PATCH',body:JSON.stringify({status:result.ok?'sent':'failed'})});if(result.ok)sent++;
  }
  return reply({sent});
 }catch{return reply({error:'O resumo não pôde ser concluído'},503);}
});
