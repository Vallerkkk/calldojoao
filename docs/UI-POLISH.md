# Acabamento visual e movimento

Esta camada foi adicionada para deixar a Órbita mais bonita e, principalmente, mais fluida, sem mudar a estrutura do HTML nem a lógica de dados.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `static/polish.css` | Camada final de design: tipografia, cores, superfícies, espaçamento, estados de foco, tema claro, responsivo e animações. Carregada depois de todos os CSS existentes. |
| `static/ui-polish.js` | Microinterações: entrada de mensagens novas, fade ao trocar de canal, sombra do cabeçalho ao rolar e escalonamento dos canais. Importado por `static/app.js`. |
| `static/vendor/fonts/inter-latin-wght.woff2` | Fonte de interface (Inter Variable, local, sem requisição externa). |
| `static/vendor/fonts/space-grotesk-latin-wght.woff2` | Fonte de títulos (Space Grotesk Variable, local). |

O build (`scripts/build.mjs`) passou a incluir `polish` na lista de CSS versionados. O `index.html` referencia a versão em `static/dist/`, então **é preciso rodar o build** após qualquer alteração.

```powershell
npm install
npm run build
python -m uvicorn app:app --reload
```

## Princípios

- **Movimento curto e previsível.** Tokens `--dur-1` (120 ms), `--dur-2` (200 ms) e `--dur-3` (320 ms), com curvas `--ease-out`, `--ease-soft` e `--ease-spring`.
- **Só transform/opacity/fundo são animados.** Evita repaint de layout e mantém o scroll leve.
- **Nada de animação contínua.** O fundo aurora é estático; apenas o indicador de conexão respira.
- **`prefers-reduced-motion` desliga todo o movimento.** O layout e a hierarquia continuam intactos.
- **Toque em primeiro lugar.** Alvos de 44 px no mobile e gaveta com scrim próprio, sem sequestrar o clique do conteúdo.
- **Contraste AA em todos os 12 temas e nos dois modos.** Validado pelo `tests/accessibility_browser.cjs`.

## O que mudou na prática

- Tipografia Inter + Space Grotesk local e pré-carregada.
- Paleta mais profunda, bordas e elevações consistentes, foco visível e scrollbar refinada.
- Rail, sidebar, cabeçalho, mensagens, composer, popovers, diálogos, chamadas, feed e tela de login com o mesmo vocabulário visual.
- Cabeçalho com busca expansível, status de conexão compacto e sombra ao rolar.
- Gaveta mobile com largura estável, scrim correto e transição de 200 ms.
- Entrada de mensagens novas, fade na troca de canal e reagrupamento suave do histórico.
- Estado vazio de amigos, cartão de perfil e painel de configurações harmonizados.
- Fontes servidas com cache imutável (`app.py`), reduzindo revalidações.

## Testes usados na validação

```powershell
npm run test:unit
$env:ORBITA_TEST_URL='http://127.0.0.1:8767/'; $env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/browser-tests.cjs navigation
node scripts/browser-tests.cjs calls
node scripts/browser-tests.cjs media
node tests/accessibility_browser.cjs
node tests/performance_browser.cjs
```
