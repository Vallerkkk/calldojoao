export const conversationKey = (user, target) => user && target?.id ? `${user}:${target.private ? 'dm' : 'channel'}:${target.id}` : '';

// O cache é da sessão: não persiste mensagens privadas no dispositivo.
export class ConversationCache {
  constructor({limit = 12, rows = 2000, ttl = 300000, now = Date.now} = {}) {
    this.limit = limit; this.rows = rows; this.ttl = ttl; this.now = now; this.items = new Map();
  }
  save(key, view) {
    if (!key) return;
    this.items.delete(key);
    if (view.messages.size > this.rows) return;
    this.items.set(key, {...view, messages: new Map(view.messages), expires: this.now() + this.ttl});
    while (this.items.size > this.limit || [...this.items.values()].reduce((sum, item) => sum + item.messages.size, 0) > this.rows) this.items.delete(this.items.keys().next().value);
  }
  get(key) {
    const view = this.items.get(key);
    if (!view) return;
    if (view.expires <= this.now()) { this.items.delete(key); return; }
    this.items.delete(key); this.items.set(key, view);
    return {...view, messages: new Map(view.messages)};
  }
  patch(key, message) { const view = this.items.get(key); if (view) { view.messages.set(message.id, message); this.save(key, view); } }
  remove(key, id) { this.items.get(key)?.messages.delete(id); }
  retain(predicate) { for (const key of this.items.keys()) if (!predicate(key)) this.items.delete(key); }
  clear() { this.items.clear(); }
}

// IDs locais nunca são enviados ao banco; o servidor continua gerando os IDs reais.
export class MessageOutbox {
  constructor(limit = 40) { this.limit = limit; this.items = new Map(); }
  add(user, target, content, reply) {
    if (this.items.size >= this.limit) throw Error('Resolva os envios pendentes antes de enviar mais mensagens.');
    const record = {id: 'local-' + crypto.randomUUID(), user, target: {...target}, key: conversationKey(user, target), content, reply, created_at: new Date().toISOString(), status: 'sending', observedId: null};
    this.items.set(record.id, record); return record;
  }
  rows(user, target) {
    const key = conversationKey(user, target);
    return [...this.items.values()].filter(item => item.key === key && !item.observedId).map(item => ({id: item.id, author_id: item.user, content: item.content, reply_to: item.reply, created_at: item.created_at, local_state: item.status, local_error: item.error, reactions: []}));
  }
  observe(user, target, message) {
    const key = conversationKey(user, target);
    const matches = [...this.items.values()].filter(item => item.key === key && !item.knownIds?.has(message.id) && item.user === message.author_id && item.content === message.content && (item.reply || null) === (message.reply_to || null) && !message.thread_root && ['sending', 'uncertain', 'checking'].includes(item.status) && Math.abs(Date.parse(message.created_at) - Date.parse(item.created_at)) < 300000);
    if (matches.length === 1) { matches[0].observedId = message.id; return matches[0]; }
  }
  remove(id) { this.items.delete(id); }
  clear() { this.items.clear(); }
}

// A navegação cancela leituras antigas; o prazo impede controles presos em redes instáveis.
export function requestWithDeadline(query, {signal, timeout = 15000} = {}) {
  if (signal?.aborted) { const error = new Error('Leitura cancelada.'); error.name = 'AbortError'; return Promise.reject(error); }
  const controller = new AbortController(); let timer, cancel;
  const stop = name => { const error = new Error(name === 'TimeoutError' ? 'A conexão demorou demais. Tente novamente.' : 'Leitura cancelada.'); error.name = name; controller.abort(); cancel(error); };
  const cancellation = new Promise((_, reject) => { cancel = reject; });
  const abort = () => stop('AbortError');
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
  timer = setTimeout(() => stop('TimeoutError'), timeout);
  const task = Promise.resolve().then(() => {
    if (controller.signal.aborted) return cancellation;
    return typeof query === 'function' ? query(controller.signal) : typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
  });
  return Promise.race([Promise.resolve(task), cancellation]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
}
