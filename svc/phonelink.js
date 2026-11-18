// PC 쪽 폰 연결: 중계 서버에 붙어 폰에 목록을 보내고, 폰에서 온 명령·소리를 처리한다.
// 폰이 할 수 있는 일은 아래 ALLOWED에 적힌 것뿐이다(파일 열기·설정·키 읽기 같은 것은 못 함).
const zlib = require('zlib');
const crypto = require('crypto');
const LinkCore = require('../ui/linkcore');

// 폰에서 부를 수 있는 동작(본체의 IPC 처리기를 그대로 씀)
const cal = require('./calendar');
// 폰 캘린더로 보낼 목록: 구글 캘린더로 보내는 것과 똑같다(같은 uid·제목·시각·알림)
function calOut(board, settings) {
  try { return cal.entries(board, settings).slice(0, 400).map(e => ({ uid: e.uid, title: e.summary, start: e.start.getTime(), offsets: e.offsets })); } catch (_) { return []; }
}
const ALLOWED = new Set(['item:set', 'dl:set', 'dl:add', 'dl:removeMine', 'manual:add', 'manual:remove', 'item:apply', 'nl:ai', 'ai:run', 'scan']);
const ITEM_KEYS = new Set(['imp', 'done', 'doneAt', 'doneBand', 'active', 'hidden', 'title', 'note', 'area', 'group']);
const SEEN_MAX = 300;

const dlOf = d => d && ({ date: d.date, time: d.time || '', label: d.label || '', kind: d.kind, src: d.src, confirmed: !!d.confirmed, done: !!d.done, days: d.days, ...(d.doc ? { doc: { key: d.doc.key, name: d.doc.name } } : {}) });

// 폰으로 보낼 목록: 일 이름·마감·상태만. 경로·문서 이름 목록·대화 기록·메모 원문은 보내지 않는다.
function snapshot(board, settings) {
  const items = (board.items || []).filter(it => it.band !== 'sleep' || it.fdl).map(it => ({
    id: it.id, title: it.title, area: it.area, group: it.group, band: it.band, days: it.days, kind: it.kind,
    importance: it.importance || 0, done: !!it.done, doneAt: it.doneAt || 0, doneInPlace: !!it.doneInPlace, hidden: !!it.hidden, aiDone: !!it.aiDone,
    status: it.status || '', summary: it.summary || '', nextAction: it.nextAction || '', note: it.note || '', lastRel: it.lastRel || '', lastTs: it.lastTs || 0,
    fdl: dlOf(it.fdl) || null, nextDl: dlOf(it.nextDl) || null, overdueDl: dlOf(it.overdueDl) || null, deadlines: (it.deadlines || []).map(dlOf),
  }));
  return {
    t: 'snap', items, areas: board.areas || [], today: board.today, version: board.version, at: Date.now(),
    cal: calOut(board, settings), calGoogle: (settings.calendar || {}).mode === 'script' && !!((settings.calendar || {}).script || {}).enabled,
    set: { hideDone: !!settings.hideDone, dueTime: settings.dueTime, urgentDays: settings.urgentDays, custom: (settings.nlp || {}).custom || [], learn: (settings.nlp || {}).learn || null, theme: settings.theme, miniCount: (settings.mini || {}).count || 8 },
  };
}

class PhoneLink {
  // deps: { settings(), setPhone(patch), board(), handlers(이름→처리기), hub(VoiceHub), learn(들은 글, 고친 글), ui(상태), onNotice(글), dataFile }
  constructor(deps) {
    this.d = deps;
    this.link = null; this.lastHash = ''; this.timer = null;
    this.seen = new Map(); // 처리한 명령 id → 답(폰이 다시 보내도 두 번 안 함)
    this.st = { on: false, server: 'off', phones: 0, lastSeen: 0, relay: '', rtt: null };
  }
  state() { return { ...this.st }; }
  _ui() { this.d.ui(this.state()); }
  relay() { return (this.d.settings().phone || {}).relay; }
  pairUrl() { const p = this.d.settings().phone || {}; return p.secret ? `${p.relay.replace(/\/+$/, '')}/app/#p=${p.secret}` : ''; }
  async start() {
    this.stop();
    let p = this.d.settings().phone || {};
    if (!p.secret) { this.d.setPhone({ secret: LinkCore.newSecret() }); p = this.d.settings().phone; }
    this.st.on = true; this.st.relay = p.relay;
    this.link = new LinkCore.Link({
      relay: p.relay, secret: p.secret, role: 'pc',
      onState: s => { this.st.server = s; if (s !== 'on') this.st.phones = 0; this._ui(); },
      onRtt: r => { this.st.rtt = r; },
      onPresence: pr => {
        const was = this.st.phones;
        this.st.phones = pr.phone;
        if (pr.phone > was) { this.st.lastSeen = Date.now(); this.lastHash = ''; this.boardChanged(true); }
        this._ui();
      },
      onJson: j => this._onJson(j),
      onAudio: a => { if (a.id === 'agent') this.d.agent.chunk(a.pcm); else this.d.hub.chunk(a.id, a.pcm); },
    });
    await this.link.start();
    this._ui();
  }
  stop() { if (this.link) { this.link.stop(); this.link = null; } clearTimeout(this.timer); this.st = { ...this.st, on: false, server: 'off', phones: 0 }; this._ui(); }
  // 새 열쇠로 바꾸면 지금까지 연결한 폰은 모두 끊긴다
  async rotate() { this.d.setPhone({ secret: LinkCore.newSecret() }); if (this.st.on) await this.start(); return this.pairUrl(); }

  boardChanged(now) {
    if (!this.link || !this.st.phones) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._sendSnap(), now ? 0 : 300);
  }
  _sendSnap() {
    const board = this.d.board();
    if (!board || !this.link) return;
    const snap = snapshot(board, this.d.settings());
    const body = JSON.stringify({ ...snap, at: 0 });
    const hash = crypto.createHash('sha1').update(body).digest('hex');
    if (hash === this.lastHash) return;
    snap.hash = hash;
    const sent = this.noGz ? this.link.sendJson(snap) : this.link.sendGzip(zlib.gzipSync(JSON.stringify(snap), { level: 6 }));
    if (sent) this.lastHash = hash;
  }
  _reply(o) { if (this.link) this.link.sendJson(o); }
  // 음성 결과를 폰으로(폰에서 말한 것만)
  voiceEvent(ev) {
    if (ev.source !== 'phone' || ev.type === 'level') return;
    this._reply({ t: 'v', ...ev });
  }
  _info() { const v = this.d.hub.info(); return { t: 'pc', version: this.d.version, voice: v }; }
  async _onJson(j) {
    this.st.lastSeen = Date.now();
    switch (j.t) {
      case 'hello': this.noGz = j.gz === false; this.lastHash = j.hash === this.lastHash ? j.hash : ''; this._reply(this._info()); this.boardChanged(true); if (j.warm) this.d.hub.warm(); this._ui(); break;
      case 'warm': this.d.hub.warm(); break;
      case 'ping': this._reply({ t: 'pong', ts: j.ts }); break;
      case 'v-start': this.d.hub.begin({ id: j.id, source: 'phone', where: j.where || 'quick', itemId: j.itemId || null }); break;
      case 'v-end': this.d.hub.end(j.id); break;
      case 'v-cancel': this.d.hub.cancel(j.id); this.d.notice({ type: 'phone-cancel', id: j.id }); break;
      case 'v-learn': this.d.learn(String(j.heard || ''), String(j.fixed || '')); break;
      case 'v-added': this.d.notice({ type: 'phone-added', id: j.id }); break;
      case 'a-begin': this.d.agent.begin('phone'); break;
      case 'a-end': this.d.agent.end(); break;
      case 'a-cancel': this.d.agent.cancel(); break;
      case 'a-text': this.d.agent.text(String(j.text || ''), 'phone'); break;
      case 'a-stop': this.d.agent.stopTalking(); break;
      case 'a-rate': this.d.agent.setRate(j.p || {}); break;
      case 'a-warm': if (this.d.agent.available()) this.d.agent.connect().catch(() => { /* 말할 때 다시 */ }); this._reply({ t: 'a', type: 'rate', owner: 'phone', ...this.d.agent.rateInfo() }); break;
      case 'need': this.lastHash = ''; this.boardChanged(true); break;
      case 'cmd': await this._cmd(j); break;
      case 'cal': this._cal(j); break;
    }
  }
  async _cmd(j) {
    if (this.seen.has(j.id)) { this._reply(this.seen.get(j.id)); return; }
    let ack;
    try {
      if (!ALLOWED.has(j.op)) throw new Error('허용되지 않은 동작: ' + j.op);
      const args = Array.isArray(j.args) ? j.args : [];
      if (j.op === 'item:set') { for (const k of Object.keys(args[1] || {})) if (!ITEM_KEYS.has(k)) throw new Error('허용되지 않은 값: ' + k); }
      const res = await this.d.handlers[j.op](null, ...args);
      ack = { t: 'ack', id: j.id, ok: true, res: res === undefined ? null : res };
    } catch (e) { ack = { t: 'ack', id: j.id, ok: false, err: e.message }; }
    this.seen.set(j.id, ack);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.keys().next().value);
    this._reply(ack);
    if (j.op === 'manual:add' && ack.ok && j.fromVoice) this.d.notice({ type: 'phone-added', id: j.fromVoice });
    this.boardChanged();
  }
  // 비서 소식·목소리를 폰으로(폰에서 말을 건 대화만)
  agentEvent(ev) { if (ev.owner === 'phone') this._reply({ t: 'a', ...ev }); }
  agentAudio(buf) { if (this.link) { this.agentSeq = (this.agentSeq || 0) + 1; this.link.sendAudio('agent', this.agentSeq, new Uint8Array(buf)); } }
  setting() { this.boardChanged(); }
  // 폰 캘린더 일정 받기. 폰이 보낸 값은 믿지 않고 모양·길이를 다시 맞춘다.
  _cal(j) {
    if (!this.d.phoneCal) return;
    const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
    const events = [];
    for (const e of (Array.isArray(j.events) ? j.events : []).slice(0, 1500)) {
      if (!e || typeof e !== 'object') continue;
      const key = clean(e.key, 120), title = clean(e.title, 200), date = String(e.date || '');
      if (!key || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      events.push({ key, title, date, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(e.time || '') ? e.time : '', allDay: !!e.allDay, end: Number(e.end) || 0, cal: clean(e.cal, 60), location: clean(e.location, 120) });
    }
    const cals = (Array.isArray(j.cals) ? j.cals : []).slice(0, 60).map(c => ({ name: clean(c && c.name, 60), account: clean(c && c.account, 80), n: Number(c && c.n) || 0 }));
    this.d.phoneCal({ at: Date.now(), from: Number(j.from) || 0, to: Number(j.to) || 0, events, cals, wrote: Number(j.wrote) || 0, target: clean(j.target, 60) });
    this._reply({ t: 'cal-ok', n: events.length });
  }
}

module.exports = { PhoneLink, snapshot };
