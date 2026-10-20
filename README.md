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