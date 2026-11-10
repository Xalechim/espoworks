// Tiny WebAudio sound-effects kit: no audio files, everything is synthesized.
window.sfx = (() => {
  let ctx = null, master = null, on = true, noiseBuf = null, hiss = null;
  const unlock = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
  };
  const noise = (dur, { type = "lowpass", freq = 1000, q = 1, gain = 0.4, attack = 0.005, when = 0 } = {}) => {
    if (!ctx || !on) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + dur + 0.05);
  };
  const tone = (from, to, dur, { type = "sine", gain = 0.5, when = 0 } = {}) => {
    if (!ctx || !on) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  return {
    unlock,
    isOn: () => on,
    setOn(v) { on = v; if (master) master.gain.value = v ? 0.9 : 0; if (!v) this.staticOff(); },
    pick() { noise(0.18, { type: "bandpass", freq: 1800, q: 0.8, gain: 0.25 }); },
    beep() { tone(1000, 1000, 0.07, { type: "square", gain: 0.12 }); },
    clunk() { tone(140, 45, 0.22, { gain: 0.8 }); noise(0.12, { freq: 500, gain: 0.5 }); },
    whir(dur = 1.2) {
      if (!ctx || !on) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = 58; lfo.frequency.value = 9; lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.15); g.gain.setValueAtTime(0.18, t + dur - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
      o.connect(lp).connect(g).connect(master); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      noise(dur, { freq: 300, gain: 0.12 });
    },
    eject() { this.whir(0.9); setTimeout(() => this.clunk(), 700); },
    staticOn(level = 0.22) {
      if (!ctx || !on || hiss) return;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1200;
      const g = ctx.createGain(); g.gain.value = level;
      src.connect(f).connect(g).connect(master); src.start(); hiss = { src, g };
    },
    staticOff() { if (!hiss) return; try { hiss.src.stop(); } catch (e) {} hiss = null; },
  };
})();
