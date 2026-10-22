# Processamento local de voz

Base: Jesus 16.zip + CallAudioProcessor de Texto colado.txt.

Em Entrada e saída de áudio, RNNoise continua sendo a opção padrão. Os quatro perfis Voz são opcionais. O processamento é local, sem envio para uma API de áudio externa. O algoritmo fornecido usa gate/envelope por RMS e ZCR; não é supressão espectral por FFT nem uma garantia de remoção de teclado.

O adaptador usa setProcessor/restart/destroy do LiveKit 2.15.6. LiveKit continua responsável pela captura, troca de dispositivos, mute, push-to-talk e publicação RTP. Streams emprestados nunca são encerrados pelo DSP. Alterar presets não muda as preferências nativas de cancelamento de eco, ruído ou ganho. O ganho digital é desabilitado quando o ganho nativo está ativo ou seu estado é desconhecido.

O worklet é um arquivo servido pela própria aplicação, sem Blob URL, eval ou dependência de WASM adicional. Falha, ausência ou carregamento acima de oito segundos do worklet usa passthrough na mesma saída. Erro em tempo de execução reconecta o microfone diretamente à saída sem trocar a track publicada. Ausência de Web Audio ou falha de inicialização deixa o LiveKit com a captura original. Recursos próprios são liberados no restart/destroy; conclusões tardias de inicialização cancelada não recriam a saída.

A classe TypeScript é a fonte; npm run build gera sua versão JavaScript e os bundles. O build não verifica tipos TypeScript.

Validação local (Chrome em Windows):
- 58 testes unitários JavaScript e 70 testes Python passaram.
- Build, integridade dos assets e equivalência das migrações/SQL passaram.
- DSP real: os quatro presets produziram amostras finitas e áudio não silencioso com sinal sintético; restart, destroy idempotente, stream emprestado, preset inválido, saída estável, falha de módulo, erro de execução e cancelamento durante init passaram.
- Suites audio_experience, call_session, call_controls e call_media passaram em desktop/mobile simulados, com LiveKit simulado. audio_experience cobre seleção dos quatro novos presets.

Limitações: sem chamada ponta a ponta em servidor LiveKit real, sem microfones físicos, sem audição/calibração dos presets e sem Safari/Firefox/Electron. Acessibilidade em 24 modos de tema passou em desktop/mobile simulados; a suíte completa de navegação e os testes SQL com banco real não foram executados. Os perfis podem cortar sílabas/fala baixa; RNNoise e somente navegador continuam disponíveis. Publicar como PR em rascunho até validar com dois participantes, mute/PTT, troca de dispositivo, reconexão e saída da chamada nos navegadores suportados.

Higiene da base: dependências instaladas, arquivos .env, logs e builds antigos não referenciados do ZIP foram excluídos. As rotas de IA/transcrição adicionadas pelo ZIP foram removidas: não verificavam acesso à chamada e uma delas referenciava time sem import. Não são necessárias para DSP e não foram expostas. Arquivos legados já existentes no GitHub foram preservados.


Atualização Jesus 19: os modos Aprimorada e Agressiva usam RNNoise; Agressiva aumenta o corte de graves de 80 para 120 Hz. O controle Ganho do microfone ajusta o volume enviado nesses dois modos (10–100%, com 50% como ganho unitário), sem substituir a faixa durante os ajustes. Não é uma integração com Krisp. Os quatro perfis de voz continuam disponíveis. Os ajustes são preservados ao trocar o microfone ou reiniciar o processador.
