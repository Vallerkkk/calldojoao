# Diagnóstico de qualidade

Em Configurações → Administração da Órbita → Qualidade do aplicativo · CSV, administradores e criadores podem exportar o relatório. O servidor verifica `site_roles` a cada acesso, sem confiar em apelidos ou metadados editáveis. CSV usa UTF-8 com BOM, ponto e vírgula e proteção contra fórmulas. Respostas privadas têm `Cache-Control: no-store`.

## Coleta

Com uma conta conectada e página visível, o navegador acumula contagens fixas de visualização, erro JavaScript/recurso/promessa/API, navegação acima de 350 ms e tarefas acima de 200 ms. Envia no máximo 12 contadores de 1 a 20 por lote a cada 65 segundos, apenas quando há novos sinais. Não lê mensagens de erro, stack traces, texto do DOM, nomes de salas, URLs, mensagens, imagens, áudio ou credenciais. Sem gravação, impressão digital, cookies extras, armazenamento local ou envio ao sair. Não mede usuários únicos nem fornece taxas de erro ou causas confirmadas.

O banco valida todas as categorias e limita cada conta a um lote por minuto. Contagens globais não contêm identificadores e duram 30 dias. Uma tabela privada usa o UUID de autenticação apenas para limitar abuso, com retenção de dois dias; não é acessível ao cliente nem enviada ao Gemini. Retenção é aplicada na próxima coleta, sem cron pago.

## Gemini opcional e DESLIGADO

O usuário pediu manter o Gemini preparado e desligado porque não confirmou o plano. `GEMINI_DIAGNOSTICS_ENABLED=false` no Render. Para ativar futuramente, verificar que a chave pertence a um projeto gratuito, sem faturamento, e definir no servidor `GEMINI_API_KEY`, `GEMINI_FREE_TIER_CONFIRMED=true` e `GEMINI_DIAGNOSTICS_ENABLED=true`. Nunca colocar a chave no frontend ou Git. Um limite de chamadas/tokens não garante custo zero em projeto pago.

Implementação REST oficial `gemini-2.5-flash-lite`, JSON estruturado, até 1.400 tokens de saída, sem ferramentas, busca ou código executável. Quando habilitado, análises são disparadas por uso autenticado com pelo menos três novos sinais de problemas, no máximo uma por hora e quatro por dia UTC para toda a aplicação. O orçamento é reservado atomicamente no banco antes da chamada e contabiliza falhas; 429/erros não causam retries ou troca para modelo pago. Sem tráfego ocioso e sem novo serviço/worker. O plano gratuito do Google pode usar os resumos técnicos para melhorar produtos.

As contagens persistem no Supabase. As sugestões de IA ficam pendentes na memória do processo e são consolidadas no Supabase quando um administrador abre/exporta o relatório. Reiniciar antes disso perde apenas essas sugestões pendentes. Sugestões são hipóteses; não examinam código ou telas, não aplicam correções automaticamente. Na ausência de IA, o CSV usa regras técnicas explícitas, sem se passar por uma análise Gemini.

Documentação oficial consultada: https://ai.google.dev/gemini-api/docs/pricing e https://ai.google.dev/gemini-api/docs/structured-output . Revalidar disponibilidade/preços antes de ativar.

## Verificação

`tests/test_diagnostics.py`, `tests/app-diagnostics.test.mjs`, `tests/diagnostics_browser.cjs` e `tests/diagnostics_access.sql` cobrem autenticação, papéis reais, validação estrita, limites, fórmulas CSV, isolamento, desativação de transcrição e download no celular/computador. Dados SQL de teste rodam em transação revertida. Avisos INFO de RLS sem política nas tabelas privadas de limites são intencionais: clientes não têm acesso.
