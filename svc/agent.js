// 말하는 비서: Gemini Live(gemini-3.8-live)로 소리를 주고받으며 도구로 일정·설정을 다룬다. 2026-11 실측: 말이 끝나고 첫 목소리까지 0.8~1.7초.
// 말 빠르기는 모델에 시켜도 거의 안 바뀌어(초당 5.2→6.1글자) 재생하는 쪽(voicecore.js Player)에서 음높이를 유지한 채 배속한다.
const { rateCommand, isUrgent, paceOf, autoFactor, daysBetween } = require('./agentwords');
const { nowText } = require('./agenttools');

const URL_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=';
const MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];
const IDLE_CLOSE_MS = 180000;
const VOICES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'];

const rms16 = b => { let s = 0; const n = Math.floor(b.length / 2); for (let i = 0; i < n; i++) { const v = b.readInt16LE(i * 2) / 32768; s += v * v; } return n ? Math.sqrt(s / n) : 0; };

class VoiceAgent {
  // deps: { key(), settings(), applySettings(), tools(AgentTools), board(), emit(이벤트), audio(소리 조각, 받는 쪽) }
  constructor(deps) {
    this.d = deps;
    this.ws = null; this.ready = false; this.connecting = null; this.owner = 'pc';
    this.turn = null; this.history = []; this.heard = ''; this.said = ''; this.voiced = 0; this.modelIdx = 0;
    this.autoF = 1; this.lastCmdAt = 0; this.mute = false; this.idleTimer = null; this.toolPending = false;
    this.state = 'off';
  }
  available() { return !!this.d.key(); }
  _set(state, extra) { this.state = state; this.d.emit({ type: 'state', state, owner: this.owner, ...extra }); }
  rateInfo() {
    const v = this.d.settings().voice || {};
    const base = v.agentRate || 1, auto = v.agentAuto !== false;
    // 자동은 알아듣기 어려울 만큼 빨라지지 않게 1.8배까지만. 사용자가 직접 정한 빠르기는 그대로 둔다.
    const rate = auto ? Math.max(base, Math.min(1.8, base * this.autoF)) : base;
    return { base, auto, factor: auto ? this.autoF : 1, rate: Math.round(rate * 100) / 100 };
  }
  _sendRate(why) { this.d.emit({ type: 'rate', owner: this.owner, ...this.rateInfo(), why }); }
  // 사용자가 숫자·자동을 정했을 때(도구·화면·폰에서)
  setRate({ rate, auto, step, fromTool }) {
    const v = this.d.settings().voice || {};
    const patch = {};
    if (fromTool && Date.now() - this.lastCmdAt < 8000) rate = undefined;
    if (step) patch.agentRate = Math.round(Math.max(0.7, Math.min(2.5, (v.agentRate || 1) * (auto === undefined ? this.rateInfo().factor : 1) + step)) * 100) / 100;
    if (rate !== undefined) patch.agentRate = rate;
    if (auto !== undefined) patch.agentAuto = auto;
    if (patch.agentRate !== undefined) this.autoF = 1; // 직접 정했으면 지금 값에서 다시 시작
    this.d.applySettings({ voice: patch });
    this._sendRate('직접 정함');
    return this.rateInfo();
  }
  _system() {
    const s = this.d.settings(), v = s.voice || {}, now = new Date();
    const b = this.d.board();
    const act = b ? b.items.filter(i => !i.hidden && !i.done && i.band !== 'done' && i.fdl) : [];
    const n = k => act.filter(i => i.band === k).length;
    const mem = (v.agentMemory || []).map(x => `- ${x}`).join('\n');
    const past = this.history.slice(-12).map(h => `${h.who === 'me' ? '사용자' : '비서'}: ${h.text}`).join('\n');
    return `너는 ‘한눈에’ 일정판의 전속 비서다. 실제 사람 비서처럼 자연스럽고 눈치 있게 말한다.

말하는 법
- 사용자가 한국어로 말하면 자연스러운 존댓말 한국어로, 영어로 말하면 원어민처럼 유창한 영어로 답한다. 섞어 말해도 알아듣고 맞춘다. 번역투를 쓰지 않는다.
- 듣기 좋게 짧게: 보통 한두 문장. 목록은 급한 것 세 개까지만 말하고 "그 밖에 몇 개 더 있습니다"라고 한다. 사용자가 더 말해 달라면 이어서 말한다.
- 번호·기호·영어 약자 설명을 읽지 않는다. 날짜는 "내일 오후 3시", "이번 주 금요일"처럼 말한다. 도구가 돌려준 when을 그대로 쓰면 된다.
- 사용자가 급해 보이면 결론부터, 인사 없이 말한다. 느긋하면 부드럽게 말한다. 기계처럼 "처리했습니다"만 반복하지 않는다.
- 첫 인사를 먼저 길게 하지 않는다. 물은 것에 바로 답한다.

일하는 법
- 일정·마감·설정에 관한 말은 반드시 도구로 확인하거나 실행한 뒤 답한다. 지어내지 않는다. 도구가 실패하면 까닭을 쉽게 말하고 어떻게 할지 묻는다.
- 넣기·바꾸기·완료·설정 변경은 묻지 말고 바로 하고, 무엇을 어떻게 했는지 한 문장으로 말한다. 말을 잘못 알아들은 것 같으면 그때만 되묻는다. 지우기만 먼저 확인한다.
- 있는 일을 "바꿔·고쳐·수정·미뤄·당겨·제목(이름)을 …로"라고 하면 새 일을 넣지 말고 change_item으로 그 일을 바꾼다. 어느 일인지 모르면 get_schedule(query)로 찾고, 여럿이면 묻는다.
- "취소해", "방금 거 되돌려"는 undo로.
- 비서답게 판단한다: 마감이 겹치거나 지난 일이 있으면 짧게 알리고, 무엇부터 할지 물으면 마감·중요도(별)를 보고 근거와 함께 하나를 권한다.
- 앞으로도 쓸 선호나 사실을 말하면 remember로 기억한다.
- 말 빠르기: "더 빨리", "천천히"는 앱이 이미 바꿨으니 짧게 "네"라고만 하고, 숫자 배속이나 자동 켜기·끄기를 말할 때만 set_speech_rate를 부른다.

지금: ${nowText(now)}
지금 상황: 지난 마감 ${n('overdue')}개, 오늘 ${n('today')}개, 3일 안 ${n('d3')}개, 7일 안 ${n('d7')}개
${mem ? `기억하고 있는 것:\n${mem}\n` : ''}${past ? `직전 대화(이어서 말한다):\n${past}\n` : ''}`;
  }
  _soonMinutes() {
    const b = this.d.board();
    if (!b) return null;
    const now = new Date();
    let best = null;
    for (const it of b.items) {
      if (it.hidden || it.done || !it.fdl || !it.fdl.time || daysBetween(now, it.fdl.date) !== 0) continue;
      const [h, m] = it.fdl.time.split(':').map(Number);
      const mins = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
      if (mins >= 0 && (best === null || mins < best)) best = mins;
    }
    return best;
  }
  connect() {
    if (this.ws && this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const key = this.d.key();
    if (!key) return Promise.reject(new Error('비서는 Gemini 키가 있어야 합니다. 설정 › AI 에이전트에서 저장하세요.'));
    this._set('connecting');
    this.connecting = new Promise((resolve, reject) => {
      const v = this.d.settings().voice || {};
      const model = MODELS[this.modelIdx] || MODELS[0];
      const ws = new WebSocket(URL_BASE + encodeURIComponent(key));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('비서 연결 시간 초과')); try { ws.close(); } catch (_) { /* 무시 */ } }, 12000);
      ws.onopen = () => ws.send(JSON.stringify({ setup: {
        model: 'models/' + model,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES.includes(v.agentVoice) ? v.agentVoice : 'Kore' } } } },
        systemInstruction: { parts: [{ text: this._system() }] },
        tools: [{ functionDeclarations: this.d.tools.declarations() }],
        inputAudioTranscription: {}, outputAudioTranscription: {},
      } }));
      ws.onerror = () => { clearTimeout(timer); reject(new Error('비서에 연결하지 못했습니다(인터넷 확인).')); };
      ws.onclose = e => {
        clearTimeout(timer);
        if (this.ws === ws) { this.ws = null; this.ready = false; }
        const why = String(e.reason || '');
        if (/not found|not supported/i.test(why) && this.modelIdx < MODELS.length - 1) this.modelIdx++;
        reject(new Error('비서 연결이 닫혔습니다: ' + why.slice(0, 120)));
        if (this.state !== 'off') { if (this.state === 'thinking' || this.state === 'speaking') this.d.emit({ type: 'error', owner: this.owner, msg: '비서 연결이 끊겼습니다. 다시 말해 주세요.' }); this._set('idle'); }
      };
      ws.onmessage = ev => {
        let j;
        try { j = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (_) { return; }
        if (j.setupComplete) { clearTimeout(timer); this.ready = true; this.connecting = null; resolve(); this._touch(); return; }
        this._onMsg(j);
      };
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  _touch() { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS); }
  async _onMsg(j) {
    this._touch();
    if (j.goAway) { this.closeSoon = true; return; }
    if (j.toolCall) {
      this.toolPending = true;
      this._set('thinking');
      const resp = [];
      for (const c of j.toolCall.functionCalls || []) {
        this.d.emit({ type: 'tool', owner: this.owner, name: c.name });
        const result = await this.d.tools.call(c.name, c.args);
        resp.push({ id: c.id, name: c.name, response: { result } });
      }
      this.toolPending = false;
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ toolResponse: { functionResponses: resp } }));
      return;
    }
    const sc = j.serverContent;
    if (!sc) return;
    if (sc.inputTranscription && sc.inputTranscription.text) {
      this.heard += sc.inputTranscription.text;
      this.d.emit({ type: 'heard', owner: this.owner, text: this.heard.trim() });
      this._judgeRate();
    }
    if (sc.interrupted) { this.d.emit({ type: 'interrupted', owner: this.owner }); this.said = ''; }
    if (sc.outputTranscription && sc.outputTranscription.text) {
      if (!this.mute) { this.said += sc.outputTranscription.text; this.d.emit({ type: 'say', owner: this.owner, text: this.said.trim() }); }
    }
    for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) {
      if (p.inlineData && p.inlineData.data && !this.mute) {
        if (this.state !== 'speaking') {
          this._set('speaking');
          if (this.t0) { this.d.emit({ type: 'latency', owner: this.owner, ms: Date.now() - this.t0 }); this.t0 = 0; }
        }
        this.d.audio(Buffer.from(p.inlineData.data, 'base64'), this.owner);
      }
    }
    if (sc.turnComplete && !this.toolPending) {
      // 도구를 부른 턴은 목소리 없이 끝나고 다음 턴에 답이 온다
      if (this.state === 'speaking' || this.said || this.mute) this._endTurn();
    }
  }
  _judgeRate() {
    const text = this.heard;
    const cmd = rateCommand(text);
    if (cmd && Date.now() - this.lastCmdAt > 4000) {
      this.lastCmdAt = Date.now();
      if (cmd.set !== undefined) this.setRate({ rate: Math.max(0.7, Math.min(2.5, cmd.set)) });
      else this.setRate({ step: cmd.step });
    }
  }
  _judgeAuto() {
    const v = this.d.settings().voice || {};
    if (v.agentAuto === false) return;
    const f = autoFactor({ pace: paceOf(this.heard, this.voiced), urgent: isUrgent(this.heard), soonMinutes: this._soonMinutes() });
    // 갑자기 튀지 않게 천천히 따라간다(급한 말은 바로)
    const next = isUrgent(this.heard) ? Math.max(this.autoF, f) : Math.round((this.autoF * 0.5 + f * 0.5) * 100) / 100;
    if (next !== this.autoF) { this.autoF = next; this._sendRate(isUrgent(this.heard) ? '급한 말' : '말 속도'); }
  }
  _endTurn() {
    if (this.heard.trim()) this.history.push({ who: 'me', text: this.heard.trim() });
    if (this.said.trim()) this.history.push({ who: 'ai', text: this.said.trim() });
    if (this.history.length > 40) this.history.splice(0, this.history.length - 40);
    const said = this.said.trim();
    this.heard = ''; this.said = ''; this.voiced = 0; this.mute = false;
    this.d.emit({ type: 'turn-end', owner: this.owner, text: said });
    this._set('idle');
  }
  // 듣기 시작(말하는 중이면 끊는다)
  begin(owner) {
    this.owner = owner || 'pc';
    if (this.state === 'speaking' || this.state === 'thinking') { this.mute = true; this.d.emit({ type: 'interrupted', owner: this.owner }); }
    this.heard = ''; this.voiced = 0;
    this._set('listening');
    this.queue = [];
    this.connect().then(() => { const q = this.queue || []; this.queue = null; for (const b of q) this._sendAudio(b); if (this.endPending) { this.endPending = false; this._sendEnd(); } }, e => { this.queue = null; this.d.emit({ type: 'error', owner: this.owner, msg: e.message }); this._set('idle'); });
  }
  _sendAudio(b) { if (this.ready && this.ws.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } })); }
  _sendEnd() { if (this.ready && this.ws.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); }
  chunk(bytes) {
    const b = Buffer.from(bytes);
    if (rms16(b) > 0.015) this.voiced += b.length / 32000;
    if (this.queue) this.queue.push(b); else this._sendAudio(b);
    this._touch();
  }
  end() {
    this.t0 = Date.now();
    this._set('thinking');
    setTimeout(() => this._judgeAuto(), 300);
    if (this.queue) this.endPending = true; else this._sendEnd();
    // 답이 없으면 알린다
    clearTimeout(this.noReply);
    this.noReply = setTimeout(() => { if (this.state === 'thinking') { this.d.emit({ type: 'error', owner: this.owner, msg: '비서가 답하지 않습니다. 다시 말해 주세요.' }); this._set('idle'); this.close(); } }, 25000);
  }
  cancel() { this.queue = null; this.mute = true; this._set('idle'); }
  // 글로 말하기(폰 글 입력, 쉴 때 브리핑 등)
  async text(str, owner) {
    this.owner = owner || 'pc';
    if (this.state === 'speaking' || this.state === 'thinking') { this.mute = true; this.d.emit({ type: 'interrupted', owner: this.owner }); }
    this.heard = str; this.voiced = 0;
    this.d.emit({ type: 'heard', owner: this.owner, text: str });
    this._judgeRate();
    this.t0 = Date.now();
    this._set('thinking');
    try { await this.connect(); } catch (e) { this.d.emit({ type: 'error', owner: this.owner, msg: e.message }); this._set('idle'); return; }
    this.mute = false;
    this.ws.send(JSON.stringify({ realtimeInput: { text: str } }));
  }
  stopTalking() { if (this.state === 'speaking' || this.state === 'thinking') { this.mute = true; this.d.emit({ type: 'interrupted', owner: this.owner }); this._set('idle'); } }
  close() {
    clearTimeout(this.idleTimer);
    const ws = this.ws; this.ws = null; this.ready = false;
    if (ws) { ws.onclose = null; try { ws.close(); } catch (_) { /* 무시 */ } }
    if (this.state !== 'off') { this.state = 'off'; this.d.emit({ type: 'state', state: 'off', owner: this.owner }); }
  }
}

module.exports = { VoiceAgent, VOICES };
