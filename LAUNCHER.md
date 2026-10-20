# Órbita Desktop para Windows

A página `/instalar` oferece o aplicativo Electron como opção principal. Ele tem motor próprio, janela independente, sessão própria, bandeja e seletor nativo de telas/janelas com áudio do sistema opcional. Não precisa de um navegador instalado para abrir sua janela. A versão web/PWA continua como alternativa para navegador e celulares.

A versão 1.0.2 adiciona atualizações automáticas à versão instalada. Verifica versões estáveis, baixa diferenças quando possível, confere o SHA-512 e instala ao encerrar pela bandeja. Downloads completos podem ocorrer como alternativa automática. Não reinicia durante chamadas. Quem usa 1.0.0 ou 1.0.1 precisa instalar 1.0.2 uma vez para ativar o recurso. Os dados são preservados. O ZIP recebe atualização manual.

## Downloads

- `/baixar/Orbita-Setup.exe` redireciona ao instalador `Orbita-Setup-1.0.2-x64.exe` na versão oficial do GitHub.
- `/baixar/Orbita-Windows.zip` agora redireciona ao aplicativo ZIP `Orbita-1.0.2-x64.zip`, substituindo o antigo pacote de atalho de internet. Extraia todos os arquivos e abra `Orbita.exe`.
- Versão: https://github.com/Vallerkkk/calldojoao/releases/tag/v1.0.2
- Hashes em `SHA256SUMS.txt`, nos anexos da versão.

O instalador é por usuário e cria atalhos. Não inicia automaticamente ao terminar nem com o Windows. Ao fechar a janela, o usuário escolhe continuar na bandeja ou encerrar. A primeira abertura pede login, pois o perfil do aplicativo é separado do navegador. Mensagens, arquivos e chamadas precisam da internet e usam o mesmo backend e banco existentes.

O executável não possui assinatura Authenticode comercial. SmartScreen e outros antivírus podem mostrar avisos; não se garante ausência de bloqueios. Não desative proteções. Nenhuma técnica de evasão, alteração de antivírus ou exceção de certificado foi usada.

## Código e validação

Código desktop e instruções de compilação em `desktop/README.md`, com Electron e empacotador fixados no lockfile. Os instaladores ficam nos anexos de Releases, sem binários grandes no Git ou no servidor Render. A página e os dois redirecionamentos são públicos e apontam somente para arquivos de versão fixos do repositório oficial.

Validados: empacotamento e correspondência do código do ASAR; fuses de segurança; login de produção carregado pelo Electron real em perfil isolado de teste; renderer sem Node; seletor com fontes simuladas e áudio mediante seleção. SHA-256 dos dois arquivos enviados conferidos com os digests do GitHub. Não se instala o programa no perfil pessoal do usuário durante o teste.

A página e seus estados de instalação web são testados em 1440, 390 e 320 px. O teste de download do navegador usa um arquivo pequeno simulado; os instaladores reais são verificados por hash separadamente. Chamadas entre duas pessoas, instalação em diferentes computadores e reputação SmartScreen ainda precisam de validação manual.
