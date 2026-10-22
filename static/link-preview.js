const allowed=new Set(['github.com','www.youtube.com','youtube.com','youtu.be','pt.wikipedia.org','en.wikipedia.org','supabase.com','docs.livekit.io','developer.mozilla.org','orbita-8nwu.onrender.com']);
const pending=new Map();let observer,cleanup;const watching=new Set();
export function enhanceLinkPreview(link,url,db){
  if(typeof db.functions?.invoke!=='function'||!allowed.has(url.hostname)||link.dataset.ogPreview)return;link.dataset.ogPreview='pending';link.orbitaPreview={url,db};
  if(!observer)observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);watching.delete(entry.target);load(entry.target).catch(()=>{});}},{rootMargin:'150px'});
  watching.add(link);observer.observe(link);while(watching.size>150){const first=watching.values().next().value;observer.unobserve(first);watching.delete(first);}
  if(!cleanup){cleanup=new MutationObserver(()=>{for(const node of watching)if(!node.isConnected){observer.unobserve(node);watching.delete(node);}});cleanup.observe(document.body,{subtree:true,childList:true});}
}
async function load(link){
  const {url,db}=link.orbitaPreview;const user=(await db.auth.getSession()).data.session?.user.id;if(!user)return;
  const key=user+':'+url.href;if(!pending.has(key)){pending.set(key,db.functions.invoke('link-preview',{body:{url:url.href}}).then(({data,error})=>error?null:data).catch(()=>null));while(pending.size>80)pending.delete(pending.keys().next().value);}
  const data=await pending.get(key);if(url.hostname==='orbita-8nwu.onrender.com')pending.delete(key);if(!data||!link.isConnected||(await db.auth.getSession()).data.session?.user.id!==user)return;
  const scroll=link.closest('#message-list,.sf-scroll'),top=scroll?.scrollTop,height=scroll?.scrollHeight,above=scroll&&link.getBoundingClientRect().top<scroll.getBoundingClientRect().top,bottom=scroll?.id==='message-list'&&height-scroll.clientHeight-top<40;
  const title=link.querySelector('strong');if(title&&typeof data.title==='string')title.textContent=data.title;
  const description=link.querySelector('span');if(description&&typeof data.description==='string')description.textContent=data.description;
  if(typeof data.image==='string'&&data.image.startsWith('https://')&&!link.querySelector('img')){const image=document.createElement('img');image.src=data.image;image.alt='';image.loading='lazy';image.decoding='async';image.width=320;image.height=180;image.referrerPolicy='no-referrer';image.onerror=()=>image.remove();link.prepend(image);}
  if(scroll)requestAnimationFrame(()=>{if(!link.isConnected||Math.abs(scroll.scrollTop-top)>1)return;if(bottom)scroll.scrollTop=scroll.scrollHeight;else if(above)scroll.scrollTop+=scroll.scrollHeight-height;});
}
