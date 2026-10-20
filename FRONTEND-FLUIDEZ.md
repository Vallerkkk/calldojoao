# Órbita — auditoria e aperfeiçoamento do front-end

## 1. Auditoria apresentada antes da implementação

As linhas desta tabela correspondem à base auditada, commit `e82bd2e519945eb29d27d31a8d06cefa7327186f`. Os arquivos atuais têm linhas adicionais. A auditoria foi apresentada na conversa antes da primeira alteração de código.

| Prioridade | Arquivo e linha da base | Problema e impacto | Correção realizada |
|---|---|---|---|
| Crítico | static/app.js:89 | Substituir diretamente uma sessão podia manter a chamada e assinaturas da conta anterior. | Encerrar a chamada, invalidar operações antigas, remover assinaturas e limpar dados e caches antes de carregar a próxima conta. |
| Médio | static/app.js:131–180 | Troca de conversa descartava histórico e rolagem, com tela vazia durante a consulta. | Cache por conta e escopo, conteúdo imediato, posição salva e atualização em segundo plano. Servidores visitados retornam ao último canal. |
| Médio | static/app.js:165 | Histórico dependia do Realtime; erro pedia reabrir o canal. | Consulta inicial independente, indicador de reconexão, nova assinatura ao voltar a rede e recuperação limitada de assinatura parada. |
| Médio | static/app.js:238 | Mensagem aparecia somente após o servidor responder. | Mensagem otimista, estados de envio/erro, tentativa novamente e verificação de resposta perdida. |
| Médio | static/app.js:118,293,513 | Listas de canais, membros e participantes eram reconstruídas, perdendo foco e controles. | Reconciliação por identificador, manutenção do volume individual e restauração de foco quando um item precisa ser substituído. |
| Médio | static/app.js:165,208 | Paginação, imagens e listas extensas podiam deslocar a leitura. | Páginas de 50, âncora visual, tamanhos reservados, restauração após layout e content-visibility acima de 200 mensagens, quando suportado. |
| Médio | static/app.js:648–673 | Reação e voto em mensagens antigas não eram atualizados pela consulta limitada às últimas mensagens. | Atualização da mensagem afetada pelo ID, incluindo DMs e enquetes. |
| Médio | static/app.js:467; static/enhancements.js:178–225,296 | Diálogos e painéis não restauravam foco; resposta atrasada podia reutilizar o corpo de outro diálogo. | Corpo isolado por abertura, associação ao título e retorno do foco. |
| Pequeno | static/index.html:290,463 | Histórico sem nome acessível próprio e diálogo sem título associado. | Região identificada, anúncio curto separado para novas mensagens e aria-labelledby. |
| Pequeno | static/enhancements.js:355–378 | Fechamento de gaveta/popovers por teclado incompleto; observação ampla repetia trabalho. | Escape, foco contido na gaveta móvel, fundo inativo enquanto aberta e observação restrita aos elementos adicionados. |
| Pequeno | static/index.html:7–13 | Conexões com CDN e Supabase só começavam quando utilizadas. | Preconnect; módulos e LiveKit sob demanda foram preservados. |
| Médio, adicional | static/app.js:89–114 | Falha ao carregar a comunidade deixava uma sessão parcial sem recuperação própria. | Botão para tentar carregar novamente, proteção contra inicializações concorrentes e manutenção do login. |
| Pequeno, adicional | static/enhancements.js:340–350 | Player podia permanecer preso após falha de carregamento ou iniciar depois de sair da chamada. | Prazo para abrir o player, recuperação de erro e validação da sala e do elemento antes de criar o player. |

A lista de mensagens já reutilizava elementos na base. Isso foi preservado; não foi identificado um replaceChildren de todas as mensagens a cada evento. As fontes já eram do sistema e o LiveKit já era importado sob demanda.

## 2. Arquivos e aplicação

O pacote **Orbita-front-end-fluido.zip** contém o projeto completo atualizado, sem .env, credenciais privadas, ambientes virtuais ou dependências instaladas. A pasta Desktop\jesus recebe os arquivos revisados.

Os arquivos completos pequenos e os trechos dos arquivos grandes estão em **Trechos-e-arquivos-front-end.md**, em blocos de código com os caminhos. Para os arquivos grandes, os trechos são diffs com linhas de origem e destino e contexto; os arquivos completos correspondentes estão no ZIP. Não é necessário colar trechos manualmente na pasta que já foi atualizada.

Mudanças de produção: static/app.js, static/enhancements.js, static/index.html, static/service-worker.js; novos static/chat-state.js, static/dom-utils.js e static/fluency.css. index.html e orbita.html permanecem cópias do ponto de entrada estático. Testes foram ampliados sem instalar bibliotecas novas.

**Backend, dependências e banco não foram alterados. Não execute os schemas ou as migrações antigas para esta atualização.** Nenhum recurso pago foi ativado.

## 3. O que mudou e o que foi testado

- Rascunhos continuam separados por conversa. O envio otimista limpa o campo sem apagar textos digitados depois.
- O cache fica somente na memória da sessão: até 12 conversas e 2.000 mensagens no total, com validade de cinco minutos; até oito servidores visitados. Ao sair ou trocar de conta, ele é limpo. Históricos que excedem o orçamento podem precisar ser carregados novamente.
- Revalidação consulta as mensagens recentes e os trechos antigos em cache; exclusões e edições não dependem apenas dos eventos recebidos enquanto o canal estava aberto.
- Leituras antigas são canceladas ao navegar; leituras e envios têm prazo para evitar estados indefinidos. Respostas de outra navegação não alteram a conversa atual.
- Se o servidor recusou o envio, há tentativa novamente. Se a resposta se perdeu, o site verifica o histórico. Um reenvio de resultado ainda incerto exige uma escolha explícita, pois a API atual não oferece idempotência garantida.
- Carregamento com esqueletos, erros recuperáveis, estados vazios com ação e indicação discreta do estado do Realtime.
- Foco visível, Escape, anúncios curtos, gaveta móvel acessível, alvos de toque e fontes de 16 px no composer móvel. Reduzir movimento continua respeitado.
- URLs de imagens de perfil são reutilizadas por até 50 minutos em um cache de memória limitado, reduzindo consultas e mudanças desnecessárias no DOM.

Validações aprovadas: 38 testes Python existentes e 15 testes JavaScript. Dois roteiros de navegador exercitam desktop e celular com Supabase, contas e LiveKit simulados: inicialização e recuperação, cache, rolagem, envio lento, falha explícita e resposta perdida, mensagens, threads, busca, edição, reações antigas, enquetes, anexos por colagem/arraste, amigos e DMs, navegação, troca de conta, controles de chamada e música com player simulado. Os roteiros ampliados registraram zero erros de JavaScript e zero avisos no console. A navegação adicional foi verificada em 320, 768 e 1440 px; login em 390 e 1440 px.

### Medição da troca em cache

| Ambiente Chrome automatizado | Canal | Servidor |
|---|---:|---:|
| Desktop | 24.2 ms | 5.3 ms |
| Celular simulado | 21.5 ms | 5.3 ms |

Medição do clique até o primeiro quadro com conteúdo em cache, com consultas simuladas atrasadas em 650 ms. Não mede a rede de produção nem garante esse tempo em qualquer aparelho. A mesma mensagem permaneceu na mesma posição visual após navegar e voltar, inclusive com mais de 300 mensagens carregadas.

### Limites da validação

Não foram criadas contas reais de teste em produção nem utilizados novos e-mails/senhas. Safari e Firefox reais, aparelhos iOS/Android físicos, câmera/microfone reais, compartilhamento de tela, autoplay de vídeos reais, leitor de tela e entrega real de push não foram testados nesta etapa. A compatibilidade utiliza APIs de navegadores recentes e proteções por suporte; precisa da validação manual abaixo.

O ambiente de testes Python emite um aviso de depreciação do TestClient. Ele não é um aviso do navegador; a dependência do backend foi preservada conforme solicitado.

## 4. Checklist manual

- [ ] Login, cadastro e saída: conferir os textos, teclado, erros de credenciais e recuperação de sessão sem expor dados da conta anterior.
- [ ] Alternar canais e servidores; escrever rascunhos diferentes; voltar ao ponto do histórico e ao último canal visitado.
- [ ] Enviar texto e respostas citadas; conferir “Enviando…”, edição, exclusão com confirmação, reações, fixadas e votação em enquetes antigas.
- [ ] Desligar a rede, continuar lendo e digitando e reconectar; conferir avisos e recebimento em tempo real sem duplicar mensagens.
- [ ] Rolar para cima, carregar histórico e abrir imagens; conferir a posição da leitura e o botão de mensagens recentes.
- [ ] Colar imagem, arrastar arquivo e enviar GIF/sticker; conferir upload, prévia e download.
- [ ] Adicionar/aceitar amigo, abrir DM e fazer chamada privada entre duas contas.
- [ ] Testar voz, câmera, áudio da tela, volume individual, ensurdecer, pressionar para falar, PiP e saída da chamada em dois dispositivos reais.
- [ ] Abrir música compartilhada, testar iniciar/pausar e sincronizar em dois navegadores; respeitar as limitações de incorporação do vídeo.
- [ ] No celular, abrir a gaveta por gesto, fechar por Escape quando houver teclado, alternar orientação e digitar com o teclado virtual aberto.
- [ ] Usar Tab e Shift+Tab: conferir foco, diálogos, menus, busca e retorno ao fechar. Testar leitor de tela, tema claro/escuro, modo compacto e reduzir movimento.
- [ ] Autorizar notificações no próprio aparelho e conferir menção/DM com a aba aberta e fechada.

## 5. Próximos passos por impacto

1. Validar chamadas, teclado e notificações nos aparelhos reais e em Safari/Firefox; são as diferenças que uma simulação Chrome não cobre.
2. Medir INP, CLS e tempo de troca em uso real com Performance APIs locais, sem enviar conteúdo ou telemetria privada a terceiros.
3. Considerar idempotência de envio no servidor se for necessário garantir que um reenvio nunca duplique uma gravação de resposta perdida. Isso exige uma proposta separada e sua confirmação; não foi implementado no banco/backend nesta entrega.
4. Para canais com milhares de mensagens simultâneas no DOM, avaliar virtualização completa com medições de altura e testes de acessibilidade. Esta entrega usa content-visibility e cache limitado, mantendo a pesquisa e a paginação existentes.

Referências verificadas: [ciclo de vida de canais](https://supabase.com/docs/reference/javascript/removechannel), [recuperação e erros do Realtime](https://supabase.com/docs/guides/realtime/protocol#error-handling).
