// 창 사용 기록(선택 기능, 기본 꺼짐). 맨 앞 창의 프로그램 이름과 제목이 바뀔 때만 적는다.
// 이 PC의 data\activity\날짜.jsonl 에만 남고, 제외 목록에 걸린 창은 제목 없이 "(제외)"로 적는다.
// 입력이 없는 동안(자리 비움)은 시간을 세지 않는다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class ActivityLog {
  constructor({ dir, script, getSettings, getIdleSec, onChange }) {
    this.dir = dir;
    this.script = script;
    this.getSettings = getSettings;
    this.getIdleSec = getIdleSec;
    this.onChange = onChange || (() => {});
    this.proc = null;
    this.cur = null; // { app, title, start, lastSeen }
    this.away = false;
    this.timer = null;
  }

  running() { return !!this.proc; }

  start() {
    if (this.proc) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const s = this.getSettings().activity;
    this.prune(s.keepDays || 30);
    this.proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Interval', String(s.intervalSec || 5)], { windowsHide: true });
    let buf = '';
    this.proc.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.onLine(line);
      }
    });
    this.proc.on('exit', () => { this.proc = null; this.close(Date.now()); this.onChange(this.state()); });
    this.timer = setInterval(() => this.tick(), 5000);
    this.onChange(this.state());
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.proc) { try { this.proc.kill(); } catch (_) { /* 이미 꺼짐 */ } }
    this.proc = null;
    this.close(Date.now());
    this.onChange(this.state());
  }

  excluded(app, title) {
    const s = this.getSettings().activity;
    const a = String(app).toLowerCase();
    if ((s.excludeApps || []).some(x => x && a.includes(String(x).toLowerCase()))) return true;
    const t = String(title).toLowerCase();
    return (s.excludeWords || []).some(x => x && t.includes(String(x).toLowerCase()));
  }

  onLine(line) {
    const [app, b64] = line.split('\t');
    let title = '';
    try { title = Buffer.from(b64 || '', 'base64').toString('utf8'); } catch (_) { /* 빈 제목 */ }
    if (this.excluded(app, title)) title = '(제외)';
    const now = Date.now();
    this.latest = { app, title };
    if (this.away) return;
    if (this.cur && this.cur.app === app && this.cur.title === title) return;
    this.close(now);
    this.cur = { app, title, start: now };
    this.onChange(this.state());
  }

  // 자리를 비우면 지금 구간을 닫고, 돌아오면 같은 창으로 새 구간을 연다
  tick() {
    const cut = this.getSettings().activity.idleCutSec || 120;
    const idle = this.getIdleSec();
    if (!this.away && idle >= cut) {
      this.away = true;
      this.close(Date.now() - idle * 1000);
      this.onChange(this.state());
    } else if (this.away && idle < 5) {
      this.away = false;
      if (this.latest) this.cur = { ...this.latest, start: Date.now() };
      this.onChange(this.state());
    }
  }

  close(end) {
    const c = this.cur;
    this.cur = null;
    if (!c || end - c.start < 3000) return;
    const rec = { s: c.start, e: end, app: c.app, title: c.title };
    try { fs.appendFileSync(path.join(this.dir, dayOf(c.start) + '.jsonl'), JSON.stringify(rec) + '\n', 'utf8'); } catch (_) { /* 쓰기 실패는 넘어감 */ }
  }

  state() {
    return { on: !!this.proc, away: this.away, app: this.cur ? this.cur.app : '', title: this.cur ? this.cur.title : '', since: this.cur ? this.cur.start : 0 };
  }

  readDays(days = 14) {
    const out = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const f = path.join(this.dir, dayOf(now - i * 86400000) + '.jsonl');
      let src = '';
      try { src = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      for (const l of src.split('\n')) { if (l) { try { out.push(JSON.parse(l)); } catch (_) { /* 깨진 줄 */ } } }
    }
    if (this.cur) out.push({ s: this.cur.start, e: now, app: this.cur.app, title: this.cur.title, live: true });
    return out;
  }

  prune(keepDays) {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (_) { return; }
    const cut = dayOf(Date.now() - keepDays * 86400000);
    for (const n of names) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) < cut) { try { fs.unlinkSync(path.join(this.dir, n)); } catch (_) { /* 넘어감 */ } }
  }

  clearAll() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (_) { return 0; }
    let n = 0;
    for (const f of names) if (f.endsWith('.jsonl')) { try { fs.unlinkSync(path.join(this.dir, f)); n++; } catch (_) { /* 넘어감 */ } }
    if (this.cur) this.cur.start = Date.now();
    return n;
  }
}

// 창 제목 → 일: 폴더 이름·최근 문서 이름·제목 낱말로 맞춘다
function titleMatcher(items) {
  const keys = [];
  for (const it of items) {
    const add = k => { k = String(k || '').toLowerCase().trim(); if (k.length >= 5) keys.push([k, it.id]); };
    for (const p of it.paths || []) add(path.basename(p));
    if (it.folderName) add(it.folderName);
    for (const d of it.docs || []) add(d.name.replace(/\.[^.]+$/, ''));
  }
  keys.sort((a, b) => b[0].length - a[0].length);
  return title => {
    const t = String(title || '').toLowerCase();
    if (!t || t === '(제외)') return null;
    for (const [k, id] of keys) if (t.includes(k)) return id;
    return null;
  };
}

// 기록 → { itemId: { 날짜: 분 } }
function focusByItem(records, match) {
  const out = {};
  for (const r of records) {
    const id = match(r.title);
    if (!id) continue;
    const min = (r.e - r.s) / 60000;
    if (min <= 0) continue;
    const d = dayOf(r.s);
    const o = out[id] || (out[id] = {});
    o[d] = Math.round(((o[d] || 0) + min) * 10) / 10;
  }
  return out;
}

module.exports = { ActivityLog, titleMatcher, focusByItem };
