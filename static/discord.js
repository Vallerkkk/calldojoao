/* Extras no estilo Discord: seletor rápido (Ctrl+K), Alt+↑/↓ entre canais e spoilers ||texto|| */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const channels = () => [...document.querySelectorAll('#text-channels .channel, #voice-channels .channel')];

  // Seletor rápido
  function openSwitcher() {
    if ($('.qs-backdrop')) return;
    const all = channels(); let sel = 0, shown = all;
    const back = document.createElement('div'); back.className = 'qs-backdrop';
    const box = document.createElement('div'); box.className = 'qs'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Seletor rápido');
    const input = document.createElement('input'); input.placeholder = 'Para onde você quer ir?';
    const list = document.createElement('ul'); const tip = document.createElement('small');
    tip.textContent = 'Enter para abrir · ↑ ↓ para escolher · Esc para fechar';
    box.append(input, list, tip); back.append(box); document.body.append(back);
    const close = () => back.remove();
    const draw = () => {
      list.replaceChildren(...shown.slice(0, 30).map((b, i) => {
        const li = document.createElement('li'); li.textContent = b.textContent.trim();
        if (i === sel) li.className = 'sel';
        li.onclick = () => { b.click(); close(); }; return li;
      }));
      if (!shown.length) { const li = document.createElement('li'); li.textContent = 'Nenhum canal encontrado'; list.replaceChildren(li); }
    };
    input.oninput = () => { const q = input.value.toLowerCase(); shown = all.filter(b => b.textContent.toLowerCase().includes(q)); sel = 0; draw(); };
    input.onkeydown = e => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) { shown[sel].click(); close(); }
    };
    back.onmousedown = e => { if (e.target === back) close(); };
    draw(); input.focus();
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSwitcher(); }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const list = channels(), i = list.findIndex(b => b.classList.contains('active'));
      const next = list[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (next) { next.click(); e.preventDefault(); }
    }
  });

  // Spoilers: ||texto|| vira um bloco que se revela ao clicar (somente nós de texto, sem innerHTML)
  const SP = /\|\|([^|\n]+)\|\|/g;
  function spoilers(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('code,.spoiler') || !n.nodeValue.includes('||') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment(); let last = 0, m; SP.lastIndex = 0;
      while ((m = SP.exec(n.nodeValue))) {
        frag.append(n.nodeValue.slice(last, m.index));
        const s = document.createElement('span'); s.className = 'spoiler'; s.textContent = m[1]; s.title = 'Clique para revelar';
        s.onclick = () => s.classList.toggle('revealed'); frag.append(s); last = m.index + m[0].length;
      }
      if (last) { frag.append(n.nodeValue.slice(last)); n.replaceWith(frag); }
    }
  }
  const list = $('#message-list');
  if (list) { new MutationObserver(() => spoilers(list)).observe(list, { childList: true, subtree: true }); spoilers(list); }
})();
