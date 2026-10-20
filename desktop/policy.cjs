'use strict';
const APP_URL = 'https://orbita-8nwu.onrender.com/';
function safeHttps(value) {
  if(typeof value!=='string'||value.length>4096||/[\x00-\x20\\]/.test(value))return null;
  try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')?url:null; } catch { return null; }
}
function isAppURL(value) { return safeHttps(value)?.origin===new URL(APP_URL).origin; }
function isLocalUI(value) { try {const u=new URL(value);return u.protocol==='orbita-desktop:'&&u.hostname==='ui'&&['/picker.html','/loading.html','/offline.html'].includes(u.pathname)&&!u.username&&!u.password&&!u.port;}catch{return false;} }
module.exports={APP_URL,safeHttps,isAppURL,isLocalUI};
