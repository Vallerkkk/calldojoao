// Only uploaded clips use this controller; call tracks and YouTube stay independent.
const clips=new Map();
let visibilityObserver,removalObserver;

function visible(video,record){
  return !record.disposed&&record.visible&&video.isConnected&&!document.hidden;
}
function pause(video,record){
  if(!video.paused){record.autoPause=true;video.pause();}
}
function start(video,record){
  if(!visible(video,record)||record.manualPause||record.pending||!video.paused||video.ended)return;
  record.pending=true;
  try{
    Promise.resolve(video.play()).then(()=>{
      if(!visible(video,record)||record.manualPause)pause(video,record);
    }).catch(()=>{}).finally(()=>{record.pending=false;});
  }catch{record.pending=false;}
}
function release(video,record){
  record.disposed=true;visibilityObserver?.unobserve(video);clips.delete(video);
  for(const [name,handler] of record.events)video.removeEventListener(name,handler);
  video.pause();video.removeAttribute('src');video.load();
}
function init(){
  if(removalObserver)return;
  if('IntersectionObserver' in window)visibilityObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){const record=clips.get(entry.target);if(!record)continue;
      record.visible=entry.isIntersecting&&entry.intersectionRatio>=0.25;
      if(record.visible)start(entry.target,record);else pause(entry.target,record);
    }
  },{threshold:[0,0.25]});
  removalObserver=new MutationObserver(()=>{
    for(const [video,record] of clips)if(!video.isConnected)release(video,record);
  });
  removalObserver.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{
    for(const [video,record] of clips){if(document.hidden)pause(video,record);else start(video,record);}
  });
  window.addEventListener('pagehide',()=>{for(const [video,record] of clips)pause(video,record);});
  window.addEventListener('pageshow',()=>{for(const [video,record] of clips)start(video,record);});
}

export function watchUploadedVideo(video){
  if(clips.has(video))return video;
  init();video.classList.add('uploaded-video');video.controls=true;video.playsInline=true;
  video.defaultMuted=true;video.muted=true;video.preload='metadata';
  // Calling play only for visible clips avoids background downloads and playback.
  const record={visible:!visibilityObserver,manualPause:false,autoPause:false,pending:false,disposed:false,events:[]};
  record.events=[
    ['loadeddata',()=>start(video,record)],
    ['play',()=>{record.manualPause=false;if(!visible(video,record))pause(video,record);}],
    ['pause',()=>{if(record.autoPause)record.autoPause=false;else if(visible(video,record)&&video.getClientRects().length)record.manualPause=true;}],
  ];
  clips.set(video,record);for(const [name,handler] of record.events)video.addEventListener(name,handler);
  if(visibilityObserver)visibilityObserver.observe(video);else video.addEventListener('canplay',()=>start(video,record),{once:true});
  return video;
}
