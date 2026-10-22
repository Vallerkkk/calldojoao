import { requestWithDeadline } from './chat-state.js';

// Calls open on the provider's own origin; its hardware check owns media permissions.
export function choosePrivateCall(context, conversation, integratedCall) {
  const { el, button, showDialog, state, apiFetch } = context;
  const owner = state().session?.user.id;
  showDialog('Como você quer ligar?', box => {
    box.append(el('p', 'muted', 'A chamada integrada mantém os controles do Órbita. A opção no Brasil abre a Videochamada em outra aba.'));
    box.append(button('Chamada integrada — LiveKit', () => {
      if (state().session?.user.id !== owner) throw Error('Sua conta mudou. Reabra a conversa.');
      return integratedCall();
    }, 'primary'));
    box.append(button('Chamada no Brasil — criar convite', () => {
      if (state().room) throw Error('Saia da chamada atual antes de iniciar outra.');
      const request = { request_id: crypto.randomUUID(), expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
      showDialog('Chamada no Brasil', panel => {
        panel.append(el('p', '', 'Até 4 participantes, sem gravação ou transcrição. O convite expira em cerca de uma hora.'));
        panel.append(el('p', 'muted', 'Envie o convite somente na conversa privada. Quem tiver o link poderá entrar. Não é necessário ativar câmera ou microfone para criar o convite.'));
        const status = el('p', 'muted'); status.setAttribute('role', 'status');
        const create = button('Criar convite privado', async () => {
          if (state().session?.user.id !== owner) throw Error('Sua conta mudou. Reabra a conversa.');
          if (state().room) throw Error('Saia da chamada atual antes de iniciar outra.');
          status.textContent = 'Preparando convite…';
          try {
            const response = await requestWithDeadline(apiFetch(`/api/conversations/${conversation.id}/videochamada`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
            }), { timeout: 22000 });
            const result = await response.json();
            if (!panel.isConnected || state().session?.user.id !== owner) return;
            const url = new URL(result.url);
            if (url.protocol !== 'https:' || !/(^|\.)videochamada\.com\.br$/.test(url.hostname) || url.username || url.password) throw Error('O convite retornado é inválido.');
            const deadline = new Date(result.expiresAt);
            if (!Number.isFinite(deadline.getTime())) throw Error('O prazo do convite é inválido.');
            create.remove(); status.textContent = 'Convite pronto. Válido até ' + deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.';
            const open = el('a', 'primary', 'Abrir chamada em outra aba ↗');
            open.href = url.href; open.target = '_blank'; open.rel = 'noopener noreferrer'; panel.append(open);
            panel.append(button('Inserir convite na conversa', () => {
              const current = state();
              if (current.session?.user.id !== owner || !current.selected?.private || current.selected.id !== conversation.id || current.selected.kind !== 'text') throw Error('Volte à conversa privada para inserir este convite.');
              context.insertInvitation('📹 Chamada privada — Videochamada\n' + url.href + '\nVálida até ' + deadline.toLocaleString('pt-BR') + '.');
            }, 'soft-button'));
            panel.append(button('Copiar link do convite', async () => {
              try { await navigator.clipboard.writeText(url.href); status.textContent = 'Link copiado. Compartilhe somente com os participantes.'; }
              catch { const input = el('input'); input.value = url.href; input.readOnly = true; input.setAttribute('aria-label', 'Link privado da chamada'); panel.append(input); input.focus(); input.select(); status.textContent = 'Selecione e copie o link acima.'; }
            }));
          } catch (error) {
            if (panel.isConnected && state().session?.user.id === owner) status.textContent = error.message || 'Não foi possível criar o convite. Tente novamente.';
          }
        }, 'primary');
        panel.append(status, create);
      });
    }));
  });
}
