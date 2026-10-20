type Wave = OscillatorType;

interface ToneOptions {
  from: number;
  to?: number;
  duration: number;
  type?: Wave;
  gain?: number;
  delay?: number;
}

/**
 * Tiny synthesizer. Every sound is generated at call time with oscillators
 * and a short noise buffer — the project ships no audio assets.
 */
export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noise: AudioBuffer | null = null;

  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noise = null;
    if (context) void context.close();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.28, this.context.currentTime, 0.01);
    }
  }

  /** Must be called from a user gesture the first time. */
  unlock(): void {
    const context = this.ensureContext();
    if (context && context.state === "suspended") {
      void context.resume();
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.context) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.28;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }

  private tone({
    from,
    to = from,
    duration,
    type = "sine",
    gain = 0.5,
    delay = 0,
  }: ToneOptions): void {
    const context = this.ensureContext();
    if (!context || !this.master || this.muted) return;

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, from), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private burst(duration = 0.09, gain = 0.25, cutoff = 900): void {
    const context = this.ensureContext();
    if (!context || !this.master || this.muted) return;

    if (!this.noise) {
      const length = Math.floor(context.sampleRate * 0.3);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noise = buffer;
    }

    const start = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();

    source.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;

    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  click(): void {
    this.tone({ from: 880, to: 660, duration: 0.05, type: "square", gain: 0.12 });
  }

  start(): void {
    this.tone({ from: 330, to: 440, duration: 0.1, type: "triangle", gain: 0.2 });
    this.tone({ from: 440, to: 660, duration: 0.14, type: "triangle", gain: 0.2, delay: 0.09 });
  }

  wall(): void {
    this.tone({ from: 120, to: 60, duration: 0.14, type: "sine", gain: 0.55 });
    this.burst(0.08, 0.3, 600);
  }

  heart(): void {
    this.tone({ from: 220, to: 196, duration: 0.12, type: "triangle", gain: 0.35 });
    this.tone({ from: 165, to: 110, duration: 0.22, type: "triangle", gain: 0.3, delay: 0.08 });
  }

  enemy(): void {
    this.tone({ from: 520, to: 70, duration: 0.55, type: "sawtooth", gain: 0.4 });
    this.tone({ from: 240, to: 60, duration: 0.6, type: "sine", gain: 0.3, delay: 0.03 });
  }

  win(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone({
        from: frequency,
        duration: 0.22,
        type: "triangle",
        gain: 0.3,
        delay: index * 0.09,
      });
    });
  }

  lose(): void {
    const notes = [392, 329.63, 261.63];
    notes.forEach((frequency, index) => {
      this.tone({
        from: frequency,
        to: frequency * 0.98,
        duration: 0.32,
        type: "sawtooth",
        gain: 0.22,
        delay: index * 0.16,
      });
    });
    this.tone({ from: 98, to: 55, duration: 0.9, type: "sine", gain: 0.35, delay: 0.18 });
  }
}
