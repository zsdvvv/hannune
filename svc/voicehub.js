// 음성 처리 중심: 본 창·미니 창·폰에서 온 소리를 받아 받아쓰기하고 결과를 알린다.
// 한 번의 말(utt) = begin → chunk… → end. 결과는 emit으로: level · interim · final · check · error
//  - 실시간 엔진은 연결을 미리 열어 두고 여러 번 쓴다(warm). 연결 전에 온 소리는 모아 뒀다 한꺼번에 보낸다.
//  - 실시간이 실패하면 같은 소리를 '끝난 뒤 받아쓰기'로 다시 돌린다(말한 것을 잃지 않게).
//  - 같은 말이 두 번 와도(폰이 다시 보낸 경우) 결과를 다시 만들지 않고 저장해 둔 것을 돌려준다.
const stt = require('./../scan/stt');
const { LiveSTT } = require('./../scan/livestt');

const IDLE_CLOSE_MS = 120000; // 이만큼 안 쓰면 실시간 연결을 닫는다
const SESSION_MAX_MS = 8 * 60000; // 연결 한 개는 약 10분까지라 쉬는 틈에 미리 새로 연다
const FINAL_WAIT_MS = 2500; // 말이 끝난 뒤 글자가 하나도 없을 때 기다리는 한도
// 말이 끝난 뒤 서버 소식이 이만큼 없으면 끝낸다. 잠깐 조용했다 놓으면 서버가 이미 끝낸 말이라 완료 신호가 다시 오지 않는다.
const QUIET_DONE_MS = 600; // 글자는 확정됐지만 끝나기 직전까지 말한 때(보통 0.3초 안에 마저 옴)
const QUIET_PENDING_MS = 1200; // 아직 임시 글자만 있을 때
const SILENT_BEFORE_END_MS = 900; // 이만큼 조용했다 끝나면 서버가 이미 끝낸 말이라 바로 보여 준다(2026-11-05 시간표 실측)
const LATE_MS = 6000; // 보여 준 뒤에도 이 동안 늦게 온 글자는 고쳐 넣는다(서버가 2초 넘게 늦을 때가 있음)

const rmsLevel = pcm => {
  let sum = 0; const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; }
  return n ? Math.min(1, Math.sqrt(Math.sqrt(sum / n)) * 2.4) : 0;
};
const same = (a, b) => String(a).replace(/[\s,.!?。~]/g, '') === String(b).replace(/[\s,.!?。~]/g, '');

class VoiceHub {
  // deps: { settings(), dataDir, hint(), vocab(), fix(글)→{text,fixes}, emit(이벤트), log(기록) }
  constructor(deps) {
    this.d = deps;
    this.utts = new Map();
    this.done = new Map(); // id → 마지막 결과(다시 보낸 말에 그대로 답함)
    this.live = null; this.liveAt = 0; this.liveConnecting = null; this.liveOwner = null; this.idleTimer = null;
  }
  info() { const p = stt.pick(this.d.settings(), this.d.dataDir); return { engine: p.engine, label: p.label || '', ready: p.ready, why: p.why || '', live: p.engine === 'live' }; }

  // 실시간 연결을 미리 연다(누르면 바로 글자가 오게)
  warm() {
    const p = stt.pick(this.d.settings(), this.d.dataDir);
    if (p.engine !== 'live' || !p.ready) return;
    this._touchIdle();
    this._ensureLive(p).catch(() => { /* 말할 때 다시 시도하거나 예비로 넘어감 */ });
  }
  _touchIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.liveOwner) this._closeLive(); }, IDLE_CLOSE_MS);
  }
  _closeLive() { if (this.live) { this.live.close(); this.live = null; } this.liveConnecting = null; }
  _ensureLive(p) {
    if (this.live && this.live.ready && Date.now() - this.liveAt < SESSION_MAX_MS) return Promise.resolve(this.live);
    if (this.liveConnecting) return this.liveConnecting;
    if (this.live && !this.liveOwner) this._closeLive();
    // 연결이 11초씩 걸리는 때가 있어(실측) 4초 안에 안 되면 한 번 더 시도한다
    const attempt = tm => {
      const live = new LiveSTT({ key: p.key, vocab: this.d.vocab(), on: {
        interim: t => this._onInterim(t), final: t => this._onFinal(t), complete: () => this._onComplete(),
        closed: why => this._onClosed(live, why), goaway: () => { this.liveAt = 0; },
      } });
      this.live = live;
      return live.connect(tm).then(() => { live.wasReady = true; return live; });
    };
    this.liveConnecting = attempt(4000).catch(() => attempt(9000)).then(live => { this.liveAt = Date.now(); this.liveConnecting = null; return live; }, e => { this.liveConnecting = null; this.live = null; throw e; });
    return this.liveConnecting;
  }
  _onClosed(live, why) {
    if (!live.wasReady) return; // 연결 시도 중 실패는 _ensureLive가 다시 시도한다
    if (this.live === live) this.live = null;
    const u = this.utts.get(this.liveOwner);
    if (u && !u.finished) { u.liveFailed = why; this.liveOwner = null; if (u.ended) this._fallback(u); }
    else this.liveOwner = null;
  }
  _onInterim(t) {
    const u = this.utts.get(this.liveOwner);
    if (!u || u.finished) return;
    u.interim = t; u.pending = true;
    if (!u.firstAt) u.firstAt = Date.now();
    this._emit(u, { type: 'interim', text: this.d.fix(this._text(u)).text });
    if (u.ended) this._armQuiet(u);
  }
  _onFinal(t) {
    const u = this.utts.get(this.liveOwner);
    if ((!u || u.finished) && this.late && Date.now() < this.late.until) { this._lateFinal(t); return; }
    if (!u || u.finished) return;
    u.finals.push(t.trim()); u.interim = ''; u.pending = false;
    if (!u.firstAt) u.firstAt = Date.now();
    this._emit(u, { type: 'interim', text: this.d.fix(this._text(u)).text });
    if (u.ended) this._armQuiet(u);
  }
  // 이미 보여 준 말에 늦게 온 글자: 이어 붙여 고친 결과를 다시 알린다
  _lateFinal(t) {
    const L = this.late;
    L.finals.push(t.trim());
    this._revise(L, L.finals.join(' '), {});
  }
  _revise(L, raw, meta) {
    const { text, fixes } = this.d.fix(raw);
    const ev = { ...L.ev, ...meta, raw, text: clean(text), fixes, revised: true };
    L.ev = ev;
    this.done.set(ev.id, ev);
    this.d.emit(ev);
  }
  _armQuiet(u) {
    clearTimeout(u.quiet);
    if (!this._text(u)) return;
    u.quiet = setTimeout(() => this._finishLive(u), u.pending ? QUIET_PENDING_MS : QUIET_DONE_MS);
  }
  _onComplete() {
    const u = this.utts.get(this.liveOwner);
    if (u && !u.finished && u.ended && !u.pending) this._finishLive(u);
  }
  _text(u) { return [...u.finals, u.interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
  _emit(u, ev) { this.d.emit({ id: u.id, source: u.source, where: u.where, itemId: u.itemId, ...ev }); }

  begin({ id, source = 'pc', where = 'quick', itemId = null, engine = null }) {
    if (this.done.has(id)) return; // 이미 끝낸 말 — end에서 저장한 결과를 다시 알림
    if (this.utts.has(id)) return;
    this.late = null;
    const p = stt.pick(this.d.settings(), this.d.dataDir, engine);
    const u = { id, source, where, itemId, p, chunks: [], size: 0, queue: [], finals: [], interim: '', pending: false, startedAt: Date.now(), ended: false, finished: false, peak: 0 };
    this.utts.set(id, u);
    if (!p.ready) { this._emit(u, { type: 'error', msg: p.why }); this.utts.delete(id); return; }
    if (p.engine === 'live') {
      if (this.liveOwner && this.utts.has(this.liveOwner)) { u.noLive = true; return; } // 다른 말이 쓰는 중이면 끝난 뒤 받아쓰기로
      this.liveOwner = id;
      this._touchIdle();
      this._ensureLive(p).then(live => {
        if (u.finished || this.liveOwner !== id) return;
        for (const b of u.queue) live.audio(b);
        u.queue = null; u.liveReady = true;
        if (u.ended) this._endLive(u);
      }, e => {
        u.liveFailed = e.message;
        if (this.liveOwner === id) this.liveOwner = null;
        if (u.ended) this._fallback(u);
      });
    }
  }
  chunk(id, bytes) {
    const u = this.utts.get(id);
    if (!u || u.finished) return;
    const b = Buffer.from(bytes);
    u.chunks.push(b); u.size += b.length;
    const lv = rmsLevel(b);
    if (lv > u.peak) u.peak = lv;
    if (lv > 0.24) { u.lastLoudAt = Date.now(); u.voiced = (u.voiced || 0) + b.length / 32000; }
    this._emit(u, { type: 'level', v: lv });
    if (u.p.engine === 'live' && !u.noLive && !u.liveFailed) {
      if (u.liveReady && this.live) this.live.audio(b);
      else if (u.queue) u.queue.push(b);
    }
    // 90초를 넘기면 그만 받는다(폰이 끊긴 채 계속 보내는 경우 대비)
    if (u.size > 32000 * 90) this.end(id);
  }
  end(id) {
    const old = this.done.get(id);
    if (old) { this.d.emit(old); return; } // 폰이 다시 보낸 말
    const u = this.utts.get(id);
    if (!u || u.ended) return;
    u.ended = true; u.endedAt = Date.now();
    if (u.p.engine !== 'live' || u.noLive || u.liveFailed) return this._fallback(u);
    if (u.liveReady) this._endLive(u);
    u.finalTimer = setTimeout(() => {
      if (u.finished) return;
      if (this._text(u)) this._finishLive(u);
      else { u.liveFailed = 'no text'; if (this.liveOwner === id) { this.liveOwner = null; this._closeLive(); } this._fallback(u); }
    }, FINAL_WAIT_MS + (u.liveReady ? 0 : 3000));
  }
  _endLive(u) {
    if (!this.live) return;
    this.live.endAudio();
    if (u.finals.length && !u.pending && Date.now() - (u.lastLoudAt || 0) >= SILENT_BEFORE_END_MS) { this._finishLive(u); return; }
    this._armQuiet(u);
  }
  cancel(id) {
    const u = this.utts.get(id);
    if (!u) return;
    u.finished = true;
    this._clearTimers(u);
    this.utts.delete(id);
    if (this.liveOwner === id) { this.liveOwner = null; if (this.live) this.live.endAudio(); }
    this._touchIdle();
  }
  _clearTimers(u) { clearTimeout(u.finalTimer); clearTimeout(u.quiet); }
  _finishLive(u) {
    if (u.finished) return;
    this._clearTimers(u);
    if (this.liveOwner === u.id) this.liveOwner = null;
    this._touchIdle();
    const raw = this._text(u);
    if (!raw && u.peak > 0.25) return this._fallback(u); // 말소리는 컸는데 글자가 없으면 다른 방법으로 한 번 더
    const ev = this._finish(u, raw, { engine: 'live', model: u.p.model });
    // 확정된 글자만 지닌다. 임시 글자까지 넣으면 그 말의 최종 글자가 늦게 왔을 때 같은 말이 두 번 들어간다.
    this.late = { until: Date.now() + LATE_MS, finals: [...u.finals], ev };
    // 서버가 멈춰 앞부분만 준 것 같으면(말한 시간에 비해 글자가 너무 적음) 소리 전체로 한 번 더 받아 적어 고쳐 넣는다
    const chars = raw.replace(/[\s.,!?。]/g, '').length;
    if ((u.voiced || 0) >= 1.5 && chars < u.voiced * 2) {
      const L = this.late;
      const p = stt.pick(this.d.settings(), this.d.dataDir, 'gemini');
      if (p.ready) stt.batch(p, Buffer.concat(u.chunks), this.d.hint()).then(r => { if (r.text && r.text.replace(/\s/g, '').length > chars * 1.3) this._revise(L, r.text, { engine: 'gemini', model: r.model }); }, () => { /* 처음 글자라도 남는다 */ });
    }
  }
  async _fallback(u) {
    if (u.finished || u.fallingBack) return;
    u.fallingBack = true;
    this._clearTimers(u);
    this._emit(u, { type: 'busy' });
    const pcm = Buffer.concat(u.chunks);
    try {
      const r = await stt.batch(u.p, pcm, this.d.hint());
      this._finish(u, r.text, { engine: r.engine === 'live' ? 'gemini' : r.engine, model: r.model, viaFallback: !!u.liveFailed, silent: r.silent });
    } catch (e) {
      u.finished = true;
      this.utts.delete(u.id);
      this._emit(u, { type: 'error', msg: e.message });
    }
  }
  _finish(u, raw, meta) {
    u.finished = true;
    this.utts.delete(u.id);
    const { text, fixes } = this.d.fix(raw);
    const seconds = u.size / 32000;
    const ms = { first: u.firstAt ? u.firstAt - u.startedAt : null, afterEnd: u.endedAt ? Date.now() - u.endedAt : null };
    const ev = { id: u.id, source: u.source, where: u.where, itemId: u.itemId, type: 'final', text: clean(text), raw, fixes, seconds, ms, ...meta };
    this.done.set(u.id, ev);
    if (this.done.size > 60) this.done.delete(this.done.keys().next().value);
    this.d.emit(ev);
    if (this.d.log) this.d.log({ at: new Date().toISOString(), source: u.source, where: u.where, raw, text: ev.text, fixes, seconds, engine: meta.engine, model: meta.model, ms });
    // 정확도 확인: 소리 전체를 다른 모델로 한 번 더 돌려 다르면 후보로 알린다(기다리지 않음)
    const s = this.d.settings().voice || {};
    if (s.quality === 'check' && meta.engine === 'live' && ev.text) {
      const p = stt.pick(this.d.settings(), this.d.dataDir, 'gemini');
      if (p.ready) stt.batch({ ...p, model: s.model || 'gemini-3.5-flash' }, Buffer.concat(u.chunks), this.d.hint()).then(r => {
        const t = clean(this.d.fix(r.text).text);
        if (t && !same(t, ev.text)) this.d.emit({ id: u.id, source: u.source, where: u.where, itemId: u.itemId, type: 'check', text: t, model: r.model, ms: r.ms });
      }, () => { /* 확인은 실패해도 그만 */ });
    }
    return ev;
  }
  // 내 목소리로 엔진 비교: 같은 소리를 고른 엔진들에 모두 보낸다
  async compare(pcmBytes, engines) {
    const pcm = Buffer.from(pcmBytes);
    const out = [];
    for (const e of engines) {
      if (e.engine === 'live') { out.push(await this._compareLive(pcm)); continue; }
      const p = stt.pick(this.d.settings(), this.d.dataDir, e.engine);
      const row = { label: e.label || p.label || e.engine, engine: e.engine, model: e.model || p.model };
      if (!p.ready) { out.push({ ...row, text: '', err: p.why }); continue; }
      try { const r = await stt.batch(e.model ? { ...p, model: e.model } : p, pcm, this.d.hint()); out.push({ ...row, text: clean(this.d.fix(r.text).text), raw: r.text, ms: r.ms, model: r.model }); }
      catch (err) { out.push({ ...row, text: '', err: err.message }); }
    }
    return out;
  }
  // 비교 때는 연결을 따로 열어 소리를 실제 빠르기보다 빨리 흘려 넣는다
  _compareLive(pcm) {
    const p = stt.pick(this.d.settings(), this.d.dataDir, 'live');
    const row = { label: p.label || 'Gemini 실시간', engine: 'live', model: p.model };
    if (!p.ready) return Promise.resolve({ ...row, text: '', err: p.why });
    return new Promise(resolve => {
      const finals = []; let t0 = 0, closed = false;
      const finish = err => { if (closed) return; closed = true; clearTimeout(tm); live.close(); const raw = finals.join(' ').trim(); resolve({ ...row, text: clean(this.d.fix(raw).text), raw, ms: t0 ? Date.now() - t0 : null, err }); };
      const live = new LiveSTT({ key: p.key, vocab: this.d.vocab(), on: { final: t => finals.push(t), complete: () => setTimeout(() => finish(), 200), closed: w => finish('연결이 닫힘 ' + w) } });
      const tm = setTimeout(() => finish(finals.length ? undefined : '시간 초과'), 15000);
      live.connect().then(() => { t0 = Date.now(); const trimmed = stt.trimPcm(pcm) || pcm; for (let i = 0; i < trimmed.length; i += 3200) live.audio(trimmed.subarray(i, i + 3200)); live.endAudio(); }, e => finish(e.message));
    });
  }
  stop() { clearTimeout(this.idleTimer); this._closeLive(); }
}
const clean = t => String(t || '').replace(/\s+/g, ' ').trim();

module.exports = { VoiceHub };
