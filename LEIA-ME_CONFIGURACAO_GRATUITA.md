# Órbita — versão sem Google Cloud

Execute iniciar_orbita.bat e abra http://127.0.0.1:8000. O HTML depende do servidor; não abra por file://.

A interface vem do index.html fornecido na pasta jesus. Login, amigos, mensagens privadas, comunidades, enquetes, cargos e chamadas usam o backend autenticado existente. Supabase e LiveKit são configurados pelo .env, que não deve ser publicado.

A configuração local mantém o projeto Supabase da Órbita já preparado, com as contas existentes. O outro projeto presente no protótipo possui um esquema incompatível. supabase.sql documenta o esquema para uma instalação nova.

Não há integração Google Cloud, Firebase ou Drive. Arquivos e músicas usam um bucket privado do Supabase Storage; o plano gratuito inclui até 1 GB armazenado e o aplicativo limita cada arquivo a 25 MB. O áudio da tela depende da autorização na janela do navegador, preferencialmente compartilhando uma aba.

VallerJP mantém o cargo registrado no banco. Kalil deve aceitar o convite privado já gerado; apenas escolher esse nome não concede administração.

Esta pasta é uma versão local. Para publicar, envie apenas os fontes e configure as cinco variáveis do .env no Render. Nunca envie .env ou .venv. A chave secreta embutida no pacote anterior foi removida dos fontes ativos e deve ser revogada no projeto de origem.
