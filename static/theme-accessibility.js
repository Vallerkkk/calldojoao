export function contrast(a,b){const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function foreground(hex){const c=/^#[0-9a-f]{6}$/i.test(hex||'')?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):[124,92,255];return contrast(c,[0,0,0])>contrast(c,[255,255,255])?'#000':'#fff';}
export function initThemeAccessibility(){
  const body=document.body,canvas=document.createElement('canvas').getContext('2d');
  const rgb=value=>{canvas.fillStyle='#000';canvas.fillStyle=value.trim();const c=canvas.fillStyle;if(c[0]==='#')return [1,3,5].map(i=>parseInt(c.slice(i,i+2),16));return (c.match(/[\d.]+/g)||[0,0,0]).slice(0,3).map(Number);};
  const toCss=c=>'rgb('+c.map(Math.round).join(' ')+')';
  function apply(){for(const name of ['--text','--text-dim','--text-mut','--accent-foreground','--accent-ink'])body.style.removeProperty(name);const style=getComputedStyle(body),backgrounds=['--bg-main','--bg-input','--bg-sidebar','--bg-floating','--bg-elevated'].map(k=>rgb(style.getPropertyValue(k))),accent=rgb(style.getPropertyValue('--accent'));
    const readable=color=>{if(backgrounds.every(bg=>contrast(color,bg)>=4.6))return color;const black=[0,0,0],white=[255,255,255],target=Math.min(...backgrounds.map(bg=>contrast(black,bg)))>Math.min(...backgrounds.map(bg=>contrast(white,bg)))?black:white;for(let t=.05;t<=1.01;t+=.05){const next=color.map((v,i)=>v*(1-t)+target[i]*t);if(backgrounds.every(bg=>contrast(next,bg)>=4.6))return next;}return target;};
    for(const name of ['--text','--text-dim','--text-mut'])body.style.setProperty(name,toCss(readable(rgb(style.getPropertyValue(name)))));
    body.style.setProperty('--accent-foreground',contrast(accent,[0,0,0])>contrast(accent,[255,255,255])?'#000':'#fff');body.style.setProperty('--accent-ink',toCss(readable(accent)));
  }
  new MutationObserver(apply).observe(body,{attributes:true,attributeFilter:['data-theme','data-color-mode']});window.addEventListener('orbita:styles-ready',apply);apply();return {apply};
}
