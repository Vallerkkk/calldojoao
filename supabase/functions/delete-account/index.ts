const base=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const origins=new Set(['https://orbita-8nwu.onrender.com','http://127.0.0.1:8766','http://localhost:8766']);
async function limitedBody(req:Request,limit:number){const reader=req.body?.getReader();if(!reader)return '';const decoder=new TextDecoder();let text='',bytes=0;try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw new RangeError('Solicitação grande demais');text+=decoder.decode(value,{stream:true});}return text;}finally{await reader.cancel();}}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'https://orbita-8nwu.onrender.com',headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://orbita-8nwu.onrender.com','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST'||!origins.has(origin))return reply({error:'Solicitação inválida'},403);
 const token=req.headers.get('authorization')||'',userHeaders={apikey:anon,Authorization:token,'Content-Type':'application/json'},adminHeaders={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
 try{
  if(Number(req.headers.get('content-length')||0)>1024)return reply({error:'Solicitação inválida'},413);
  const raw=await limitedBody(req,1024);if(raw.length>1024||JSON.parse(raw).confirmation!=='EXCLUIR')return reply({error:'Digite EXCLUIR para confirmar'},400);
  const auth=await fetch(base+'/auth/v1/user',{headers:userHeaders,signal:AbortSignal.timeout(5000)});if(!auth.ok)return reply({error:'Entre novamente na sua conta'},401);const user=await auth.json();
  const age=Date.now()-Date.parse(user.last_sign_in_at||'');if(!Number.isFinite(age)||age>10*60000||age<0)return reply({error:'Saia e entre novamente antes de excluir a conta. A confirmação precisa ser recente.'},401);
  const rpc=async(name:string)=>{const result=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:userHeaders,body:'{}',signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error('Não foi possível verificar seus dados');return result.json();};
  const allowed=await rpc('can_delete_account');if(!allowed.allowed)return reply({error:'Transfira a propriedade das suas comunidades e o cargo de criador antes de excluir a conta.'},409);
  const paths=await rpc('my_storage_paths');
  const queue=await fetch(base+'/rest/v1/account_cleanup',{method:'POST',headers:adminHeaders,body:JSON.stringify({user_id:user.id,paths}),signal:AbortSignal.timeout(10000)});if(!queue.ok)throw Error('Não foi possível preparar a exclusão');
  const deleted=await fetch(base+'/auth/v1/admin/users/'+encodeURIComponent(user.id),{method:'DELETE',headers:adminHeaders,signal:AbortSignal.timeout(15000)});
  if(!deleted.ok){await fetch(base+'/rest/v1/account_cleanup?user_id=eq.'+user.id,{method:'DELETE',headers:adminHeaders});throw Error('Não foi possível excluir a conta. Nenhum arquivo foi removido.');}
  let cleaned=true;const buckets=new Map<string,string[]>();for(const item of paths){if(!buckets.has(item.bucket))buckets.set(item.bucket,[]);buckets.get(item.bucket)!.push(item.path);}
  for(const [bucket,names]of buckets)for(let index=0;index<names.length;index+=100){try{const result=await fetch(base+'/storage/v1/object/'+encodeURIComponent(bucket),{method:'DELETE',headers:adminHeaders,body:JSON.stringify({prefixes:names.slice(index,index+100)}),signal:AbortSignal.timeout(10000)});if(!result.ok)cleaned=false;}catch{cleaned=false;}}
  if(cleaned)await fetch(base+'/rest/v1/account_cleanup?user_id=eq.'+user.id,{method:'DELETE',headers:adminHeaders});
  return reply({deleted:true,cleanupPending:!cleaned});
 }catch(error){return reply({error:error instanceof SyntaxError?'Confirmação inválida':error instanceof Error?error.message:'Não foi possível excluir a conta'},error instanceof SyntaxError?400:error instanceof RangeError?413:503);}
});
