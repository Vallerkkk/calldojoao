# Chamadas privadas com Videochamada.com.br

Integração opcional. As salas de voz, chamadas privadas integradas e controles LiveKit continuam disponíveis. Não altera o banco Supabase nem adiciona dependências.

## Como usar

1. Abra uma DM com um amigo e clique em **Ligar em particular**.
2. Escolha **Chamada integrada — LiveKit** ou **Chamada no Brasil — criar convite**.
3. Na segunda opção, crie o convite. Ele dura cerca de uma hora, admite até quatro participantes e abre o provedor em outra aba, com seus próprios controles e teste de câmera/microfone.
4. Use **Inserir convite na conversa**. O texto entra no rascunho sem apagar o que você já escreveu; envie quando quiser, pelo envio normal do Órbita. O amigo entra pelo mesmo link.

O link é uma credencial de acesso: compartilhe somente com os participantes. O botão **Copiar link** também está disponível. A contagem e o estado da chamada externa não aparecem como participantes LiveKit no Órbita. Nenhuma melhoria de latência, qualidade de vídeo ou suporte a áudio da tela é garantida pela simples troca de provedor; isso depende da rede e do navegador. Use os controles da Videochamada na aba da chamada.

## Configuração privada no Render

Variáveis diretamente no serviço, preservando as existentes e o Blueprint. A chave nunca entra no JavaScript, HTML, resposta pública de configuração, GitHub ou ZIP:

```
VIDEOCHAMADA_API_KEY=<credencial privada do provedor>
VIDEOCHAMADA_FREE_PLAN_CONFIRMED=true
```

Antes de confirmar a segunda variável, verificar no painel que a organização está no plano **Gratuito**, sem upgrade, e que gravação e transcrição estão desligadas no projeto. `false`, variável ausente ou chave vazia ocultam a opção alternativa; LiveKit continua disponível. Após mudar variáveis é necessário um deploy normal para entrarem em vigor.

Plano confirmado em 20/10/2026: 2.000 minutos mensais, contabilizados por participante. A franquia é da organização, compartilhada entre projetos. No plano gratuito não há cobrança automática; não fazer upgrade para Pay as You Go. A configuração não acompanha mudanças futuras de plano feitas manualmente no provedor.

Não usar “limite de gastos = R$ 0” como bloqueio: a documentação diz que zero remove o limite. Gravação e transcrição são recursos pagos separados e permanecem desligados. Cada criação envia explicitamente `recording: false`, e o servidor recusa entregar um link se o provedor não confirmar esse valor.

## Proteções

- Autenticação Supabase no servidor, consulta com a sessão do próprio usuário, confirmação explícita de participação na DM e amizade aceita antes de chamar o provedor.
- Chamada externa limitada a conversas privadas, sem mudança nas políticas ou tabelas do Supabase.
- Prazo curto, validação de URL HTTPS do domínio oficial, sem redirecionar credenciais nem seguir redirects HTTP.
- Mesmo identificador e corpo nas tentativas; chave de idempotência HMAC vinculada ao usuário e à conversa. Não retransmite o token Supabase nem o nome dos amigos ao provedor na criação.
- Limite de seis solicitações por minuto por conta e até 2.000 contas na memória do processo. É uma proteção local, não uma quota distribuída entre servidores. O limite financeiro é o plano gratuito do provedor.
- Respostas de falha sem detalhes/segredos do serviço externo; chamada integrada continua disponível.
- Não cria uma chamada automaticamente ao abrir DM nem ativa câmera/microfone no Órbita.

## Validação

- Testes Python cobrem autorização, plano explícito, idempotência, prazo, limites, URLs, gravação e erros sem vazamento da chave.
- Testes de navegador em 1440 px e 390 px usam provedores simulados: criam convite, recuperam uma falha com o mesmo pedido, preservam rascunho, enviam na DM e verificam o link.
- Validação real: autenticação da API e criação de uma sala de teste sem gravação, com expiração de dez minutos, sem conectar participantes. Essa sala não é usada pelo site nem compartilhada.
- Não foi realizada uma chamada real entre duas pessoas. Qualidade de mídia, áudio da tela e comportamento dos controles externos em dispositivos físicos precisam de validação manual.

Referências oficiais consultadas:

- https://documentacao.videochamada.com.br/documentacao-tecnica-da-api/quickstart/
- https://documentacao.videochamada.com.br/documentacao-tecnica-da-api/criar-chamada/
- https://documentacao.videochamada.com.br/cobranca/como-funciona/
