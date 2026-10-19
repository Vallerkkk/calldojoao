# Conectar o Google Drive à Órbita

A versão Órbita Social usa uma pasta central do proprietário. O Supabase guarda contas, amizades, mensagens e permissões; o Drive guarda os arquivos. O player de música usa arquivos de áudio dessa mesma pasta.

## Configuração necessária

1. No [Google Cloud](https://console.cloud.google.com/), selecione ou crie um projeto e ative a **Google Drive API**.
2. Configure o consentimento OAuth para o aplicativo e crie um cliente OAuth para aplicação Web. Cadastre o endereço de retorno da ferramenta que você usará para obter a autorização.
3. Autorize sua própria conta com acesso offline e o escopo `https://www.googleapis.com/auth/drive.file`. Esse escopo permite acesso aos arquivos criados pelo aplicativo. Guarde o `refresh_token` no servidor.
4. Crie a pasta usando a mesma autorização do aplicativo, ou selecione uma pasta pelo Google Picker com o mesmo cliente OAuth. Uma pasta criada manualmente e apenas copiada pelo ID pode não estar acessível com o escopo `drive.file`.
5. No Render, abra o serviço **orbita → Environment** e adicione:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
```

6. Salve e publique novamente. O site passará a aceitar arquivos de até **25 MB** e músicas nos formatos aceitos pelo navegador.

Não coloque esses valores no GitHub nem no JavaScript. O Drive não recebe links públicos: cada download é autenticado no site e verificado conforme a conversa. A pasta central ocupa a cota da sua conta Google. Cada membro da comunidade poderá enviar arquivos para ela; mensagens diretas ficam disponíveis apenas aos dois participantes pelo site. O proprietário da conta Drive continua podendo ver todos os arquivos na própria conta.

Para produção, publique o consentimento OAuth conforme as regras do Google. Autorizações de aplicativos externos em modo de teste podem expirar; se isso ocorrer, será necessário autorizar novamente.

Opcionais: `STORAGE_SIGNING_KEY` fixa uma chave exclusiva de assinatura dos registros de arquivos. Na ausência dela, o servidor usa a chave LiveKit com um prefixo específico para arquivos. Depois de começar a armazenar arquivos, mantenha a chave de assinatura estável: alterá-la invalida as provas dos registros existentes.

## Funcionalidades desta versão

- Pedidos de amizade pelo @ do perfil, aceitar, recusar e remover.
- Conversas diretas e chamadas privadas de voz/vídeo, com verificação de amizade e participação no servidor.
- Canais de texto e voz, criação de canais, histórico paginado, reações, edição/exclusão das próprias mensagens e fixação das próprias mensagens.
- Perfil, presença online, microfone com redução de ruído, cancelamento de eco e ajuste automático de ganho, conforme suporte do navegador.
- Câmera e tela com metas de 1080p/30, adaptação à rede e tela cheia.
- Arquivos no Drive e player compartilhado com pausa, reprodução, posição sincronizada e volume local. A sincronização é aproximada; cada navegador precisa permitir a reprodução de áudio.

O FlaviBot funciona no Discord e não é integrado ao LiveKit. O player próprio foi a alternativa escolhida. Esta versão cobre as funções descritas acima; não implementa todas as funções, moderação, cargos, múltiplos servidores, aplicativos ou escala do Discord. A fixação de mensagens está restrita ao próprio autor. Remover uma amizade impede novas mensagens e novas entradas em chamadas, mas não desconecta uma chamada já em andamento. A pesquisa filtra as mensagens carregadas; use o botão de histórico para carregar mais.

## Verificação

Execute `python -m unittest discover -s tests -v` na pasta do projeto. Os testes cobrem autenticação, escopo dos tokens de chamada, bloqueio de terceiros, amizade obrigatória, limites de upload, assinatura dos arquivos e proteção das credenciais. A autorização e a transferência real do Drive precisam ser testadas depois que as credenciais Google forem configuradas.

Referências: [OAuth para aplicações Web](https://developers.google.com/identity/protocols/oauth2/web-server), [uploads do Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [escopos do Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
