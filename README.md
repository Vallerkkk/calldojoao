# Órbita

Aplicação de comunidade com mensagens em tempo real, lista de amigos, conversas privadas, chamadas de áudio e vídeo, compartilhamento de tela, redução de ruído no microfone e player de áudio compartilhado.

## Serviços

- Supabase Auth, Postgres, Realtime e Storage privado para mensagens, perfis e arquivos.
- LiveKit Cloud para chamadas de voz, vídeo e compartilhamento de tela.
- Render para hospedar o servidor Python e entregar a interface.

Os arquivos ficam em um bucket privado do Supabase e respeitam o acesso ao canal ou à conversa privada. O limite do Órbita é 25 MB por arquivo. No plano Free, o armazenamento total é limitado pela cota atual do Supabase.

## Publicação

O Render publica a branch `main` usando `render.yaml`. Configure no Render as variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. Não publique o arquivo `.env` nem use chaves secretas no navegador.

Para instalar ou atualizar o esquema em um projeto Supabase novo, execute `supabase.sql`. Para um projeto existente, aplique as migrações em `migrations/` na ordem indicada pelos nomes. As credenciais e chaves secretas devem ficar nas variáveis de ambiente do Render.

## Desenvolvimento local

Copie `.env.example` para `.env`, configure as variáveis e execute `iniciar_orbita.bat`. Os testes do servidor podem ser executados com `python -m unittest discover -s tests -v`.

A permissão de microfone, câmera e compartilhamento de tela é solicitada pelo navegador. Para transmitir áudio da tela, selecione uma aba ou janela compatível e marque a opção de compartilhar áudio oferecida pelo próprio navegador.
## Organização dos fontes

A interface utilizada pelo servidor fica em `static/index.html`. O servidor inicia por `app:app`. O esquema principal fica em `supabase.sql`, e as alterações incrementais em `migrations/`. O aplicativo Windows e o atualizador ficam em `desktop/`. As pastas `tests/`, `.github/` e os lockfiles são necessários para validação e publicação.

O arquivo `.env` e o ambiente `.venv/` são locais e não devem ser enviados ao GitHub ou Render.


## Feed geral da Órbita

O ícone ◈ da barra lateral abre o feed de todos os usuários autenticados. Ele tem abas Explorar, Seguindo, Salvos, Pessoas e Notificações. Publicações aceitam 280 caracteres e até quatro imagens, GIFs ou vídeos. Imagens são comprimidas no dispositivo; limites por arquivo: 2 MB para imagem/GIF e 25 MB para vídeo. O espaço do bucket privado `orbita-feed` compartilha a cota do projeto Supabase existente.

Inclui respostas em conversa, citações, republicações, curtidas, favoritos privados, seguir/deixar de seguir, busca por texto/pessoas, hashtags, menções clicáveis, links de publicação, edição e exclusão com confirmação. Os perfis usam a conta, avatar, banner e biografia existentes. Colar imagens e arrastar arquivos funciona no compositor. Chamadas continuam conectadas ao navegar no feed. Novas publicações aparecem por um aviso do Realtime, preservando a posição de leitura.

Bloqueios escondem publicações nas duas direções; denúncias são privadas e administradores/criadores do site podem revisá-las e apagar publicações. Anexos usam URLs assinadas de cinco minutos. Notificações mostram as últimas 50 curtidas, republicações, respostas, citações e novos seguidores; são consultadas ao abrir a aba, não enviadas como push. A aba Seguindo ordena publicações pela data original e inclui republicações das contas seguidas.

As duas migrações `supabase/migrations/*_social_feed*.sql` precisam estar aplicadas antes de publicar o frontend. Foram aplicadas neste projeto pela integração do Supabase. Elas só adicionam o feed e seu bucket, sem alterar tabelas de chat. Não é necessária nova chave nem assinatura de serviço. Os limites dos planos gratuitos existentes continuam valendo.

Validação: `tests/feed_browser.cjs` cobre PC e celular com uma conta simulada; `tests/social_feed_access.sql` valida RLS, mídia e notificações com dados temporários, terminando em ROLLBACK. Os testes de navegador usam as mesmas dependências locais dos demais testes e o endereço ORBITA_TEST_URL (padrão http://127.0.0.1:8766/).
