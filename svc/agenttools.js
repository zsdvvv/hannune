// 비서가 쓰는 도구: 일정 읽기·넣기·바꾸기·완료·되돌리기, 설정, 기억. 화면·폰과 같은 처리기를 쓴다.
// 위험한 것(지우기)은 confirmed 없이는 하지 않고, 바꾼 것은 undo로 되돌린다. AI 키·폰 열쇠·폴더는 건드릴 수 없다.
const NLP = require('../ui/nlp');
const { daysBetween, spokenWhen, itemBrief, findItems } = require('./agentwords');

// 넣기로 들어온 말이 사실은 '있는 일 바꾸기'인지 본다(비서 모델이 도구를 잘못 고르는 일이 있었다:
// "‘모두 도 회의 알람’ 제목을 모두창 회의로 바꿔줘"를 add_item으로 보내 그 문장이 새 일 제목이 됨).
const ASK_CHANGE = /(?:바꿔|바꾸어|변경해|수정해|고쳐|미뤄|당겨|옮겨)\s*(?:줘|주세요|주라|줄래|줄래요|달라|요)?\s*[.!?~]*\s*$|(?:제목|이름)\s*(?:을|를)?\s*.+?(?:으로|로)\s*(?:바꿔|바꾸|변경|수정|고쳐)/;
function changeTarget(text) {
  const t = String(text || '');
  const q = /['"‘’“”「『](.+?)['"‘’“”」』]/.exec(t);
  if (q && q[1].trim()) return { query: q[1].trim(), change: t.slice(q.index + q[0].length) };
  const m = /^(.*?)\s*(?:의\s*)?(?:내용\s*)?(?:제목|이름|일\s*이름)\s*(?:을|를|은|는|:)/.exec(t);
  if (m && m[1].trim()) return { query: m[1].trim(), change: t.slice(m[1].length) };
  return { query: t, change: t };
}

const SETTINGS = {
  idle_alert: { path: 'idle.enabled', type: 'bool', name: '쉴 때 알림' },
  idle_seconds: { path: 'idle.inputSec', type: 'num', min: 10, max: 7200, name: '쉴 때 알림까지 입력 없는 시간(초)' },
  quiet_start: { path: 'idle.quietStart', type: 'time', name: '조용한 시간 시작' },
  quiet_end: { path: 'idle.quietEnd', type: 'time', name: '조용한 시간 끝' },
  deadline_alarm: { path: 'alarms.enabled', type: 'bool', name: '마감 알람' },
  morning_alarm: { path: 'alarms.morning', type: 'bool', name: '당일 아침 9시 알림' },
  due_time: { path: 'dueTime', type: 'time', name: '시각 없는 마감의 기본 시각' },
  theme: { path: 'theme', type: 'enum', values: ['paper', 'night'], name: '바탕(paper=종이, night=밤)' },
  hide_done: { path: 'hideDone', type: 'bool', name: '끝낸 일 감추기' },
  view: { path: 'layout', type: 'enum', values: ['list', 'matrix', 'timeline'], name: '화면(list=목록, matrix=4분면, timeline=달력 띠)' },
  window_log: { path: 'activity.enabled', type: 'bool', name: '창 사용 기록' },
  auto_start: { path: 'autoStart', type: 'bool', name: '컴퓨터 켤 때 자동 실행' },
  dictation_auto_add: { path: 'voice.autoSubmit', type: 'bool', name: '받아 적은 뒤 바로 넣기' },
  speak_results: { path: 'voice.speak', type: 'bool', name: '받아쓰기 결과 읽어 주기' },
  read_brief: { path: 'voice.readBrief', type: 'bool', name: '쉴 때 화면 읽어 주기' },
  end_wait_ms: { path: 'voice.silenceMs', type: 'num', min: 600, max: 4000, name: '말 끝 기다림(ms)' },
  follow_up: { path: 'voice.agentFollow', type: 'bool', name: '비서가 답한 뒤 이어서 듣기' },
};
const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
const patchOf = (p, v) => p.split('.').reverse().reduce((a, k) => ({ [k]: a }), v);

const DECLS = [
  { name: 'get_schedule', description: '사용자의 할 일·마감을 급한 순으로 가져온다. 일정을 물으면 반드시 먼저 부른다.',
    parameters: { type: 'OBJECT', properties: { range: { type: 'STRING', enum: ['today', 'tomorrow', 'week', 'overdue', 'upcoming', 'all'], description: 'today=오늘, tomorrow=내일, week=7일 안, overdue=지난 것, upcoming=다가오는 모두, all=전부' }, area: { type: 'STRING', description: '영역으로 거르기(업무·개발·학교·연구·집필·창업·개인)' }, query: { type: 'STRING', description: '이름으로 찾기' } } } },
  { name: 'add_item', description: '새 할 일을 넣는다(새로 생기는 일일 때만). text에는 넣을 일을 말한 그대로(날짜·시각·별·영역 포함) 넣는다. 예: "내일 오후 3시까지 보고서 제출 별 넷 업무". 있는 일을 "바꿔·고쳐·수정·미뤄·제목(이름)을 …로"라고 하면 add_item이 아니라 change_item이다.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] } },
  { name: 'change_item', description: '있는 일을 바꾼다. query는 일 이름(일부도 됨), change는 바꿀 내용을 말로. 예: "이틀 미뤄", "다음 주 금요일 오후 3시로", "별 넷", "학교로 옮겨", "제목을 주간보고로 바꿔", "숨겨". 사용자가 "‘모두 회의’ 제목을 모두창 회의로 바꿔 줘"라고 하면 query="모두 회의", change="제목을 모두창 회의로 바꿔". 후보가 여럿이면 돌아온 candidates를 말하고 어느 것인지 묻는다.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, change: { type: 'STRING' }, deadline: { type: 'STRING', description: '일에 마감이 여럿일 때 어느 마감인지(이름 또는 YYYY-MM-DD)' } }, required: ['query', 'change'] } },
  { name: 'complete_item', description: '일을 끝냄으로 체크한다(done=false면 되돌림).', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, done: { type: 'BOOLEAN' } }, required: ['query'] } },
  { name: 'delete_item', description: '일을 지운다. 직접 넣은 일은 지우고, 자동으로 찾은 일은 숨긴다. 사용자가 분명히 확인했을 때만 confirmed=true로 부른다. 처음엔 어느 일인지 말하고 지울지 묻는다.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, confirmed: { type: 'BOOLEAN' } }, required: ['query'] } },
  { name: 'undo', description: '비서가 방금 바꾼 것을 되돌린다("취소해", "방금 거 되돌려").', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'get_settings', description: '프로그램 설정을 이름·지금 값으로 가져온다. 설정을 묻거나 바꾸기 전에 부른다.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'set_setting', description: '프로그램 설정 하나를 바꾼다. name은 get_settings가 돌려준 이름. 말 빠르기는 set_speech_rate로.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, value: { type: 'STRING', description: '켜기 true, 끄기 false, 숫자, 시각 HH:MM 등' } }, required: ['name', 'value'] } },
  { name: 'set_speech_rate', description: '비서의 말 빠르기를 정한다. 숫자는 배속(1=보통, 1.5, 2까지). auto=true면 사용자의 말 속도·급한 상황에 맞춰 자동으로 조절. "더 빨리", "천천히"는 앱이 이미 바꾸므로 숫자를 말했거나 자동을 켜고 끌 때만 부른다.',
    parameters: { type: 'OBJECT', properties: { rate: { type: 'NUMBER' }, auto: { type: 'BOOLEAN' } } } },
  { name: 'remember', description: '사용자가 기억해 달라고 한 것, 앞으로도 쓸 선호·사실을 저장한다(다음 대화에도 기억). 예: "회의는 전날 저녁에 알려 주는 걸 좋아함"', parameters: { type: 'OBJECT', properties: { fact: { type: 'STRING' } }, required: ['fact'] } },
  { name: 'forget', description: '기억한 것을 지운다.', parameters: { type: 'OBJECT', properties: { fact: { type: 'STRING' } }, required: ['fact'] } },
  { name: 'show_on_screen', description: '컴퓨터 화면을 바꾼다. what: list(목록)·matrix(4분면)·timeline(달력 띠)·mini(미니 창)·settings(설정)·item(query로 찾은 일 열기)', parameters: { type: 'OBJECT', properties: { what: { type: 'STRING', enum: ['list', 'matrix', 'timeline', 'mini', 'settings', 'item'] }, query: { type: 'STRING' } }, required: ['what'] } },
  { name: 'organize_with_ai', description: '일 전체를 AI로 다시 정리한다(영역·주제·마감 찾기). 몇 분 걸리니 사용자가 원할 때만.', parameters: { type: 'OBJECT', properties: {} } },
];

class AgentTools {
  // deps: { board(), settings(), applySettings(패치), handlers, snapshotUser(), restoreUser(글), screen(명령), setRate(값) }
  constructor(deps) { this.d = deps; this.undoStack = []; }
  declarations() { return DECLS; }
  _save(label) { this.undoStack.push({ label, snap: this.d.snapshotUser() }); if (this.undoStack.length > 10) this.undoStack.shift(); }
  async call(name, args) {
    const fn = this[name];
    if (!fn || !DECLS.some(x => x.name === name)) return { ok: false, error: '없는 도구: ' + name };
    try { return await fn.call(this, args || {}); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  get_schedule({ range = 'upcoming', area, query }) {
    const b = this.d.board();
    if (!b) return { ok: false, error: '아직 목록을 읽는 중입니다' };
    const now = new Date();
    let items = b.items.filter(it => !it.hidden && !(it.done && !it.doneInPlace) && it.band !== 'done');
    if (area) items = items.filter(it => it.area === area);
    if (query) { const f = findItems(items, query); items = f.map(x => x.it); }
    const dOf = it => (it.fdl ? daysBetween(now, it.fdl.date) : null);
    const has = it => !!it.fdl && !it.done;
    const test = { today: it => has(it) && dOf(it) === 0, tomorrow: it => has(it) && dOf(it) === 1, week: it => has(it) && dOf(it) >= 0 && dOf(it) <= 7, overdue: it => has(it) && dOf(it) < 0, upcoming: it => has(it) && dOf(it) >= 0, all: () => true }[range] || (() => true);
    const list = items.filter(test).sort((x, y) => (dOf(x) ?? 9999) - (dOf(y) ?? 9999) || (y.importance || 0) - (x.importance || 0));
    const overdue = items.filter(it => has(it) && dOf(it) < 0).length;
    return { ok: true, now: nowText(now), range, count: list.length, overdue_count: overdue, items: list.slice(0, 15).map(it => itemBrief(it, now)), more: Math.max(0, list.length - 15) };
  }
  async add_item({ text }) {
    const s = this.d.settings();
    // 바꾸라는 말이면 새로 넣지 않는다: 어느 일인지 분명하면 바로 바꾸고, 아니면 비서에게 change_item을 쓰라고 돌려준다
    if (ASK_CHANGE.test(String(text || '').trim())) {
      const { query, change } = changeTarget(text);
      const asked = NLP.parse(change, { mode: 'edit', custom: (s.nlp || {}).custom }).actions;
      if (asked.length) {
        const p = this._pick(query);
        if (p.it) {
          const r = await this.change_item({ query: p.it.title, change, _id: p.it.id });
          return r.ok ? { ...r, note: '새로 넣지 않고 있는 일을 바꿨습니다(바꾸라는 말이었음).' } : r;
        }
        return { ok: false, error: '새 일이 아니라 있는 일을 바꾸라는 말입니다. add_item을 쓰지 말고, 어느 일인지 사용자에게 확인한 뒤 change_item(query=일 이름, change=바꿀 내용)을 부르세요.', candidates: p.candidates || [] };
      }
    }
    const r = NLP.parse(String(text || ''), { mode: 'quick', custom: (s.nlp || {}).custom });
    if (!r.title) return { ok: false, error: '할 일 이름을 알아듣지 못했습니다. 무엇을 넣을지 물어보세요.' };
    const g = k => (r.actions.find(a => a.type === k) || {}).value;
    let date = g('date');
    if (!date && g('time')) date = NLP.ymd(new Date());
    const kind = g('kind') || 'deadline';
    this._save(`넣기: ${r.title}`);
    const id = await this.d.handlers['manual:add'](null, { title: r.title, area: g('area') || '개인', date, time: g('time') || '', label: kind === 'event' ? '일정' : '마감', imp: g('imp') || 0, kind });
    return { ok: true, id, title: r.title, when: date ? spokenWhen(date, g('time') || '') : '날짜 없음', stars: g('imp') || 0, area: g('area') || '개인' };
  }
  _pick(query) {
    const b = this.d.board();
    if (!b) return { error: '아직 목록을 읽는 중입니다' };
    const f = findItems(b.items.filter(it => it.band !== 'done' || it.done), query);
    if (!f.length) return { error: `‘${query}’와 비슷한 일을 찾지 못했습니다.` };
    if (f.length > 1 && f[0].score - f[1].score < 0.08 && f[0].score < 0.98) return { candidates: f.slice(0, 4).map(x => x.it.title) };
    return { it: f[0].it };
  }
  async change_item({ query, change, deadline, _id }) {
    const b0 = _id && this.d.board();
    const exact = b0 && b0.items.find(x => x.id === _id);
    const p = exact ? { it: exact } : this._pick(query);
    if (p.error) return { ok: false, error: p.error };
    if (p.candidates) return { ok: false, candidates: p.candidates, error: '비슷한 일이 여럿입니다. 어느 것인지 물어보세요.' };
    const it = p.it, s = this.d.settings();
    const dls = (it.deadlines || []).filter(d => !d.done);
    let dl = it.fdl || dls[0] || null;
    if (deadline) { const m = (it.deadlines || []).find(d => d.date === deadline || String(d.label).includes(deadline)); if (m) dl = m; }
    const cur = { title: it.title, area: it.area, group: it.group, imp: it.importance || 0, done: !!it.done, hidden: !!it.hidden, date: dl ? dl.date : '', time: dl ? dl.time : '', label: dl ? dl.label : '', kind: dl ? dl.kind : 'deadline' };
    const r = NLP.parse(String(change || ''), { mode: 'edit', baseDate: cur.date || undefined, custom: (s.nlp || {}).custom });
    const { next, changes } = NLP.apply(r, cur, { dueTime: s.dueTime });
    if (!changes.length) return { ok: false, error: `‘${change}’를 알아듣지 못했습니다. 날짜·시각·별처럼 다시 말해 달라고 하세요.` };
    const ch = {};
    for (const k of ['title', 'area', 'group', 'imp', 'hidden']) if (next[k] !== cur[k]) ch[k] = next[k];
    if (next.done !== cur.done) Object.assign(ch, { done: next.done, doneBand: it.band, wasAiDone: it.aiDone || it.status === '완료' });
    if (['date', 'time', 'label', 'kind'].some(k => next[k] !== cur[k]) || next.removeDl || next.addNew) {
      if (next.date || next.removeDl) ch.dl = { from: dl ? dl.date : null, src: dl ? dl.src : null, key: dl && dl.doc ? dl.doc.key : null, date: next.date, time: next.time || (cur.time ? '' : s.dueTime), label: next.label || (next.kind === 'event' ? '일정' : '마감'), kind: next.kind, remove: !!next.removeDl, addNew: !!next.addNew || !dl };
    }
    this._save(`바꾸기: ${it.title}`);
    await this.d.handlers['item:apply'](null, it.id, ch);
    return { ok: true, title: next.title, changed: changes.map(c => c.key), now: next.removeDl ? '마감 지움' : next.date ? spokenWhen(next.date, ch.dl ? ch.dl.time : next.time) : '날짜 없음', stars: next.imp };
  }
  async complete_item({ query, done = true }) {
    const p = this._pick(query);
    if (p.error) return { ok: false, error: p.error };
    if (p.candidates) return { ok: false, candidates: p.candidates, error: '비슷한 일이 여럿입니다.' };
    const it = p.it;
    this._save(`완료: ${it.title}`);
    if (done) await this.d.handlers['item:set'](null, it.id, { done: true, doneAt: Date.now(), doneBand: it.band, active: null });
    else await this.d.handlers['item:set'](null, it.id, { done: null, doneAt: null, doneBand: null, active: it.status === '완료' ? true : null });
    return { ok: true, title: it.title, done: !!done };
  }
  async delete_item({ query, confirmed }) {
    const p = this._pick(query);
    if (p.error) return { ok: false, error: p.error };
    if (p.candidates) return { ok: false, candidates: p.candidates, error: '비슷한 일이 여럿입니다.' };
    const it = p.it;
    if (!confirmed) return { ok: false, need_confirm: true, title: it.title, error: '지울지 사용자에게 먼저 물어보세요.' };
    this._save(`지우기: ${it.title}`);
    if (it.kind === 'manual') { await this.d.handlers['manual:remove'](null, it.id); return { ok: true, title: it.title, removed: true }; }
    await this.d.handlers['item:set'](null, it.id, { hidden: true });
    return { ok: true, title: it.title, hidden: true };
  }
  undo() {
    const u = this.undoStack.pop();
    if (!u) return { ok: false, error: '되돌릴 것이 없습니다.' };
    this.d.restoreUser(u.snap);
    return { ok: true, undone: u.label };
  }
  get_settings() {
    const s = this.d.settings();
    const list = {};
    for (const [k, m] of Object.entries(SETTINGS)) list[k] = { what: m.name, value: getPath(s, m.path) };
    const v = s.voice || {};
    return { ok: true, settings: list, speech: { rate: v.agentRate || 1, auto: v.agentAuto !== false } };
  }
  set_setting({ name, value }) {
    const m = SETTINGS[name];
    if (!m) return { ok: false, error: `바꿀 수 없는 설정입니다: ${name}. AI 키·폰 연결·폴더는 설정 화면에서 직접 바꿔야 합니다.`, allowed: Object.keys(SETTINGS) };
    let v = value;
    const t = String(value).trim().toLowerCase();
    if (m.type === 'bool') { if (/^(true|on|켜|켬|예|네|1)/.test(t)) v = true; else if (/^(false|off|꺼|끄|끔|아니|0)/.test(t)) v = false; else return { ok: false, error: '켜기·끄기로 말해 주세요.' }; }
    if (m.type === 'num') { v = Number(String(value).replace(/[^\d.]/g, '')); if (!isFinite(v) || v < m.min || v > m.max) return { ok: false, error: `${m.min}~${m.max} 사이여야 합니다.` }; }
    if (m.type === 'time' && !/^\d{1,2}:\d{2}$/.test(t)) return { ok: false, error: '시각은 HH:MM으로.' };
    if (m.type === 'enum' && !m.values.includes(t)) return { ok: false, error: '고를 수 있는 값: ' + m.values.join(', ') };
    if (m.type === 'enum') v = t;
    const before = getPath(this.d.settings(), m.path);
    this.d.applySettings(patchOf(m.path, v));
    if (name === 'view') this.d.screen({ view: v });
    return { ok: true, what: m.name, before, now: v };
  }
  set_speech_rate({ rate, auto }) {
    const p = {};
    if (typeof rate === 'number' && isFinite(rate)) p.rate = Math.max(0.7, Math.min(2.5, rate));
    if (typeof auto === 'boolean') p.auto = auto;
    p.fromTool = true; // "빠르게 말해"는 앱이 이미 올렸으니 모델이 또 올려도 두 번 오르지 않게 한다
    return { ok: true, ...this.d.setRate(p) };
  }
  remember({ fact }) {
    const f = String(fact || '').trim();
    if (!f) return { ok: false, error: '무엇을 기억할까요?' };
    const m = [...(this.d.settings().voice.agentMemory || []).filter(x => x !== f), f].slice(-40);
    this.d.applySettings({ voice: { agentMemory: m } });
    return { ok: true, count: m.length };
  }
  forget({ fact }) {
    const f = String(fact || '').trim();
    const all = this.d.settings().voice.agentMemory || [];
    const m = all.filter(x => !x.includes(f) && !f.includes(x));
    this.d.applySettings({ voice: { agentMemory: m } });
    return { ok: true, removed: all.length - m.length };
  }
  show_on_screen({ what, query }) {
    if (what === 'item') {
      const p = this._pick(query || '');
      if (p.error) return { ok: false, error: p.error };
      if (p.candidates) return { ok: false, candidates: p.candidates };
      this.d.screen({ item: p.it.id });
      return { ok: true, title: p.it.title };
    }
    this.d.screen(what === 'mini' ? { mini: true } : what === 'settings' ? { settings: true } : { view: what });
    return { ok: true };
  }
  organize_with_ai() { this.d.handlers['ai:run'](null, false); return { ok: true, note: '정리를 시작했습니다. 몇 분 걸립니다.' }; }
}

function nowText(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}(${'일월화수목금토'[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

module.exports = { AgentTools, nowText };
