'use strict';

// Procedural sound effects (Web Audio, no asset files).
// Each sound has a minimum gap so mass kills / fast weapons don't stack into noise.
const SFX_MAX_VOICES = 24;

const Sfx = {
  ctx: null,
  master: null,
  noiseBuf: null,
  voices: 0,
  last: {},
  muted: localStorage.getItem('turretproto_muted') === '1',

  // Browsers only allow audio after a user gesture.
  init() {
    const start = () => {
      if (!this.ctx) this.create();
      this.ctx.resume();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  },

  create() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('turretproto_muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  },

  // Returns false when the sound should be skipped (no context, muted, throttled or too many voices).
  gate(name, gap) {
    if (!this.ctx || this.muted || this.voices >= SFX_MAX_VOICES) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last[name] || -1) < gap) return false;
    this.last[name] = now;
    return true;
  },

  envelope(vol, dur, delay) {
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  },

  track(src, t, dur) {
    this.voices++;
    src.onended = () => this.voices--;
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  tone(type, f0, f1, dur, vol, delay = 0) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(this.envelope(vol, dur, delay));
    this.track(o, t, dur);
  },

  noise(filter, f0, f1, dur, vol, delay = 0, q = 1) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f);
    f.connect(this.envelope(vol, dur, delay));
    this.track(src, t, dur);
  },

  // ---------- Game sounds ----------

  shoot(kind) {
    if (!this.gate('shoot_' + kind, kind === 'flame' ? 0.09 : 0.05)) return;
    const p = 0.9 + Math.random() * 0.2;
    if (kind === 'rocket') this.noise('bandpass', 900 * p, 200, 0.18, 0.05, 0, 2);
    else if (kind === 'chain') this.tone('sawtooth', 1400 * p, 500, 0.06, 0.025);
    else if (kind === 'flame') this.noise('lowpass', 1200, 400, 0.12, 0.025);
    else this.tone('square', 1100 * p, 280, 0.035, 0.018);
  },

  kill(e) {
    if (e.boss) {
      if (!this.gate('killBoss', 0.2)) return;
      this.noise('lowpass', 2000, 60, 1.1, 0.35);
      this.tone('sine', 140, 30, 0.9, 0.3);
      return;
    }
    if (!this.gate(e.elite ? 'killElite' : 'kill', e.elite ? 0.06 : 0.035)) return;
    const p = 0.85 + Math.random() * 0.3;
    const big = e.elite ? 1.6 : 1;
    this.noise('bandpass', 2200 * p / big, 250, 0.12 * big, 0.09 * big, 0, 1.5);
    this.tone('sine', 320 * p / big, 70, 0.08 * big, 0.07 * big);
  },

  hurt() {
    if (!this.gate('hurt', 0.12)) return;
    this.tone('sine', 150, 45, 0.18, 0.18);
    this.noise('lowpass', 600, 100, 0.12, 0.08);
  },

  pickup() {
    if (!this.gate('pickup', 0.06)) return;
    this.tone('sine', 700, 1050, 0.07, 0.06);
  },

  pick() {
    if (!this.gate('pick', 0.05)) return;
    [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.08, i * 0.05));
  },

  levelUp() {
    if (!this.gate('level', 0.3)) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.14, 0.06, i * 0.06));
  },

  bossIncoming() {
    if (!this.gate('boss', 1)) return;
    this.tone('sawtooth', 70, 55, 0.9, 0.08);
    this.tone('sawtooth', 105, 82, 0.9, 0.05);
  },

  death() {
    if (!this.gate('death', 0.5)) return;
    this.noise('lowpass', 1500, 40, 1.4, 0.4);
    this.tone('sine', 110, 25, 1.2, 0.3);
  },

  coin() {
    if (!this.gate('coin', 0.045)) return;
    const p = 0.92 + Math.random() * 0.16;
    this.tone('triangle', 1760 * p, 2350 * p, 0.06, 0.035);
  },

  dash() {
    if (!this.gate('dash', 0.08)) return;
    this.noise('bandpass', 600, 2400, 0.14, 0.12, 0, 1.2);
  },

  chest() {
    if (!this.gate('chest', 0.1)) return;
    this.noise('lowpass', 900, 200, 0.12, 0.12);
    [659, 880, 1175].forEach((f, i) => this.tone('triangle', f, f, 0.1, 0.07, 0.06 + i * 0.05));
  },

  denied() {
    if (!this.gate('denied', 0.25)) return;
    this.tone('square', 180, 150, 0.12, 0.05);
  },

  equip() {
    if (!this.gate('equip', 0.1)) return;
    this.noise('bandpass', 400, 1800, 0.18, 0.08, 0, 1.5);
    [440, 660].forEach((f, i) => this.tone('triangle', f, f * 1.5, 0.12, 0.06, i * 0.05));
  },

  laser(big) {
    if (!this.gate(big ? 'laserBig' : 'laser', big ? 0.2 : 0.08)) return;
    this.tone('sawtooth', big ? 900 : 1600, big ? 120 : 300, big ? 0.4 : 0.16, big ? 0.07 : 0.03);
    if (big) this.noise('bandpass', 2500, 400, 0.35, 0.08, 0, 1.5);
  },

  boom(big) {
    if (!this.gate(big ? 'boomBig' : 'boom', big ? 0.2 : 0.06)) return;
    this.noise('lowpass', big ? 900 : 1600, 50, big ? 0.7 : 0.25, big ? 0.25 : 0.1);
    this.tone('sine', big ? 90 : 160, 30, big ? 0.6 : 0.2, big ? 0.2 : 0.08);
  },

  teleport() {
    if (!this.gate('teleport', 1)) return;
    this.noise('bandpass', 300, 3000, 0.9, 0.12, 0, 2);
    [262, 392, 523, 784].forEach((f, i) => this.tone('sine', f, f * 1.5, 0.3, 0.06, i * 0.08));
  },

  surge() {
    if (!this.gate('surge', 1)) return;
    this.tone('sawtooth', 220, 330, 0.35, 0.05);
    this.tone('sawtooth', 165, 247, 0.35, 0.04, 0.05);
  },
};
