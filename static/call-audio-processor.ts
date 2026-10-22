/**
 * ============================================================================
 * CallAudioProcessor API - Motor de Processamento de Áudio em Tempo Real (WebRTC + Web Audio DSP)
 * ============================================================================
 *
 * Pipeline de áudio de baixa latência (128 amostras por bloco; latência total depende do dispositivo)
 * projetado para chamadas de voz (estilo Discord / WebRTC), combinando:
 *
 * 1. Camada Nativa (Hardware/OS via MediaTrackConstraints):
 *    - Cancelamento de Eco Acústico (AEC - Acoustic Echo Cancellation)
 *    - Supressão de Ruído Nativa (NS - Noise Suppression)
 *    - Controle Automático de Ganho Nativo (AGC - Auto Gain Control)
 *
 * 2. Filtro de Equalização de Voz (5 Estágios BiquadFilterNode):
 *    - High-Pass (85 Hz): Remove ruído de vento, ar-condicionado, vibração de mesa e plosivas ("p", "b")
 *    - Low-Mid Cut (250 Hz): Remove som "encaixotado" ou abafado da voz
 *    - Presence Boost (2.8 kHz): Destaca a inteligibilidade e articulação das consoantes
 *    - Clarity High-Shelf (4.5 kHz): Adiciona nitidez e presença vocal
 *    - Low-Pass Anti-Hiss (7.8 kHz): Corta chiados agudos de microfones de entrada
 *
 * 3. DSP Customizado em Thread de Áudio Dedicada (AudioWorkletProcessor):
 *    - Supressão de Ruído Estacionário Adaptativa (Estimador contínuo de piso de ruído)
 *    - VAD (Voice Activity Detection) Híbrido (Energia RMS + Taxa de Cruzamento por Zero - ZCR)
 *    - Noise Gate Inteligente (Anti-Teclado e Respiração) com envelopes de Attack, Hold e Release
 *    - AGC Digital Adaptativo (Normalização dinâmica de volume para nivelar falas baixas)
 *
 * 4. Compressor / Limiter Broadcast (DynamicsCompressorNode):
 *    - Protege contra picos súbitos (gritos/risadas) e estabiliza a faixa dinâmica na call.
 */

export type AudioPresetName =
  | 'padrao_call'
  | 'ambiente_ruidoso'
  | 'anti_teclado_gamer'
  | 'voz_estudio';

export interface VoiceEqualizerConfig {
  enabled: boolean;
  /** Frequência de corte de graves (Hz) para remover plosivas e vibrações. Padrão: 85 Hz */
  highPassFreqHz: number;
  /** Atenuação de médio-graves em 250 Hz (dB) para limpar voz abafada. Padrão: -3.5 dB */
  mudCutDb: number;
  /** Ganho de presença vocal em 2800 Hz (dB) para destacar a fala. Padrão: +4.0 dB */
  presenceBoostDb: number;
  /** Ganho de brilho/nitidez em 4500 Hz (dB). Padrão: +2.0 dB */
  clarityShelfDb: number;
  /** Frequência de corte de agudos (Hz) para remover chiado (hiss). Padrão: 7800 Hz */
  lowPassFreqHz: number;
}

export interface VadNoiseGateConfig {
  enabled: boolean;
  /** Limiar de abertura do Gate em dBFS (ex: -42 dB). Sons abaixo disso são cortados. */
  thresholdDb: number;
  /** Atenuação máxima quando o Gate está fechado (dB, ex: -60 dB para silêncio quase total). */
  floorAttenuationDb: number;
  /** Tempo mínimo de fala contínua (ms) para ignorar cliques curtos de teclado (ex: 18 ms). */
  antiClickHoldDelayMs: number;
  /** Tempo de ataque do Gate (ms) ao detectar voz. Padrão: 4 ms */
  attackMs: number;
  /** Tempo de sustentação (ms) mantendo o Gate aberto após parar de falar. Padrão: 180 ms */
  holdMs: number;
  /** Tempo de descida suave (ms) ao fechar o Gate para não cortar finais de frases. Padrão: 90 ms */
  releaseMs: number;
  /** Limite de Zero-Crossing Rate (0.0 a 1.0) para rejeitar ruídos percussivos/sopro. Padrão: 0.42 */
  maxVoiceZcr: number;
}

export interface NoiseSuppressionConfig {
  /** Ativa supressão de ruído nativa do navegador/SO (WebRTC NS) */
  nativeEnabled: boolean;
  /** Ativa supressão adaptativa de ruído de fundo no AudioWorklet DSP */
  spectralAdaptiveEnabled: boolean;
  /** Intensidade da supressão adaptativa (0.0 a 1.0). Padrão: 0.65 */
  suppressionStrength: number;
}

export interface AgcAndCompressorConfig {
  /** Ativa o AGC nativo do WebRTC */
  nativeAgcEnabled: boolean;
  /** Ativa normalização digital de ganho no DSP (nivela quem fala baixo) */
  digitalAgcEnabled: boolean;
  /** Nível alvo de volume da voz em dBFS (ex: -18 dBFS) */
  targetLevelDb: number;
  /** Ganho máximo automático permitido em dB (evita amplificar ruído). Padrão: 12 dB */
  maxGainBoostDb: number;
  /** Limiar do compressor de picos (dB). Padrão: -18 dB */
  compressorThresholdDb: number;
  /** Taxa de compressão (ex: 4 para 4:1). Padrão: 4 */
  compressorRatio: number;
  /** Ganho final de saída (Makeup Gain em dB). Padrão: 2 dB */
  makeupGainDb: number;
}

export interface CallAudioConfig {
  deviceId?: string;
  sampleRate?: number;
  /** Cancelamento de Eco Acústico (AEC) para evitar retorno das caixas de som */
  echoCancellation: boolean;
  noiseSuppression: NoiseSuppressionConfig;
  vadGate: VadNoiseGateConfig;
  equalizer: VoiceEqualizerConfig;
  agc: AgcAndCompressorConfig;
}

export interface AudioTelemetryMetrics {
  /** Indica se a voz do usuário está ativa no momento (ideal para borda verde de "falando" na UI) */
  isSpeaking: boolean;
  /** Nível de entrada bruto do microfone em dBFS */
  inputLevelDb: number;
  /** Nível de saída pós-processamento em dBFS */
  outputLevelDb: number;
  /** Estimativa atual do piso de ruído ambiente em dBFS */
  noiseFloorDb: number;
  /** Atenuação aplicada pelo Noise Gate no instante atual (dB) */
  gateAttenuationDb: number;
  /** Ganho dinâmico aplicado pelo AGC Digital (dB) */
  agcGainDb: number;
  /** Redução de pico aplicada pelo Compressor Broadcast (dB) */
  compressorReductionDb: number;
  /** Taxa de cruzamento por zero instantânea (útil para diagnóstico de cliques/sopro) */
  zeroCrossingRate: number;
}

export type TelemetryCallback = (metrics: AudioTelemetryMetrics) => void;
export type VoiceStateCallback = (isSpeaking: boolean) => void;

/**
 * Perfis pré-calibrados para diferentes cenários de chamada.
 */
export const AUDIO_PRESETS: Record<AudioPresetName, CallAudioConfig> = {
  padrao_call: {
    sampleRate: 48000,
    echoCancellation: true,
    noiseSuppression: {
      nativeEnabled: true,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.65,
    },
    vadGate: {
      enabled: true,
      thresholdDb: -42,
      floorAttenuationDb: -55,
      antiClickHoldDelayMs: 16,
      attackMs: 4,
      holdMs: 180,
      releaseMs: 90,
      maxVoiceZcr: 0.42,
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 85,
      mudCutDb: -3.5,
      presenceBoostDb: 4.0,
      clarityShelfDb: 2.0,
      lowPassFreqHz: 7800,
    },
    agc: {
      nativeAgcEnabled: true,
      digitalAgcEnabled: true,
      targetLevelDb: -18,
      maxGainBoostDb: 12,
      compressorThresholdDb: -18,
      compressorRatio: 4,
      makeupGainDb: 2.0,
    },
  },

  ambiente_ruidoso: {
    sampleRate: 48000,
    echoCancellation: true,
    noiseSuppression: {
      nativeEnabled: true,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.85,
    },
    vadGate: {
      enabled: true,
      thresholdDb: -36,
      floorAttenuationDb: -65,
      antiClickHoldDelayMs: 22,
      attackMs: 5,
      holdMs: 150,
      releaseMs: 75,
      maxVoiceZcr: 0.38,
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 110,
      mudCutDb: -4.5,
      presenceBoostDb: 5.0,
      clarityShelfDb: 1.5,
      lowPassFreqHz: 7000,
    },
    agc: {
      nativeAgcEnabled: true,
      digitalAgcEnabled: true,
      targetLevelDb: -16,
      maxGainBoostDb: 10,
      compressorThresholdDb: -16,
      compressorRatio: 5,
      makeupGainDb: 2.5,
    },
  },

  anti_teclado_gamer: {
    sampleRate: 48000,
    echoCancellation: true,
    noiseSuppression: {
      nativeEnabled: true,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.75,
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
      maxVoiceZcr: 0.35,
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 95,
      mudCutDb: -3.0,
      presenceBoostDb: 4.2,
      clarityShelfDb: 1.8,
      lowPassFreqHz: 7400,
    },
    agc: {
      nativeAgcEnabled: true,
      digitalAgcEnabled: true,
      targetLevelDb: -17,
      maxGainBoostDb: 12,
      compressorThresholdDb: -18,
      compressorRatio: 6,
      makeupGainDb: 2.0,
    },
  },

  voz_estudio: {
    sampleRate: 48000,
    echoCancellation: false, // Ideal para quem usa fone fechado em ambiente controlado
    noiseSuppression: {
      nativeEnabled: false,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.35,
    },
    vadGate: {
      enabled: true,
      thresholdDb: -48,
      floorAttenuationDb: -45,
      antiClickHoldDelayMs: 10,
      attackMs: 3,
      holdMs: 240,
      releaseMs: 130,
      maxVoiceZcr: 0.48,
    },
    equalizer: {
      enabled: true,
      highPassFreqHz: 75,
      mudCutDb: -2.5,
      presenceBoostDb: 3.0,
      clarityShelfDb: 3.0,
      lowPassFreqHz: 11000,
    },
    agc: {
      nativeAgcEnabled: false,
      digitalAgcEnabled: true,
      targetLevelDb: -16,
      maxGainBoostDb: 10,
      compressorThresholdDb: -20,
      compressorRatio: 3.5,
      makeupGainDb: 3.0,
    },
  },
};

/**
 * Código do AudioWorkletProcessor embutido para execução isolada na thread de áudio.
 * Realiza:
 *  - Estimativa adaptativa de ruído de fundo (Noise Floor Tracker)
 *  - Detecção de Atividade de Voz (VAD) por RMS + Zero-Crossing Rate (anti-teclado/respiração)
 *  - Noise Gate suave com histerese e filtro de transientes curtos
 *  - Controle Automático de Ganho (AGC Digital) com proteção de piso de ruído
 */

/**
 * Classe principal da API de Processamento de Áudio para Chamadas.
 */
export class CallAudioProcessor {
  private config: CallAudioConfig;
  private audioContext: AudioContext | null = null;
  private rawStream: MediaStream | null = null;
  private ownsInput = false;
  private generation = 0;
  public fallback = false;
  public onFallback?: () => void;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  // Nós do grafo de áudio
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highPassFilter: BiquadFilterNode | null = null;
  private mudCutFilter: BiquadFilterNode | null = null;
  private presenceFilter: BiquadFilterNode | null = null;
  private clarityShelfFilter: BiquadFilterNode | null = null;
  private lowPassFilter: BiquadFilterNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private makeupGainNode: GainNode | null = null;
  private muteGainNode: GainNode | null = null;

  // Estado e observadores
  private isMuted = false;
  private isBypassed = false;
  private lastSpeakingState = false;
  private telemetryListeners = new Set<TelemetryCallback>();
  private voiceStateListeners = new Set<VoiceStateCallback>();

  constructor(initialConfig: Partial<CallAudioConfig> | AudioPresetName = 'padrao_call') {
    if (typeof initialConfig === 'string') {
      if (!Object.hasOwn(AUDIO_PRESETS, initialConfig)) throw new Error('Preset inválido');
      this.config = structuredClone(AUDIO_PRESETS[initialConfig]);
    } else {
      const base = structuredClone(AUDIO_PRESETS.padrao_call);
      this.config = {...base, ...initialConfig,
        noiseSuppression: {...base.noiseSuppression, ...initialConfig.noiseSuppression},
        vadGate: {...base.vadGate, ...initialConfig.vadGate},
        equalizer: {...base.equalizer, ...initialConfig.equalizer},
        agc: {...base.agc, ...initialConfig.agc}};
    }
  }

  /**
   * Inicializa a captura do microfone e constrói o pipeline completo de DSP.
   * Retorna o MediaStream limpo e tratado, pronto para ser enviado ao WebRTC (RTCPeerConnection).
   */
  public async initialize(customRawStream?: MediaStream): Promise<MediaStream> {
    const disposing = this.dispose();
    const generation = this.generation;
    await disposing;
    if (generation !== this.generation) throw new Error('Processamento cancelado');
    let captured: MediaStream | undefined;
    try {
      captured = customRawStream ?? await this.captureMicrophoneStream();
      if (generation !== this.generation) {
        if (!customRawStream) captured.getTracks().forEach(t => t.stop());
        throw new Error('Processamento cancelado');
      }
      if (!captured.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('Microfone indisponível');
      this.rawStream = captured;
      this.ownsInput = !customRawStream;
      const Audio = window.AudioContext || (window as any).webkitAudioContext;
      if (!Audio) { this.fallback = true; return captured; }
      const ctx: AudioContext = new Audio({latencyHint: 'interactive'});
      this.audioContext = ctx;
      this.sourceNode = ctx.createMediaStreamSource(new MediaStream([captured.getAudioTracks()[0]]));
      this.destinationNode = ctx.createMediaStreamDestination();
      this.setupEqualizerNodes(ctx);
      this.setupCompressorAndGainNodes(ctx);
      this.fallback = false;
      try { await this.setupAudioWorkletNode(ctx); }
      catch {
        if (generation !== this.generation) throw new Error('Processamento cancelado');
        this.fallback = true; // Same destination and raw microphone remain alive.
      }
      if (generation !== this.generation) throw new Error('Processamento cancelado');
      this.connectAudioGraph();
      await ctx.resume();
      if (generation !== this.generation) throw new Error('Processamento cancelado');
      if (ctx.state !== 'running') throw new Error('Áudio suspenso');
      return this.destinationNode!.stream;
    } catch (error) {
      if (generation === this.generation) await this.dispose();
      throw error;
    }
  }

  /**
   * Solicita o microfone aplicando as constraints de hardware/navegador para chamadas.
   */
  private async captureMicrophoneStream(): Promise<MediaStream> {
    const constraints: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: this.config.sampleRate ?? 48000 },
      echoCancellation: { ideal: this.config.echoCancellation },
      noiseSuppression: { ideal: this.config.noiseSuppression.nativeEnabled },
      autoGainControl: { ideal: this.config.agc.nativeAgcEnabled },
    };

    if (this.config.deviceId) {
      constraints.deviceId = { exact: this.config.deviceId };
    }

    return navigator.mediaDevices.getUserMedia({
      audio: constraints,
      video: false,
    });
  }

  /**
   * Configura os 5 estágios do Equalizador de Voz (High-Pass, Mud Cut, Presence, Clarity, Low-Pass).
   */
  private setupEqualizerNodes(ctx: AudioContext): void {
    const eq = this.config.equalizer;

    // 1. Filtro Passa-Altas (remove graves de ar-condicionado, vento e plosivas "p"/"b")
    this.highPassFilter = ctx.createBiquadFilter();
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = eq.enabled ? eq.highPassFreqHz : 20;
    this.highPassFilter.Q.value = 0.707;

    // 2. Corte de Embolamento (250 Hz)
    this.mudCutFilter = ctx.createBiquadFilter();
    this.mudCutFilter.type = 'peaking';
    this.mudCutFilter.frequency.value = 250;
    this.mudCutFilter.Q.value = 1.4;
    this.mudCutFilter.gain.value = eq.enabled ? eq.mudCutDb : 0;

    // 3. Realce de Presença e Inteligibilidade da Voz (2800 Hz)
    this.presenceFilter = ctx.createBiquadFilter();
    this.presenceFilter.type = 'peaking';
    this.presenceFilter.frequency.value = 2800;
    this.presenceFilter.Q.value = 1.1;
    this.presenceFilter.gain.value = eq.enabled ? eq.presenceBoostDb : 0;

    // 4. Brilho e Articulação (High-Shelf em 4500 Hz)
    this.clarityShelfFilter = ctx.createBiquadFilter();
    this.clarityShelfFilter.type = 'highshelf';
    this.clarityShelfFilter.frequency.value = 4500;
    this.clarityShelfFilter.gain.value = eq.enabled ? eq.clarityShelfDb : 0;

    // 5. Filtro Passa-Baixas Anti-Chiado (corta ruído branco acima de 7.8 kHz)
    this.lowPassFilter = ctx.createBiquadFilter();
    this.lowPassFilter.type = 'lowpass';
    this.lowPassFilter.frequency.value = eq.enabled ? eq.lowPassFreqHz : 20000;
    this.lowPassFilter.Q.value = 0.707;
  }

  /**
   * Carrega o AudioWorkletProcessor a partir de um Blob URL em memória (sem depender de arquivos externos).
   */
  private async setupAudioWorkletNode(ctx: AudioContext): Promise<void> {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet indisponível');
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        ctx.audioWorklet.addModule('/static/call-voice-worklet.js'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo de carregamento excedido')), 8000); }),
      ]);
    } finally { clearTimeout(timer!); }
    if (this.audioContext !== ctx) throw new Error('Processamento cancelado');
      this.workletNode = new AudioWorkletNode(ctx, 'call-voice-dsp-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      this.workletNode.onprocessorerror = () => {
        if (this.audioContext !== ctx) return;
        this.fallback = true;
        this.connectAudioGraph();
        this.onFallback?.();
      };
      this.syncWorkletConfig();

      this.workletNode.port.onmessage = (event) => {
        if (event.data?.type === 'TELEMETRY') {
          const rawMetrics = event.data.payload;
          const compressorReductionDb = this.compressorNode ? this.compressorNode.reduction : 0;

          const fullMetrics: AudioTelemetryMetrics = {
            ...rawMetrics,
            compressorReductionDb,
          };

          if (fullMetrics.isSpeaking !== this.lastSpeakingState) {
            this.lastSpeakingState = fullMetrics.isSpeaking;
            this.voiceStateListeners.forEach((cb) => (() => { try { cb(fullMetrics.isSpeaking); } catch {} })());
          }

          this.telemetryListeners.forEach((cb) => (() => { try { cb(fullMetrics); } catch {} })());
        }
      };
  }

  /**
   * Configura o Compressor Dinâmico (Limiter de picos) e Ganho de Saída.
   */
  private setupCompressorAndGainNodes(ctx: AudioContext): void {
    const agc = this.config.agc;

    this.compressorNode = ctx.createDynamicsCompressor();
    this.compressorNode.threshold.value = agc.compressorThresholdDb;
    this.compressorNode.knee.value = 12;
    this.compressorNode.ratio.value = agc.compressorRatio;
    this.compressorNode.attack.value = 0.003; // 3ms para segurar picos rápidos
    this.compressorNode.release.value = 0.15; // 150ms de retorno natural

    this.makeupGainNode = ctx.createGain();
    this.makeupGainNode.gain.value = this.dbToLinear(agc.makeupGainDb);

    this.muteGainNode = ctx.createGain();
    this.muteGainNode.gain.value = this.isMuted ? 0 : 1;
  }

  /**
   * Conecta ou reconecta os nós do pipeline de acordo com o modo normal ou bypass.
   */
  private connectAudioGraph(): void {
    if (
      !this.sourceNode ||
      !this.highPassFilter ||
      !this.mudCutFilter ||
      !this.presenceFilter ||
      !this.clarityShelfFilter ||
      !this.lowPassFilter ||
      !this.compressorNode ||
      !this.makeupGainNode ||
      !this.muteGainNode ||
      !this.destinationNode
    ) {
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

    this.sourceNode
      .connect(this.highPassFilter)
      .connect(this.mudCutFilter)
      .connect(this.presenceFilter)
      .connect(this.clarityShelfFilter)
      .connect(this.lowPassFilter)
      .connect(this.workletNode)
      .connect(this.compressorNode)
      .connect(this.makeupGainNode)
      .connect(this.muteGainNode)
      .connect(this.destinationNode);
  }

  /**
   * Sincroniza os parâmetros atuais com a thread do AudioWorklet.
   */
  private syncWorkletConfig(): void {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'UPDATE_CONFIG',
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
        bypass: this.isBypassed,
      },
    });
  }

  /**
   * Aplica um dos presets prontos ('padrao_call', 'ambiente_ruidoso', 'anti_teclado_gamer', 'voz_estudio')
   * em tempo real, sem interromper a chamada.
   */
  public async applyPreset(presetName: AudioPresetName): Promise<void> {
    const preset = AUDIO_PRESETS[presetName];
    if (!Object.hasOwn(AUDIO_PRESETS, presetName)) throw new Error('Preset inválido');
    await this.updateConfig(structuredClone(preset));
  }

  /**
   * Atualiza qualquer parâmetro de áudio (AEC, NS, VAD/Gate, EQ, AGC) em tempo real.
   */
  public async updateConfig(partial: Partial<CallAudioConfig>): Promise<void> {
    for (const [section, values] of Object.entries(partial)) {
      if (values && typeof values === 'object') {
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 24000))
            throw new Error('Parâmetro de áudio inválido: ' + section + '.' + key);
        }
      }
    }
    this.config = {
      ...this.config,
      ...partial,
      noiseSuppression: { ...this.config.noiseSuppression, ...partial.noiseSuppression },
      vadGate: { ...this.config.vadGate, ...partial.vadGate },
      equalizer: { ...this.config.equalizer, ...partial.equalizer },
      agc: { ...this.config.agc, ...partial.agc },
    };

    // Atualiza constraints nativas da track do microfone (AEC, NS nativo, AGC nativo)
    const audioTrack = this.rawStream?.getAudioTracks()[0];
    if (this.ownsInput && audioTrack && audioTrack.applyConstraints) {
      try {
        await audioTrack.applyConstraints({
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression.nativeEnabled,
          autoGainControl: this.config.agc.nativeAgcEnabled,
        });
      } catch {
        // Alguns navegadores exigem recriar a stream para alterar constraints de hardware
      }
    }

    // Atualiza Equalizador de Voz com transições suaves (evita estalos)
    if (this.audioContext) {
      const now = this.audioContext.currentTime;
      const eq = this.config.equalizer;
      this.highPassFilter?.frequency.setTargetAtTime(eq.enabled ? eq.highPassFreqHz : 20, now, 0.015);
      this.mudCutFilter?.gain.setTargetAtTime(eq.enabled ? eq.mudCutDb : 0, now, 0.015);
      this.presenceFilter?.gain.setTargetAtTime(eq.enabled ? eq.presenceBoostDb : 0, now, 0.015);
      this.clarityShelfFilter?.gain.setTargetAtTime(eq.enabled ? eq.clarityShelfDb : 0, now, 0.015);
      this.lowPassFilter?.frequency.setTargetAtTime(eq.enabled ? eq.lowPassFreqHz : 20000, now, 0.015);

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
  public async switchMicrophone(deviceId: string): Promise<void> {
    if (this.rawStream && !this.ownsInput) throw new Error('Troque o microfone pelo LiveKit');
    const generation = this.generation, ctx = this.audioContext;
    const previous = this.config.deviceId;
    this.config.deviceId = deviceId;
    if (!ctx) return;
    let stream: MediaStream;
    try { stream = await this.captureMicrophoneStream(); }
    catch (error) { this.config.deviceId = previous; throw error; }
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
    const source = ctx.createMediaStreamSource(stream);
    const old = this.rawStream;
    this.sourceNode?.disconnect();
    this.rawStream = stream;
    this.sourceNode = source;
    this.connectAudioGraph();
    old?.getTracks().forEach(t => t.stop());
  }

  /**
   * Silencia ou ativa o microfone suavemente (rampa de 10ms para não gerar clique no áudio da call).
   */
  public setMuted(muted: boolean): void {
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
  public setBypass(bypass: boolean): void {
    this.isBypassed = bypass;
    this.syncWorkletConfig();
    this.connectAudioGraph();
  }

  /**
   * Substitui ou adiciona a track de áudio processada diretamente em uma conexão WebRTC (RTCPeerConnection).
   */
  public async attachToPeerConnection(peerConnection: RTCPeerConnection): Promise<RTCRtpSender | null> {
    const processedStream = this.getProcessedStream();
    if (!processedStream) {
      throw new Error('CallAudioProcessor não foi inicializado. Chame initialize() primeiro.');
    }

    const [processedAudioTrack] = processedStream.getAudioTracks();
    if (!processedAudioTrack) return null;

    // Dica para o codificador Opus do WebRTC priorizar clareza de fala
    if ('contentHint' in processedAudioTrack) {
      processedAudioTrack.contentHint = 'speech';
    }

    const existingSender = peerConnection
      .getSenders()
      .find((sender) => sender.track?.kind === 'audio');

    if (existingSender) {
      await existingSender.replaceTrack(processedAudioTrack);
      return existingSender;
    }

    return peerConnection.addTrack(processedAudioTrack, processedStream);
  }

  /**
   * Registra um listener para receber métricas em tempo real (~30fps) de VAD, nível dB e redução de ruído.
   */
  public onTelemetry(callback: TelemetryCallback): () => void {
    this.telemetryListeners.add(callback);
    return () => this.telemetryListeners.delete(callback);
  }

  /**
   * Registra um listener disparado sempre que o usuário começa ou para de falar (VAD Gate).
   */
  public onVoiceStateChange(callback: VoiceStateCallback): () => void {
    this.voiceStateListeners.add(callback);
    return () => this.voiceStateListeners.delete(callback);
  }

  /**
   * Retorna o MediaStream tratado (pós-EQ, VAD, Gate, NS e AGC).
   */
  public getProcessedStream(): MediaStream | null {
    return this.destinationNode?.stream ?? this.rawStream;
  }

  /**
   * Retorna uma cópia da configuração ativa no momento.
   */
  public getConfig(): CallAudioConfig {
    return structuredClone(this.config);
  }

  /**
   * Lista todos os microfones disponíveis no dispositivo do usuário.
   */
  public static async listMicrophones(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  /**
   * Encerra o processamento e libera o microfone e a thread de áudio.
   */
  public async dispose(): Promise<void> {
    ++this.generation;
    const ctx = this.audioContext;
    this.audioContext = null;
    for (const node of [this.sourceNode, this.highPassFilter, this.mudCutFilter, this.presenceFilter,
      this.clarityShelfFilter, this.lowPassFilter, this.workletNode, this.compressorNode,
      this.makeupGainNode, this.muteGainNode, this.destinationNode]) {
      try { node?.disconnect(); } catch {}
    }
    if (this.workletNode) {
      this.workletNode.onprocessorerror = null;
      this.workletNode.port.onmessage = null;
      this.workletNode.port.close();
    }
    this.destinationNode?.stream.getTracks().forEach(t => t.stop());
    if (this.ownsInput) this.rawStream?.getTracks().forEach(t => t.stop());
    this.sourceNode = this.workletNode = this.destinationNode = this.rawStream = null;
    this.highPassFilter = this.mudCutFilter = this.presenceFilter = this.clarityShelfFilter = this.lowPassFilter = null;
    this.compressorNode = this.makeupGainNode = this.muteGainNode = null;
    this.ownsInput = false;
    this.lastSpeakingState = false;
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
  }

  private dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
  }
}