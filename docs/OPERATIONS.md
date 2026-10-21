# Compilação, banco e serviços opcionais

## Publicar a interface

Use Node 24: `npm ci` e `npm run build`. Commitar os fontes, o lockfile e os arquivos apontados por `static/dist/manifest.json`, além de `static/dist/index.html`. O Render Python entrega esses arquivos já compilados; não precisa instalar Node no servidor. `python scripts/check_build.py` verifica a integridade dos artefatos. Arquivos JS/CSS com hash recebem cache imutável por um ano; HTML, versão e APIs são revalidados ou não armazenados. Não apague arquivos com hash de uma versão publicada enquanto clientes antigos puderem solicitá-los.

O build usa esbuild com divisão de código e Lightning CSS. Feed, estilos do feed, temas extras, busca, aparência do perfil, administração e SDK de telemetria carregam sob demanda. Uma preferência de tema salva é carregada na entrada para respeitar a escolha da pessoa. LiveKit continua sendo importado ao entrar na chamada.

`app.js` continua coordenando a sessão e o chat; ele não foi inteiramente reescrito. Busca, administração, feed, aparência, paletas, atualização e compartilhamento têm módulos próprios. Essa divisão gradual preserva os controles de áudio, chamadas e políticas existentes.

## Uma fonte de verdade para o banco

Edite somente `supabase/migrations/*.sql`. O baseline congela o esquema anterior ao feed; os arquivos seguintes acrescentam feed, atividade, administradores e denúncias. Os antigos patches da pasta `migrations/` estão preservados no histórico Git e no backup local, e foram incorporados no baseline.

Execute `python scripts/database.py --write` após alterar uma migração para gerar `supabase.sql`. A CI rejeita divergência entre o SQL gerado e a cadeia canônica. Não edite o arquivo gerado à mão.

- Projeto novo: executar o `supabase.sql` gerado uma única vez, ou aplicar a cadeia canônica em ordem.
- Projeto existente: aplicar somente a migração nova ainda não aplicada, depois de conferir o histórico remoto. Nunca executar o baseline ou o SQL completo em cima da produção. O projeto atual já tinha feed e administradores; recebeu somente a nova migração de denúncias.
- A consolidação de arquivos não reescreve o histórico interno do Supabase. Antes de adotar `supabase db push` em uma instalação antiga, reconcilie o baseline com o histórico remoto usando o procedimento oficial de migration repair e confirme que o esquema corresponde. Não automatizar repair, reset ou reaplicar patches em produção.

## Verificações automáticas

O workflow `quality.yml` roda em pushes e pull requests de repositórios públicos: 56 testes Python, testes unitários JS, grupos de navegação, chamadas, mídia e qualidade no Chromium, verificação dos artefatos e testes do desktop. Nenhuma credencial Supabase/LiveKit é usada: as contas e mídias de navegador são simuladas. A verificação de acesso SQL foi executada separadamente, com transação revertida, no projeto conectado. Testes históricos de layouts dos ZIPs Jesus 7/8 continuam como referência; a suíte mantida cobre o layout atual.

Para rodar localmente: iniciar `python -m uvicorn app:app --port 8766` e executar `npm run test:browser`. `CHROME_PATH` permite usar um Chrome instalado; sem a variável, instalar o navegador de teste com `npx playwright install chromium`. `accessibility_browser.cjs` usa axe-core e mede as 12 paletas nos modos claro e escuro. Isso ajuda a prevenir regressões e não substitui testes com pessoas ou leitores de tela.

## Sentry e estatísticas (opcionais, desligados por padrão)

Nenhuma conta foi criada e nenhum serviço foi contratado. Para ativar depois, escolher um projeto/plano gratuito e preencher apenas no Render:

- `SENTRY_PUBLIC_DSN`: DSN público do projeto Browser JavaScript. O SDK só é importado quando há configuração. A integração não grava sessões, não cria traces e remove usuário, requisição, breadcrumbs, texto de erro e parâmetros de URLs dos eventos enviados; preserva o tipo do erro e os quadros da pilha.
- `UMAMI_SCRIPT_URL` e `UMAMI_WEBSITE_ID`: endereço HTTPS e ID do site de uma instância Umami que você já tenha. Não foi provisionado servidor ou plano. A integração respeita Do Not Track e envia somente eventos genéricos de tela (`text`, `voice`, `feed`, `friends`), sem IDs, nomes, texto das mensagens ou URLs das conversas.

Não inserir tokens secretos de gerenciamento no frontend. Deixar essas variáveis vazias mantém as integrações desligadas e sem solicitações externas. Plausible não foi adicionado em paralelo para evitar coleta duplicada.

## Monitoramento externo

Quando houver conta UptimeRobot, criar monitor HTTP(s) GET para `https://orbita-8nwu.onrender.com/healthz`, intervalo de 5 minutos e resposta esperada HTTP 200. O endpoint já existe; o monitor ainda não foi criado porque não há conta conectada. Monitoramento detecta falhas, mas não garante disponibilidade nem remove as cotas ou as regras de suspensão do Render Free. Consulte https://render.com/docs/free.

## PWA, mídia e atualização

O manifest contém categorias, screenshots e recebimento de links/imagens. O compartilhamento exige navegador com suporte a Web Share Target e PWA instalada; o aplicativo Windows Electron não passa a registrar o menu de compartilhamento do Windows por causa do manifest. Imagens recebidas ficam no IndexedDB local, com limite de 5 arquivos/25 MB e validade de 30 minutos. Um novo compartilhamento substitui o anterior. A pessoa escolhe o destino e confirma antes do envio; o texto fica como rascunho. Não há upload intermediário para Render.

Vídeos enviados continuam reproduzindo sem som somente quando visíveis. O feed usa um quadro do vídeo como capa após carregar metadados, com CORS anônimo para permitir a captura em canvas. Não foram criadas cópias extras no Storage. Vídeos privados continuam usando URLs assinadas.

O aplicativo consulta `/api/version` ao voltar para a janela, recuperar conexão e a cada 5 minutos enquanto visível. Uma versão diferente mostra aviso: Ctrl + R no Windows ou atualizar a página no navegador. Não há recarga automática durante uma chamada. O botão pede confirmação se houver chamada ou texto não enviado. Rascunhos em memória não sobrevivem à recarga; a confirmação avisa sobre conteúdo pendente. A versão instalada do launcher continua válida.

Busca global usa as políticas atuais do Supabase, com filtros de canal/DM, autor e datas. Denúncias de mensagens só podem referenciar mensagens acessíveis ao denunciante. Administradores podem resolver denúncias; a denúncia não concede acesso ao conteúdo de DMs. Threads, status personalizado, moderação e auditoria existentes foram preservados.
