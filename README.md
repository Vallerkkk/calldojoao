# Órbita

Aplicação de comunidade com mensagens em tempo real, lista de amigos, conversas privadas, chamadas de áudio e vídeo, compartilhamento de tela, redução de ruído no microfone e player de áudio compartilhado.

## Serviços

- Supabase Auth, Postgres, Realtime e Storage privado para mensagens, perfis e arquivos.
- LiveKit Cloud para chamadas de voz, vídeo e compartilhamento de tela.
- Render para hospedar o servidor Python e entregar a interface.

Os arquivos ficam em um bucket privado do Supabase e respeitam o acesso ao canal ou à conversa privada. O limite do Órbita é 25 MB por arquivo. No plano Free, o armazenamento total é limitado pela cota atual do Supabase.

## Publicação

O Render publica a branch `main` usando `render.yaml`. Configure no Render as variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. Não publique o arquivo `.env` nem use chaves secretas no navegador.

Em um projeto Supabase novo, execute uma vez o `supabase.sql` gerado. Em projetos existentes, aplique somente migrações ainda pendentes de `supabase/migrations/`, conferindo o histórico remoto. Não reaplique o baseline ou o arquivo completo em produção. As credenciais e chaves secretas devem ficar nas variáveis de ambiente do Render.

## Desenvolvimento local

Copie `.env.example` para `.env`, configure as variáveis e execute `iniciar_orbita.bat`. Os testes do servidor podem ser executados com `python -m unittest discover -s tests -v`.

A permissão de microfone, câmera e compartilhamento de tela é solicitada pelo navegador. Para transmitir áudio da tela, selecione uma aba ou janela compatível e marque a opção de compartilhar áudio oferecida pelo próprio navegador.
## Organização dos fontes

A interface utilizada pelo servidor fica em `static/index.html`. O servidor inicia por `app:app`. A fonte editável do banco é `supabase/migrations/`; `supabase.sql` é gerado por `python scripts/database.py --write`. O aplicativo Windows e o atualizador ficam em `desktop/`. As pastas `tests/`, `.github/` e os lockfiles são necessários para validação e publicação.

O arquivo `.env` e o ambiente `.venv/` são locais e não devem ser enviados ao GitHub ou Render.


## Feed geral da Órbita

O ícone ◈ da barra lateral abre o feed de todos os usuários autenticados. Ele tem abas Explorar, Seguindo, Salvos, Pessoas e Notificações. Publicações aceitam 280 caracteres e até quatro imagens, GIFs ou vídeos. Imagens são comprimidas no dispositivo; limites por arquivo: 2 MB para imagem/GIF e 25 MB para vídeo. O espaço do bucket privado `orbita-feed` compartilha a cota do projeto Supabase existente.

Inclui respostas em conversa, citações, republicações, curtidas, favoritos privados, seguir/deixar de seguir, busca por texto/pessoas, hashtags, menções clicáveis, links de publicação, edição e exclusão com confirmação. Os perfis usam a conta, avatar, banner e biografia existentes. Colar imagens e arrastar arquivos funciona no compositor. Chamadas continuam conectadas ao navegar no feed. Novas publicações aparecem por um aviso do Realtime, preservando a posição de leitura.

Bloqueios escondem publicações nas duas direções; denúncias são privadas e administradores/criadores do site podem revisá-las e apagar publicações. Anexos usam URLs assinadas de cinco minutos. Notificações mostram as últimas 50 curtidas, republicações, respostas, citações e novos seguidores; são consultadas ao abrir a aba, não enviadas como push. A aba Seguindo ordena publicações pela data original e inclui republicações das contas seguidas.

As duas migrações `supabase/migrations/*_social_feed*.sql` precisam estar aplicadas antes de publicar o frontend. Foram aplicadas neste projeto pela integração do Supabase. Elas só adicionam o feed e seu bucket, sem alterar tabelas de chat. Não é necessária nova chave nem assinatura de serviço. Os limites dos planos gratuitos existentes continuam valendo.

Validação: `tests/feed_browser.cjs` cobre PC e celular com uma conta simulada; `tests/social_feed_access.sql` valida RLS, mídia e notificações com dados temporários, terminando em ROLLBACK. Os testes de navegador usam as mesmas dependências locais dos demais testes e o endereço ORBITA_TEST_URL (padrão http://127.0.0.1:8766/).


## Ouvir juntos com vídeos do YouTube

Entre em uma chamada, abra Ouvir juntos e cole um link do YouTube. São aceitos links normais, curtos, Shorts, transmissões /live/ e YouTube Music, inclusive com tempo inicial no link. O primeiro orador a selecionar um vídeo controla a reprodução; Reproduzir, Pausar e mudanças de posição são sincronizados pela conexão LiveKit já existente. Quem chega depois recebe o vídeo e a posição atuais. Quando o anfitrião sai, o controle passa para um participante que pode transmitir.

Cada participante pode precisar tocar em Reproduzir áudio aqui devido às regras de reprodução automática do navegador/celular. Não há download nem retransmissão de arquivos do YouTube: cada dispositivo usa o player oficial incorporado. Vídeos privados, removidos ou com incorporação bloqueada pelo autor não funcionam no player; o painel mostra o motivo e oferece Abrir vídeo no YouTube. Não é necessária chave da YouTube Data API nem serviço pago.

A política Referrer-Policy envia somente a origem em solicitações externas HTTPS, permitindo ao YouTube identificar o site sem transmitir o caminho ou os parâmetros da página. A validação de inicialização usa o painel como referência porque a API substitui o elemento original por um iframe. Testes: tests/youtube-links.test.mjs e tests/youtube_watch_browser.cjs, incluindo dois participantes, PC/celular, troca de vídeo, chegada tardia, pausa, erros, nova tentativa, transferência do controle e saída da chamada.


## Áudio separado e câmera do celular

Cada participante remoto tem dois controles de volume: Microfone e Transmissão (áudio do compartilhamento de tela). Os níveis de 0 a 100% ficam salvos neste navegador/dispositivo e são reaplicados quando chega uma nova faixa ou a conexão se recupera. O botão de ensurdecer zera ambos temporariamente e restaura os níveis escolhidos. O nível anterior por usuário foi preservado como volume do microfone; a transmissão começa com 100%.

A recepção usa o controle de volume por faixa do LiveKit e Web Audio quando disponível, inclusive para permitir ajuste em navegadores móveis que limitam o volume do elemento HTML. O áudio da transmissão precisa ser enviado por quem está compartilhando a tela; o controle não cria áudio quando a transmissão não o inclui.

A escolha Frontal/Traseira fica na seta ao lado do botão da câmera (Opções de câmera). É possível escolher com o vídeo desligado, sem abrir a câmera, ou alternar durante a chamada. A preferência é salva no dispositivo; a prévia local frontal é espelhada, e a traseira não. Se a troca falhar, o aplicativo tenta restaurar a câmera anterior. O recurso depende das câmeras e permissões disponíveis no navegador/aparelho.

Validação automatizada: tests/call_controls_browser.cjs cobre volumes independentes, zero, recuperação ao reconectar, ensurdecer/restaurar, preferências anteriores, foco, escolha/troca de câmera, recuperação de falha e ligar novamente com outra câmera. Os dispositivos e faixas são simulados; é recomendável verificar a troca também em um aparelho físico com duas câmeras.


## Grade e controles das chamadas

As chamadas usam um palco preto com grade adaptativa, nomes sobrepostos e contorno verde de quem está falando. Cada pessoa ocupa um quadro: ao ativar a câmera, o vídeo substitui o avatar. Cada tela compartilhada ocupa um quadro adicional. A grade considera a altura disponível no PC e permite rolagem no celular sem esconder os controles.

A barra inferior reúne microfone, câmera, transmissão, reação, efeitos sonoros, mais opções e desconexão. As setas abrem as opções de áudio, câmera frontal/traseira e inclusão do áudio da tela. O menu de três pontos de cada participante (também acessível com clique direito) permite ajustar separadamente microfone e transmissão. As preferências de áudio continuam locais ao dispositivo.

O canto inferior direito oferece vídeo flutuante e tela cheia da chamada; cada vídeo também tem esses atalhos. O menu superior abre canais e conversas. O botão de conversa mantém a chamada conectada e o atalho “Voltar à chamada” permite retornar, inclusive no celular. Ouvir juntos com YouTube permanece no topo e em Mais opções.

Validação: tests/call_layout_browser.cjs cobre a grade 2×2, ausência de quadros duplicados, nomes acessíveis, menus, microfone, câmera, transmissão, áudio da tela, ensurdecer, reações, efeitos, convites, tela cheia, encaminhamento ao Picture-in-Picture, navegação sem desconexão e limpeza. A suíte roda em tamanhos de PC e celular com usuários e dispositivos simulados. Os testes de ciclo de mídia, volumes/câmeras, YouTube e navegação continuam separados.


## Navegação e chat da comunidade

A busca rápida (Ctrl/Command+K ou Buscar canais e conversas na lateral) filtra canais, servidores, DMs e amigos já acessíveis à conta. As setas escolhem o destino e Enter abre; destinos recentes guardam somente identificadores locais, separados por conta. Categorias de canais podem ser recolhidas por servidor; o canal selecionado, chamadas conectadas e canais não lidos continuam disponíveis.

O chat mostra separadores de dias, horários das mensagens agrupadas ao passar o mouse, perfis clicáveis e ações rápidas de responder/curtir no PC. Clique direito abre as mesmas ações autorizadas do menu original; seleção de texto e links mantêm o menu nativo. Excluir continua pedindo confirmação. Seta para cima no campo vazio abre a edição da última mensagem própria carregada. Alt+Seta muda de canal; Ctrl/Command+Shift+M alterna o microfone; Ctrl/Command+Shift+D alterna ensurdecer. A busca rápida oferece uma lista de atalhos.

Cada vídeo pode ser destacado na chamada e devolvido à grade sem substituir a faixa de mídia. O destaque é local e termina se a transmissão sair. Os volumes independentes, câmera frontal/traseira, Picture-in-Picture, Big Picture, perfis, feed e controles existentes continuam disponíveis. O refinamento visual usa recursos do próprio navegador, sem novos serviços ou dependências.

Validação: tests/community_ux_browser.cjs cobre PC e celular, busca/DMs/teclado, categorias, separadores, ações contextuais e suas permissões, confirmação de exclusão, envio pelo botão visível, atalhos de chamada, destaque/limpeza, tema claro e troca de conta. As suítes de navegação, feed, preferências e layout de chamadas verificam regressões com contas e mídia simuladas.


### Revisão de estabilidade de 21/10/2026

Entradas em chamada têm uma operação cancelável vinculada à conta. Trocar de conta, sair ou abandonar a página cancela a entrada pendente; respostas antigas não abrem o microfone nem encerram uma chamada nova. A verificação se repete após conectar e liberar a reprodução de áudio. Uma falha ao pedir a nova sala preserva a chamada atual. Voltar pelo histórico limpa a interface de captura e restaura presença e mensagens, sem religar o microfone automaticamente.

A configuração inicial, as solicitações da aplicação e a autorização da chamada têm limite de espera de 30 segundos e retornam controles utilizáveis para tentar novamente. Leituras canceladas não iniciam consultas. Inicializações antigas deixam de atualizar canais e assinaturas de outra conta. A confirmação da caixa de saída ignora mensagens que já estavam carregadas antes do envio, mesmo quando têm texto e horário semelhantes.

O service worker guarda somente recursos estáticos da interface e ícones, com até 80 recursos além da tela offline e seus ícones. Substitui versões antigas do mesmo caminho e ignora instaladores, intervalos de arquivos, APIs e solicitações sem cache. Falhas de quota não interrompem respostas da rede. Metadados opcionais inválidos de perfil não quebram a emissão de tokens; uma conversa privada incompleta falha com resposta recuperável e sem liberar acesso.

Regressões: `tests/call_session_browser.cjs` cobre tokens atrasados, troca de conta durante a liberação do áudio, nova tentativa após erro e retorno pelo histórico no PC e celular. `tests/service-worker.test.mjs`, `tests/chat-state.test.mjs` e `tests/test_reliability.py` verificam limites do cache, cancelamento, confirmação de envios e respostas incompletas do provedor. Nenhuma migração, dependência ou serviço pago foi adicionado.


### Avatar do painel e vídeos enviados

A foto no painel inferior preenche o círculo de 34 px, com recorte central, sem iniciais por cima e preservando o indicador de presença e a moldura. A troca de conta limpa a foto anterior antes de carregar o novo perfil.

Vídeos enviados ao feed, aos canais, às DMs e às threads têm player inline com reprodução automática sem som ao aparecer na tela. Os controles nativos permitem ativar áudio e pausar. Uma pausa manual é respeitada; sair da área visível ou ocultar a página pausa a reprodução para economizar recursos. Remover a mensagem, fechar a thread ou trocar de conta libera a mídia. Chamadas e YouTube mantêm seus controles independentes. Se o navegador bloquear a reprodução automática, o botão de reproduzir continua disponível.

`tests/media_autoplay_browser.cjs` usa um vídeo WebM gerado no navegador e contas simuladas para verificar reprodução real, mute inicial, pausa, navegação, limpeza de mídia e avatar no PC e no celular.


### Atualização Jesus (11)

Importados os oito temas adicionais, os cartões de edição e personalização de perfil, banners de 160 px e o enquadramento ampliado das mídias do feed. A integração preserva o avatar inferior corrigido, a reprodução automática sem som, os controles de chamada e a recuperação de sessão. Diálogos de perfil permitem rolagem em telas baixas e fechamento com área de toque de 44 px; o editor mantém checkboxes no tamanho correto e avatar com dimensões definidas.

`tests/jesus11_browser.cjs` verifica cartões, dimensões, temas e persistência no PC e celular. O pacote enviado não altera o backend ou o banco de dados. Arquivos locais de ambiente e dependências do ZIP não entram na publicação.


### Áudio e reações da chamada

A coluna lateral direita de membros e seu botão foram retirados. Perfis continuam acessíveis pelas mensagens, amigos e participantes da chamada. O conteúdo ocupa o espaço disponível também no celular, sem montar a lista lateral oculta.

Configurações e Opções de áudio da chamada oferecem seleção de microfone e saída, com preferências locais e aplicação imediata. A troca usa a API do LiveKit e mantém os volumes individuais e o estado de mute. Os sons do aplicativo e vídeos enviados acompanham a saída escolhida quando o navegador oferece a API; navegadores sem suporte indicam que a saída deve ser escolhida no sistema. Atualizar dispositivos solicita permissão explicitamente e encerra o fluxo temporário de microfone.

A redução de ruído adicional usa RNNoise em WebAssembly/AudioWorklet, com filtro de graves, processamento a 48 kHz e execução no próprio aparelho. O modo padrão é aprimorado; é possível escolher somente o filtro do navegador. Falhas de compatibilidade ou carregamento preservam a supressão nativa e o microfone. O processador reinicia ao trocar de entrada e libera seus nós, faixas de saída e contexto de áudio ao encerrar. Fontes e licenças das dependências fixadas estão em `static/vendor/rnnoise-0.4.1/`.

O seletor de reações oferece 12 emojis, animações com nome do participante, indicação acessível, limite de frequência por pessoa e limpeza ao sair. Reduzir movimento é respeitado. Sons de aviso, entrada/saída e efeitos usam envelopes suaves e compressão, com volumes separados para avisos e soundboard. Aplausos e Pop se juntam aos quatro efeitos anteriores; controles de silêncio e Não perturbe continuam respeitados.

`tests/audio_experience_browser.cjs` executa o RNNoise real com ruído sintético, mede redução do sinal e verifica reinício/limpeza. Testa ainda seleção de dispositivos simulados, retorno após falha, fallback do filtro, saída indisponível, reações remotas e volumes no PC e celular. Nenhum dispositivo físico é aberto pelos testes e nenhum serviço pago foi adicionado.


### Nickname, entrada e administração

O cadastro e o editor usam um nickname único de 3–24 letras, números ou sublinhado. O @ é o mesmo nome em minúsculas; por exemplo, VallerJP → @vallerjp. O banco sincroniza o identificador quando o nome muda e rejeita duplicatas. Contas existentes mantêm identificadores personalizados até editarem o perfil; identificadores automáticos foram substituídos somente quando o nome era válido, único e disponível. Nomes não concedem permissões. A entrada mostra uma animação durante o carregamento real da sessão, sem atraso artificial e respeitando reduzir movimento.

Em Configurações → Administração da Órbita, somente contas com cargo de criador podem conceder ou retirar a administração do site. Criadores são protegidos; administradores comuns não podem promover outras pessoas. A função do banco verifica o cargo atual, serializa alterações e registra autor, alvo e ação em site_admin_audit. Não há permissão de escrita direta nas tabelas de cargos ou auditoria.

Comandos no campo de mensagem: /admin, /ajuda, /auditoria, /adm @nickname, /removeradm @nickname, /silenciar @nickname 10 motivo, /liberar @nickname motivo, /banir @nickname motivo e /desbanir @nickname motivo. Comandos são interceptados antes do envio público e ações pedem confirmação. Moderação vale para o servidor aberto e continua validada no servidor. Promoção é global e exclusiva de criadores.

### YouTube como participante da chamada

Ao escolher um vídeo, todos recebem automaticamente um bloco YouTube na grade, junto às câmeras e participantes. Qualquer participante conectado pode reproduzir, pausar, trocar o vídeo e silenciar/liberar o som para todos, inclusive na plateia de um palco. Cada pessoa também possui mute e volume locais. Por padrão o som local começa desligado para respeitar as regras de reprodução automática; Ouvir áudio libera somente o próprio dispositivo. Navegação por canais preserva o player e sair da chamada destrói o iframe e os temporizadores.

Comandos confiáveis do LiveKit usam versão lógica e desempate por identidade para convergir em escolhas simultâneas. Correções periódicas de tempo vêm de uma identidade eleita entre os presentes. Pedidos de estado atendem entradas tardias; dados de fora da sala e pacotes inválidos são ignorados. Não há servidor extra ou serviço pago. Vídeos privados, removidos, restritos pelo autor e bloqueios de reprodução do navegador continuam sujeitos às regras do YouTube; o bloco oferece erro, tentativa novamente e link externo.

Validação: tests/identity_browser.cjs e tests/youtube_watch_browser.cjs cobrem PC/celular com duas contas simuladas. tests/nicknames_admin_access.sql usa transação revertida para testar unicidade, sincronização de nomes, promoção exclusiva do criador, proteção de criadores, revogação, ausência de escrita direta e auditoria sem deixar dados de teste.


## Desempenho, qualidade e operação

A interface de produção é compilada com `npm ci` e `npm run build`, com arquivos compactados, hashes automáticos e carregamento sob demanda. O workflow de qualidade roda em cada push. Consulte [docs/OPERATIONS.md](docs/OPERATIONS.md) para testes, adoção do baseline, PWA, avisos de atualização e configuração opcional de Sentry/Umami/UptimeRobot. As integrações externas permanecem desligadas sem configuração; nenhuma assinatura foi contratada.

## Expansão social e privacidade

Consulte [recursos e operação](docs/social-expansion.md) para os novos controles, limites, login social, funções do Supabase e integrações preparadas sem contratação.

LulaDroid: [transcrição consentida e assistente de voz](docs/luladroid.md).
