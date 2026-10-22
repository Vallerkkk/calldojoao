# Recursos sociais e operação

O menu **Sua Órbita**, nas conversas ou configurações, reúne privacidade, listas,
stories, comunidades, interesses, notificações e dados da conta. O feed mantém
carregamento sob demanda. Nenhum serviço pago é ativado pelo código.

## O que está incluído

- Google e Discord no navegador, com verificação dos provedores habilitados.
- Entrada e saída de áudio confirmadas antes de salvar a seleção; retorno ao
  dispositivo anterior quando a alteração falha. O mixer da chamada tem seu
  próprio AudioContext, encerrado ao sair da sala.
- Animações curtas, redução manual de movimento e preferência do sistema.
- Rascunhos por conta/canal/conversa, por até 30 dias neste aparelho, com gravação
  adiada para evitar trabalho a cada tecla. Favoritos de DM também são locais.
- Conta privada com aprovação e remoção de seguidores; listas privadas e
  publicações para seguidores ou pessoas da lista. Amizade continua separada de
  seguir alguém. Silenciar não envia aviso ao outro perfil.
- Feed por relevância e em alta, com limite de candidatos/paginação; enquetes,
  textos de até 10 mil caracteres, citações, reações, perfil com publicação fixada
  e compartilhamento por link. A grade de posts é opcional.
- Stories de até 5 MB, vídeos de até 30 segundos no seletor, limite de 20 arquivos
  por conta e dez destaques. O banco oculta os stories após 24 h, exceto destaques.
  Os arquivos expirados do próprio usuário são removidos ao abrir os stories.
  Um usuário que não voltar ao aplicativo pode manter arquivos expirados no
  armazenamento; expiração de visibilidade não equivale a um serviço de limpeza
  global agendado.
- Cargos de interesse sem poderes administrativos. Regras versionadas bloqueiam
  leitura dos canais até a aceitação. O fluxo oferece interesses antes de entrar.
- Busca de pessoas/posts/hashtags/comunidades; histórico local por conta;
  sugestões por conexões em comum; comunidades públicas em crescimento.
- Perfis externos e prévias de posts **somente após ativação explícita** em
  privacidade, e somente para conteúdo público de contas não privadas. As URLs
  são `/@nickname` e `/p/id`. Respostas privadas não são publicadas por essas rotas.
- Dispositivos conectados, revogação de uma sessão ou de todas as outras,
  exportação JSON e exclusão com confirmação e login recente. Tokens de acesso
  já emitidos continuam sujeitos ao prazo de expiração do Supabase. Arquivos de
  uma exclusão interrompida ficam registrados em `account_cleanup` para limpeza
  administrativa, sem incluir credenciais do usuário.
- Denúncia de perfil e conteúdo, cópia do material denunciado para revisão e
  registro de decisões. Denúncias antigas de chat/feed continuam disponíveis
  nos respectivos painéis anteriores. Apenas administradores do site acessam a
  nova fila e o histórico de decisões.
- Webhooks de texto por canal, até cinco por canal e dez mensagens por minuto.
  A URL privada aparece apenas ao criar; o banco guarda um hash da chave.
  Para trocar a chave, revogue o webhook e crie outro. Payload: `{"content":"Aviso"}`.
  Também aceita payload de push do GitHub. Menções do webhook são neutralizadas.
- Câmera/tela em destaque ao clicar, tela cheia e vídeo flutuante onde o aparelho
  suporta. Vídeos enviados têm botão de ampliar. Chamadas e palcos existentes,
  soundboard, reações, anexos por arrastar/colar e PWA são preservados.

## Google e Discord: configuração necessária

Não coloque segredos no JavaScript, no GitHub ou no chat. Crie os aplicativos nos
provedores e salve os IDs/segredos diretamente em **Supabase > Authentication >
Sign In / Providers**.

Callback para ambos os provedores:

```
https://psreyaufhrquixfjzuek.supabase.co/auth/v1/callback
```

No Google, o origin autorizado é `https://orbita-8nwu.onrender.com`. No Supabase,
configure o Site URL e o retorno permitido como `https://orbita-8nwu.onrender.com/`.
Os botões habilitam quando o Auth informa que o provedor está configurado.
O cadastro social recebe um nome temporário único e oferece escolher o nickname.
Convites e links internos são preservados no retorno.

O instalador Electron atual mantém login por e-mail: ele bloqueia navegação de
OAuth externo por segurança. O login social desta versão funciona no navegador
e na PWA; não abre uma sessão separada fingindo autenticar a janela instalada.

Referências: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Discord](https://supabase.com/docs/guides/auth/social-login/auth-discord).

## Funções do Supabase

- `link-preview`: token do usuário validado em `/auth/v1/user`; allowlist de
  domínios, HTTPS, DNS público, redirecionamentos limitados, timeout e limite do
  HTML. Cache público limitado em memória. Links de posts internos consultam o
  banco com o token do próprio usuário, respeitando RLS, sem cache compartilhado.
- `delete-account`: confirmação `EXCLUIR`, login de até dez minutos e verificação
  de propriedade antes da exclusão. Criadores transferem sua propriedade primeiro.
  Remoção dos arquivos acontece depois de confirmar a exclusão da conta.
- `incoming-webhook`: autenticação própria pela chave aleatória da URL e RPC
  exclusiva do servidor. Nunca retorna chave de serviço ao navegador.
- `daily-digest`: permanece desativada sem Resend, remetente verificado e segredo
  de agendamento. Não possui nenhuma tarefa agendada automaticamente.

`verify_jwt=false` nessas funções não torna ações privadas anônimas: os handlers
validam a identidade ou o segredo correspondente. Isso também evita depender do
verificador legado do gateway para os tokens atuais do Auth.

## E-mail: preparado e desativado

Para ativar futuramente, configure **nos segredos das Edge Functions**
`RESEND_API_KEY`, `RESEND_FROM` e `DIGEST_CRON_SECRET` (aleatório, 32+ caracteres).
Confirme o plano/cotas do provedor antes. Só depois configure
`DAILY_DIGEST_ENABLED=true` no Render para liberar a escolha ao usuário.
O envio requer consentimento na tela de notificações; não é ativado para contas
existentes. Não enviamos corpos de DMs por e-mail.

Agende futuramente um POST por hora à função `daily-digest`, com o segredo de cron
no Authorization. O handler seleciona 18h do fuso de cada usuário, respeita horário
de silêncio, usa idempotência e reserva no máximo 50 envios/dia e 1.500/mês para o
app. Esses limites não consideram uso da mesma conta Resend por outros aplicativos.
Não foi criada conta, agenda ou contratação para esse recurso.

Referência: [API de envio do Resend](https://resend.com/docs/api-reference/emails/send-email).

## Banco, build e validação

A única fonte de esquema é `supabase/migrations`. `supabase.sql` é gerado por
`python scripts/database.py --write`; não aplique o snapshot completo no projeto
existente. A nova migração é testada em transação com rollback antes de aplicar.
Veja também a documentação de migrações existente para conciliar o histórico
antigo antes de usar `db push`.

Depois de editar a interface, rode `npm run build` e versione o manifest e os
arquivos com hash. Não apague hashes já publicados: clientes antigos ainda podem
pedir módulos sob demanda. Não publique `node_modules`, `.env` ou `work`.

Testes incluem: permissões negativas no SQL, contas privadas, listas, cargos,
regras, enquetes, denúncias/auditoria, webhook e exclusão com dados fictícios e
rollback. Navegador cobre PC/celular, rascunhos, privacidade, buscas e controles de
áudio. Dispositivos reais e credenciais OAuth não são simulados como se estivessem
validados em produção. Os testes das funções não enviam e-mails nem apagam contas
reais.
