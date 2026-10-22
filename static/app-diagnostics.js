// Only fixed category counters. Never inspect error messages, stacks, DOM text or URLs.
export const SCREENS=new Set(['messages','voice','feed','friends','settings','other']);
export const SIGNALS=new Set(['view','javascript_error','promise_error','resource_error','navigation_slow','long_task','api_error']);
export function createCounters(){
 const values=new Map();
 return {add(screen,signal){if(!SCREENS.has(screen)||!SIGNALS.has(signal))return;const key=screen+':'+signal;values.set(key,Math.min(20,(values.get(key)||0)+1));},
  take(){const events=[...values].slice(0,12).map(([key,count])=>{values.delete(key);const[screen,signal]=key.split(':');return {screen,signal,count};});return events;},clear(){values.clear();}};
}
export function initAppDiagnostics(ctx){
 const counters=createCounters();let account,lastScreen,pending=false,observer;
 const screen=()=>{if(document.querySelector('#app-dialog[open]'))return 'settings';if(document.getElementById('feed-view')?.hidden===false)return 'feed';if(!document.getElementById('voice-view')?.hidden)return 'voice';if(!document.getElementById('friends-view')?.hidden)return 'friends';if(!document.getElementById('text-view')?.hidden)return 'messages';return 'other';};
 const active=()=>!!ctx.account()&&!document.hidden;
 function add(signal){if(active())counters.add(screen(),signal);}
 function sync(){const next=ctx.account();if(next!==account){account=next;counters.clear();lastScreen=null;}if(active()&&lastScreen!==screen()){lastScreen=screen();counters.add(lastScreen,'view');}}
 window.addEventListener('error',event=>add(event.target===window?'javascript_error':'resource_error'),true);
 window.addEventListener('unhandledrejection',()=>add('promise_error'));
 window.addEventListener('orbita:technical-signal',event=>{if(event.detail==='api_error')add('api_error');});
 // PerformanceObserver reports durations; contents/attribution are deliberately discarded.
 if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){try{observer=new PerformanceObserver(list=>{if(list.getEntries().some(e=>e.duration>=200))add('long_task');});observer.observe({type:'longtask',buffered:false});}catch{}}
 const navigation=new MutationObserver(entries=>{sync();if(!active())return;for(const {target}of entries){if(!target.hidden){const start=performance.now(),origin=screen(),user=account;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(ctx.account()===user&&active()&&performance.now()-start>350)counters.add(origin,'navigation_slow');}));}}});
 for(const id of ['text-view','voice-view','friends-view']){const node=document.getElementById(id);if(node)navigation.observe(node,{attributes:true,attributeFilter:['hidden']});}
 async function flush(){sync();if(!active()||pending||!navigator.onLine)return;const events=counters.take();if(!events.length)return;pending=true;const user=account;try{await ctx.send(events,user);}catch{/* Best effort: never loop, toast or interfere with a call. */}finally{pending=false;}}
 const interval=setInterval(flush,65000);document.addEventListener('visibilitychange',sync);
 // No localStorage, identifiers, network instrumentation, recording or unload beacons.
 sync();return {sync,flush,stop(){clearInterval(interval);observer?.disconnect();navigation.disconnect();counters.clear();}};
}
