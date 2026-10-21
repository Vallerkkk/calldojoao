# Recursos e uso

A interface utiliza superfícies escuras com acentos roxos, navegação lateral, composer destacado e layout para celular. Não exige um serviço pago adicional.

- **Mensagens:** o menu ⋯ de cada mensagem reúne respostas, reações, edição, exclusão, fixação, Thread e copiar link. Busca no histórico pelo ícone de lupa ou Enter no campo de busca, menções com autocomplete e Tab, edição com revisão e exclusão com confirmação. “Copiar link” abre a mensagem respeitando as permissões do canal.
- **Arquivos:** escolha até cinco arquivos, arraste-os ou cole uma imagem no composer. JPG, PNG e WebP estáticos são redimensionados e comprimidos no próprio dispositivo. GIFs e WebP animados mantêm a animação. Avatares usam até 384 px; banners, 1600 px; anexos, 1920 px no maior lado. O limite final permanece em 25 MB por anexo e 5 MB por imagem de perfil.
- **Perfis:** status personalizado, foto, banner, pronomes e atividade ficam em Configurações. A presença online/ausente usa Realtime Presence; “digitando…” usa Broadcast sem nova tabela.
- **GIFs e stickers:** abra Anexar → GIF ou sticker. Há upload, links HTTPS diretos e um pacote próprio de figurinhas. A API Tenor foi encerrada em 30/06/2026 e não é utilizada. Não é necessário criar conta no Tenor.
- **Moderação:** Mais opções → Moderação/Auditoria. Donos, administradores e cargos autorizados podem silenciar por tempo ou banir membros de hierarquia inferior. O banco restringe mensagens, reações, anexos e acesso; o backend aplica o controle às chamadas ativas. A remoção de mensagens e os controles de voz também geram auditoria. Não é possível editar o texto de outra pessoa.
- **Palcos:** ao criar ou editar uma sala de voz, marque Sala de palco. Novos membros entram como plateia; moderadores podem promover oradores, mover para a plateia, silenciar e desconectar participantes.
- **PWA:** use Mais opções → Instalar Órbita. Há ícones próprios, manifesto, service worker e uma tela offline. O app não guarda mensagens ou arquivos privados no cache de instalação. No iPhone, use Compartilhar → Adicionar à Tela de Início.
- **Celular:** gesto desde a borda esquerda abre o menu; deslizar uma mensagem para a direita prepara uma resposta. Controles de toque têm pelo menos 44 px. O composer acompanha o teclado via `visualViewport`, quando suportado.
- **Aparência:** tema claro/escuro manual, tamanho das mensagens, modo compacto, foco visível e respeito a reduzir movimento.
- **Notificações:** clique em Ativar notificações e push nas configurações. O navegador pede permissão; no iOS, a instalação na tela inicial pode ser necessária. As chaves VAPID e a credencial do transporte ficam somente no servidor. Os avisos mostram informação genérica, sem o conteúdo privado. A mensagem fica salva mesmo que o envio de push falhe.
- **Chamadas:** Screen Wake Lock mantém a tela ativa em navegadores compatíveis. O botão Vídeo flutuante usa Picture-in-Picture. Falantes ativos continuam com o anel verde. Sons de entrada/saída, avisos e soundboard usam Web Audio e podem ser desligados.
- **Ouvir juntos:** abra numa chamada e cole um vídeo do YouTube. O anfitrião controla a reprodução, que é sincronizada pelo canal de dados do LiveKit. Cada participante abre seu próprio player e pode precisar tocar em reproduzir. Vídeos sem permissão para incorporação não funcionam. Não há extração de áudio nem retransmissão pelo servidor.

## UptimeRobot

Endpoint pronto: `https://orbita-8nwu.onrender.com/healthz` (GET e HEAD, resposta 200).

É necessário criar uma conta própria no [UptimeRobot](https://uptimerobot.com/), adicionar um monitor HTTP(S) para esse endereço e selecionar as notificações desejadas. Nenhuma conta ou monitor foi criado sem acesso à conta do proprietário.

O monitoramento não garante disponibilidade contínua. O Render grátis pode suspender instâncias por inatividade, limites de horas, manutenção ou uso. Não foi contratado um plano nem criado um serviço de ping adicional.

## Configuração do push

O servidor utiliza `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` e `PUSH_TRANSPORT_KEY` no ambiente. O banco guarda somente o hash do transporte em schema privado. Preserve as chaves entre deploys; a rotação de VAPID exige novas inscrições dos dispositivos. Nunca coloque as chaves privadas no frontend ou no Git.

## Validação

- Testes Python: `python -m unittest discover -s tests -v`.
- Os testes transacionais de acesso ficam em `tests/database_access.sql`; criam dados temporários e executam ROLLBACK.
- A interface foi exercitada em Chrome headless com sessões simuladas, nos tamanhos desktop e celular. Os testes cobrem threads, busca além da página carregada, autocomplete, envio, confirmação de edição, compressão e mudança de tema. Isso não substitui um teste de áudio/vídeo com dispositivos reais nem a autorização de push no celular do usuário.

Fontes: [Tenor](https://support.google.com/tenor/answer/10455265?hl=pt-br), [Render grátis](https://render.com/docs/free), [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Push API](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe).

## Fluidez da interface

Mensagens sem alterações reutilizam os mesmos elementos, preservando foco, imagens e menus. URLs assinadas de anexos são reutilizadas por até 50 minutos, com limite de 200 entradas e separação por conta; o logout limpa o cache da memória. O indicador de quem está falando atualiza apenas o destaque dos participantes. Os efeitos visuais são curtos, sem fundos animados continuamente, e respeitam reduzir movimento.

No celular, o nome do canal permanece visível, os recursos secundários ficam em Mais opções e o composer acompanha a altura disponível. O botão Mensagens recentes retorna ao fim da conversa.

O teste `tests/browser_smoke.cjs` usa Playwright e contas simuladas. Execute com o servidor local na porta 8765. Defina `ORBITA_PLAYWRIGHT` para o módulo instalado e `CHROME_PATH` para o executável do Chrome, se necessário. Os screenshots de teste vão para `work/browser-temp`.

## Revisão de confiabilidade

As validações automatizadas estão na pasta `tests/`. O composer aceita Shift+Enter; rascunhos ficam separados por canal durante a sessão. A criação de canais privados, as permissões de chamadas e as notificações receberam testes adicionais.
