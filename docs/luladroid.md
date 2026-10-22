# Transcrição no chat da sala de voz

Cada sala de voz tem seu próprio chat de texto, aberto pelo botão **Chat da sala**. É possível enviar mensagens sem ligar o microfone. Chamadas privadas usam um histórico vinculado à conversa privada, sem misturar mensagens entre salas.

Na chamada, abra o chat, clique em **Transcrever minha fala** e aceite publicar a sua própria fala. Os trechos novos aparecem no mesmo chat, identificados com o nome da pessoa e **Transcrição automática**. Outros participantes autorizam a própria fala separadamente. Mutar pausa o reconhecimento; sair encerra e revoga o consentimento.

A ativação por “eai LulaDroid”, as perguntas ao Gemini e a leitura automática de respostas foram removidas. Nenhuma fala dispara um assistente. O endpoint antigo de perguntas não existe mais.

O histórico de transcrições anterior continua restrito aos administradores do site. Só trechos novos, com autorização explícita de compartilhamento no chat, são publicados para quem tem acesso à sala. Clientes antigos não passam a publicar automaticamente. Transcrições expiram após sete dias. Mensagens digitadas seguem o histórico normal da sala. Apagar um trecho do histórico administrativo também remove sua cópia do chat.

O reconhecimento depende do navegador e pode estar indisponível no Windows, Brave ou em celulares. O fornecedor do navegador pode processar o áudio; a Órbita não grava áudio no servidor. Pode haver erros e trechos ausentes. A transcrição não substitui uma gravação.

O banco valida acesso à sala/conversa, consentimento e autor. Canais privados, regras de entrada, bloqueios e moderação continuam sendo respeitados. Há limites de 30 mensagens digitadas por minuto e os limites existentes de transcrição. O chat atualiza pelo Supabase Realtime e revalida o histórico quando aberto.
