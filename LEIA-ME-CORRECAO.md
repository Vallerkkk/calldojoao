# Correção do envio de mensagens + acabamento visual

## O bug do texto

O compositor sempre enviava a coluna `reply_to` no INSERT, mesmo quando a mensagem não era uma resposta (`reply_to: null`). Se o banco de produção não tiver o grant dessa coluna (schema anterior à migração de respostas), o PostgREST rejeita o INSERT inteiro com `permission denied` — leitura e histórico continuam funcionando, mas nenhuma mensagem normal é enviada.

Correções em `static/app.js`:

- `reply_to` só entra no payload quando existe uma resposta de verdade.
- Se o banco ainda não tiver a coluna, a mensagem é reenviada sem a citação e o usuário é avisado.
- Antes de gravar, a sessão é renovada; token expirado não deixa mais o envio travado.
- Os estados de erro/incerteza continuam com as opções de tentar novamente ou verificar.

## Layout

- Cards de chamada com fundo em gradiente, borda de fala, avatar com brilho e elevação.
- Botão **Chat da sala** deixou de quebrar o texto dentro de um quadrado de 44 px.
- Painel de chat da sala com cabeçalho, mensagens em cartões, campo de texto e botão de envio no mesmo vocabulário visual do resto do app.
- Ajustes responsivos para o botão do chat no celular.

## Como rodar

1. Abra a pasta `jesus`.
2. Execute `iniciar_orbita.bat`.
3. O app abre em `http://127.0.0.1:8000`.

Se estiver usando o zip, copie o seu `.env` da versão antiga para a pasta extraída (o zip não inclui credenciais). O `.bat` cria o `.venv` e instala as dependências se necessário.

## Build

As mudanças em `static/` já estão compiladas em `static/dist/`. Para editar e recompilar:

```powershell
npm install
npm run build
```

## Validação

- Envio físico pelo compositor (clique + teclado + Enter): ok.
- Simulação de banco sem grant em `reply_to`: mensagem enviada sem a coluna e sem erro.
- `browser_smoke`: desktop e mobile ok.
- `accessibility_browser`: WCAG AA nos 12 temas, desktop e mobile.
- `navigation_browser`: troca de canais e retorno de rolagem ok.
