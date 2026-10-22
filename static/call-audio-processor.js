const AUDIO_PRESETS = {
  padrao_call: {
    sampleRate: 48e3,
    echoCancellation: true,
    noiseSuppression: {
      nativeEnabled: true,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.65
    },
    vadGate: {
      enabled: true,
      thresholdDb: -42,
      floorAttenuationDb: -55,
      antiClickHoldDelayMs: 16,
      attackMs: 4,
      holdMs: 180,
      releaseMs: 90,
      maxVoiceZcr: 0.42
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 85,
      mudCutDb: -3.5,
      presenceBoostDb: 4,
      clarityShelfDb: 2,
      lowPassFreqHz: 7800
    },
    agc: {
      nativeAgcEnabled: true,
      digitalAgcEnabled: true,
      targetLevelDb: -18,
      maxGainBoostDb: 12,
      compressorThresholdDb: -18,
      compressorRatio: 4,
      makeupGainDb: 2
    }
  },
  ambiente_ruidoso: {
    sampleRate: 48e3,
    echoCancellation: true,
    noiseSuppression: {
      nativeEnabled: true,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.85
    },
    vadGate: {
      enabled: true,
      thresholdDb: -36,
      floorAttenuationDb: -65,
      antiClickHoldDelayMs: 22,
      attackMs: 5,
      holdMs: 150,
      releaseMs: 75,
      maxVoiceZcr: 0.38
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 110,
      mudCutDb: -4.5,
      presenceBoostDb: 5,
      clarityShelfDb: 1.5,
      lowPassFreqHz: 7e3
    },
    agc: {
      nativeAgcEnabled: true,
      digitalAgcEnabled: true,
      targetLevelDb: -16,
      maxGainBoostDb: 10,
      compressorThresholdDb: -16,
      compressorRatio: 5,
      makeupGainDb: 2.5
    }
  },
  anti_teclado_gamer: {
    sampleRate: 48e3,
    echoCancellation: true,
    noiseSuppression: {
      nativeEnabled: true,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.75
    },
    vadGate: {
      enabled: true,
      thresholdDb: -38,
      floorAttenuationDb: -60,
      // Rejeita transientes rápidos de switches mecânicos (< 25ms) e exige ZCR vocal
      antiClickHoldDelayMs: 25,
      attackMs: 3,
      holdMs: 200,
      releaseMs: 85,
      maxVoiceZcr: 0.35
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 95,
      mudCutDb: -3,
      presenceBoostDb: 4.2,
      clarityShelfDb: 1.8,
      lowPassFreqHz: 7400
    },
    agc: {
      nativeAgcEnabled: true,
      digitalAgcEnabled: true,
      targetLevelDb: -17,
      maxGainBoostDb: 12,
      compressorThresholdDb: -18,
      compressorRatio: 6,
      makeupGainDb: 2
    }
  },
  voz_estudio: {
    sampleRate: 48e3,
    echoCancellation: false,
    // Ideal para quem usa fone fechado em ambiente controlado
    noiseSuppression: {
      nativeEnabled: false,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.35
    },
    vadGate: {
      enabled: true,
      thresholdDb: -48,
      floorAttenuationDb: -45,
      antiClickHoldDelayMs: 10,
      attackMs: 3,
      holdMs: 240,
      releaseMs: 130,
      maxVoiceZcr: 0.48
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 75,
      mudCutDb: -2.5,
      presenceBoostDb: 3,
      clarityShelfDb: 3,
      lowPassFreqHz: 11e3
    },
    agc: {
      nativeAgcEnabled: false,
      digitalAgcEnabled: true,
      targetLevelDb: -16,
      maxGainBoostDb: 10,
      compressorThresholdDb: -20,
      compressorRatio: 3.5,
      makeupGainDb: 3
    }
  }
};
class CallAudioProcessor {
  config;
  audioContext = null;
  rawStream = null;
  ownsInput = false;
  generation = 0;
  fallback = false;
  onFallback;
  destinationNode = null;
  // Nós do grafo de áudio
  sourceNode = null;
  highPassFilter = null;
  mudCutFilter = null;
  presenceFilter = null;
  clarityShelfFilter = null;
  lowPassFilter = null;
  workletNode = null;
  compressorNode = null;
  makeupGainNode = null;
  muteGainNode = null;
  // Estado e observadores
  isMuted = false;
  isBypassed = false;
  lastSpeakingState = false;
  telemetryListeners = /* @__PURE__ */ new Set();
  voiceStateListeners = /* @__PURE__ */ new Set();
  constructor(initialConfig = "padrao_call") {
    if (typeof initialConfig === "string") {
      if (!Object.hasOwn(AUDIO_PRESETS, initialConfig)) throw new Error("Preset inv\xE1lido");
      this.config = structuredClone(AUDIO_PRESETS[initialConfig]);
    } else {
      const base = structuredClone(AUDIO_PRESETS.padrao_call);
      this.config = {
        ...base,
        ...initialConfig,
        noiseSuppression: { ...base.noiseSuppression, ...initialConfig.noiseSuppression },
        vadGate: { ...base.vadGate, ...initialConfig.vadGate },
        equalizer: { ...base.equalizer, ...initialConfig.equalizer },
        agc: { ...base.agc, ...initialConfig.agc }
      };
    }
  }
  /**
   * Inicializa a captura do microfone e constrói o pipeline completo de DSP.
   * Retorna o MediaStream limpo e tratado, pronto para ser enviado ao WebRTC (RTCPeerConnection).
   */
  async initialize(customRawStream) {
    const disposing = this.dispose();
    const generation = this.generation;
    await disposing;
    if (generation !== this.generation) throw new Error("Processamento cancelado");
    let captured;
    try {
      captured = customRawStream ?? await this.captureMicrophoneStream();
      if (generation !== this.generation) {
        if (!customRawStream) captured.getTracks().forEach((t) => t.stop());
        throw new Error("Processamento cancelado");
      }
      if (!captured.getAudioTracks().some((t) => t.readyState === "live")) throw new Error("Microfone indispon\xEDvel");
      this.rawStream = captured;
      this.ownsInput = !customRawStream;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) {
        this.fallback = true;
        return captured;
      }
      const ctx = new Audio({ latencyHint: "interactive" });
      this.audioContext = ctx;
      this.sourceNode = ctx.createMediaStreamSource(new MediaStream([captured.getAudioTracks()[0]]));
      this.destinationNode = ctx.createMediaStreamDestination();
      this.setupEqualizerNodes(ctx);
      this.setupCompressorAndGainNodes(ctx);
      this.fallback = false;
      try {
        await this.setupAudioWorkletNode(ctx);
      } catch {
        if (generation !== this.generation) throw new Error("Processamento cancelado");
        this.fallback = true;
      }
      if (generation !== this.generation) throw new Error("Processamento cancelado");
      this.connectAudioGraph();
      await ctx.resume();
      if (generation !== this.generation) throw new Error("Processamento cancelado");
      if (ctx.state !== "running") throw new Error("\xC1udio suspenso");
      return this.destinationNode.stream;
    } catch (error) {
      if (generation === this.generation) await this.dispose();
      throw error;
    }
  }
  /**
   * Solicita o microfone aplicando as constraints de hardware/navegador para chamadas.
   */
  async captureMicrophoneStream() {
    const constraints = {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: this.config.sampleRate ?? 48e3 },
      echoCancellation: { ideal: this.config.echoCancellation },
      noiseSuppression: { ideal: this.config.noiseSuppression.nativeEnabled },
      autoGainControl: { ideal: this.config.agc.nativeAgcEnabled }
    };
    if (this.config.deviceId) {
      constraints.deviceId = { exact: this.config.deviceId };
    }
    return navigator.mediaDevices.getUserMedia({
      audio: constraints,
      video: false
    });
  }
  /**
   * Configura os 5 estágios do Equalizador de Voz (High-Pass, Mud Cut, Presence, Clarity, Low-Pass).
   */
  setupEqualizerNodes(ctx) {
    const eq = this.config.equalizer;
    this.highPassFilter = ctx.createBiquadFilter();
    this.highPassFilter.type = "highpass";
    this.highPassFilter.frequency.value = eq.enabled ? eq.highPassFreqHz : 20;
    this.highPassFilter.Q.value = 0.707;
    this.mudCutFilter = ctx.createBiquadFilter();
    this.mudCutFilter.type = "peaking";
    this.mudCutFilter.frequency.value = 250;
    this.mudCutFilter.Q.value = 1.4;
    this.mudCutFilter.gain.value = eq.enabled ? eq.mudCutDb : 0;
    this.presenceFilter = ctx.createBiquadFilter();
    this.presenceFilter.type = "peaking";
    this.presenceFilter.frequency.value = 2800;
    this.presenceFilter.Q.value = 1.1;
    this.presenceFilter.gain.value = eq.enabled ? eq.presenceBoostDb : 0;
    this.clarityShelfFilter = ctx.createBiquadFilter();
    this.clarityShelfFilter.type = "highshelf";
    this.clarityShelfFilter.frequency.value = 4500;
    this.clarityShelfFilter.gain.value = eq.enabled ? eq.clarityShelfDb : 0;
    this.lowPassFilter = ctx.createBiquadFilter();
    this.lowPassFilter.type = "lowpass";
    this.lowPassFilter.frequency.value = eq.enabled ? eq.lowPassFreqHz : 2e4;
    this.lowPassFilter.Q.value = 0.707;
  }
  /**
   * Carrega o AudioWorkletProcessor a partir de um Blob URL em memória (sem depender de arquivos externos).
   */
  async setupAudioWorkletNode(ctx) {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("AudioWorklet indispon\xEDvel");
    let timer;
    try {
      await Promise.race([
        ctx.audioWorklet.addModule("/static/call-voice-worklet.js"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Tempo de carregamento excedido")), 8e3);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.audioContext !== ctx) throw new Error("Processamento cancelado");
    this.workletNode = new AudioWorkletNode(ctx, "call-voice-dsp-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    this.workletNode.onprocessorerror = () => {
      if (this.audioContext !== ctx) return;
      this.fallback = true;
      this.connectAudioGraph();
      this.onFallback?.();
    };
    this.syncWorkletConfig();
    this.workletNode.port.onmessage = (event) => {
      if (event.data?.type === "TELEMETRY") {
        const rawMetrics = event.data.payload;
        const compressorReductionDb = this.compressorNode ? this.compressorNode.reduction : 0;
        const fullMetrics = {
          ...rawMetrics,
          compressorReductionDb
        };
        if (fullMetrics.isSpeaking !== this.lastSpeakingState) {
          this.lastSpeakingState = fullMetrics.isSpeaking;
          this.voiceStateListeners.forEach((cb) => (() => {
            try {
              cb(fullMetrics.isSpeaking);
            } catch {
            }
          })());
        }
        this.telemetryListeners.forEach((cb) => (() => {
          try {
            cb(fullMetrics);
          } catch {
          }
        })());
      }
    };
  }
  /**
   * Configura o Compressor Dinâmico (Limiter de picos) e Ganho de Saída.
   */
  setupCompressorAndGainNodes(ctx) {
    const agc = this.config.agc;
    this.compressorNode = ctx.createDynamicsCompressor();
    this.compressorNode.threshold.value = agc.compressorThresholdDb;
    this.compressorNode.knee.value = 12;
    this.compressorNode.ratio.value = agc.compressorRatio;
    this.compressorNode.attack.value = 3e-3;
    this.compressorNode.release.value = 0.15;
    this.makeupGainNode = ctx.createGain();
    this.makeupGainNode.gain.value = this.dbToLinear(agc.makeupGainDb);
    this.muteGainNode = ctx.createGain();
    this.muteGainNode.gain.value = this.isMuted ? 0 : 1;
  }
  /**
   * Conecta ou reconecta os nós do pipeline de acordo com o modo normal ou bypass.
   */
  connectAudioGraph() {
    if (!this.sourceNode || !this.highPassFilter || !this.mudCutFilter || !this.presenceFilter || !this.clarityShelfFilter || !this.lowPassFilter || !this.compressorNode || !this.makeupGainNode || !this.muteGainNode || !this.destinationNode) {
      return;
    }
    this.sourceNode.disconnect();
    this.highPassFilter.disconnect();
    this.mudCutFilter.disconnect();
    this.presenceFilter.disconnect();
    this.clarityShelfFilter.disconnect();
    this.lowPassFilter.disconnect();
    this.workletNode?.disconnect();
    this.compressorNode.disconnect();
    this.makeupGainNode.disconnect();
    this.muteGainNode.disconnect();
    if (this.isBypassed || this.fallback || !this.workletNode) {
      this.sourceNode.connect(this.muteGainNode);
      this.muteGainNode.connect(this.destinationNode);
      return;
    }
    this.sourceNode.connect(this.highPassFilter).connect(this.mudCutFilter).connect(this.presenceFilter).connect(this.clarityShelfFilter).connect(this.lowPassFilter).connect(this.workletNode).connect(this.compressorNode).connect(this.makeupGainNode).connect(this.muteGainNode).connect(this.destinationNode);
  }
  /**
   * Sincroniza os parâmetros atuais com a thread do AudioWorklet.
   */
  syncWorkletConfig() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: "UPDATE_CONFIG",
      payload: {
        vadEnabled: this.config.vadGate.enabled,
        thresholdDb: this.config.vadGate.thresholdDb,
        floorAttenuationDb: this.config.vadGate.floorAttenuationDb,
        antiClickHoldDelayMs: this.config.vadGate.antiClickHoldDelayMs,
        attackMs: this.config.vadGate.attackMs,
        holdMs: this.config.vadGate.holdMs,
        releaseMs: this.config.vadGate.releaseMs,
        maxVoiceZcr: this.config.vadGate.maxVoiceZcr,
        spectralAdaptiveEnabled: this.config.noiseSuppression.spectralAdaptiveEnabled,
        suppressionStrength: this.config.noiseSuppression.suppressionStrength,
        digitalAgcEnabled: this.config.agc.digitalAgcEnabled,
        targetLevelDb: this.config.agc.targetLevelDb,
        maxGainBoostDb: this.config.agc.maxGainBoostDb,
        bypass: this.isBypassed
      }
    });
  }
  /**
   * Aplica um dos presets prontos ('padrao_call', 'ambiente_ruidoso', 'anti_teclado_gamer', 'voz_estudio')
   * em tempo real, sem interromper a chamada.
   */
  async applyPreset(presetName) {
    const preset = AUDIO_PRESETS[presetName];
    if (!Object.hasOwn(AUDIO_PRESETS, presetName)) throw new Error("Preset inv\xE1lido");
    await this.updateConfig(structuredClone(preset));
  }
  /**
   * Atualiza qualquer parâmetro de áudio (AEC, NS, VAD/Gate, EQ, AGC) em tempo real.
   */
  async updateConfig(partial) {
    for (const [section, values] of Object.entries(partial)) {
      if (values && typeof values === "object") {
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 24e3))
            throw new Error("Par\xE2metro de \xE1udio inv\xE1lido: " + section + "." + key);
        }
      }
    }
    this.config = {
      ...this.config,
      ...partial,
      noiseSuppression: { ...this.config.noiseSuppression, ...partial.noiseSuppression },
      vadGate: { ...this.config.vadGate, ...partial.vadGate },
      equalizer: { ...this.config.equalizer, ...partial.equalizer },
      agc: { ...this.config.agc, ...partial.agc }
    };
    const audioTrack = this.rawStream?.getAudioTracks()[0];
    if (this.ownsInput && audioTrack && audioTrack.applyConstraints) {
      try {
        await audioTrack.applyConstraints({
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression.nativeEnabled,
          autoGainControl: this.config.agc.nativeAgcEnabled
        });
      } catch {
      }
    }
    if (this.audioContext) {
      const now = this.audioContext.currentTime;
      const eq = this.config.equalizer;
      this.highPassFilter?.frequency.setTargetAtTime(eq.enabled ? eq.highPassFreqHz : 20, now, 0.015);
      this.mudCutFilter?.gain.setTargetAtTime(eq.enabled ? eq.mudCutDb : 0, now, 0.015);
      this.presenceFilter?.gain.setTargetAtTime(eq.enabled ? eq.presenceBoostDb : 0, now, 0.015);
      this.clarityShelfFilter?.gain.setTargetAtTime(eq.enabled ? eq.clarityShelfDb : 0, now, 0.015);
      this.lowPassFilter?.frequency.setTargetAtTime(eq.enabled ? eq.lowPassFreqHz : 2e4, now, 0.015);
      const agc = this.config.agc;
      this.compressorNode?.threshold.setTargetAtTime(agc.compressorThresholdDb, now, 0.015);
      this.compressorNode?.ratio.setTargetAtTime(agc.compressorRatio, now, 0.015);
      this.makeupGainNode?.gain.setTargetAtTime(this.dbToLinear(agc.makeupGainDb), now, 0.015);
    }
    this.syncWorkletConfig();
  }
  /**
   * Troca o dispositivo de microfone durante a chamada mantendo o mesmo stream de saída no WebRTC.
   */
  async switchMicrophone(deviceId) {
    if (this.rawStream && !this.ownsInput) throw new Error("Troque o microfone pelo LiveKit");
    const generation = this.generation, ctx = this.audioContext;
    const previous = this.config.deviceId;
    this.config.deviceId = deviceId;
    if (!ctx) return;
    let stream;
    try {
      stream = await this.captureMicrophoneStream();
    } catch (error) {
      this.config.deviceId = previous;
      throw error;
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const old = this.rawStream;
    this.sourceNode?.disconnect();
    this.rawStream = stream;
    this.sourceNode = source;
    this.connectAudioGraph();
    old?.getTracks().forEach((t) => t.stop());
  }
  /**
   * Silencia ou ativa o microfone suavemente (rampa de 10ms para não gerar clique no áudio da call).
   */
  setMuted(muted) {
    this.isMuted = muted;
    if (this.muteGainNode && this.audioContext) {
      this.muteGainNode.gain.setTargetAtTime(
        muted ? 0 : 1,
        this.audioContext.currentTime,
        0.01
      );
    }
  }
  /**
   * Ativa ou desativa o modo Bypass (áudio cru vs. áudio tratado) para teste A/B.
   */
  setBypass(bypass) {
    this.isBypassed = bypass;
    this.syncWorkletConfig();
    this.connectAudioGraph();
  }
  /**
   * Substitui ou adiciona a track de áudio processada diretamente em uma conexão WebRTC (RTCPeerConnection).
   */
  async attachToPeerConnection(peerConnection) {
    const processedStream = this.getProcessedStream();
    if (!processedStream) {
      throw new Error("CallAudioProcessor n\xE3o foi inicializado. Chame initialize() primeiro.");
    }
    const [processedAudioTrack] = processedStream.getAudioTracks();
    if (!processedAudioTrack) return null;
    if ("contentHint" in processedAudioTrack) {
      processedAudioTrack.contentHint = "speech";
    }
    const existingSender = peerConnection.getSenders().find((sender) => sender.track?.kind === "audio");
    if (existingSender) {
      await existingSender.replaceTrack(processedAudioTrack);
      return existingSender;
    }
    return peerConnection.addTrack(processedAudioTrack, processedStream);
  }
  /**
   * Registra um listener para receber métricas em tempo real (~30fps) de VAD, nível dB e redução de ruído.
   */
  onTelemetry(callback) {
    this.telemetryListeners.add(callback);
    return () => this.telemetryListeners.delete(callback);
  }
  /**
   * Registra um listener disparado sempre que o usuário começa ou para de falar (VAD Gate).
   */
  onVoiceStateChange(callback) {
    this.voiceStateListeners.add(callback);
    return () => this.voiceStateListeners.delete(callback);
  }
  /**
   * Retorna o MediaStream tratado (pós-EQ, VAD, Gate, NS e AGC).
   */
  getProcessedStream() {
    return this.destinationNode?.stream ?? this.rawStream;
  }
  /**
   * Retorna uma cópia da configuração ativa no momento.
   */
  getConfig() {
    return structuredClone(this.config);
  }
  /**
   * Lista todos os microfones disponíveis no dispositivo do usuário.
   */
  static async listMicrophones() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }
  /**
   * Encerra o processamento e libera o microfone e a thread de áudio.
   */
  async dispose() {
    ++this.generation;
    const ctx = this.audioContext;
    this.audioContext = null;
    for (const node of [
      this.sourceNode,
      this.highPassFilter,
      this.mudCutFilter,
      this.presenceFilter,
      this.clarityShelfFilter,
      this.lowPassFilter,
      this.workletNode,
      this.compressorNode,
      this.makeupGainNode,
      this.muteGainNode,
      this.destinationNode
    ]) {
      try {
        node?.disconnect();
      } catch {
      }
    }
    if (this.workletNode) {
      this.workletNode.onprocessorerror = null;
      this.workletNode.port.onmessage = null;
      this.workletNode.port.close();
    }
    this.destinationNode?.stream.getTracks().forEach((t) => t.stop());
    if (this.ownsInput) this.rawStream?.getTracks().forEach((t) => t.stop());
    this.sourceNode = this.workletNode = this.destinationNode = this.rawStream = null;
    this.highPassFilter = this.mudCutFilter = this.presenceFilter = this.clarityShelfFilter = this.lowPassFilter = null;
    this.compressorNode = this.makeupGainNode = this.muteGainNode = null;
    this.ownsInput = false;
    this.lastSpeakingState = false;
    if (ctx && ctx.state !== "closed") await ctx.close().catch(() => {
    });
  }
  dbToLinear(db) {
    return Math.pow(10, db / 20);
  }
}
export {
  AUDIO_PRESETS,
  CallAudioProcessor
};
