export type EngineId = "residfp" | "sidlite";

export interface PlayerCallbacks {
  onTime?: (ms: number) => void;
  onState?: (state: "idle" | "loading" | "playing" | "paused" | "ended") => void;
  onError?: (message: string) => void;
  onEnded?: () => void;
  onRomStatus?: (status: { requested: boolean; active: boolean }) => void;
  /** Unrecoverable engine failure (WASM trap, out of bounds…). */
  onFatal?: (message: string) => void;
}

const SAMPLE_RATE = 48000;
const BLOCK_FRAMES = 2048;
const TARGET_BUFFER_SECONDS = 0.8;

/**
 * Thin controller around libsidplayfp-wasm + an AudioWorklet ring buffer.
 *
 * The WASM engine renders interleaved stereo PCM ahead of time; blocks are
 * pushed to the worklet, which owns the actual audio clock.
 */
export class SidPlayer {
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private engine: import("libsidplayfp-wasm").SidAudioEngine | null = null;
  private engineId: EngineId = "residfp";
  private renderToken = 0;
  private rendering = false;
  private pushedFrames = 0;
  /** Frames already consumed at the last position rebase. */
  private baseConsumed = 0;
  private playStartedAt = 0;
  /** Playback position (ms) at the last rebase (load / seek / song change). */
  private positionBaseMs = 0;
  private timer: number | null = null;
  private ticker: number | null = null;
  private playing = false;
  private currentDurationMs = 0;
  private volume = 0.8;
  private roms: { kernal: Uint8Array; basic: Uint8Array; chargen: Uint8Array } | null = null;
  /** Kept so a rebuilt engine (engine switch, WASM recovery) can restore the tune. */
  private lastTune: {
    bytes: Uint8Array;
    song: number;
    model?: string;
    clock?: string;
  } | null = null;
  private callbacks: PlayerCallbacks = {};
  private romActive: boolean | null = null;
  private romDetail: {
    requested: boolean;
    active: boolean;
    kernal: boolean;
    basic: boolean;
    chargen: boolean;
  } | null = null;
  private broken = false;
  private endedFired = false;

  getEngineId(): EngineId {
    return this.engineId;
  }

  getRomStatus(): boolean | null {
    return this.romActive;
  }

  /** Per-ROM view of the last `setSystemROMs()` call (what the engine reports). */
  getRomDetail() {
    return this.romDetail;
  }

  /** RMS of the current output, 0..1 (used to detect silent tunes). */
  getRms(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i] / 128 - 1;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  setCallbacks(cb: PlayerCallbacks) {
    this.callbacks = cb;
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
    }
  }

  getVolume() {
    return this.volume;
  }

  getAnalyser() {
    return this.analyser;
  }

  getDurationMs() {
    return this.currentDurationMs;
  }

  setDurationMs(ms: number) {
    this.currentDurationMs = ms;
  }

  isPlaying() {
    return this.playing;
  }

  private consumedFrames() {
    if (!this.ctx || !this.playing) return this.baseConsumed;
    return (
      this.baseConsumed +
      Math.max(0, (this.ctx.currentTime - this.playStartedAt) * SAMPLE_RATE)
    );
  }

  private queuedSeconds() {
    return Math.max(0, (this.pushedFrames - this.consumedFrames()) / SAMPLE_RATE);
  }

  /**
   * Position the user is actually hearing, in ms.
   *
   * Derived from the AudioContext clock (frames actually consumed by the
   * worklet), not from libsidplayfp's internal clock: the engine renders ahead,
   * so its clock runs ~0.8 s in the future and does not necessarily reset on
   * every load.
   */
  getTimeMs() {
    const consumed = this.consumedFrames();
    const elapsedMs = ((consumed - this.baseConsumed) / SAMPLE_RATE) * 1000;
    return Math.max(0, this.positionBaseMs + elapsedMs);
  }

  /** Start a new position timeline at `ms`. */
  private rebasePosition(ms: number) {
    this.positionBaseMs = Math.max(0, ms);
    this.baseConsumed = this.consumedFrames();
    this.playStartedAt = this.ctx ? this.ctx.currentTime : 0;
    this.endedFired = false;
  }

  async init(engineId: EngineId = "residfp") {
    if (this.ctx && this.engineId === engineId && this.engine && !this.broken) return;
    this.engineId = engineId;

    if (this.ctx) {
      // engine switch or recovery after a trap: rebuild the wasm engine
      this.disposeEngine();
    } else {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "playback" });
      await this.ctx.audioWorklet.addModule(
        new URL("/sid-worklet.js", window.location.origin).href,
      );
      this.worklet = new AudioWorkletNode(this.ctx, "sid-player", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.worklet.connect(this.gain);
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.worklet.port.onmessage = (event) => {
        if (event.data?.type === "underrun" && this.playing) {
          this.scheduleRender();
        }
      };
    }

    const mod = await import("libsidplayfp-wasm");
    const locateFile = (name: string) =>
      this.engineId === "sidlite" ? `/wasm/sidlite/${name}` : `/wasm/${name}`;
    this.engine = new mod.SidAudioEngine({
      engine: this.engineId,
      sampleRate: SAMPLE_RATE,
      stereo: true,
      locateFile,
    });
    await this.applyRoms();
    if (!this.engine) return; // ROM injection trapped: the next attempt rebuilds
    this.broken = false;
    // A new engine has no tune: restore the last one so switching engine (or
    // recovering from a WASM trap) leaves the player in a usable state.
    if (this.lastTune) {
      try {
        await this.engine.loadSidBuffer(this.lastTune.bytes, this.lastTune.song);
        await this.applyEmulation(this.lastTune.model, this.lastTune.clock);
        this.rebasePosition(0);
        this.callbacks.onTime?.(0);
      } catch {
        /* the tune may no longer be loadable; leave the engine empty */
      }
    }
  }

  private async applyRoms() {
    if (!this.engine) return;
    const roms = this.roms;
    if (!roms) {
      // Never hand three nulls to the WASM engine: some builds trap with
      // "memory access out of bounds" and leave the instance unusable. A fresh
      // engine (see `setRoms`) simply has no ROMs configured.
      this.romDetail = {
        requested: false,
        active: false,
        kernal: false,
        basic: false,
        chargen: false,
      };
      this.romActive = false;
      this.callbacks.onRomStatus?.({ requested: false, active: false });
      return;
    }
    try {
      await this.engine.setSystemROMs(
        roms?.kernal ?? null,
        roms?.basic ?? null,
        roms?.chargen ?? null,
      );
      const status = this.engine.getRomStatus();
      this.romDetail = status;
      this.romActive = status.active;
      this.callbacks.onRomStatus?.({ requested: status.requested, active: status.active });
    } catch (err) {
      this.romDetail = null;
      this.romActive = false;
      this.callbacks.onRomStatus?.({ requested: true, active: false });
      this.callbacks.onError?.(`ROM non applicabili: ${String(err)}`);
      // A trapped instance may be unusable: rebuild it on the next play.
      this.stopRendering();
      this.playing = false;
      this.pushedFrames = 0;
      this.baseConsumed = 0;
      this.positionBaseMs = 0;
      this.broken = true;
      this.disposeEngine();
      this.worklet?.port.postMessage({ type: "clear" });
      this.callbacks.onState?.("paused");
      this.callbacks.onTime?.(0);
    }
  }

  /**
   * Hand new ROM images to the engine (or clear them with `null`).
   *
   * `setSystemROMs()` reloads the loaded tune from its start, so the position
   * timeline has to restart too. The engine's own `getRomStatus()` is the only
   * authoritative answer about whether the images were accepted.
   */
  async setRoms(roms: { kernal: Uint8Array; basic: Uint8Array; chargen: Uint8Array } | null) {
    const wasPlaying = this.playing;
    this.roms = roms;

    if (!roms && this.engine) {
      // Drop the ROMs by rebuilding the engine: the WASM side is left in an
      // undefined state by a null injection.
      this.disposeEngine();
      this.romDetail = null;
      this.romActive = false;
      this.callbacks.onRomStatus?.({ requested: false, active: false });
      await this.init(this.engineId);
      return;
    }

    // Validate the images even before the first tune is played: `init()`
    // applies `this.roms` and reports the engine's verdict.
    if (!this.engine) await this.init(this.engineId);
    else await this.applyRoms();

    if (wasPlaying && this.engine?.hasTune()) {
      await this.play();
    }
  }

  async load(sidBytes: Uint8Array, opts: { subtune?: number; model?: string; clock?: string; durationMs?: number }) {
    if (!this.ctx || this.broken || !this.engine) await this.init(this.engineId);
    if (!this.engine) throw new Error("engine non inizializzato");
    if (this.ctx!.state === "suspended") await this.ctx!.resume();
    this.stopRendering();
    this.worklet?.port.postMessage({ type: "clear" });
    this.pushedFrames = 0;
    this.baseConsumed = 0;
    this.currentDurationMs = opts.durationMs ?? 0;
    this.callbacks.onState?.("loading");
    const songIndex = Math.max(0, (opts.subtune ?? 1) - 1);
    await this.engine.loadSidBuffer(sidBytes, songIndex);
    this.lastTune = { bytes: sidBytes, song: songIndex, model: opts.model, clock: opts.clock };
    await this.applyEmulation(opts.model, opts.clock);
    this.rebasePosition(0);
    this.callbacks.onState?.("paused");
    this.callbacks.onTime?.(0);
  }

  private async applyEmulation(model?: string, clock?: string) {
    if (!this.engine) return;
    // Always send the force flags: leaving them out would keep a previously
    // forced model active when the user switches back to "da header".
    const config: Record<string, unknown> = {
      forceC64Model: !!clock && clock !== "auto",
      forceSidModel: !!model && model !== "auto",
    };
    if (clock && clock !== "auto") {
      config.c64Model = clock === "NTSC" ? "NTSC" : "PAL";
    }
    if (model && model !== "auto") {
      config.sidModel = model === "MOS8580" ? "MOS8580" : "MOS6581";
    }
    await this.engine.setEmulationConfig(config as never);
  }

  /**
   * Apply a new SID/C64 model to the running engine. The engine reloads the
   * current tune from its start, so the position restarts at zero.
   */
  async setEmulation(model: string, clock: string) {
    if (!this.engine) return;
    await this.applyEmulation(model, clock);
    this.rebasePosition(0);
    this.callbacks.onTime?.(0);
  }

  async selectSong(subtune: number) {
    if (!this.engine) return;
    this.stopRendering();
    this.worklet?.port.postMessage({ type: "clear" });
    this.pushedFrames = 0;
    this.baseConsumed = 0;
    const songIndex = Math.max(0, subtune - 1);
    await this.engine.selectSong(songIndex);
    if (this.lastTune) this.lastTune.song = songIndex;
    this.rebasePosition(0);
    if (this.playing) this.startRendering();
  }

  async seek(ms: number) {
    if (!this.engine) return;
    this.stopRendering();
    this.worklet?.port.postMessage({ type: "clear" });
    this.pushedFrames = 0;
    this.baseConsumed = 0;
    await this.engine.seekSeconds(Math.max(0, ms) / 1000);
    this.rebasePosition(ms);
    this.callbacks.onTime?.(ms);
    if (this.playing) this.startRendering();
  }

  async play() {
    if (!this.engine || !this.ctx) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.baseConsumed = this.consumedFrames();
    this.playStartedAt = this.ctx.currentTime;
    this.playing = true;
    this.worklet?.port.postMessage({ type: "play" });
    this.callbacks.onState?.("playing");
    this.startRendering();
    if (this.ticker === null) {
      this.ticker = window.setInterval(() => this.tick(), 200);
    }
  }

  pause() {
    this.baseConsumed = this.consumedFrames();
    this.playing = false;
    this.worklet?.port.postMessage({ type: "pause" });
    this.callbacks.onState?.("paused");
    this.stopRendering();
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  stop() {
    this.pause();
    this.engine?.reset();
    this.worklet?.port.postMessage({ type: "clear" });
    this.pushedFrames = 0;
    this.baseConsumed = 0;
    this.positionBaseMs = 0;
    this.callbacks.onTime?.(0);
    this.callbacks.onState?.("idle");
  }

  private tick() {
    if (!this.playing) return;
    const time = this.getTimeMs();
    this.callbacks.onTime?.(time);
    if (
      this.currentDurationMs > 0 &&
      time >= this.currentDurationMs &&
      !this.endedFired
    ) {
      this.endedFired = true;
      this.callbacks.onEnded?.();
    }
  }

  private startRendering() {
    if (this.rendering) return;
    this.rendering = true;
    this.renderToken += 1;
    const token = this.renderToken;
    const loop = async () => {
      if (!this.rendering || token !== this.renderToken || !this.engine) return;
      try {
        while (this.queuedSeconds() < TARGET_BUFFER_SECONDS) {
          const pcm = await this.engine.renderFrames(BLOCK_FRAMES);
          if (token !== this.renderToken) return;
          if (!pcm || pcm.length === 0) break;
          const frames = pcm.length / 2;
          const left = new Float32Array(frames);
          const right = new Float32Array(frames);
          for (let i = 0; i < frames; i += 1) {
            left[i] = pcm[i * 2] / 32768;
            right[i] = pcm[i * 2 + 1] / 32768;
          }
          this.worklet?.port.postMessage({ type: "push", left, right }, [left.buffer, right.buffer]);
          this.pushedFrames += frames;
        }
      } catch (err) {
        this.fail(err);
        return;
      }
      if (this.rendering && token === this.renderToken) {
        this.timer = window.setTimeout(loop, 60);
      }
    };
    void loop();
  }

  private scheduleRender() {
    if (this.rendering) return;
    this.startRendering();
  }

  private fail(err: unknown) {
    this.rendering = false;
    this.renderToken += 1;
    this.playing = false;
    this.broken = true;
    this.disposeEngine();
    this.worklet?.port.postMessage({ type: "pause" });
    this.worklet?.port.postMessage({ type: "clear" });
    this.pushedFrames = 0;
    this.baseConsumed = 0;
    this.positionBaseMs = 0;
    this.callbacks.onState?.("paused");
    this.callbacks.onFatal?.(err instanceof Error ? err.message : String(err));
  }

  private stopRendering() {
    this.rendering = false;
    this.renderToken += 1;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private disposeEngine() {
    try {
      this.engine?.dispose();
    } catch {
      /* ignore */
    }
    this.engine = null;
  }
}

export const sidPlayer = new SidPlayer();
