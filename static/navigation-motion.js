export function initNavigationMotion(){
  const media=matchMedia('(prefers-reduced-motion: reduce)'),animations=new WeakMap();
  const reduced=()=>media.matches||localStorage.getItem('orbita-reduce-motion')==='true';
  const apply=()=>{document.body.dataset.reduceMotion=String(reduced());if(reduced())document.getAnimations().forEach(animation=>animation.cancel());};
  apply();media.addEventListener('change',apply);window.addEventListener('orbita:motion-changed',apply);
  const observer=new MutationObserver(entries=>{
    if(reduced())return;
    for(const {target} of entries){if(target.hidden||!target.isConnected)continue;
      animations.get(target)?.cancel();
      if(target.animate)animations.set(target,target.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:140,easing:'ease-out'}));
    }
  });
  for(const id of ['friends-view','text-view','voice-view']){const node=document.getElementById(id);if(node)observer.observe(node,{attributes:true,attributeFilter:['hidden']});}
}
