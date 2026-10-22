// State stays in memory and is cleared when the account changes.
export class DraftStore {
  constructor(limit = 60) { this.limit = limit; this.items = new Map(); this.clock = 0; }
  get(key) { return this.items.get(key)?.text || ''; }
  revision(key) { return this.items.get(key)?.revision || 0; }
  set(key, text) {
    if (!key || this.get(key) === text) return;
    if (!text) { this.items.delete(key); this.clock++; return; }
    this.items.delete(key);
    this.items.set(key, {text, revision: ++this.clock});
    while (this.items.size > this.limit) this.items.delete(this.items.keys().next().value);
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
