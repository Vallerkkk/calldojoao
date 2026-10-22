export const ALLOWED_HOSTS=new Set(['github.com','www.youtube.com','youtube.com','youtu.be','pt.wikipedia.org','en.wikipedia.org','supabase.com','docs.livekit.io','developer.mozilla.org','orbita-8nwu.onrender.com']);
const IMAGE_HOSTS=new Set(['opengraph.githubassets.com','avatars.githubusercontent.com','i.ytimg.com','upload.wikimedia.org','supabase.com','developer.mozilla.org']);
export function previewURL(value){
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!ALLOWED_HOSTS.has(url.hostname))throw Error('Domínio não permitido');
  if(url.href.length>2048)throw Error('Link muito longo');url.hash='';
  // Never fetch access tokens or tracking parameters pasted into a chat.
  const video=url.searchParams.get('v');url.search='';if(['youtube.com','www.youtube.com'].includes(url.hostname)&&video&&/^[\w-]{11}$/.test(video))url.searchParams.set('v',video);
  return url;
}
export function publicIP(value){
  if(value.includes(':')){const ip=value.toLowerCase();return /^[23][0-9a-f]{0,3}:/.test(ip)&&!/^2001:(db8|0):|^2002:/.test(ip);}
  const parts=value.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=parts;return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
function decode(value){return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,entity=>{
  const key=entity.slice(1,-1).toLowerCase();if(key[0]==='#'){const code=key[1]==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key]||'';
}).replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim();}
export function parseOG(html,base){
  const values=new Map();for(const tag of html.match(/<meta\b[^>]{0,5000}>/gi)||[]){const attrs={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]);const key=(attrs.property||attrs.name||'').toLowerCase();if(attrs.content&&!values.has(key))values.set(key,attrs.content);}
  const title=values.get('og:title')||values.get('twitter:title')||decode(html.match(/<title[^>]*>([\s\S]{0,2000}?)<\/title>/i)?.[1]||base.hostname);
  let image='';try{if(!values.get('og:image')&&!values.get('twitter:image'))throw Error();const url=new URL(values.get('og:image')||values.get('twitter:image')||'',base);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&IMAGE_HOSTS.has(url.hostname)&&url.href.length<=2048)image=url.href;}catch{}
  return {url:base.href,title:title.slice(0,200),description:(values.get('og:description')||values.get('description')||'').slice(0,500),image};
}
