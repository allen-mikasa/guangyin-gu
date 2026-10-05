/* ========== 声境引擎：纯 Web Audio 合成，无外部音频文件 ========== */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.players = {};      // name -> { playing, gain, stopFns }
    this.masterVol = 0.6;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;

    // 混响（合成脉冲响应）
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.2);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.18;
    this.reverb.connect(wet).connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = rate * seconds;
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // 噪声缓冲：white / pink / brown
  _noiseBuffer(type, seconds = 3) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    if (type === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (type === 'pink') {
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;
        b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;
        b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;
        b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;
        b6 = w*0.115926;
      }
    } else { // brown
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02*w) / 1.02;
        d[i] = last * 3.2;
      }
    }
    return buf;
  }

  _lfo(freq, out, min, max) {
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    lfo.frequency.value = freq;
    lg.gain.value = (max - min) / 2;
    lfo.connect(lg).connect(out);
    if (out instanceof AudioParam) {
      out.value = (max + min) / 2;
    }
    lfo.start();
    return lfo;
  }

  _newPlayer() {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    gain.connect(this.reverb);
    return { gain, nodes: [], timers: [] };
  }

  _start(name, vol, builder) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.players[name] && this.players[name].playing) return;
    const p = this._newPlayer();
    p.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.4);
    builder(p);
    p.playing = true;
    this.players[name] = p;
  }

  _stop(name) {
    const p = this.players[name];
    if (!p || !p.playing) return;
    p.playing = false;
    const now = this.ctx.currentTime;
    p.gain.gain.setTargetAtTime(0, now, 0.25);
    p.timers.forEach(t => clearInterval(t));
    const nodes = p.nodes;
    setTimeout(() => { try { nodes.forEach(n => { try { n.stop && n.stop(); } catch(e){} try { n.disconnect(); } catch(e){} }); } catch(e){} }, 1200);
  }

  // ---- 各声境 ----
  _buildOcean(p) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer('brown', 4); src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    src.connect(lp).connect(p.gain);
    src.start();
    const l1 = this._lfo(0.08, lp.frequency, 320, 900);
    const g2 = this.ctx.createGain(); g2.gain.value = 0.35;
    const l2 = this._lfo(0.06, g2.gain, 0.12, 0.6);
    // 用增益节点包一层实现潮汐起伏
    lp.disconnect(); lp.connect(g2).connect(p.gain);
    p.nodes.push(src, l1, l2, lp, g2);
  }

  _buildRain(p) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer('white', 3); src.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const ng = this.ctx.createGain(); ng.gain.value = 0.22;
    src.connect(hp).connect(lp).connect(ng).connect(p.gain);
    src.start();
    p.nodes.push(src, hp, lp, ng);
    // 偶发雨滴
    const t = setInterval(() => {
      if (Math.random() < 0.55) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 1400 + Math.random() * 2600;
        const t0 = this.ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05 + Math.random()*0.05, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05 + Math.random()*0.05);
        o.connect(g).connect(p.gain);
        o.start(t0); o.stop(t0 + 0.12);
      }
    }, 90);
    p.timers.push(t);
  }

  _buildStream(p) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer('pink', 3); src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(bp).connect(g).connect(p.gain);
    src.start();
    const l1 = this._lfo(1.1, bp.frequency, 1500, 2800);
    const l2 = this._lfo(0.7, g.gain, 0.3, 0.62);
    p.nodes.push(src, bp, g, l1, l2);
  }

  _buildWind(p) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer('brown', 4); src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 1.4;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(bp).connect(g).connect(p.gain);
    src.start();
    const l1 = this._lfo(0.11, bp.frequency, 280, 760);
    const l2 = this._lfo(0.07, g.gain, 0.2, 0.7);
    p.nodes.push(src, bp, g, l1, l2);
  }

  _buildFire(p) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer('brown', 3); src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    const g = this.ctx.createGain(); g.gain.value = 0.4;
    src.connect(lp).connect(g).connect(p.gain);
    src.start();
    p.nodes.push(src, lp, g);
    // 噼啪
    const t = setInterval(() => {
      if (Math.random() < 0.5) {
        const n = this.ctx.createBufferSource();
        n.buffer = this._noiseBuffer('white', 0.06);
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900 + Math.random()*1200;
        const gg = this.ctx.createGain();
        const t0 = this.ctx.currentTime;
        const dur = 0.01 + Math.random()*0.05;
        gg.gain.setValueAtTime(0.12 + Math.random()*0.15, t0);
        gg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        n.connect(hp).connect(gg).connect(p.gain);
        n.start(t0); n.stop(t0 + dur + 0.02);
      }
    }, 70);
    p.timers.push(t);
  }

  _buildWhite(p) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer('white', 3); src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0.28;
    src.connect(g).connect(p.gain);
    src.start();
    p.nodes.push(src, g);
  }

  toggle(name, on, vol) {
    if (on) {
      const builders = {
        ocean: this._buildOcean, rain: this._buildRain, stream: this._buildStream,
        wind: this._buildWind, fire: this._buildFire, white: this._buildWhite
      };
      this._start(name, vol == null ? 0.5 : vol, builders[name].bind(this));
    } else {
      this._stop(name);
    }
  }

  setVolume(name, v) {
    const p = this.players[name];
    if (p && p.playing) p.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  setMaster(v) {
    this.masterVol = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  stopAll() {
    Object.keys(this.players).forEach(n => this._stop(n));
  }

  // ---- 钟磬声：加法合成，三连击 ----
  bell(times = 3) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const partials = [
      { r: 1,    g: 1.0,  d: 7.0 },
      { r: 2.01, g: 0.50, d: 5.0 },
      { r: 2.99, g: 0.32, d: 3.4 },
      { r: 4.16, g: 0.18, d: 2.2 },
      { r: 5.43, g: 0.11, d: 1.5 },
      { r: 6.79, g: 0.06, d: 1.0 }
    ];
    const base = 196; // G3
    for (let h = 0; h < times; h++) {
      const t0 = this.ctx.currentTime + h * 1.5;
      partials.forEach(pt => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = base * pt.r;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(pt.g * 0.16, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + pt.d);
        o.connect(g);
        g.connect(this.master);
        g.connect(this.reverb);
        o.start(t0); o.stop(t0 + pt.d + 0.1);
      });
    }
  }

  // 短促玉磬（点击反馈，可选）
  chime() {
    this.ensure();
    const t0 = this.ctx.currentTime;
    [1, 2.01, 2.99].forEach((r, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = 523.25 * r;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.08 / (i + 1), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      o.connect(g); g.connect(this.master); g.connect(this.reverb);
      o.start(t0); o.stop(t0 + 1.5);
    });
  }
}

window.soundEngine = new SoundEngine();
