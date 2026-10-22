
class CallVoiceDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.config = {
      vadEnabled: true,
      thresholdDb: -42,
      floorAttenuationDb: -55,
      antiClickHoldDelayMs: 16,
      attackMs: 4,
      holdMs: 180,
      releaseMs: 90,
      maxVoiceZcr: 0.42,
      spectralAdaptiveEnabled: true,
      suppressionStrength: 0.65,
      digitalAgcEnabled: true,
      targetLevelDb: -18,
      maxGainBoostDb: 12,
      bypass: false,
    };

    // Estado interno do DSP
    this.noiseFloorDb = -60.0;
    this.currentGateGain = 1.0;
    this.currentAgcGain = 1.0;
    this.holdSamplesRemaining = 0;
    this.consecutiveVoiceSamples = 0;
    this.isSpeaking = false;
    this.framesSinceLastReport = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'UPDATE_CONFIG') {
        Object.assign(this.config, event.data.payload);
      }
    };
  }

  dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  linearToDb(linear) {
    return 20 * Math.log10(Math.max(linear, 1e-7));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }

    const inChannel = input[0];
    const outChannel = output[0];
    const numSamples = inChannel.length;
    const sr = sampleRate || 48000;

    if (this.config.bypass) {
      for (let i = 0; i < numSamples; i++) {
        outChannel[i] = inChannel[i];
      }
      return true;
    }

    // 1. Cálculo de Energia RMS e Zero-Crossing Rate (ZCR) do frame (128 samples = ~2.66ms)
    let sumSquares = 0;
    let zeroCrossings = 0;
    for (let i = 0; i < numSamples; i++) {
      const sample = inChannel[i];
      sumSquares += sample * sample;
      if (i > 0 && ((inChannel[i - 1] >= 0 && sample < 0) || (inChannel[i - 1] < 0 && sample >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / numSamples);
    const inputDb = this.linearToDb(rms);
    const zcr = zeroCrossings / numSamples;

    // 2. Estimador Adaptativo de Piso de Ruído (atualiza lentamente no silêncio)
    if (inputDb < this.config.thresholdDb - 3) {
      this.noiseFloorDb = 0.992 * this.noiseFloorDb + 0.008 * Math.max(inputDb, -75);
    } else if (inputDb < this.noiseFloorDb) {
      this.noiseFloorDb = 0.95 * this.noiseFloorDb + 0.05 * Math.max(inputDb, -75);
    }

    // 3. Detecção de Atividade de Voz (VAD) com rejeição de transientes de teclado e sopro
    // A voz humana tem forte energia fundamental (ZCR moderado/baixo), enquanto cliques de teclado
    // possuem ZCR alto e curtíssima duração (< 15-25ms).
    const snrDb = inputDb - this.noiseFloorDb;
    const isLikelyVoiceCandidate =
      inputDb >= this.config.thresholdDb &&
      zcr <= this.config.maxVoiceZcr &&
      snrDb >= 6.0;

    const requiredVoiceSamples = Math.max(
      128,
      Math.floor((this.config.antiClickHoldDelayMs / 1000) * sr)
    );
    const holdSamplesTotal = Math.floor((this.config.holdMs / 1000) * sr);

    if (isLikelyVoiceCandidate) {
      this.consecutiveVoiceSamples += numSamples;
      if (this.consecutiveVoiceSamples >= requiredVoiceSamples) {
        this.isSpeaking = true;
        this.holdSamplesRemaining = holdSamplesTotal;
      }
    } else {
      this.consecutiveVoiceSamples = Math.max(0, this.consecutiveVoiceSamples - numSamples * 2);
      if (this.holdSamplesRemaining > 0) {
        this.holdSamplesRemaining = Math.max(0, this.holdSamplesRemaining - numSamples);
        this.isSpeaking = true;
      } else {
        this.isSpeaking = false;
      }
    }

    // 4. Cálculo do ganho do Noise Gate + Supressão Adaptativa de Ruído Estacionário
    let targetGateGain = 1.0;
    if (this.config.vadEnabled) {
      if (this.isSpeaking) {
        targetGateGain = 1.0;
      } else {
        targetGateGain = this.dbToLinear(this.config.floorAttenuationDb);
      }
    }

    if (this.config.spectralAdaptiveEnabled && !this.isSpeaking) {
      const adaptiveFloorGain = 1.0 - this.config.suppressionStrength * 0.85;
      targetGateGain = Math.min(targetGateGain, adaptiveFloorGain);
    }

    // Coeficientes de suavização por amostra para Attack e Release (evita cliques de áudio)
    const attackSamples = Math.max(16, (this.config.attackMs / 1000) * sr);
    const releaseSamples = Math.max(64, (this.config.releaseMs / 1000) * sr);
    const attackCoeff = 1.0 - Math.exp(-1.0 / attackSamples);
    const releaseCoeff = 1.0 - Math.exp(-1.0 / releaseSamples);

    // 5. Controle Automático de Ganho Digital (AGC) - atua apenas durante fala confirmada
    let targetAgcGain = this.currentAgcGain;
    if (this.config.digitalAgcEnabled) {
      if (this.isSpeaking && inputDb > this.config.thresholdDb) {
        const desiredBoostDb = Math.min(
          this.config.maxGainBoostDb,
          Math.max(-6, this.config.targetLevelDb - inputDb)
        );
        targetAgcGain = this.dbToLinear(desiredBoostDb);
      }
    } else {
      targetAgcGain = 1.0;
    }

    // Suavização lenta do AGC para soar natural
    this.currentAgcGain = 0.985 * this.currentAgcGain + 0.015 * targetAgcGain;

    // 6. Aplicação amostra a amostra no buffer de áudio
    let outSumSquares = 0;
    for (let i = 0; i < numSamples; i++) {
      if (targetGateGain > this.currentGateGain) {
        this.currentGateGain += attackCoeff * (targetGateGain - this.currentGateGain);
      } else {
        this.currentGateGain += releaseCoeff * (targetGateGain - this.currentGateGain);
      }

      const processed = inChannel[i] * this.currentGateGain * this.currentAgcGain;
      // Soft-clipping tangente hiperbólica para evitar distorção digital acima de 0 dBFS
      const safeSample = Math.tanh(processed);
      outChannel[i] = safeSample;
      outSumSquares += safeSample * safeSample;
    }

    // Copia para outros canais se existirem
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(outChannel);
    }

    // 7. Envia telemetria para a thread principal a cada ~12 frames (~32ms / ~30Hz)
    this.framesSinceLastReport++;
    if (this.framesSinceLastReport >= 12) {
      this.framesSinceLastReport = 0;
      const outRms = Math.sqrt(outSumSquares / numSamples);
      this.port.postMessage({
        type: 'TELEMETRY',
        payload: {
          isSpeaking: this.isSpeaking,
          inputLevelDb: inputDb,
          outputLevelDb: this.linearToDb(outRms),
          noiseFloorDb: this.noiseFloorDb,
          gateAttenuationDb: this.linearToDb(this.currentGateGain),
          agcGainDb: this.linearToDb(this.currentAgcGain),
          zeroCrossingRate: zcr,
        },
      });
    }

    return true;
  }
}

registerProcessor('call-voice-dsp-processor', CallVoiceDspProcessor);
