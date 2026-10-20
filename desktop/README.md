# Órbita Desktop 1.0.1 — Windows x64

Aplicativo Electron com motor Chromium próprio, janela independente, sessão persistente, bandeja do Windows, notificações mediante permissão e seletor de telas/janelas com áudio do computador opcional. Não precisa de Brave, Chrome ou Edge instalados para abrir sua janela.

O aplicativo acessa o Órbita em `https://orbita-8nwu.onrender.com/`. Mensagens, login, arquivos e chamadas continuam usando os serviços online existentes. Não é uma versão offline nem executa um banco de dados no computador. É necessário entrar na sua conta na primeira abertura; o perfil do aplicativo é separado do navegador.

## Correção 1.0.1

Corrige a recusa prematura de compartilhamento: o Electron solicita captura de tela como permissão `media` com `mediaTypes` vazio. Essa solicitação segue para o seletor, que exige escolha explícita. Não concede nem persiste acesso ao microfone ou à câmera. O teste agora percorre o pedido real `getDisplayMedia`, cancelamento, repetição e ausência de fontes.

## Distribuição

- `Orbita-Setup-1.0.1-x64.exe`: instalador por usuário, atalho na área de trabalho e menu Iniciar; não inicia o aplicativo automaticamente ao terminar.
- `Orbita-1.0.1-x64.zip`: versão sem instalador; extrair a pasta completa e abrir `Orbita.exe`. Manter DLLs e a pasta `resources` junto do executável.
- `SHA256SUMS.txt`: hashes dos dois arquivos publicados.

Downloads oficiais: https://github.com/Vallerkkk/calldojoao/releases/tag/desktop-v1.0.1

Compilado para Windows 10/11 de 64 bits. A arquitetura ARM64 não foi compilada/testada. Ao fechar a janela, escolha continuar na bandeja ou encerrar o aplicativo; encerrar também encerra as chamadas. Não inicia com o Windows e não instala serviços.

O instalador não possui assinatura Authenticode de um certificado comercial. O Windows/SmartScreen pode mostrar um aviso de aplicativo desconhecido. Não há garantia de ausência de bloqueios; não desative as proteções do computador. Não foram usados empacotadores para ocultação ou técnicas de evasão. Uma futura distribuição assinada exige certificado ou fluxo de loja aprovado, não configurado nesta entrega.

## Segurança

- Página remota limitada à origem HTTPS exata do Órbita; `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`. Nenhuma API nativa é exposta à página remota.
- Links externos HTTPS abrem no navegador com confirmação; protocolos executáveis, URLs com credenciais e navegação remota fora da origem são recusados na janela do aplicativo.
- Permissões de câmera, microfone e notificações confirmadas em diálogo nativo; nenhuma captura de mídia automática. Compartilhamento exige gesto do usuário e escolha explícita da tela/janela.
- Áudio de sistema é opcional e vem desligado no seletor. No Windows ele inclui o áudio de todos os aplicativos, mesmo quando somente uma janela foi escolhida.
- O seletor local usa protocolo próprio, CSP restritiva, isolamento, preload com somente dois métodos e validação da janela/frame que envia cada mensagem.
- No executável final, fuses desligam RunAsNode, NODE_OPTIONS e inspeção por linha de comando; integridade do ASAR ativada e carregamento limitado ao ASAR.
- Não ignora erros de certificado, não solicita administrador e não altera antivírus ou firewall. Não armazena chaves do LiveKit, Supabase privado ou Videochamada no pacote.
- Não há atualizador de executáveis nesta versão. O conteúdo do site acompanha as versões publicadas; atualizações do motor desktop devem ser baixadas por uma nova versão oficial.

## Compilar

Use Node.js recente em Windows e as versões fixadas no package-lock.json. Na pasta desktop:

```
npm ci
node node_modules/electron/install.js
npm test
npm run dist
```

Saída em `../work/desktop-dist`. Os ícones estão em `assets/`. O instalador é gerado com NSIS e instalação por usuário; `--publish never` não envia arquivos automaticamente. As ferramentas de empacotamento são dependências de desenvolvimento e não entram no ASAR.

O relatório npm audit de dependências de produção retornou zero vulnerabilidades conhecidas. A árvore das ferramentas de build aponta avisos moderados transitivos de `sprintf-js`/logging; não são bibliotecas de runtime do aplicativo e nenhum conteúdo de usuário é usado como formato nas ferramentas de compilação. Não foi aplicada uma atualização forçada que rebaixaria o empacotador sugerido pelo audit.

## Validação e limites

Testados: políticas de URL; carregamento do login de produção pelo Electron real em perfil de teste separado; ausência de Node/process no renderer; sandbox e isolamento; seletor com telas simuladas, nomes tratados como texto e áudio mediante seleção. Não foi capturada tela real nem aberta câmera/microfone para validar a interface.

Ainda precisam de teste manual entre duas contas: mídia real, compartilhamento com áudio em cada dispositivo e notificações após permissão. Reputação SmartScreen e compatibilidade com todos os antivírus não são garantidas. A instalação no perfil pessoal do usuário não faz parte dos testes automáticos.

Documentação oficial consultada: https://www.electronjs.org/docs/latest/tutorial/security e https://www.electronjs.org/docs/latest/api/session.
