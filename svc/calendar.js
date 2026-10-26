// 마감을 캘린더로 보낸다.
//  1) .ics 파일: 구글·삼성·아웃룩 어디서나 불러올 수 있는 공통 형식(알람 포함)
//  2) 구글 Apps Script(쉬운 연결, 기본): 사용자가 자기 구글 계정에 붙여 넣어 배포한 작은 스크립트로
//     "한눈에 마감" 캘린더에 넣고·고치고·지운다. Google Cloud 설정·토큰 만료가 없다.
//  3) 구글 캘린더 API(고급): OAuth 클라이언트를 직접 만들어 쓰는 방식.
//     삼성 캘린더는 같은 구글 계정을 연결해 두면 함께 보인다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

function dueDate(d) {
  const [y, m, dd] = d.date.split('-').map(Number);
  const [hh, mm] = (d.time || '18:00').split(':').map(Number);
  return new Date(y, m - 1, dd, hh || 0, mm || 0);
}

// 알람 시점(분 전) 목록: 설정의 offsets + 당일 아침(선택)
function offsetsFor(start, alarms) {
  const list = [...(alarms.offsets || [])];
  if (alarms.morning) {
    const m = new Date(start); m.setHours(9, 0, 0, 0);
    const diff = Math.round((start - m) / 60000);
    if (diff > 0 && !list.includes(diff)) list.push(diff);
  }
  return [...new Set(list)].filter(n => n > 0 && n <= 40320).sort((a, b) => b - a).slice(0, 5);
}

function entries(board, settings) {
  const scope = (settings.alarms && settings.alarms.scope) || 'confirmed';
  const out = [];
  for (const it of board.items || []) {
    if (it.hidden || it.done || it.band === 'done') continue; // 끝낸 일은 캘린더·알람에서 빠진다
    for (const d of it.deadlines || []) {
      if (d.done || d.days < 0) continue;
      if (scope === 'confirmed' && !d.confirmed) continue;
      const start = dueDate(d);
      out.push({
        uid: 'hannune-' + hash(it.id + '|' + d.date), itemId: it.id, title: it.title, area: it.area,
        label: d.label, kind: d.kind, date: d.date, time: d.time, start,
        offsets: offsetsFor(start, settings.alarms || {}),
        summary: `${d.kind === 'event' ? '[일정]' : '[마감]'} ${it.title} · ${d.label}`,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- .ics ----------
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const parts = [];
  let cur = '', len = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (len + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; }
    cur += ch; len += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function writeIcs(list, file) {
  const now = utc(new Date());
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hannune//한눈에 일정판//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:한눈에 마감', 'X-WR-TIMEZONE:Asia/Seoul'];
  for (const e of list) {
    const end = new Date(e.start.getTime() + 30 * 60000);
    L.push('BEGIN:VEVENT', `UID:${e.uid}@hannune`, `DTSTAMP:${now}`, `DTSTART:${utc(e.start)}`, `DTEND:${utc(end)}`,
      `SUMMARY:${icsEsc(e.summary)}`, `DESCRIPTION:${icsEsc(`영역: ${e.area}\n한눈에 일정판에서 보냄`)}`);
    for (const m of e.offsets) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.summary)}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, L.map(fold).join('\r\n') + '\r\n', 'utf8');
  return list.length;
}

// ---------- 구글 캘린더 ----------
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE_OWN = 'https://www.googleapis.com/auth/calendar.app.created';
const SCOPE_PRIMARY = 'https://www.googleapis.com/auth/calendar.events';

class GoogleCalendar {
  constructor(dataDir, getSettings, saveSettings, openExternal) {
    this.tokenFile = path.join(dataDir, 'secret', 'google_token.json');
    this.mapFile = path.join(dataDir, 'calendar', 'google_map.json');
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.openExternal = openExternal;
    this.lastResult = null;
  }
  cfg() { return this.getSettings().calendar.google; }
  readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } }
  writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), 'utf8'); }
  connected() { return !!this.readJson(this.tokenFile, null); }
  status() {
    const c = this.cfg();
    return { enabled: !!c.enabled, hasClient: !!(c.clientId && c.clientSecret), connected: this.connected(), calendarId: c.calendarId || '', last: this.lastResult };
  }
  disconnect() { try { fs.unlinkSync(this.tokenFile); } catch (_) { /* 없음 */ } this.lastResult = null; }

  // 브라우저로 구글 로그인 → 이 PC의 임시 주소(127.0.0.1)로 승인 코드를 받는다
  connect() {
    const c = this.cfg();
    if (!c.clientId || !c.clientSecret) return Promise.reject(new Error('클라이언트 ID와 비밀값을 먼저 넣어 주세요.'));
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/cb') { res.end(); return; }
        const code = u.searchParams.get('code');
        const ok = code && u.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">${ok ? '연결됐습니다. 이 창은 닫아도 됩니다.' : '연결하지 못했습니다: ' + (u.searchParams.get('error') || '')}</body>`);
        srv.close();
        clearTimeout(timer);
        if (!ok) return reject(new Error('구글 승인이 취소됐거나 잘못됐습니다.'));
        try {
          const redirect = `http://127.0.0.1:${port}/cb`;
          const tok = await this.post(TOKEN, { code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
          if (!tok.refresh_token) throw new Error('갱신 토큰을 받지 못했습니다. 다시 연결해 주세요.');
          this.writeJson(this.tokenFile, { ...tok, obtained: Date.now() });
          resolve(this.status());
        } catch (e) { reject(e); }
      });
      let port = 0;
      const timer = setTimeout(() => { srv.close(); reject(new Error('5분 안에 승인하지 않아 멈췄습니다.')); }, 300000);
      srv.listen(0, '127.0.0.1', () => {
        port = srv.address().port;
        const scope = c.target === 'primary' ? SCOPE_PRIMARY : SCOPE_OWN;
        const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: `http://127.0.0.1:${port}/cb`, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state });
        this.openExternal(`${AUTH}?${q}`);
      });
    });
  }

  async post(url, form) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant') throw new Error('구글 연결이 만료되거나 취소됐습니다. 다시 연결해 주세요.');
      throw new Error(`구글 응답 ${r.status}: ${j.error_description || j.error || ''}`);
    }
    return j;
  }

  async accessToken() {
    const t = this.readJson(this.tokenFile, null);
    if (!t) throw new Error('구글 캘린더가 연결돼 있지 않습니다.');
    if (t.access_token && Date.now() < t.obtained + (t.expires_in - 120) * 1000) return t.access_token;
    const c = this.cfg();
    const n = await this.post(TOKEN, { client_id: c.clientId, client_secret: c.clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
    const merged = { ...t, ...n, obtained: Date.now() };
    this.writeJson(this.tokenFile, merged);
    return merged.access_token;
  }

  async api(method, url, body) {
    const tok = await this.accessToken();
    const r = await fetch(API + url, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`구글 캘린더 ${r.status}: ${(j.error && j.error.message) || ''}`); e.status = r.status; throw e; }
    return j;
  }

  async ensureCalendar() {
    const c = this.cfg();
    if (c.target === 'primary') return 'primary';
    if (c.calendarId) return c.calendarId;
    const cal = await this.api('POST', '/calendars', { summary: '한눈에 마감', timeZone: 'Asia/Seoul', description: '한눈에 일정판이 넣는 마감·일정' });
    const s = this.getSettings();
    s.calendar.google.calendarId = cal.id;
    this.saveSettings(s);
    return cal.id;
  }

  // 원하는 목록과 지난번에 넣은 목록을 비교해 넣기·고치기·지우기
  async sync(list) {
    let rawId = await this.ensureCalendar();
    let map = this.readJson(this.mapFile, {});
    if (rawId !== 'primary') {
      // 사용자가 구글에서 캘린더를 지웠으면 새로 만들고 처음부터 넣는다
      try { await this.api('GET', `/calendars/${encodeURIComponent(rawId)}`); }
      catch (err) {
        if (err.status !== 404 && err.status !== 410) throw err;
        const s = this.getSettings(); s.calendar.google.calendarId = ''; this.saveSettings(s);
        map = {};
        rawId = await this.ensureCalendar();
      }
    }
    const calId = encodeURIComponent(rawId);
    const want = new Map(list.map(e => [e.uid, e]));
    let added = 0, changed = 0, removed = 0;
    const errors = [];
    for (const e of list) {
      const end = new Date(e.start.getTime() + 30 * 60000);
      const body = {
        summary: e.summary,
        description: `영역: ${e.area}\n한눈에 일정판에서 넣은 일정입니다.`,
        start: { dateTime: e.start.toISOString(), timeZone: 'Asia/Seoul' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Seoul' },
        reminders: { useDefault: false, overrides: e.offsets.map(m => ({ method: 'popup', minutes: m })) },
        extendedProperties: { private: { hannune: e.uid } },
      };
      const sig = hash(JSON.stringify([body.summary, body.start, body.reminders]));
      const prev = map[e.uid];
      try {
        if (!prev) {
          const r = await this.api('POST', `/calendars/${calId}/events`, body);
          map[e.uid] = { id: r.id, sig }; added++;
        } else if (prev.sig !== sig) {
          try { await this.api('PATCH', `/calendars/${calId}/events/${prev.id}`, body); }
          catch (err) { if (err.status !== 404 && err.status !== 410) throw err; const r = await this.api('POST', `/calendars/${calId}/events`, body); prev.id = r.id; }
          prev.sig = sig; changed++;
        }
      } catch (err) { errors.push(err.message); }
    }
    for (const [uid, v] of Object.entries(map)) {
      if (want.has(uid)) continue;
      try { await this.api('DELETE', `/calendars/${calId}/events/${v.id}`); } catch (err) { if (err.status !== 404 && err.status !== 410) { errors.push(err.message); continue; } }
      delete map[uid]; removed++;
    }
    this.writeJson(this.mapFile, map);
    this.lastResult = { at: Date.now(), added, changed, removed, total: list.length, errors: errors.slice(0, 3) };
    return this.lastResult;
  }
}

// ---------- 구글 Apps Script (쉬운 연결) ----------
// 사용자의 구글 계정에서 돌아가는 스크립트. 앱은 마감 목록 전체를 보내고, 스크립트가
// "한눈에 마감" 캘린더를 그 목록과 똑같이 맞춘다(없으면 넣고, 바뀌면 고치고, 빠지면 지움).
// 비밀 열쇠(token)가 맞아야만 움직인다.
function appsScriptCode(token) {
  return `// 한눈에 일정판 → 구글 캘린더 연결 스크립트 (그대로 붙여 넣고 저장 → 배포 › 새 배포 › 웹 앱)
const TOKEN = '${token}';
const CAL_NAME = '한눈에 마감';

function doGet() { return out_({ ok: true, app: 'hannune', calendar: CAL_NAME }); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  if (body.token !== TOKEN) return out_({ ok: false, error: 'token' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const cal = cal_();
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperties();
    const want = {};
    (body.events || []).forEach(function (ev) { want[ev.uid] = ev; });
    let added = 0, changed = 0, removed = 0;
    if (body.test) return out_({ ok: true, test: true, calendar: cal.getName(), events: Object.keys(saved).filter(function (k) { return k.indexOf('e_') === 0; }).length });
    Object.keys(want).forEach(function (uid) {
      const ev = want[uid];
      const prev = saved['e_' + uid] ? JSON.parse(saved['e_' + uid]) : null;
      if (prev && prev.sig === ev.sig && get_(cal, prev.id)) return;
      if (prev) { const old = get_(cal, prev.id); if (old) old.deleteEvent(); }
      const ce = cal.createEvent(ev.title, new Date(ev.start), new Date(ev.end), { description: ev.desc || '' });
      ce.removeAllReminders();
      (ev.reminders || []).slice(0, 5).forEach(function (m) { ce.addPopupReminder(m); });
      props.setProperty('e_' + uid, JSON.stringify({ id: ce.getId(), sig: ev.sig }));
      if (prev) changed++; else added++;
    });
    Object.keys(saved).forEach(function (k) {
      if (k.indexOf('e_') !== 0 || want[k.slice(2)]) return;
      const old = get_(cal, JSON.parse(saved[k]).id);
      if (old) old.deleteEvent();
      props.deleteProperty(k);
      removed++;
    });
    return out_({ ok: true, added: added, changed: changed, removed: removed, total: Object.keys(want).length, calendar: cal.getName() });
  } finally { lock.releaseLock(); }
}

function cal_() {
  const cs = CalendarApp.getCalendarsByName(CAL_NAME);
  if (cs.length) return cs[0];
  const c = CalendarApp.createCalendar(CAL_NAME, { color: CalendarApp.Color.RED, timeZone: 'Asia/Seoul' });
  return c;
}
function get_(cal, id) { try { return cal.getEventById(id); } catch (err) { return null; } }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}

class ScriptCalendar {
  constructor(getSettings) { this.getSettings = getSettings; this.lastResult = null; }
  cfg() { return this.getSettings().calendar.script || {}; }
  ready() { const c = this.cfg(); return !!(c.url && c.token); }
  status() { const c = this.cfg(); return { enabled: !!c.enabled, hasUrl: !!c.url, last: this.lastResult }; }
  async post(payload) {
    const c = this.cfg();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(c.url || '')) throw new Error('웹 앱 주소가 https://script.google.com/… 형태가 아닙니다.');
    const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: c.token, ...payload }), redirect: 'follow' });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch (_) {
      if (/accounts\.google\.com|ServiceLogin|로그인/.test(txt)) throw new Error('배포의 "액세스 권한"을 "모든 사용자"로 바꿔 다시 배포해 주세요.');
      throw new Error(`스크립트 응답을 읽지 못했습니다(HTTP ${r.status}). 주소가 /exec 로 끝나는지 확인해 주세요.`);
    }
    if (!j.ok) throw new Error(j.error === 'token' ? '비밀 열쇠가 맞지 않습니다. 앱에서 코드를 다시 복사해 붙여 넣고 새로 배포해 주세요.' : '스크립트 오류: ' + (j.error || '알 수 없음'));
    return j;
  }
  async test() {
    const j = await this.post({ test: true });
    this.lastResult = { at: Date.now(), test: true, calendar: j.calendar, errors: [] };
    return j;
  }
  async sync(list) {
    const events = list.map(e => {
      const end = new Date(e.start.getTime() + 30 * 60000);
      const ev = { uid: e.uid, title: e.summary, start: e.start.toISOString(), end: end.toISOString(), desc: `영역: ${e.area}\n한눈에 일정판에서 넣은 일정입니다.`, reminders: e.offsets };
      ev.sig = hash(JSON.stringify([ev.title, ev.start, ev.reminders]));
      return ev;
    });
    try {
      const j = await this.post({ events });
      this.lastResult = { at: Date.now(), added: j.added, changed: j.changed, removed: j.removed, total: j.total, calendar: j.calendar, errors: [] };
    } catch (e) {
      this.lastResult = { at: Date.now(), errors: [e.message] };
    }
    return this.lastResult;
  }
}

module.exports = { entries, writeIcs, GoogleCalendar, ScriptCalendar, appsScriptCode, dueDate };
