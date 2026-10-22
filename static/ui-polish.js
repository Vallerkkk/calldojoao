/* Órbita — microinterações de interface.
   Camada independente: observa o DOM já renderizado e acrescenta apenas
   classes/animações efêmeras. Nenhuma lógica de dados é alterada. */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motionOn = !reduceMotion.matches;
reduceMotion.addEventListener?.('change', event => { motionOn = !event.matches; });

const list = document.getElementById('message-list');
const main = document.querySelector('.main');

/* 1. Mensagens que chegam ganham uma entrada curta. Lotes grandes (histórico,
      troca de canal) não são animados para preservar a fluidez do scroll. */
if (list) {
  const seen = new WeakSet();
  let frame;
  const animate = nodes => {
    const fresh = [...new Set(nodes)].filter(node => node.isConnected && !seen.has(node));
    if (fresh.length > 4) { fresh.forEach(node => seen.add(node)); return; }
    for (const node of fresh) {
      seen.add(node);
      node.classList.add('ui-message-in');
      node.addEventListener('animationend', () => node.classList.remove('ui-message-in'), {once: true});
    }
  };
  new MutationObserver(records => {
    if (!motionOn || document.body.dataset.reduceMotion==='true' || records.length > 40) return;
    const added = [];
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.('.message')) added.push(node);
      else added.push(...(node.querySelectorAll?.('.message') || []));
    }
    if (!added.length) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => animate(added));
  }).observe(list, {childList: true});

  /* 2. Sombra progressiva no cabeçalho quando o histórico está rolado. */
  let scrolled = false, scrollFrame;
  list.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const next = list.scrollTop > 6;
      if (next === scrolled) return;
      scrolled = next;
      main?.toggleAttribute('data-scrolled', next);
    });
  }, {passive: true});

  /* 3. Ao trocar de canal, um fade curto suaviza a substituição do histórico. */
  let scopeTimer;
  new MutationObserver(records => {
    if (!motionOn || document.body.dataset.reduceMotion==='true') return;
    let removed = 0, added = 0;
    for (const record of records) { removed += record.removedNodes.length; added += record.addedNodes.length; }
    if (removed < 5 || added < 5) return;
    list.classList.remove('ui-scope-in');
    void list.offsetWidth;
    list.classList.add('ui-scope-in');
    clearTimeout(scopeTimer);
    scopeTimer = setTimeout(() => list.classList.remove('ui-scope-in'), 260);
  }).observe(list, {childList: true});
}

/* 3. Escalonamento sutil na entrada dos canais recém-renderizados. */
const stagger = root => {
  if (!root) return;
  [...root.children].forEach((node, index) => node.style.setProperty('--nav-index', String(Math.min(index, 12))));
};
const channels = [document.getElementById('text-channels'), document.getElementById('voice-channels')];
for (const root of channels) {
  stagger(root);
  new MutationObserver(() => stagger(root)).observe(root, {childList: true});
}

/* 4. A dica de teclado aparece só em dispositivos com teclado. */
if (!matchMedia('(pointer: fine)').matches) document.documentElement.classList.add('ui-touch');
