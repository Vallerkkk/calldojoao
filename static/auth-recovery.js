import {requestWithDeadline}from './chat-state.js';
export const isInvalidSessionError=error=>error?.name==='AuthSessionMissingError'||['refresh_token_not_found','refresh_token_already_used','session_not_found','user_not_found','bad_jwt'].includes(error?.code)||error?.status===401;
export function createAuthRecovery({auth,currentUser,onExpired}){
 let pending;
 const check=user=>{if(currentUser()!==user)throw new DOMException('A conta mudou.','AbortError');};
 async function read(){const {data,error}=await requestWithDeadline(()=>auth().getSession(),{timeout:15000});if(error)throw error;return data?.session||null;}
 async function refresh(user){
  check(user);if(pending?.user===user)return pending.task;
  const task=(async()=>{
   let previous;try{previous=await read();}catch(error){if(!isInvalidSessionError(error))throw error;}
   check(user);if(previous&&previous.user.id!==user)throw new DOMException('A conta mudou.','AbortError');let result;
   try{result=typeof auth().refreshSession==='function'?await requestWithDeadline(()=>auth().refreshSession(),{timeout:15000}):{error:{name:'AuthSessionMissingError'}};}
   catch(error){if(!isInvalidSessionError(error))throw error;result={error};}
   check(user);const fresh=result?.data?.session;
   if(fresh&&fresh.user.id!==user)throw new DOMException('A conta mudou.','AbortError');
   if(fresh?.user.id===user&&fresh.access_token)return fresh;
   if(result?.error&&!isInvalidSessionError(result.error))throw result.error;
   // Another SDK refresh may have rotated the token during the failed request.
   const latest=await read().catch(error=>{if(!isInvalidSessionError(error))throw error;return null;});check(user);
   if(latest&&latest.user.id!==user)throw new DOMException('A conta mudou.','AbortError');
   if(latest?.user.id===user&&latest.access_token&&latest.access_token!==previous?.access_token)return latest;
   await onExpired(user);throw Error('Sua sessão expirou. Entre novamente.');
  })();pending={user,task};try{return await task;}finally{if(pending?.task===task)pending=null;}
 }
 async function get(user){check(user);let fresh;try{fresh=await read();}catch(error){if(!isInvalidSessionError(error))throw error;return refresh(user);}check(user);
  if(fresh&&fresh.user.id!==user)throw new DOMException('A conta mudou.','AbortError');
  if(!fresh||typeof fresh.expires_at==='number'&&fresh.expires_at<=Date.now()/1000+45)return refresh(user);return fresh;
 }
 return {get,refresh,async expire(user){check(user);await onExpired(user);}};
}
