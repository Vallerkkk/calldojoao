export function isQuiet(user,storage=localStorage,date=new Date()){
  if(!user)return false;
  try{const p=JSON.parse(storage.getItem('orbita-quiet:'+user)||'null');if(!p?.quiet_start||!p?.quiet_end)return false;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:p.time_zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date),clock=parts.find(p=>p.type==='hour').value+':'+parts.find(p=>p.type==='minute').value;
    const start=p.quiet_start.slice(0,5),end=p.quiet_end.slice(0,5);if(start===end)return true;return start<end?clock>=start&&clock<end:start<=clock||clock<end;
  }catch{return false;}
}
export function channelNotifies(user,data,storage=localStorage){
  if(data.private)return true;const mode=storage.getItem('orbita-channel-notify:'+user+':'+data.scope)||'all';return mode!=='none'&&(mode!=='mentions'||data.mentioned);
}
export async function syncNotificationPreferences(db,user){
  const [quiet,channels]=await Promise.all([db.from('notification_preferences').select('*').eq('user_id',user).maybeSingle(),db.from('channel_notification_preferences').select('channel_id,mode').eq('user_id',user)]);
  if((await db.auth.getSession()).data.session?.user.id!==user)return;
  if(!quiet.error){if(quiet.data)localStorage.setItem('orbita-quiet:'+user,JSON.stringify(quiet.data));else localStorage.removeItem('orbita-quiet:'+user);}
  if(!channels.error){for(const key of Object.keys(localStorage))if(key.startsWith('orbita-channel-notify:'+user+':'))localStorage.removeItem(key);for(const channel of channels.data||[])localStorage.setItem('orbita-channel-notify:'+user+':'+channel.channel_id,channel.mode);}
}
