# Revisão de qualidade — 20/10/2026

Esta revisão mantém a identidade visual da interface aprovada e corrige comportamento, desempenho e privacidade.

## Mensagens e navegação

- Rascunhos em memória separados por conta e canal, preservados ao navegar e limpos no logout. Um envio lento não apaga uma mensagem digitada depois.
- Campo com múltiplas linhas: Enter envia, Shift+Enter quebra linha. Sem conexão, o texto permanece disponível e o envio é bloqueado.
- Recuperação de falhas de inicialização com botão de tentar novamente e sem duplicar assinaturas de autenticação.
- Lista de membros restrita à comunidade atual; perfis atualizados; cargos e indicadores sem duplicação.
- Threads fecham quando a mensagem principal é apagada; respostas removidas atualizam a conversa.
- Criação de canais consulta o ID após a inserção, evitando o conflito de visibilidade das políticas de acesso dentro da mesma instrução.

## Chamadas e acesso

- Pressionar para falar aplica comandos em ordem, inclusive quando o microfone demora a abrir. Soltar a tecla, perder foco ou sair da chamada solicita o fechamento do microfone.
- Ensurdecer desativa a reprodução e o microfone; plateia e usuários ensurdecidos não podem abrir o microfone pelo atalho.
- Alterações de membros, privacidade, palco e cargos conciliam os participantes da chamada com as permissões do banco. Pessoas sem acesso são desconectadas; a plateia perde a permissão de publicar. Se o LiveKit estiver indisponível, o site informa que a sincronização precisa ser repetida.
- A exclusão de sala solicita primeiro seu encerramento no LiveKit. A autorização para isso é verificada no servidor.

## Servidor, armazenamento e notificações

- Conexões HTTP reutilizadas, limites de concorrência, timeouts e respostas compreensíveis em falhas externas.
- Respostas inválidas de autenticação, dados ou permissões não geram tokens de chamada.
- Compressão HTTP para reduzir transferência. Proteção contra incorporação do site em outra página.
- Uploads de perfil que falham são removidos; imagens antigas de propriedade da conta são liberadas após salvar a substituição. Anexos ainda referenciados não são apagados.
- Fila de push limitada a cinco mensagens por lote, lease de 90 segundos, entrega com concorrência e duração limitadas e proteção contra despachos simultâneos na mesma instância.
- Versões das dependências de produção fixadas e instaladas num ambiente isolado para validação.

## Validação

- 38 testes Python passaram com as versões de produção; 7 testes JavaScript passaram.
- Chrome automatizado em desktop e celular com contas, LiveKit e dispositivos simulados: rascunhos, envio lento, múltiplas linhas, offline, threads, busca, edição, criação de canal privado, compressão, limpeza de avatar, temas, microfone, ensurdecer, saída e menus. Sem erros de JavaScript.
- Navegação adicional em 320, 768 e 1440 px; login em 390 e 1440 px.
- Testes SQL transacionais executados no Supabase: canais privados, palco, revogação de acesso, timeout, banimento, auditoria, isolamento de DMs/threads, busca, edição e fila de push. Os dados temporários são revertidos com ROLLBACK.
- Duas migrações incrementais aplicadas: notification_batch_limit e voice_access_reconciliation.

## Limitações e pendências

Os testes automatizados de mídia usam dispositivos simulados. Chamadas entre dispositivos reais, permissões do sistema e entrega real de push precisam de validação com os dispositivos do proprietário. Não foram contratados serviços pagos nem criadas contas externas de monitoramento ou GIFs.

O advisor do Supabase mantém um aviso anterior de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Nenhum plano foi alterado.

A chave secreta do LiveKit enviada anteriormente ao repositório deve ser substituída no painel do LiveKit e no ambiente do Render. O arquivo .env não integra esta publicação; remover o arquivo atual não apaga o segredo do histórico do Git.
