// 음성 수집 공용 코드(본 창·미니 창·폰 앱이 같이 씀). 마이크 → 16kHz 16bit 모노 PCM을 100ms씩 내보낸다.
//  - 미리 열어 두면(warm) 누르기 직전 0.3초도 함께 보내 첫 음절이 잘리지 않는다.
//  - 말 끝 감지(EndDetector)는 순수 계산이라 Node에서도 시험한다.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.VoiceCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const RATE = 16000, FRAME = 320 /* 20ms */, CHUNK = 1600 /* 100ms */;

  // 말 시작·끝 감지. v1.3까지는 처음 0.4초를 무조건 소음으로 봐서, 누르자마자 말하면 그 목소리가 소음 기준이 되어
  // 말을 못 듣는 일이 있었다 → 소음 기준 = 최근 2.5초의 가장 작은 소리, 처음 1.5초는 기준에 상한을 둔다.
  class EndDetector {
    constructor({ silenceMs = 1500, noSpeechMs = 7000, maxMs = 30000, frameMs = 20 } = {}) {
      Object.assign(this, { silenceMs, noSpeechMs, maxMs, frameMs });
      this.t = 0; this.lastLoud = 0; this.run = 0; this.heard = false;
      this.win = []; this.winMax = Math.round(2500 / frameMs);
    }
    threshold() {
      const floor = this.win.length ? Math.min(...this.win) : 0;
      const thr = floor * 2.5;
      return Math.max(0.012, this.t < 1500 ? Math.min(thr, 0.03) : thr);
    }
    // rms 한 칸(20ms)을 넣으면 null | 'speech' | 'silence' | 'nospeech' | 'max'
    frame(rms) {
      this.t += this.frameMs;
      this.win.push(rms);
      if (this.win.length > this.winMax) this.win.shift();
      const loud = rms > this.threshold();
      let ev = null;
      if (loud) {
        this.run += this.frameMs;
        if (this.run >= 60) { this.lastLoud = this.t; if (!this.heard) { this.heard = true; ev = 'speech'; } }
      } else this.run = 0;
      if (this.heard && this.t - this.lastLoud > this.silenceMs) return 'silence';
      if (!this.heard && this.t > this.noSpeechMs) return 'nospeech';
      if (this.t > this.maxMs) return 'max';
      return ev;
    }
  }

  // 아무 표본율 → 16kHz (구간 평균이라 말소리에 충분하고 가볍다)
  class Resampler {
    constructor(inRate) { this.ratio = inRate / RATE; this.pos = 0; this.sum = 0; this.n = 0; }
    push(input, out) {
      if (this.ratio === 1) { for (let i = 0; i < input.length; i++) out(input[i]); return; }
      for (let i = 0; i < input.length; i++) {
        this.sum += input[i]; this.n++; this.pos += 1;
        if (this.pos >= this.ratio) { out(this.sum / this.n); this.sum = 0; this.n = 0; this.pos -= this.ratio; }
      }
    }
  }

  const levelOf = rms => Math.min(1, Math.sqrt(rms) * 2.4); // 눈으로 보기 좋은 크기(작은 소리도 보이게)

  class Capture {
    // opts: { preRollMs, worklet(불러올 파일 주소, 없으면 ScriptProcessor), warmMs(쓰고 나서 마이크를 열어 둘 시간) }
    constructor(opts = {}) {
      this.opts = { preRollMs: 300, worklet: null, warmMs: 0, ...opts };
      this.stream = null; this.ctx = null; this.node = null; this.src = null;
      this.h = null; this.det = null; this.opening = null;
      this.pcm = new Int16Array(CHUNK); this.fill = 0;
      this.frameSum = 0; this.frameN = 0; this.levelTick = 0;
      this.ring = []; this.ringMax = Math.ceil(this.opts.preRollMs / 100);
      this.warmTimer = null;
    }
    get isOpen() { return !!this.stream; }
    // 마이크를 미리 열어 둔다(누르기 직전 소리부터 담기 위해). ms 동안 안 쓰면 닫는다.
    async warm(ms = 20000) {
      clearTimeout(this.warmTimer);
      await this.openMic();
      if (!this.h) { clearTimeout(this.warmTimer); this.warmTimer = setTimeout(() => { if (!this.h) this.closeMic(); }, ms); }
    }
    get active() { return !!this.h; }

    // 사용자가 누른 그 순간에 부른다(아이폰은 누를 때만 소리 장치를 깨울 수 있음)
    touch() { if (this.ctx && this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (_) { /* 무시 */ } } }

    openMic() {
      if (this.stream) return Promise.resolve();
      if (this.opening) return this.opening;
      this.opening = this._open().finally(() => { this.opening = null; });
      return this.opening;
    }
    // 소리 장치를 미리 깨워 둔다. 마이크를 열 때 함께 깨우면 그 사이(약 0.5초) 소리를 잃어 첫 낱말이 사라졌다(2026-11-05 실측).
    prepare() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        try { this.ctx = new AC({ sampleRate: RATE, latencyHint: 'interactive' }); } catch (_) { this.ctx = new AC(); }
      }
      if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (_) { /* 누를 때 다시 */ } }
      return this.ctx;
    }
    async _open() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: this.opts.audio || { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = this.prepare();
      const src = ctx.createMediaStreamSource(stream);
      const rs = new Resampler(ctx.sampleRate);
      const feed = float32 => rs.push(float32, s => this._sample(s));
      let node = null;
      if (this.opts.worklet && ctx.audioWorklet) {
        try {
          await ctx.audioWorklet.addModule(this.opts.worklet);
          node = new AudioWorkletNode(ctx, 'hn-capture', { numberOfOutputs: 0 });
          node.port.onmessage = e => feed(e.data);
          src.connect(node);
        } catch (_) { node = null; }
      }
      if (!node) {
        // 오래된 방식이지만 어디서나 돈다. 스피커로 나가지 않게 소리 0으로 잇는다.
        node = ctx.createScriptProcessor(1024, 1, 1);
        node.onaudioprocess = e => feed(e.inputBuffer.getChannelData(0));
        const mute = ctx.createGain(); mute.gain.value = 0;
        src.connect(node); node.connect(mute); mute.connect(ctx.destination);
      }
      if (ctx.state !== 'running') { try { await ctx.resume(); } catch (_) { /* 무시 */ } }
      Object.assign(this, { stream, src, node });
    }
    closeMic() {
      clearTimeout(this.warmTimer);
      if (this.node) { try { this.node.disconnect(); } catch (_) { /* 무시 */ } if (this.node.port) this.node.port.onmessage = null; else this.node.onaudioprocess = null; }
      if (this.src) { try { this.src.disconnect(); } catch (_) { /* 무시 */ } }
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = this.node = this.src = null; // 소리 장치(ctx)는 깨어 있게 둔다
      this.ring = []; this.fill = 0; this.frameSum = 0; this.frameN = 0;
    }
    _sample(s) {
      const v = Math.max(-1, Math.min(1, s));
      this.pcm[this.fill++] = v < 0 ? v * 0x8000 : v * 0x7FFF;
      if (this.fill === CHUNK) { this._chunk(this.pcm.slice(0)); this.fill = 0; }
      this.frameSum += v * v;
      if (++this.frameN === FRAME) {
        const rms = Math.sqrt(this.frameSum / FRAME);
        this.frameSum = 0; this.frameN = 0;
        this._frame(rms);
      }
    }
    _chunk(int16) {
      const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
      if (this.h) this.h.onChunk && this.h.onChunk(bytes);
      else if (this.ringMax) { this.ring.push(bytes); if (this.ring.length > this.ringMax) this.ring.shift(); }
    }
    _frame(rms) {
      if (!this.h) return;
      if (++this.levelTick >= 2) { this.levelTick = 0; this.h.onLevel && this.h.onLevel(levelOf(rms), this.det ? this.det.heard : true); }
      if (!this.det) return;
      const ev = this.det.frame(rms);
      if (ev === 'speech') this.h.onSpeech && this.h.onSpeech();
      else if (ev) this.stop(ev);
    }
    // 듣기 시작. handlers: { onChunk(Uint8Array), onLevel(0~1, 말함?), onSpeech(), onEnd(까닭) }
    //  auto: true면 말이 끝나면 알아서 멈춤, false면 stop()을 부를 때까지(누르는 동안 듣기)
    begin(handlers, { auto = true, silenceMs, maxSec, noSpeechMs } = {}) {
      clearTimeout(this.warmTimer);
      this.h = handlers;
      this.det = auto ? new EndDetector({ silenceMs, maxMs: (maxSec || 30) * 1000, noSpeechMs }) : null;
      this.maxTimer = auto ? null : setTimeout(() => this.stop('max'), (maxSec || 60) * 1000);
      const pre = this.ring; this.ring = [];
      for (const b of pre) handlers.onChunk && handlers.onChunk(b);
    }
    setAuto(auto, opts = {}) { this.det = auto ? new EndDetector(opts) : null; }
    stop(why = 'user') {
      if (!this.h) return;
      const h = this.h; this.h = null; this.det = null;
      clearTimeout(this.maxTimer);
      if (this.fill) { const rest = this.pcm.slice(0, this.fill); this.fill = 0; const bytes = new Uint8Array(rest.buffer); h.onChunk && h.onChunk(bytes); }
      h.onEnd && h.onEnd(why);
      if (this.opts.warmMs > 0) this.warmTimer = setTimeout(() => this.closeMic(), this.opts.warmMs);
      else this.closeMic();
    }
    cancel() { if (this.h) { this.h = null; this.det = null; clearTimeout(this.maxTimer); this.fill = 0; if (!this.opts.warmMs) this.closeMic(); } }
  }

  // 음높이를 그대로 두고 빠르기만 바꾼다(WSOLA). 비서 목소리의 배속에 쓴다. 조각으로 넣어도 이어서 처리한다.
  class Stretcher {
    constructor({ rate = 1, frame = 960, search = 240 } = {}) {
      this.rate = rate; this.N = frame; this.H = frame >> 1; this.S = search;
      this.win = new Float32Array(frame);
      for (let i = 0; i < frame; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / frame);
      this.inp = new Float32Array(0); this.pos = 0; this.prev = null; this.tail = new Float32Array(this.H);
    }
    _bestOffset(target, center) {
      let best = 0, bs = -Infinity;
      const inp = this.inp, H = this.H;
      for (let d = -this.S; d <= this.S; d += 4) {
        const at = center + d;
        if (at < 0 || at + H >= inp.length) continue;
        let c = 0;
        for (let i = 0; i < H; i += 4) c += target[i] * inp[at + i];
        if (c > bs) { bs = c; best = d; }
      }
      return best;
    }
    // 소리를 넣고, 지금 만들 수 있는 만큼 돌려준다(Float32Array)
    push(input) {
      if (input && input.length) { const m = new Float32Array(this.inp.length + input.length); m.set(this.inp); m.set(input, this.inp.length); this.inp = m; }
      const { N, H, win } = this;
      const out = [];
      while (this.pos + N + this.S < this.inp.length) {
        let at = Math.round(this.pos);
        if (this.prev) at += this._bestOffset(this.prev, at);
        at = Math.max(0, at);
        const seg = this.inp.subarray(at, at + N);
        const o = new Float32Array(H);
        for (let i = 0; i < H; i++) o[i] = this.tail[i] + seg[i] * win[i];
        for (let i = 0; i < H; i++) this.tail[i] = seg[i + H] * win[i + H];
        out.push(o);
        // 다음 조각이 이어 붙어야 할 소리 = 지금 조각의 자연스러운 뒤
        this.prev = this.inp.slice(at + H, at + H + H);
        this.pos += H * this.rate;
      }
      // 이미 쓴 앞부분은 버린다(오래 말해도 메모리가 늘지 않게)
      const drop = Math.floor(this.pos) - this.S - N;
      if (drop > 4800) { this.inp = this.inp.slice(drop); this.pos -= drop; }
      const n = out.reduce((a, b) => a + b.length, 0), r = new Float32Array(n);
      let k = 0; for (const o of out) { r.set(o, k); k += o.length; }
      return r;
    }
    // 남은 소리를 다 내보낸다
    flush() {
      const out = this.push(new Float32Array(this.N + this.S + 4));
      this.inp = new Float32Array(0); this.pos = 0; this.prev = null; this.tail = new Float32Array(this.H);
      return out;
    }
  }

  // 비서 목소리 재생: 조각(16bit PCM)을 받는 대로 빈틈없이 이어 튼다. rate를 바꾸면 바로 빨라지거나 느려진다.
  class Player {
    constructor({ sampleRate = 24000, ctx = null, onLevel = null, onEnd = null } = {}) {
      this.sr = sampleRate; this.ctx = ctx; this.onLevel = onLevel; this.onEnd = onEnd;
      this.st = new Stretcher({ rate: 1 }); this.next = 0; this.srcs = new Set(); this.ending = false; this.gen = 0;
    }
    set rate(v) { this.st.rate = Math.max(0.7, Math.min(2.5, v)); }
    get rate() { return this.st.rate; }
    get playing() { return this.srcs.size > 0 || this.ending; }
    _ctx() {
      if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC({ latencyHint: 'interactive' }); }
      if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (_) { /* 무시 */ } }
      return this.ctx;
    }
    push(bytes) {
      const a = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~1)));
      const f = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) f[i] = a[i] / 32768;
      this._play(this.st.push(f));
    }
    _play(samples) {
      if (!samples.length) return;
      const c = this._ctx();
      const buf = c.createBuffer(1, samples.length, this.sr);
      buf.copyToChannel(samples, 0);
      const s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination);
      const now = c.currentTime;
      if (this.next < now + 0.03) this.next = now + 0.06;
      s.start(this.next);
      const gen = this.gen;
      if (this.onLevel) { let e = 0, n = 0; for (let i = 0; i < samples.length; i += 8) { e += samples[i] * samples[i]; n++; } const lv = levelOf(Math.sqrt(e / n)); setTimeout(() => { if (gen === this.gen) this.onLevel(lv); }, (this.next - now) * 1000); }
      this.next += buf.duration;
      this.srcs.add(s);
      s.onended = () => { this.srcs.delete(s); if (!this.srcs.size && this.ending && gen === this.gen) { this.ending = false; this.onEnd && this.onEnd(); } };
    }
    // 이번 말이 끝났다는 신호(남은 소리까지 틀고 onEnd)
    finish() { this.ending = true; this._play(this.st.flush()); if (!this.srcs.size) { this.ending = false; this.onEnd && this.onEnd(); } }
    // 바로 멈춤(말을 끊을 때)
    stop() {
      this.gen++; this.ending = false;
      for (const s of this.srcs) { try { s.onended = null; s.stop(); } catch (_) { /* 이미 끝남 */ } }
      this.srcs.clear(); this.next = 0;
      const r = this.st.rate; this.st = new Stretcher({ rate: r });
    }
  }

  return { RATE, CHUNK, EndDetector, Resampler, Capture, Stretcher, Player, levelOf };
});
