// 메모리·대화·최근 문서·사용자 설정·AI 결과를 합쳐 화면에 보일 "보드"를 만든다.
const path = require('path');
const crypto = require('crypto');
const { norm, PrefixMatcher, extractPaths, isUnder } = require('./paths');
const { deadlinesFrom, daysUntil, ymd, today0, DAY } = require('./dates');

const AREAS = [
  { id: '업무', color: '#2B4C7E' },
  { id: '개발', color: '#2F6F5E' },
  { id: '학교', color: '#8A5A2B' },
  { id: '연구', color: '#6A4C93' },
  { id: '집필', color: '#9B3D5A' },
  { id: '창업', color: '#B5651D' },
  { id: '개인', color: '#5F6B73' },
];

const PATH_AREA = []; // 폴더 경로로 영역을 정하는 규칙(필요하면 직접 추가)
const KW_AREA = [
  ['업무', /공문|기관|보고서|회의|출장|업무|결재|협의|회신|부서|팀장|사내/g],
  ['학교', /대학원|대학교|학교|수업|과제|학기|강의|자격증|시험공부|교수/g],
  ['연구', /논문|학회|KSC|EvoMUSART|특허|LNCS|투고/g],
  ['집필', /\(책\)|『|집필|원고|교정지|에세이/g],
  ['창업', /창업|사업화|투자자|경진대회|공모전|지원서|스타트업|모두의|해커톤|본선|예선/g],
  ['개발', /앱|웹|개발|로블록스|게임|확장|플랫폼|Workers|Unity|프로그램|자동화|도구|배포|서버/gi],
];

function ruleArea(text, primary) {
  if (primary) for (const [rx, a] of PATH_AREA) if (rx.test(primary)) return a;
  let best = '개인', bestN = 0;
  for (const [a, rx] of KW_AREA) {
    const n = (String(text).match(rx) || []).length;
    if (n > bestN) { best = a; bestN = n; }
  }
  return best;
}

function cleanFolderName(n) {
  return String(n).replace(/^\d+(\.\s*|_)\s*/, '').replace(/^\(책\)_?/, '').replace(/_/g, ' ').trim();
}

function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12); }

// 비교용으로 소문자가 된 경로를 화면에는 실제 표기로
const realCase = new Map();
function display(p) {
  if (!realCase.has(p)) {
    let r = p;
    try { r = require('fs').realpathSync.native(p); } catch (_) { /* 없는 폴더는 그대로 */ }
    realCase.set(p, r);
  }
  return realCase.get(p);
}

// 메모리 글에서 이 일이 차지하는 폴더들(strong: 직접 적힌 경로, weak: 언급된 작업 폴더)
function collectClaims(memories, rootsInfo) {
  const childMatcher = new PrefixMatcher(rootsInfo.children.map(c => c.key));
  const claims = [];
  for (const m of memories) {
    const text = [m.description, m.hook, m.body].join('\n');
    const strong = extractPaths(text, rootsInfo.nameMap);
    strong.forEach((p, rank) => claims.push({ id: 'm:' + m.name, p, strong: true, rank, mt: m.mtimeMs }));
    const weak = childMatcher.find(text);
    let r = 0;
    for (const [p] of weak) claims.push({ id: 'm:' + m.name, p, strong: false, rank: r++, mt: m.mtimeMs });
    for (const p of strong) {
      const c = rootsInfo.children.find(c => isUnder(p, c.key));
      if (c && !weak.has(c.key)) claims.push({ id: 'm:' + m.name, p: c.key, strong: false, rank: 99, mt: m.mtimeMs });
    }
  }
  return claims;
}

function prefixesFor(memories, rootsInfo) {
  const claims = collectClaims(memories, rootsInfo);
  const list = [...new Set([...rootsInfo.children.map(c => c.key), ...claims.map(c => c.p)])].sort();
  return { prefixes: list, prefixHash: hash(list.join('|')), claims };
}

function makeResolver(claims, rootsInfo) {
  const cache = new Map();
  return function resolve(p) {
    if (cache.has(p)) return cache.get(p);
    let best = null;
    for (const c of claims) {
      if (!isUnder(p, c.p)) continue;
      if (!best || c.p.length > best.p.length ||
        (c.p.length === best.p.length && ((c.strong && !best.strong) ||
          (c.strong === best.strong && (c.rank < best.rank || (c.rank === best.rank && c.mt > best.mt)))))) best = c;
    }
    let id = best ? best.id : null;
    if (!id) {
      const ch = rootsInfo.children.find(c => isUnder(p, c.key));
      if (ch) id = 'd:' + ch.key;
    }
    cache.set(p, id);
    return id;
  };
}

function relTime(ms, now) {
  if (!ms) return '';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  const h = Math.round(m / 60);
  if (h < 24) return h + '시간 전';
  const d = Math.round(h / 24);
  if (d < 31) return d + '일 전';
  return Math.round(d / 30) + '달 전';
}

function bandOf(days) {
  if (days === 0) return 'today';
  if (days <= 3) return 'd3';
  if (days <= 7) return 'd7';
  if (days <= 14) return 'd14';
  if (days <= 31) return 'd31';
  return 'later';
}

const BANDS = [
  { id: 'overdue', name: '지남 · 확인 필요' },
  { id: 'today', name: '오늘' },
  { id: 'd3', name: '3일 안' },
  { id: 'd7', name: '이번 주 (7일 안)' },
  { id: 'd14', name: '2주 안' },
  { id: 'd31', name: '한 달 안' },
  { id: 'later', name: '그 뒤' },
  { id: 'none', name: '기한 없음 · 최근 작업 순' },
  { id: 'sleep', name: '잠든 일 · 30일 넘게 손 안 댐', collapsed: true },
  { id: 'done', name: '끝낸 일', collapsed: true },
];

/*
 ctx = { memories, sessions(cache.sessions), recent[], vscode[], rootsInfo, claims, notes{id:{text,mtimeMs}},
         user, ai, settings, focus{itemId:{day:min}}, now }
*/
function buildBoard(ctx) {
  const now = ctx.now || Date.now();
  const nowDate = new Date(now);
  const t0 = today0(nowDate);
  const user = ctx.user || {};
  const uItems = user.items || {};
  const ai = ctx.ai || {};
  const aiGroups = ai.groups || {};
  const aiDetails = ai.details || {};
  const settings = ctx.settings || {};
  const resolve = makeResolver(ctx.claims, ctx.rootsInfo);
  const items = new Map();

  const ensureDir = (id) => {
    if (items.has(id)) return items.get(id);
    const key = id.slice(2);
    const ch = ctx.rootsInfo.children.find(c => c.key === key);
    const it = newItem(id, 'dir');
    it.folderName = ch ? ch.name : path.basename(key);
    it.baseTitle = cleanFolderName(it.folderName);
    it.paths = [ch ? ch.path : key];
    it.primary = key;
    items.set(id, it);
    return it;
  };

  // 1) 메모리 = 일 단위
  for (const m of ctx.memories) {
    const id = 'm:' + m.name;
    const it = newItem(id, 'memory');
    it.memName = m.name;
    it.memFile = m.file;
    it.baseTitle = m.title || m.description.split(/[—\-(:]/)[0].trim() || m.name;
    it.hook = m.hook || m.description;
    it.text = [m.title, m.hook, m.description, m.body].join('\n');
    it.anchor = m.modified;
    it.memModified = Date.parse(m.modified) || m.mtimeMs;
    const strong = ctx.claims.filter(c => c.id === id && c.strong).sort((a, b) => a.rank - b.rank);
    const weak = ctx.claims.filter(c => c.id === id && !c.strong).sort((a, b) => a.rank - b.rank);
    it.primary = (strong[0] || weak[0] || {}).p || '';
    it.paths = [...new Set([...strong, ...weak].map(c => display(c.p)))];
    it.lastTs = Math.max(it.lastTs, it.memModified || 0);
    items.set(id, it);
  }

  // 2) Claude 대화 → 일
  const unassigned = [];
  const sessUser = user.sessions || {};
  const sessAi = ai.sessions || {};
  for (const s of Object.values(ctx.sessions || {})) {
    const lastMs = Date.parse(s.lastTs) || 0;
    const per = new Map();
    for (const [key, days] of Object.entries(s.hits || {})) {
      let id = key.startsWith('mem:') ? 'm:' + key.slice(4) : resolve(key);
      if (!id) continue;
      if (id.startsWith('m:') && !items.has(id)) continue; // 피드백 메모리 등
      per.set(id, merge(per.get(id) || {}, days));
    }
    const forced = sessUser[s.id] || (!per.size && sessAi[s.id]);
    if (forced && forced !== '-') per.set(forced, merge(per.get(forced) || {}, s.days || {}));
    if (!per.size) {
      if (s.prompts > 0 && sessUser[s.id] !== '-') unassigned.push(sessionBrief(s, now));
      continue;
    }
    for (const [id, days] of per) {
      const it = id.startsWith('d:') ? ensureDir(id) : items.get(id);
      if (!it) continue;
      const n = Object.values(days).reduce((a, b) => a + b, 0);
      for (const [d, c] of Object.entries(days)) it.activity[d] = (it.activity[d] || 0) + c;
      const lastHitDay = Object.keys(days).sort().pop();
      const lastHitMs = lastHitDay ? Math.min(lastMs, Date.parse(lastHitDay + 'T23:59:59') || lastMs) : lastMs;
      it.lastTs = Math.max(it.lastTs, lastHitMs);
      it.sessions.push({ id: s.id, title: s.title || (s.firstPrompts[0] || {}).t || s.id.slice(0, 8), lastTs: s.lastTs, n, cwd: s.cwd });
    }
  }

  // 3) 최근 문서·폴더 → 일
  const loose = [];
  for (const r of ctx.recent || []) {
    const id = resolve(norm(r.path));
    if (!id) { if (r.isDoc) loose.push({ path: r.path, name: r.name, ts: r.ts }); continue; }
    if (id.startsWith('m:') && !items.has(id)) continue;
    const it = id.startsWith('d:') ? ensureDir(id) : items.get(id);
    const d = ymd(new Date(r.ts));
    it.activity[d] = (it.activity[d] || 0) + 1;
    it.lastTs = Math.max(it.lastTs, r.ts);
    if (r.isDoc && it.docs.length < 12) it.docs.push({ path: r.path, name: r.name, ts: r.ts });
  }
  for (const v of ctx.vscode || []) {
    const id = resolve(norm(v.path));
    if (!id || (id.startsWith('m:') && !items.has(id))) continue;
    const it = id.startsWith('d:') ? ensureDir(id) : items.get(id);
    it.lastTs = Math.max(it.lastTs, v.ts);
  }

  // 4) 창 사용 기록(켜 둔 경우) → 집중 시간
  for (const [id, days] of Object.entries(ctx.focus || {})) {
    const it = id.startsWith('d:') ? ensureDir(id) : items.get(id);
    if (!it) continue;
    for (const [d, min] of Object.entries(days)) {
      it.focus[d] = (it.focus[d] || 0) + min;
      it.activity[d] = (it.activity[d] || 0) + Math.ceil(min / 5);
    }
  }

  // 4-2) 지정 폴더 문서에서 찾은 일정: 켠 것만 해당 일의 마감으로 넣는다.
  //      넣을 일 = 내가 고른 일 > 문서 경로로 찾은 일 > 그 폴더 이름의 일(f:)
  const uFound = user.found || {};
  const foundOut = [];
  const folderCfg = new Map((settings.docFolders || []).map(f => [norm(f.path), f]));
  const ensureFolder = (folder) => {
    const id = 'f:' + norm(folder);
    if (items.has(id)) return items.get(id);
    const it = newItem(id, 'folder');
    it.baseTitle = path.basename(folder);
    it.paths = [folder];
    it.primary = norm(folder);
    it.hook = '지정한 폴더의 문서에서 찾은 일정';
    it.text = it.baseTitle;
    items.set(id, it);
    return it;
  };
  for (const f of ctx.found || []) {
    const st = uFound[f.key] || {};
    const fa = f.ai || {}; // AI로 다듬은 값
    const label = st.label || fa.label || f.label;
    const date = st.date || fa.date || f.date;
    const time = st.time ?? fa.time ?? f.time ?? '';
    const auto = resolve(norm(f.file));
    const autoTarget = auto && !(auto.startsWith('m:') && !items.has(auto)) ? auto : 'f:' + norm(f.folder);
    const target = st.target || autoTarget;
    const rec = { key: f.key, file: f.file, name: f.name, folder: f.folder, date, time, kind: fa.kind || f.kind, label, ctx: f.ctx, raw: f.raw,
      on: !!st.on, target, autoTarget, aiKeep: fa.keep, aiAt: fa.at || '', days: daysUntil(date, nowDate), mtimeMs: f.mtimeMs };
    foundOut.push(rec);
    if (!rec.on) continue;
    const it = target.startsWith('f:') ? ensureFolder(f.folder) : target.startsWith('d:') ? ensureDir(target) : items.get(target);
    if (!it) continue;
    (it.docDls = it.docDls || []).push({ date, time, label, kind: rec.kind, file: f.file, name: f.name, key: f.key });
    it.lastTs = Math.max(it.lastTs, f.mtimeMs || 0);
  }
  for (const it of items.values()) if (it.kind === 'folder') {
    const fc = folderCfg.get(it.primary);
    if (fc && fc.area) it.manualArea = fc.area;
  }

  // 폴더 일은 최근 60일 안에 손댄 것만(찾은 일정을 켠 일은 남김)
  for (const [id, it] of items) {
    if (it.kind === 'dir' && now - it.lastTs > 60 * DAY && !uItems[id] && !(it.docDls && it.docDls.length)) items.delete(id);
  }

  // 5) 내가 직접 넣은 일
  for (const mi of user.manual || []) {
    const it = newItem(mi.id, 'manual');
    it.baseTitle = mi.title;
    it.hook = mi.note || '';
    it.text = mi.title + '\n' + (mi.note || '');
    it.lastTs = mi.created || 0;
    it.manualArea = mi.area;
    items.set(mi.id, it);
  }

  // 6) 프로젝트 폴더 안내 글
  for (const it of items.values()) {
    const n = ctx.notes && ctx.notes[it.id];
    if (n) { it.notesText = n.text; it.notesFile = n.file; it.notesMt = n.mtimeMs; }
  }

  // 7) 제목·영역·주제·마감 확정
  const dueTime = settings.dueTime || '18:00';
  const out = [];
  const texts = {};
  for (const it of items.values()) {
    const u = uItems[it.id] || {};
    const g = aiGroups[it.id] || {};
    const det = aiDetails[it.id];
    it.title = u.title || g.title || it.baseTitle;
    it.area = u.area || g.area || it.manualArea || ruleArea(it.text + ' ' + it.baseTitle + ' ' + (it.notesText || '').slice(0, 800), it.primary);
    if (!AREAS.some(a => a.id === it.area)) it.area = '개인';
    it.group = u.group || g.group || (it.kind === 'dir' ? it.baseTitle : it.kind === 'manual' ? '할 일' : groupFromPath(it.primary, ctx.rootsInfo) || it.baseTitle);
    it.importance = u.imp || 0;
    it.note = u.note || '';
    it.hidden = !!u.hidden;
    it.done = !!u.done;
    it.doneAt = u.doneAt || 0;
    it.summary = det ? det.summary : '';
    it.nextAction = det ? det.next : '';
    it.status = det ? det.status : '';
    it.aiAt = det ? det.at : '';

    // 마감: AI 결과가 있으면 그것(확신 0.4 미만은 뺌), 없으면 글에서 찾은 바탕값. 내가 넣은 것은 항상.
    const anchor = it.anchor ? new Date(it.anchor) : nowDate;
    let found = deadlinesFrom(it.text || '', anchor, 'auto');
    if (it.notesText) found = found.concat(deadlinesFrom(it.notesText, new Date(it.notesMt || now), 'auto'));
    it.candidates = found.map(d => `${d.date} ${d.label}`).slice(0, 12);
    let auto;
    if (det && Array.isArray(det.deadlines)) {
      auto = det.deadlines.filter(d => (d.confidence ?? 0.8) >= 0.4)
        .map(d => ({ date: d.date, label: d.label, kind: d.kind || 'deadline', conf: d.confidence ?? 0.8, src: 'ai', time: d.time || '' }));
    } else auto = found;
    const byDate = new Map();
    for (const d of auto) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) continue;
      if (!byDate.has(d.date)) byDate.set(d.date, d);
    }
    // 문서에서 찾아 켠 일정(내가 고른 것이므로 확정)
    for (const d of it.docDls || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) continue;
      const prev = byDate.get(d.date);
      if (!prev || prev.src !== 'me') byDate.set(d.date, { date: d.date, label: d.label, kind: d.kind || 'deadline', conf: 1, src: 'doc', time: d.time || '', doc: { file: d.file, name: d.name, key: d.key } });
    }
    for (const d of u.myDeadlines || []) byDate.set(d.date, { date: d.date, label: d.label || '마감', kind: d.kind || 'deadline', conf: 1, src: 'me', time: d.time || '' });
    const dls = [];
    for (const d of byDate.values()) {
      const st = (u.dl || {})[d.date] || {};
      if (st.rejected) continue;
      const days = daysUntil(d.date, nowDate);
      dls.push({
        date: d.date, label: st.label || d.label, kind: d.kind, src: d.src,
        time: st.time || d.time || dueTime,
        confirmed: d.src === 'me' || d.src === 'doc' || !!st.confirmed,
        done: !!st.done, days, conf: d.conf, doc: d.doc,
      });
    }
    dls.sort((a, b) => a.date.localeCompare(b.date));
    it.deadlines = dls;

    // 8) 긴박도 띠
    const open = dls.filter(d => !d.done);
    const future = open.filter(d => d.days >= 0);
    const overdue = open.filter(d => d.days < 0 && d.days >= -14);
    it.nextDl = future[0] || null;
    it.overdueDl = overdue.length ? overdue[overdue.length - 1] : null;
    const idleDays = it.lastTs ? Math.floor((t0 - today0(new Date(it.lastTs))) / DAY) : 999;
    it.idleDays = idleDays;
    // 완료 체크한 일은 며칠 동안 그 자리에 줄을 그어 둔다(체크할 때 있던 띠 그대로)
    const keepMs = (settings.doneKeepDays ?? 3) * DAY;
    it.doneInPlace = it.done && u.doneBand && u.doneBand !== 'done' && now - it.doneAt < keepMs;
    it.aiDone = !it.done && !u.active && it.status === '완료' && !future.length; // AI가 끝난 것으로 본 일
    // 지난 마감(확인 필요)보다 3일 안에 오는 마감이 더 급하다
    if (it.doneInPlace) it.band = u.doneBand;
    else if (it.done || it.aiDone) it.band = 'done';
    else if (it.overdueDl && !(it.nextDl && it.nextDl.days <= 3)) it.band = 'overdue';
    else if (it.nextDl) it.band = bandOf(it.nextDl.days);
    else it.band = idleDays > 30 ? 'sleep' : 'none';
    it.fdl = it.band === 'overdue' ? it.overdueDl : (it.nextDl || (it.doneInPlace ? it.overdueDl : null)); // 화면에 앞세울 마감
    it.days = it.fdl ? it.fdl.days : null;
    it.neglect = it.nextDl && it.nextDl.days <= 7 && idleDays >= 3 ? idleDays : 0;

    // 최근 14일 활동 막대
    const spark = [];
    for (let i = 13; i >= 0; i--) spark.push(it.activity[ymd(new Date(t0.getTime() - i * DAY))] || 0);
    it.spark = spark;
    it.todayFocus = it.focus[ymd(t0)] || 0;
    it.lastRel = relTime(it.lastTs, now);
    it.sessions.sort((a, b) => String(b.lastTs).localeCompare(String(a.lastTs)));
    it.sessions = it.sessions.slice(0, 8);
    it.docs.sort((a, b) => b.ts - a.ts);
    // AI에게 줄 글: 글이 길어 잘려도 날짜를 놓치지 않게 자동 추출 후보를 맨 앞에
    texts[it.id] = [it.candidates.length ? `[글에서 자동으로 찾은 날짜 후보 — 틀릴 수 있음] ${it.candidates.join(' / ')}` : '',
      (it.text || '').slice(0, 3000), (it.notesText || '').slice(0, 1500)].join('\n');
    delete it.candidates;
    it.aiHash = hash([it.baseTitle, it.hook, texts[it.id]].join('|'));
    delete it.text;
    delete it.notesText;
    delete it.docDls;
    out.push(it);
  }

  // 찾은 일정 목록에 넣을 일 이름을 붙인다
  const titleOf = new Map(out.map(it => [it.id, it.title]));
  for (const f of foundOut) {
    f.targetTitle = titleOf.get(f.target) || (f.target.startsWith('f:') ? path.basename(f.folder) + ' (폴더)' : '');
    f.autoTitle = titleOf.get(f.autoTarget) || (f.autoTarget.startsWith('f:') ? path.basename(f.folder) + ' (폴더)' : '');
  }
  foundOut.sort((a, b) => a.date.localeCompare(b.date));

  // 30일 이전 활동은 화면에 필요 없음(달력 띠는 앞뒤 8주)
  const cut = ymd(new Date(t0.getTime() - 60 * DAY));
  for (const it of out) for (const d of Object.keys(it.activity)) if (d < cut) delete it.activity[d];

  unassigned.sort((a, b) => String(b.lastTs).localeCompare(String(a.lastTs)));
  loose.sort((a, b) => b.ts - a.ts);
  return {
    generatedAt: now,
    today: ymd(t0),
    areas: AREAS,
    bands: BANDS,
    items: out,
    unassigned: unassigned.slice(0, 40),
    looseDocs: loose.slice(0, 40),
    found: foundOut.filter(f => f.on || f.days >= -30).slice(0, 600),
    foundStats: ctx.foundStats || null,
    texts, // AI 정리용(화면에는 보내지 않음)
    stats: {
      sessions: Object.keys(ctx.sessions || {}).length,
      memories: ctx.memories.length,
      recent: (ctx.recent || []).length,
    },
  };
}

function groupFromPath(p, rootsInfo) {
  if (!p) return '';
  const ch = rootsInfo.children.find(c => isUnder(p, c.key));
  return ch ? cleanFolderName(ch.name) : '';
}

function merge(a, b) {
  for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v;
  return a;
}

function sessionBrief(s, now) {
  return {
    id: s.id, title: s.title || ((s.firstPrompts[0] || {}).t || '').slice(0, 50) || s.id.slice(0, 8),
    lastTs: s.lastTs, lastRel: relTime(Date.parse(s.lastTs), now), cwd: s.cwd,
    first: ((s.firstPrompts[0] || {}).t || '').slice(0, 120),
  };
}

function newItem(id, kind) {
  return {
    id, kind, baseTitle: '', title: '', hook: '', paths: [], primary: '',
    activity: {}, focus: {}, sessions: [], docs: [], lastTs: 0,
  };
}

module.exports = { buildBoard, prefixesFor, AREAS, BANDS, hash, cleanFolderName };
