# Órbita — interface revisada

A referência desta versão é o arquivo orbita.html da pasta Órbita/SITEEE-configuracao-gratuita. O visual foi adaptado ao aplicativo real: Supabase para contas, mensagens e arquivos; LiveKit para chamadas. Os dados e as ações simulados da referência não foram incorporados.

## O que mudou

- Painéis escuros com acentos roxos, navegação lateral, compositor destacado e tema claro opcional.
- Ações de mensagens no menu ⋯, reações existentes abaixo do texto e agrupamento de mensagens consecutivas.
- Menu lateral por gesto ou botão no celular, controles de toque de 44 px, teclado acompanhado por visualViewport e retorno às mensagens recentes.
- Atualização das mensagens preserva os elementos sem alterações; anexos reutilizam URLs assinadas na memória; falantes ativos atualizam apenas o destaque.
- Acessibilidade de teclado, identificação de botões e opção reduzir movimento.

Os recursos do pacote de colaboração estão descritos em RECURSOS.md. As três migrações aditivas 20261020033840, 20261020034054 e 20261020034553 já foram aplicadas ao projeto Supabase existente. O frontend antigo permanece compatível.

## Validação

20 testes Python passaram. Testes de navegador com contas e mensagens simuladas verificaram envio, edição com confirmação, threads, busca no histórico, menções, compressão, tema claro/escuro, preservação de elementos e comportamento com menor altura de tela. A navegação entre servidores, amigos e salas foi exercitada em 320, 768 e 1440 px; o fluxo completo também foi testado em 390 px.

Chamadas entre dispositivos reais e entrega de push em celulares não foram verificadas neste ambiente. O push depende das variáveis privadas no Render; o UptimeRobot depende de uma conta do proprietário. Nenhum serviço pago adicional foi contratado.

## Publicação

O pacote é publicado pelo repositório Vallerkkk/calldojoao, branch main, no serviço existente orbita do Render. As credenciais permanecem nas variáveis do serviço; o arquivo .env não deve ser versionado. As configurações privadas de Web Push são aplicadas diretamente ao ambiente do Render.

As credenciais locais na pasta jesus são preservadas. Nunca publique o arquivo .env nem chaves privadas.
