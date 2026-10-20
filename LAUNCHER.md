# Órbita no computador e celular

Página pública de instalação: `/instalar`. O login e a barra de servidores também têm atalhos para essa página, em nova aba para preservar conversas e chamadas abertas.

## Aplicativo pelo navegador — opção principal

O Órbita já possui manifesto, ícones e service worker. O novo fluxo captura o evento de instalação do navegador e solicita a confirmação somente após um clique. Quando a instalação automática não está disponível, mostra instruções para Edge/Chrome, outros navegadores e dispositivos móveis. Não declara a instalação concluída apenas porque o usuário aceitou o pedido: aguarda `appinstalled` ou detecta a janela de aplicativo.

O navegador gerencia a instalação, o ícone e a janela independente. A aplicação continua sendo o site; mensagens, chamadas e login precisam da conexão. Nenhum executável próprio, script PowerShell, serviço do Windows, alteração de registro, pedido de administrador ou desativação de proteção é necessário. Não foi produzido um instalador EXE/MSIX assinado.

## Download opcional para Windows

`/baixar/Orbita-Windows.zip` baixa um pacote com apenas:

- `Órbita.url`: atalho de internet para `https://orbita-8nwu.onrender.com/`.
- `LEIA-ME.txt`: instruções de uso e instalação.

O ZIP não instala nada. Após extrair, o atalho abre o site no navegador padrão; a instalação PWA é que oferece a janela independente. A versão do pacote no repositório é reproduzível e não contém código executável ou credenciais.

## Segurança e limites

Não é possível garantir ausência de alertas: SmartScreen, antivírus e políticas corporativas dependem do computador, do domínio e do navegador. Não foram usadas técnicas para ocultar arquivos ou contornar proteções. Se houver bloqueio, não desative proteções: use o endereço HTTPS e a instalação suportada pelo navegador. A página explica essas diferenças antes do download.

## Verificação

- Testes do backend conferem acesso público à página e ao download, cabeçalho de anexo, tipo ZIP e os dois únicos arquivos internos, incluindo a URL HTTPS exata.
- Chrome automatizado em 1440, 390 e 320 pixels confere fallback de instalação, cancelamento, aceite, sinal de instalação concluída, download concluído, ausência de rolagem horizontal e erros JavaScript. Os eventos de instalação são simulados; não se instala software na máquina durante o teste.
- A revisão de navegação desktop/celular continua passando. Nenhum banco, dependência ou plano de serviço foi alterado.
- Instalação efetiva no menu Iniciar, reputação SmartScreen em computadores de terceiros e comportamento de cada antivírus não foram testados nem garantidos.

Referências oficiais consultadas em 20/10/2026:

- https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/ux
- https://support.microsoft.com/en-US/edge/install-manage-or-uninstall-apps-in-microsoft-edge
