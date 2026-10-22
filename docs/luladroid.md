# LulaDroid e transcrição consentida

Na chamada, abra **Transcrição e LulaDroid** e aceite transcrever **sua própria
fala nesta chamada**. O consentimento não é automático nem permanente. Cada
participante decide. Mutar o microfone pausa o reconhecimento; sair encerra o
recurso. O aviso fica visível inclusive ao navegar para outro canal.

Diga **eai LulaDroid** seguido da pergunta. Também aceita **e aí Lula Droid**.
Se disser apenas o nome, há oito segundos para fazer a pergunta seguinte.
Só a pergunta é enviada ao Gemini. Conversas anteriores e o histórico ADM não
são enviados ao modelo. Não há ferramentas, execução de comandos ou acesso
administrativo pelo assistente.

Os participantes recebem a resposta pelo canal de dados autenticado do LiveKit
e cada aparelho a reproduz com sua voz instalada. Não é uma faixa de áudio de
um participante bot; a voz pode variar, exigir interação inicial ou não existir
no aparelho. É possível silenciá-la localmente. A reprodução pausa o próprio
reconhecimento para reduzir realimentação.

O histórico fica em **Administração > Transcrições de chamadas**, restrito aos
cargos **admin/creator do site**, tanto na interface como por RLS no banco.
Não é liberado a cargos comuns de servidores. Exibe até 200 trechos recentes;
o administrador pode excluir um trecho com confirmação. Retenção de leitura:
sete dias; registros expirados são removidos quando uma nova transcrição chega.
Sem novas falas, registros expirados podem continuar fisicamente no banco,
inacessíveis pelo aplicativo, até uma limpeza administrativa. O áudio não é
armazenado pela Órbita. Excluir a conta remove seus trechos por cascata.

Limites do aplicativo: 20 trechos/minuto por pessoa, 5.000 trechos/dia no total,
2.000 caracteres por trecho; Gemini até 50 perguntas/dia, três/minuto no total,
intervalo de 20 segundos por pessoa, entrada de 1.000 caracteres e resposta curta.
Esses limites não substituem as cotas do Google nem incluem outros aplicativos
do mesmo projeto. Erros e cotas não causam novas tentativas automáticas.

## Limitações e privacidade

Web Speech tem suporte variável, especialmente Brave/Electron. Detectar a API
não garante que o serviço de reconhecimento funcione. Em aparelhos sem suporte,
o botão informa a limitação; não há envio oculto para outro transcritor. Não é
possível garantir registro completo de toda a conversa: somente participantes
que consentem, com microfone ativo e reconhecimento funcionando contribuem.
Textos automáticos podem conter erros e falas podem se perder. Não são prova
de uma gravação. O navegador pode usar um serviço externo de reconhecimento e
enviar o áudio a seu fornecedor. No plano gratuito Gemini, perguntas podem ser
usadas pelo Google para melhorar seus produtos. Isso aparece no consentimento.

Puter não é carregado nem utilizado: o usuário escolheu reconhecimento do
navegador e voz do aparelho para evitar consumo de créditos Puter.

## Servidor

Configure **somente no Render**, sem GitHub ou JavaScript:

```
GEMINI_API_KEY=<chave privada>
GEMINI_FREE_TIER_CONFIRMED=true
```

A segunda variável só deve ser verdadeira após confirmar plano Free no AI
Studio. O modelo é `gemini-2.5-flash`, sem pesquisa paga, sem áudio Gemini e sem
histórico. A chave nunca é retornada por `/api/config`. O endpoint exige sessão,
acesso RLS à sala, presença real no LiveKit e consentimento. Não é necessário
serviço pago adicional ou novo instalador para a interface hospedada.

Referências: [Web Speech](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition),
[Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[Puter: modelo de créditos do STT](https://developer.puter.com/speech-to-text/).
