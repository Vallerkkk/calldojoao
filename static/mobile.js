/* Experiência mobile: gestos de arrastar, teclado virtual e menu que fecha sozinho. */
(() => {
  const body = document.body, mq = matchMedia('(max-width: 780px)');
  let scrim = document.getElementById('scrim');
  if (!scrim) { scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.setAttribute('aria-hidden', 'true'); body.append(scrim); }
  const close = () => body.classList.remove('mobile-menu-open', 'members-open');
  scrim.onclick = close;
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  // Escolheu um canal ou servidor: fecha o menu depois do clique.
  document.addEventListener('click', e => {
    if (mq.matches && e.target.closest('.sidebar .channel, .rail .server-icon')) setTimeout(close, 120);
  });
  // Gestos: arrastar da borda esquerda abre o menu; arrastar para a esquerda fecha; para baixo fecha os membros.
  let sx = 0, sy = 0, tracking = false;
  addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = mq.matches; }, {passive: true});
  addEventListener('touchend', e => {
    if (!tracking) return; tracking = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) {
      if (dy > 80 && body.classList.contains('members-open') && Math.abs(dx) < 40) close();
      return;
    }
    if (dx > 0 && sx < 28 && !body.classList.contains('mobile-menu-open')) { body.classList.add('mobile-menu-open'); navigator.vibrate?.(8); }
    else if (dx < 0 && body.classList.contains('mobile-menu-open')) close();
  }, {passive: true});
  // Teclado virtual: a altura do app acompanha a área realmente visível.
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => { document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      if (mq.matches && document.activeElement?.id === 'message-input') { const l = document.getElementById('message-list'); if (l) l.scrollTop = l.scrollHeight; } };
    vv.addEventListener('resize', fit); fit();
  }
})();
