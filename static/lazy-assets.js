const styles=new Map();
export function loadStyle(url){
  if(styles.has(url))return styles.get(url);
  const task=new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.onload=()=>{window.dispatchEvent(new Event('orbita:styles-ready'));resolve();};link.onerror=()=>{link.remove();styles.delete(url);reject(Error('Não foi possível carregar esta tela. Tente novamente.'));};document.head.append(link);});styles.set(url,task);return task;
}
