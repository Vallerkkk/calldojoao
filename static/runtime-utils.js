// Memory is scoped to the active account. Optional local snapshots expire after 30 days.
export class DraftStore {
  constructor(limit = 60) { this.limit = limit; this.items = new Map(); this.clock = 0; this.account = null; }
  useAccount(id, storage) {
    this.flush(); this.clear(); this.account = id || null; this.storage = storage;
    if (!id || !storage) return;
    try {
      const snapshot=JSON.parse(storage.getItem('orbita-drafts:'+id)||'null');
      if (!snapshot || Date.now()-snapshot.savedAt>30*86400000 || !Array.isArray(snapshot.items)) return;
      for (const [key,text] of snapshot.items.slice(-this.limit)) if(typeof key==='string'&&key.startsWith(id+':')&&typeof text==='string') this.items.set(key,{text:text.slice(0,16000),revision:++this.clock});
    } catch {}
  }
  persist() {if(!this.account||!this.storage||this.timer)return;this.timer=setTimeout(()=>this.flush(),250);}
  flush() {
    clearTimeout(this.timer);this.timer=null;
    if (!this.account || !this.storage) return;
    try { this.storage.setItem('orbita-drafts:'+this.account,JSON.stringify({savedAt:Date.now(),items:[...this.items].map(([key,item])=>[key,item.text])})); } catch {}
  }
  erase() { this.items.clear(); this.clock++; this.flush(); }
  get(key) { return this.items.get(key)?.text || ''; }
  revision(key) { return this.items.get(key)?.revision || 0; }
  set(key, text) {
    if (!key || this.get(key) === text) return;
    if (!text) { this.items.delete(key); this.clock++; this.persist(); return; }
    this.items.delete(key);
    this.items.set(key, {text, revision: ++this.clock});
    while (this.items.size > this.limit) this.items.delete(this.items.keys().next().value);
    this.persist();
  }
  clear() { this.items.clear(); this.clock++; }
}

// Device changes can finish out of order. Apply the latest requested state last.
export function serialToggle(apply, onError = () => {}) {
  const pending = new Map();
  let running;
  async function drain() {
    while (pending.size) {
      const [target, value] = pending.entries().next().value;
      pending.delete(target);
      try { await apply(target, value); }
      catch (error) { onError(error, target); }
    }
  }
  function start() {
    if (!running) running=Promise.resolve().then(drain).finally(()=>{running=undefined;if(pending.size)start();});
  }
  return {
    async set(target, value) {
      pending.set(target,value);start();
      while(running)await running;
    },
  };
}
