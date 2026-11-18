// 한눈에 일정판 — Electron 본체
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, powerMonitor, screen, Notification, globalShortcut, clipboard, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { listRootChildren } = require('./scan/paths');
const { readMemories } = require('./scan/memory');
const { scanSessions } = require('./scan/sessions');
const { recentItems, vscodeRecents, readProjectNotes } = require('./scan/docs');
const { buildBoard, prefixesFor } = require('./scan/build');
const { analyze, refineFound, interpretChange, useLLM } = require('./scan/ai');
const llm = require('./scan/llm');
const localllm = require('./scan/localllm');
const stt = require('./scan/stt');
const words = require('./scan/voicewords');
const { VoiceHub } = require('./svc/voicehub');
const { PhoneLink } = require('./svc/phonelink');
const { VoiceAgent } = require('./svc/agent');
const { AgentTools } = require('./svc/agenttools');
const { claudeAvailable } = require('./scan/claude');
const docfind = require('./scan/docfind');
const cal = require('./svc/calendar');
const NLP = require('./ui/nlp.js');
// 서클(오른쪽 칸). 파일이 없는 판(공개 배포본 등)은 서클 없이 켠다.
let circleMain = null;
try { circleMain = require('./circle_main'); } catch (_) { /* 서클 없는 판 */ }
const { ActivityLog, titleMatcher, focusByItem } = require('./svc/activity');

// IPC 처리기를 이름으로도 부를 수 있게 모아 둔다(폰에서 온 명령이 같은 처리기를 씀)
const HANDLERS = {};
function handle(ch, fn) { HANDLERS[ch] = fn; ipcMain.handle(ch, fn); }

const APP_DIR = __dirname;
const VERSION = require('./package.json').version;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// 저장 위치: 설치본·저장소에서 바로 실행 → 사용자 폴더(userData), 판별 개발본(versions\vX.Y) → 프로젝트의 data 폴더.
// HANNUNE_DATA 환경 변수가 있으면 그곳(시험·휴대용).
const PACKAGED = app.isPackaged;
const DEV_LAYOUT = !PACKAGED && /[\\/]versions[\\/]v[\d.]+$/.test(APP_DIR);
const DATA = process.env.HANNUNE_DATA || (DEV_LAYOUT ? path.resolve(APP_DIR, '..', '..', 'data') : path.join(app.getPath('userData'), 'data'));
if (process.env.HANNUNE_DATA) app.setPath('userData', path.join(process.env.HANNUNE_DATA, '_electron')); // 시험: 흔적을 한곳에
// v1.2.1부터 설치본 이름이 영문(Hannune)이 되어 저장 폴더가 바뀌었다 → 예전 폴더(한눈에 일정판)의 기록을 한 번 옮겨 온다
if (PACKAGED && !process.env.HANNUNE_DATA && !fs.existsSync(DATA)) {
  const old = path.join(app.getPath('appData'), '한눈에 일정판', 'data');
  try { if (fs.existsSync(old) && path.resolve(old) !== path.resolve(DATA)) fs.cpSync(old, DATA, { recursive: true }); } catch (_) { /* 옮기지 못해도 새로 시작 */ }
}
const HOME = os.homedir();
// HANNUNE_DEMO: 이 PC의 Claude 기록·최근 문서를 읽지 않는 보기용 실행(설명서 화면 찍기)
const DEMO = !!process.env.HANNUNE_DEMO;
const PROJECTS = DEMO ? path.join(os.tmpdir(), 'hannune-demo-none') : path.join(HOME, '.claude', 'projects');
const SELFTEST = process.argv.includes('--selftest');
const SELFTEST_AI = process.argv.includes('--ai');
const START_HIDDEN = process.argv.includes('--hidden');
const ICON = path.join(APP_DIR, 'assets', 'icon.png');
const TRAY_ICON = path.join(APP_DIR, 'assets', 'tray.png');

const F = {
  settings: path.join(DATA, 'settings.json'),
  user: path.join(DATA, 'user.json'),
  ai: path.join(DATA, 'ai.json'),
  sessions: path.join(DATA, 'cache', 'sessions.json'),
  docscan: path.join(DATA, 'cache', 'docscan.json'),
  board: path.join(DATA, 'cache', 'board.json'),
  fired: path.join(DATA, 'cache', 'fired_alarms.json'),
  ics: path.join(DATA, 'calendar', '한눈에_마감.ics'),
  phoneCal: path.join(DATA, 'calendar', 'phone_calendar.json'),
  activity: path.join(DATA, 'activity'),
  shots: path.join(DATA, 'cache', 'shots'),
};
for (const d of ['cache', 'calendar', 'activity', 'secret']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } }
// 판 종류: 공개 설치본은 만들 때 edition.json을 넣는다(무료 = 폰 연결·서클 없음, 새 판은 GitHub에서).
// 나중에 유료 판은 { name:'paid', paidUpdates:true, update:{ url } } 처럼 바꾸면 새 판을 라이선스 확인 뒤에만 받는다. 개발본에는 파일이 없다.
const EDITION = readJson(path.join(APP_DIR, 'edition.json'), null) || { name: PACKAGED ? 'free' : 'dev' };
const PHONE_ON = EDITION.phone !== false;
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v), 'utf8');
  fs.renameSync(tmp, f);
}
function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? deepMerge(base[k], v) : v;
  }
  return out;
}

const DEFAULTS = {
  roots: [], // 처음에는 비어 있고, 사용자가 "작업 폴더"를 고른다
  ui: { sideW: 236, detailW: 400, sideCollapsed: false, collapsed: {} },
  graph: { days: 14, height: 22, bar: 5, color: 'area', custom: '#2B4C7E' },
  nlp: { custom: [], learn: { on: true, exact: {}, votes: {} } }, // custom: [{ word, action, value }] · learn: 고친 것에서 배운 숫자 읽기
  // keys: 저장된 키 [{ id, name, provider, key, at }], profiles: 쓸 곳별 { keyId, model, base }. key·model·base는 예전 판용 사본
  agent: { provider: 'auto', keys: [], profiles: {}, key: '', model: '', base: '' },
  layout: 'list', theme: 'paper', sort: 'urgency',
  urgentDays: 7, importantMin: 4, dueTime: '18:00',
  idle: { enabled: true, inputSec: 180, action: 'front', cooldownMin: 30, quietStart: '22:00', quietEnd: '07:00' },
  alarms: { enabled: true, offsets: [1440, 300, 60], morning: false, scope: 'confirmed', digest: true },
  calendar: { ics: true, mode: 'script',
    script: { enabled: false, url: '', token: '' },
    google: { enabled: false, clientId: '', clientSecret: '', target: 'own', calendarId: '' } },
  docFolders: [], // [{ path, on, sub, area }]
  doneKeepDays: 3, hideDone: false,
  activity: { enabled: false, intervalSec: 5, keepDays: 30, idleCutSec: 120,
    excludeApps: ['KeePass', '1Password', 'Bitwarden', 'LastPass'],
    excludeWords: ['InPrivate', 'Incognito', '시크릿', '비밀번호', 'password', '은행', 'bank', '로그인', '인증서'] },
  ai: { model: 'sonnet', agent: 'same' }, // model은 Claude Code일 때, agent는 AI 정리에 쓸 곳(same = 위 AI 에이전트)
  // 음성: engine(auto=실시간→Groq→내 PC), quality(fast=실시간만 · check=다른 모델로 한 번 더 확인), autoSubmit(받아 적은 뒤 바로 넣기),
  //  speak(결과 읽어 주기), readBrief(쉴 때 화면 읽어 주기), tone(시작 소리), dict(발음 사전 [{say,write}]), learned(고친 것에서 배운 말 [{heard,fixed,n,at}])
  voice: { enabled: true, engine: 'auto', model: '', quality: 'fast', autoSubmit: false, speak: true, readBrief: false, tone: true, silenceMs: 1500, maxSec: 30, hotkey: true, voiceName: '', rate: 1.05, hintTitles: true, dict: [], learned: [], clovaId: '', clovaSecret: '', clovaUrl: '', micMode: 'std',
    // 비서: agentRate(기본 배속), agentAuto(상황 따라 자동), agentFollow(답한 뒤 이어서 듣기), agentVoice(목소리), agentMemory(기억한 것)
    agentRate: 1, agentAuto: true, agentFollow: true, agentVoice: 'Kore', agentMemory: [] },
  // 폰 연결: secret(비밀 열쇠 — QR로만 건넴), relay(중계 서버)
  phone: { enabled: false, secret: '', relay: process.env.HANNUNE_RELAY || 'https://hannune-link.zsdvvv.workers.dev' },
  phoneCal: { show: true, area: '폰 캘린더' }, // 폰 앱이 보낸 폰 캘린더(삼성 캘린더 등) 일정
  mini: { open: false, bounds: null, opacity: 0.97, count: 8 },
  main: { bounds: null, maximized: false, pinned: false },
  update: { auto: true, autoDownload: true, skip: '' }, // v1.11 새 판 받기: 자동 확인·찾으면 바로 받기·건너뛴 판
  license: { key: '' }, // 나중에 유료 판에서 새 판을 받을 때 쓰는 열쇠(지금은 쓰지 않음)
  circle: { aideAgent: 'same', aideModel: '', hamkkeUrl: '' }, // hamkkeUrl: 함께고침 주소(비우면 기본 주소) // v1.8 서클 비서에게 물을 때 쓸 AI(same = 위 AI 에이전트)
  closeToTray: true, autoStart: false, scanMin: 3,
};

let settings = deepMerge(DEFAULTS, readJson(F.settings, {}));
let user = deepMerge({ items: {}, manual: [], sessions: {} }, readJson(F.user, {}));
let ai = readJson(F.ai, {});
let sessCache = readJson(F.sessions, null);
let docCache = readJson(F.docscan, null);
let board = readJson(F.board, null);
let texts = {};
let inputs = null;
let mainWin = null, miniWin = null, tray = null;
let aiState = { running: false, msg: '' };

// 시험 찍기(--selftest)에서는 설정·사용자 기록을 디스크에 쓰지 않는다(시험 체크가 실제 기록을 바꾸지 않게)
const saveSettings = s => { settings = s; if (!SELFTEST) writeJson(F.settings, settings); };
const saveUser = () => { if (!SELFTEST) writeJson(F.user, user); };
// v1.2.1까지의 AI 설정(키·모델·주소 한 칸씩)을 저장된 키 목록으로 한 번 옮긴다
if (!settings.agent.vault) saveSettings({ ...settings, agent: llm.withMirror(llm.migrate(settings.agent)) });
// 판이 바뀌어 처음 켤 때 data(설정·내 기록·AI 결과)를 data\backup\에 남긴다 → 예전 판으로 돌아가도 그때 상태를 되살릴 수 있음(백업_복원.bat). 최근 12개만 둔다.
function backupOnUpgrade() {
  if (SELFTEST || settings._ver === VERSION) return;
  try {
    const dir = path.join(DATA, 'backup');
    const n = new Date(), p2 = x => String(x).padStart(2, '0');
    const stamp = `${n.getFullYear()}${p2(n.getMonth() + 1)}${p2(n.getDate())}-${p2(n.getHours())}${p2(n.getMinutes())}`; // 내 시계 기준
    const dst = path.join(dir, `${stamp}_v${settings._ver || '이전'}_to_v${VERSION}`);
    fs.mkdirSync(dst, { recursive: true });
    for (const f of [F.settings, F.user, F.ai]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dst, path.basename(f)));
    const old = fs.readdirSync(dir).filter(n => /^\d{8}-\d{4}_/.test(n)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 12))) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  } catch (_) { /* 백업을 못 해도 앱은 켠다 */ }
  saveSettings({ ...settings, _ver: VERSION });
}
backupOnUpgrade();
const TEST_FOLDER = (process.argv.find(a => a.startsWith('--found-folder=')) || '').slice(15);
if (SELFTEST && TEST_FOLDER) settings.docFolders = [{ path: TEST_FOLDER, on: true, sub: true }];

// 시험 찍기: 창이 다른 창에 가려져도 계속 그리게(가려지면 화면이 멈춰 캡처가 옛 화면이 됨)
if (SELFTEST) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// AI 에이전트: 설정에서 고른 곳(Claude Code·Gemini·Groq·OpenRouter·Ollama …)으로 부른다.
// AI 정리·찾은 일정 다듬기는 'AI 정리 › 쓸 곳'(ai.agent)을 따로 고를 수 있다(same이면 위 AI 에이전트와 같음).
function agentFor(task) {
  const p = (task === 'organize' || task === 'found') && settings.ai.agent && settings.ai.agent !== 'same' ? settings.ai.agent : null;
  return p ? { ...settings.agent, provider: p } : settings.agent;
}
useLLM(args => llm.callLLM(agentFor(args.task), { ...args, model: settings.ai.model }));

// ---------- 보내기 ----------
function send(win, ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function broadcast(ch, data) { send(mainWin, ch, data); send(miniWin, ch, data); }

// ---------- 창 사용 기록(선택) ----------
const activity = new ActivityLog({
  dir: F.activity,
  script: path.join(APP_DIR, 'svc', 'fgwin.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), // 설치본: 풀어 둔 사본
  getSettings: () => settings,
  getIdleSec: () => powerMonitor.getSystemIdleTime(),
  onChange: st => broadcast('activity', { ...st, item: currentItemFor(st.title) }),
});
let matchTitle = () => null;
function currentItemFor(title) {
  const id = matchTitle(title);
  const it = id && board && board.items.find(x => x.id === id);
  return it ? { id, title: it.title } : null;
}

// ---------- 읽기·조립 ----------
const notesCache = new Map();
function readNotesFor(items) {
  const out = {};
  for (const it of items) {
    if (!it.primary) continue;
    let st;
    try { st = fs.statSync(it.primary); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    const c = notesCache.get(it.primary);
    if (c && c.dirMt === st.mtimeMs) { if (c.n) out[it.id] = c.n; continue; }
    const n = readProjectNotes(it.primary);
    notesCache.set(it.primary, { dirMt: st.mtimeMs, n });
    if (n) out[it.id] = n;
  }
  return out;
}

function focusMap() {
  try {
    if (!fs.readdirSync(F.activity).some(n => n.endsWith('.jsonl')) && !activity.running()) return {};
  } catch (_) { return {}; }
  return focusByItem(activity.readDays(14), matchTitle);
}

function rebuild() {
  if (!inputs) return;
  const b = buildBoard({ ...inputs, sessions: sessCache ? sessCache.sessions : {}, user, ai, settings, focus: focusMap(), phoneCal });
  texts = b.texts;
  delete b.texts;
  b.version = VERSION;
  b.scannedAt = inputs.scannedAt;
  board = b;
  matchTitle = titleMatcher(board.items);
  if (!SELFTEST) writeJson(F.board, board);
  broadcast('board', board);
  scheduleCalendar();
  if (phone) phone.boardChanged();
}

let scanning = null;
function scan() {
  if (scanning) return scanning;
  scanning = (async () => {
    broadcast('scan', { busy: true });
    const rootsInfo = listRootChildren(settings.roots);
    const memories = readMemories(PROJECTS).filter(m => m.type === 'project');
    const { prefixes, prefixHash, claims } = prefixesFor(memories, rootsInfo);
    const r = await scanSessions({ projectsDir: PROJECTS, prefixes, prefixHash, cache: sessCache, homeDir: HOME });
    sessCache = r.cache;
    if (r.changed) writeJson(F.sessions, sessCache);
    let recent = [];
    if (IS_WIN) { try { recent = recentItems(p => shell.readShortcutLink(p).target); } catch (_) { /* 없음 */ } }
    if (DEMO) recent = [];
    inputs = { memories, rootsInfo, claims, recent, vscode: DEMO ? [] : vscodeRecents(), notes: {}, scannedAt: Date.now(),
      found: docCache ? docfind.flatten(docCache) : [], foundStats: docCache ? docfind.fileStats(docCache) : null };
    rebuild();
    inputs.notes = readNotesFor(board.items);
    rebuild();
    await scanDocs(false);
  })().catch(e => broadcast('toast', { kind: 'error', text: '읽기 실패: ' + e.message }))
    .finally(() => { scanning = null; broadcast('scan', { busy: false, at: Date.now() }); });
  return scanning;
}

// 지정 폴더의 문서에서 일정 찾기(바뀐 문서만 다시 읽음)
let docScanning = null;
function scanDocs(alone = true) {
  if (docScanning) return docScanning;
  docScanning = (async () => {
    const folders = (settings.docFolders || []).filter(f => f.on);
    if (!folders.length && !(docCache && Object.keys(docCache.files || {}).length)) return;
    broadcast('found:scan', { busy: true, done: 0 });
    const r = await docfind.findInFolders({ folders, cache: docCache, onProgress: n => broadcast('found:scan', { busy: true, done: n }) });
    docCache = r.cache;
    if (r.changed || alone) writeJson(F.docscan, docCache);
    if (inputs) { inputs.found = docfind.flatten(docCache); inputs.foundStats = docfind.fileStats(docCache); rebuild(); }
  })().catch(e => broadcast('toast', { kind: 'error', text: '문서 읽기 실패: ' + e.message }))
    .finally(() => { docScanning = null; broadcast('found:scan', { busy: false }); });
  return docScanning;
}

async function runAI(force) {
  if (aiState.running) return { ok: false, msg: '이미 정리하는 중입니다.' };
  if (!llm.ready(agentFor('organize'))) { aiState = { running: false, msg: 'AI 정리에 쓸 곳이 준비되지 않았습니다 — 설정 › AI 에이전트·AI 정리에서 고를 수 있습니다(무료 Gemini 키도 됨).' }; broadcast('ai', aiState); return aiState; }
  if (!board) await scan();
  aiState = { running: true, msg: '준비 중…' };
  broadcast('ai', aiState);
  try {
    const r = await analyze({ board, texts, ai, model: settings.ai.model, force,
      onProgress: msg => { aiState.msg = msg; broadcast('ai', aiState); },
      log: rec => { try { fs.appendFileSync(path.join(DATA, 'cache', 'ai_log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n', 'utf8'); } catch (_) { /* 기록 실패는 넘어감 */ } } });
    ai = r.ai;
    writeJson(F.ai, ai);
    rebuild();
    aiState = { running: false, msg: r.errors.length ? `일부 실패(${r.errors.length}): ${r.errors[0]}` : `정리 끝 · ${r.count}개 읽음`, at: Date.now() };
  } catch (e) {
    aiState = { running: false, msg: 'AI 정리 실패: ' + e.message };
  }
  broadcast('ai', aiState);
  return aiState;
}

// ---------- 캘린더 ----------
const google = new cal.GoogleCalendar(DATA, () => settings, saveSettings, url => shell.openExternal(url));
const gscript = new cal.ScriptCalendar(() => settings);
let calTimer = null, lastGoogleSig = '', calErrorTold = '';
function scheduleCalendar() { clearTimeout(calTimer); calTimer = setTimeout(() => syncCalendar(false), 4000); }
function calStatus(extra) {
  const all = board ? cal.entries(board, { ...settings, alarms: { ...settings.alarms, scope: 'all' } }).length : 0;
  const count = board ? cal.entries(board, settings).length : 0;
  return { mode: settings.calendar.mode, script: gscript.status(), ...google.status(), icsFile: F.ics, allCount: all, count, ...extra };
}
async function syncCalendar(force) {
  if (!board) return null;
  const list = cal.entries(board, settings);
  let icsCount = 0;
  if (settings.calendar.ics) { try { icsCount = cal.writeIcs(list, F.ics); } catch (_) { /* 넘어감 */ } }
  const sig = crypto.createHash('sha1').update(JSON.stringify(list.map(e => [e.uid, e.summary, e.start, e.offsets]))).digest('hex');
  let last = null;
  if (!SELFTEST && (force || sig !== lastGoogleSig)) {
    if (settings.calendar.mode === 'script' && settings.calendar.script.enabled && gscript.ready()) {
      last = await gscript.sync(list);
      if (!last.errors.length) lastGoogleSig = sig;
    } else if (settings.calendar.mode === 'oauth' && settings.calendar.google.enabled && google.connected()) {
      try { await google.sync(list); lastGoogleSig = sig; } catch (e) { google.lastResult = { at: Date.now(), errors: [e.message] }; }
      last = google.lastResult;
    }
    // 연결이 끊기면 한 번만 알린다
    const err = last && last.errors && last.errors[0];
    if (err && err !== calErrorTold) { calErrorTold = err; notify('구글 캘린더에 넣지 못했습니다', err + '\n설정 › 캘린더에서 확인해 주세요.', null); }
    if (last && !err) calErrorTold = '';
  }
  const st = calStatus({ icsCount, count: list.length });
  broadcast('cal', st);
  return st;
}

// ---------- PC 알람 ----------
let fired = readJson(F.fired, {});
function whenText(m) {
  if (m % 1440 === 0) return m === 1440 ? '내일' : `${m / 1440}일 뒤`;
  if (m >= 60) return `${Math.round(m / 6) / 10}시간 뒤`;
  return `${m}분 뒤`;
}
function notify(title, body, itemId) {
  if (SELFTEST || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  n.on('click', () => { showMain(); if (itemId) send(mainWin, 'select', itemId); });
  n.show();
}
function checkAlarms() {
  if (!board || !settings.alarms.enabled) return;
  const now = Date.now();
  let changed = false;
  for (const e of cal.entries(board, settings)) {
    for (const m of e.offsets) {
      const at = e.start.getTime() - m * 60000;
      const key = `${e.uid}|${e.date}|${e.time}|${m}`;
      if (fired[key] || now < at) continue;
      if (now - at < 30 * 60000) notify(`${whenText(m)} ${e.kind === 'event' ? '일정' : '마감'} · ${e.label}`, `${e.title}\n${e.date} ${e.time}`, e.itemId);
      fired[key] = now;
      changed = true;
    }
  }
  const today = new Date().toDateString();
  if (settings.alarms.digest && fired._digest !== today) {
    const items = board.items.filter(it => !it.hidden && (it.band === 'overdue' || it.band === 'today' || it.band === 'd3'));
    if (items.length) notify(`오늘 챙길 일 ${items.length}개`, items.slice(0, 4).map(it => `${it.days === 0 ? '오늘' : it.days < 0 ? `${-it.days}일 지남` : 'D-' + it.days} ${it.title}`).join('\n'), null);
    fired._digest = today;
    changed = true;
  }
  if (changed) {
    for (const [k, v] of Object.entries(fired)) if (k !== '_digest' && now - v > 40 * 86400000) delete fired[k];
    writeJson(F.fired, fired);
  }
}

// ---------- 쉴 때 알림 ----------
const brief = { active: false, last: 0, prev: null, backAt: 0 };
function minutesOf(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
function inQuiet() {
  const s = settings.idle;
  if (!s.quietStart || !s.quietEnd || s.quietStart === s.quietEnd) return false;
  const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
  const a = minutesOf(s.quietStart), b = minutesOf(s.quietEnd);
  return a < b ? (now >= a && now < b) : (now >= a || now < b);
}
function showBrief(reason) {
  if (!mainWin) createMain();
  brief.prev = { visible: mainWin.isVisible() && !mainWin.isMinimized(), bounds: mainWin.getBounds(), max: mainWin.isMaximized() };
  brief.active = true;
  brief.last = Date.now();
  brief.backAt = 0;
  if (mainWin.isMinimized()) mainWin.restore();
  if (settings.idle.action === 'full') {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (mainWin.isMaximized()) mainWin.unmaximize();
    mainWin.setBounds(d.workArea);
  }
  mainWin.show();
  mainWin.setAlwaysOnTop(true, 'screen-saver');
  mainWin.moveTop();
  mainWin.focus();
  send(mainWin, 'brief', { show: true, reason });
}
function dismissBrief(keep) {
  if (!brief.active) return;
  brief.active = false;
  const p = brief.prev || {};
  mainWin.setAlwaysOnTop(!!settings.main.pinned);
  if (settings.idle.action === 'full' && p.bounds) { if (p.max) mainWin.maximize(); else mainWin.setBounds(p.bounds); }
  if (!keep && !p.visible) mainWin.hide();
  send(mainWin, 'brief', { show: false });
}
function idleTick() {
  const idle = powerMonitor.getSystemIdleTime();
  if (brief.active) {
    if (idle < 2) {
      if (!brief.backAt) brief.backAt = Date.now();
      else if (Date.now() - brief.backAt > 120000) dismissBrief(false);
    } else brief.backAt = 0;
    return;
  }
  const s = settings.idle;
  if (!s.enabled || !board || SELFTEST) return;
  if (powerMonitor.getSystemIdleState(1) === 'locked') return;
  if (inQuiet()) return;
  if (idle >= s.inputSec && Date.now() - brief.last > s.cooldownMin * 60000) showBrief('idle');
}

// ---------- 창 ----------
const THEME = {
  paper: { bg: '#F4F1EA', sym: '#1F2430' },
  night: { bg: '#16181D', sym: '#E9E6DF' },
};
function themeColors() { return THEME[settings.theme] || THEME.paper; }

// 저장된 창 위치가 지금 붙어 있는 모니터 밖이면(모니터를 뺐을 때) 주 모니터 가운데로
function onSomeDisplay(b) {
  return screen.getAllDisplays().some(d => {
    const w = d.workArea;
    const ix = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const iy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return ix > 120 && iy > 80;
  });
}

function createMain() {
  const t = themeColors();
  let b = settings.main.bounds || { width: 1380, height: 880 };
  if (b.x !== undefined && !onSomeDisplay(b)) b = { width: b.width, height: b.height };
  // 서클 자동 시험 창은 화면 밖에 띄운다. 실제 커서가 지나가 결과가 흔들리지 않고, 사용자 일을 가리지도 않는다.
  const OFFSCREEN = !!process.env.CIRCLE_TEST_OFFSCREEN;
  if (OFFSCREEN) b = { width: 1640, height: 960, x: -4000, y: 30 };
  mainWin = new BrowserWindow({
    ...b, minWidth: 560, minHeight: 420, show: false, title: '한눈에', icon: ICON, // 작게 줄이면 화면에 가로·세로 스크롤이 생긴다
    backgroundColor: t.bg, titleBarStyle: 'hidden', titleBarOverlay: { color: t.bg, symbolColor: t.sym, height: 44 },
    webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  mainWin.setMenu(null);
  if (SELFTEST) mainWin.webContents.on('console-message', (e, level, msg, line, src) => {
    const m = e && e.message !== undefined ? e : { level, message: msg, lineNumber: line, sourceId: src };
    if (m.level === 'error' || m.level === 'warning' || m.level >= 2) console.log('renderer:', m.message, String(m.sourceId || '').split('/').pop() + ':' + m.lineNumber);
  });
  mainWin.loadFile(path.join(APP_DIR, 'ui', 'index.html'));
  if (settings.main.maximized) mainWin.maximize();
  mainWin.setAlwaysOnTop(!!settings.main.pinned);
  mainWin.once('ready-to-show', () => { if (OFFSCREEN) mainWin.showInactive(); else if (!START_HIDDEN && !SELFTEST) mainWin.show(); });
  const saveBounds = () => {
    if (!mainWin || brief.active) return;
    settings.main.maximized = mainWin.isMaximized();
    if (!mainWin.isMaximized() && !mainWin.isMinimized()) settings.main.bounds = mainWin.getBounds();
    saveSettings(settings);
  };
  let bt;
  mainWin.on('resize', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
  mainWin.on('move', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
  mainWin.on('close', e => {
    if (app.isQuitting || !settings.closeToTray) return;
    e.preventDefault();
    if (brief.active) dismissBrief(false);
    mainWin.hide();
    if (!settings._trayTold) {
      notify('한눈에는 계속 돌고 있습니다', '오른쪽 아래 트레이 아이콘이나 Ctrl+Alt+H로 다시 엽니다.', null);
      settings._trayTold = true;
      saveSettings(settings);
    }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function showMain() {
  if (!mainWin) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createMini() {
  if (miniWin) { miniWin.show(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const b = settings.mini.bounds || { width: 320, height: 460, x: wa.x + wa.width - 336, y: wa.y + 16 };
  miniWin = new BrowserWindow({
    ...b, minWidth: 240, minHeight: 200, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, minimizable: false, maximizable: false, fullscreenable: false, title: '한눈에 미니', icon: ICON,
    backgroundColor: themeColors().bg, show: false,
    webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  miniWin.setAlwaysOnTop(true, 'floating');
  miniWin.setOpacity(Math.max(0.5, Math.min(1, settings.mini.opacity || 1)));
  miniWin.loadFile(path.join(APP_DIR, 'ui', 'mini.html'));
  miniWin.once('ready-to-show', () => { if (!SELFTEST) miniWin.showInactive(); });
  let bt;
  const save = () => { if (miniWin && !SELFTEST) { settings.mini.bounds = miniWin.getBounds(); saveSettings(settings); } };
  miniWin.on('move', () => { clearTimeout(bt); bt = setTimeout(save, 500); });
  miniWin.on('resize', () => { clearTimeout(bt); bt = setTimeout(save, 500); });
  miniWin.on('closed', () => { miniWin = null; });
  if (SELFTEST) return;
  settings.mini.open = true;
  saveSettings(settings);
  refreshTray();
}
function closeMini() {
  if (miniWin) miniWin.close();
  settings.mini.open = false;
  saveSettings(settings);
  refreshTray();
}
function togglePin(v) {
  settings.main.pinned = v === undefined ? !settings.main.pinned : !!v;
  saveSettings(settings);
  if (mainWin) mainWin.setAlwaysOnTop(settings.main.pinned);
  broadcast('settings', settings);
  refreshTray();
}

// 모니터 번호: 왼쪽 → 오른쪽(같으면 위 → 아래) 순서. 윈도우 디스플레이 설정의 배치 그림과 같은 순서다.
function displaysInOrder() {
  return [...screen.getAllDisplays()].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}
// 본 창을 고른 모니터의 가운데로. 화면보다 크면 줄이고, 최대화·전체 화면은 풀고 옮긴다.
function centerOn(d) {
  showMain();
  if (mainWin.isFullScreen()) mainWin.setFullScreen(false);
  if (mainWin.isMaximized()) mainWin.unmaximize();
  const wa = d.workArea;
  const cur = mainWin.getBounds();
  const w = Math.min(cur.width, wa.width - 40), h = Math.min(cur.height, wa.height - 40);
  const nb = { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h };
  mainWin.setBounds(nb);
  // 배율(DPI)이 다른 모니터로 옮기면 크기가 한 번 어긋나므로 다시 맞춘다
  setTimeout(() => { if (mainWin) mainWin.setBounds(nb); }, 120);
  mainWin.focus();
}
function monitorItems() {
  const ds = displaysInOrder();
  const primary = screen.getPrimaryDisplay().id;
  const here = mainWin && mainWin.isVisible() ? screen.getDisplayMatching(mainWin.getBounds()).id : null;
  return ds.map((d, i) => ({
    label: `모니터 ${i + 1}${d.label ? ' · ' + d.label : ''} — ${d.size.width}×${d.size.height}${d.id === primary ? ' (주)' : ''}${d.id === here ? '  ← 지금' : ''}`,
    click: () => centerOn(d),
  }));
}

function trayMenu() {
  const mons = monitorItems();
  return Menu.buildFromTemplate([
    { label: '한눈에 열기', click: showMain },
    mons.length > 1
      ? { label: '본 창을 모니터 가운데로', submenu: mons }
      : { label: '본 창을 화면 가운데로', click: () => centerOn(screen.getPrimaryDisplay()) },
    { label: '말로 넣기 (Ctrl+Alt+V)', click: () => startVoice('quick') },
    { label: '비서에게 말하기 (Ctrl+Alt+B)', click: () => startAgent() },
    ...(PHONE_ON ? [{ label: phoneTrayLabel(), click: () => { showMain(); send(mainWin, 'voice', { openPhone: true }); } }] : []),
    { label: '미니 창', type: 'checkbox', checked: !!miniWin, click: () => (miniWin ? closeMini() : createMini()) },
    { label: '본 창 항상 위', type: 'checkbox', checked: !!settings.main.pinned, click: () => togglePin() },
    { type: 'separator' },
    { label: '다시 읽기', click: () => scan() },
    ...(updater.mode === 'dev' || updater.mode === 'off' ? [] : [updater.state().status === 'ready'
      ? { label: `새 판 ${updater.state().latest} ${process.platform === 'darwin' ? '열기' : '설치하고 다시 켜기'}`, click: () => updater.install() }
      : { label: '새 판 확인', click: () => { showMain(); updater.check(true); send(mainWin, 'update:open', updater.state()); } }]),
    { label: '쉴 때 알림', type: 'checkbox', checked: !!settings.idle.enabled, click: () => applySettings({ idle: { enabled: !settings.idle.enabled } }) },
    { label: '창 사용 기록 (선택 기능)', type: 'checkbox', checked: !!settings.activity.enabled, click: () => applySettings({ activity: { enabled: !settings.activity.enabled } }) },
    { type: 'separator' },
    { label: '끝내기', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
// 오른쪽 클릭할 때마다 메뉴를 새로 만든다(모니터를 꽂거나 뺀 것을 바로 반영)
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`한눈에 일정판 v${VERSION}` + (settings.activity.enabled ? ' · 창 기록 중' : ''));
}

function applySettings(patch) {
  const prev = settings;
  settings = deepMerge(settings, patch);
  if (patch && patch.agent) settings.agent = llm.withMirror(settings.agent);
  saveSettings(settings);
  if (IS_WIN && settings.activity.enabled && !activity.running()) activity.start();
  if (!settings.activity.enabled && activity.running()) activity.stop();
  if (prev.theme !== settings.theme) {
    const t = themeColors();
    if (mainWin) { mainWin.setBackgroundColor(t.bg); try { mainWin.setTitleBarOverlay({ color: t.bg, symbolColor: t.sym }); } catch (_) { /* 미지원 */ } }
    if (miniWin) miniWin.setBackgroundColor(t.bg);
  }
  if (miniWin) miniWin.setOpacity(Math.max(0.5, Math.min(1, settings.mini.opacity || 1)));
  if (prev.autoStart !== settings.autoStart) setAutoStart();
  if (JSON.stringify(prev.roots) !== JSON.stringify(settings.roots)) scan();
  else rebuild();
  broadcast('settings', settings);
  refreshTray();
  return settings;
}

// 부팅 시 실행: C:에 둔 작은 시작 스크립트가 작업 드라이브(USB)가 붙을 때까지 최대 3분 기다렸다가
// 프로젝트의 실행.bat(늘 최신판)을 창 없이 --hidden 으로 켠다. 등록 위치: HKCU\...\Run "한눈에 일정판"
const PROJECT_ROOT = path.resolve(APP_DIR, '..', '..');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME = '한눈에 일정판';
const BOOT_VBS = path.join(process.env.LOCALAPPDATA || HOME, 'hannune', '한눈에_자동시작.vbs');
function setAutoStart() {
  if (SELFTEST) return;
  // 설치본(윈도우·맥)·저장소 실행: 운영체제의 로그인 항목에 바로 등록
  if (!DEV_LAYOUT || !IS_WIN) {
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, openAsHidden: true, args: ['--hidden'] });
    return;
  }
  const { spawnSync } = require('child_process');
  if (settings.autoStart) {
    const bat = path.join(PROJECT_ROOT, '실행.bat');
    const vbs = [
      "' 한눈에 일정판 부팅 시 실행 (앱 설정 '윈도우 켤 때 자동 실행'이 만든 파일)",
      "' 작업 드라이브가 붙을 때까지 최대 3분 기다린 뒤 실행.bat 을 창 없이 --hidden 으로 켠다",
      'Option Explicit',
      'Dim fso, sh, bat, i',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'Set sh = CreateObject("WScript.Shell")',
      `bat = "${bat}"`,
      'For i = 1 To 90',
      '  If fso.FileExists(bat) Then Exit For',
      '  WScript.Sleep 2000',
      'Next',
      'If Not fso.FileExists(bat) Then WScript.Quit',
      'On Error Resume Next',
      'sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"',
      'On Error GoTo 0',
      'sh.Run "cmd /c """"" & bat & """ --hidden""", 0, False',
    ].join('\r\n') + '\r\n';
    fs.mkdirSync(path.dirname(BOOT_VBS), { recursive: true });
    // 한글 경로가 들어 있어 UTF-16(BOM)으로 저장해야 wscript가 바르게 읽는다
    fs.writeFileSync(BOOT_VBS, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(vbs, 'utf16le')]));
    spawnSync('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', `wscript.exe "${BOOT_VBS}"`, '/f'], { windowsHide: true });
  } else {
    spawnSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { windowsHide: true });
  }
  // Electron 자체 로그인 항목은 쓰지 않는다(판이 고정되고 두 번 켜질 수 있음)
  app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [APP_DIR, '--hidden'] });
}

// 윈도우 알림이 "한눈에" 이름으로 뜨려면 시작 메뉴 바로가기에 앱 ID가 있어야 한다
// (설치본은 설치 프로그램이 바로가기를 만들므로 개발본에서만)
const AUMID = PACKAGED ? 'io.github.hannune' : 'hannune.dev';
function ensureStartMenuShortcut() {
  // 시험·휴대용 실행(HANNUNE_DATA)은 사용자의 시작 메뉴 바로가기를 건드리지 않는다(시험 판을 가리키게 바뀐 일이 있었다)
  if (!IS_WIN || !DEV_LAYOUT || process.env.HANNUNE_DATA) return;
  const lnk = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', '한눈에 일정판.lnk');
  try {
    const want = { target: process.execPath, args: `"${APP_DIR}"`, appUserModelId: AUMID, icon: path.join(APP_DIR, 'assets', 'icon.ico'), iconIndex: 0, description: '한눈에 일정판' };
    let cur = null;
    try { cur = shell.readShortcutLink(lnk); } catch (_) { /* 없음 */ }
    if (!cur || cur.args !== want.args || cur.target !== want.target) shell.writeShortcutLink(lnk, cur ? 'replace' : 'create', want);
  } catch (_) { /* 알림은 이름 없이도 뜬다 */ }
}

// ---------- 열기 ----------
function vscodeExe() {
  const c = IS_MAC ? '/Applications/Visual Studio Code.app' : path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
  return fs.existsSync(c) ? c : null;
}
function existingDir(p) {
  let cur = p;
  for (let i = 0; i < 6 && cur; i++) {
    try { if (fs.statSync(cur).isDirectory()) return cur; } catch (_) { /* 위로 */ }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

// ---------- IPC ----------
handle('board:get', () => board);
handle('settings:get', () => settings);
handle('settings:set', (_e, patch) => applySettings(patch));
handle('scan', () => scan().then(() => true));
handle('ai:run', (_e, force) => runAI(!!force));
handle('ai:state', () => aiState);

handle('item:set', (_e, id, patch) => {
  const cur = user.items[id] || {};
  user.items[id] = { ...cur, ...patch };
  for (const k of Object.keys(user.items[id])) if (user.items[id][k] === null) delete user.items[id][k];
  saveUser(); rebuild(); return true;
});
handle('dl:set', (_e, id, date, patch) => {
  const cur = user.items[id] || (user.items[id] = {});
  cur.dl = cur.dl || {};
  cur.dl[date] = { ...(cur.dl[date] || {}), ...patch };
  for (const k of Object.keys(cur.dl[date])) if (cur.dl[date][k] === null) delete cur.dl[date][k];
  if (cur.myDeadlines && patch.time !== undefined) for (const d of cur.myDeadlines) if (d.date === date) d.time = patch.time;
  if (patch.time !== undefined) learnFrom(id, myDue(id, date) || { date, time: patch.time || '' });
  saveUser(); rebuild(); return true;
});
handle('dl:add', (_e, id, d) => {
  const cur = user.items[id] || (user.items[id] = {});
  cur.myDeadlines = (cur.myDeadlines || []).filter(x => x.date !== d.date).concat([{ date: d.date, time: d.time || '', label: d.label || '마감', kind: d.kind || 'deadline' }]);
  if (cur.dl && cur.dl[d.date]) delete cur.dl[d.date].rejected;
  learnFrom(id, myDue(id, d.date));
  saveUser(); rebuild(); return true;
});
handle('dl:removeMine', (_e, id, date) => {
  const cur = user.items[id];
  if (cur && cur.myDeadlines) cur.myDeadlines = cur.myDeadlines.filter(x => x.date !== date);
  saveUser(); rebuild(); return true;
});
handle('manual:add', (_e, m) => {
  const id = 'u:' + crypto.randomBytes(5).toString('hex');
  user.manual.push({ id, title: m.title, area: m.area || '개인', note: m.note || '', created: Date.now() });
  user.items[id] = { imp: m.imp || 0, ...(m.date ? { myDeadlines: [{ date: m.date, time: m.time || '', label: m.label || (m.kind === 'event' ? '일정' : '마감'), kind: m.kind || 'deadline' }] } : {}) };
  if (typeof m.src === 'string' && m.src.trim()) noteInput(id, m.src, m);
  saveUser(); rebuild(); return id;
});

// ---------- 고친 것에서 배우기 ----------
// 바로 넣기·말로 넣기(PC·미니·폰)로 넣은 글과 그때 숫자를 어떻게 읽었는지 적어 둔다(14일, 300개까지).
// 그 안에 날짜·시각을 고쳤는데 고친 값이 같은 숫자의 다른 읽기와 같으면(260101 → 26년 1월 1일 ↔ 1월 26일 1시)
// 그 읽기를 배운다. 똑같은 숫자는 바로, 같은 모양(여섯 자리 등)은 두 번 이상 같은 쪽으로 고치면 모양 전체가 따라간다.
const LEARN_DAYS = 14;
function noteInput(id, text, m) {
  const t = String(text).slice(0, 300);
  const r = NLP.parse(t, { mode: 'quick', custom: settings.nlp.custom, learn: settings.nlp.learn });
  if (!r.toks || !r.toks.length) return;
  user.inputs = user.inputs || {};
  user.inputs[id] = { text: t, at: Date.now(), day: NLP.ymd(new Date()), toks: r.toks.map(k => ({ text: k.text, shape: k.shape, as: k.as })), date: m.date || '', time: m.time || '' };
  const keys = Object.keys(user.inputs);
  if (keys.length > 300) for (const k of keys.sort((a, b) => user.inputs[a].at - user.inputs[b].at).slice(0, keys.length - 300)) delete user.inputs[k];
}
function learnFrom(id, after) {
  const e = user.inputs && user.inputs[id];
  if (!e || !after) return;
  if (Date.now() - e.at > LEARN_DAYS * 864e5) { delete user.inputs[id]; return; }
  const L = settings.nlp.learn || {};
  if (L.on === false) return;
  const ls = NLP.lessonFrom(e, after);
  if (!ls) return;
  delete user.inputs[id];
  settings.nlp.learn = NLP.teach(L, ls, Date.now());
  saveSettings(settings);
  broadcast('settings', settings);
  broadcast('toast', { kind: '', text: `배웠습니다: 앞으로 ‘${ls.text}’을 ${NLP.describeRead(ls)}처럼 ${NLP.READ_NAME[ls.as]}로 읽습니다 · 설정 › 글로 바꾸기에서 지울 수 있습니다` });
}
// 지금 그 일의 내 마감(날짜·시각) — 고친 뒤 값
function myDue(id, date) {
  const u = user.items[id];
  const list = (u && u.myDeadlines) || [];
  const d = (date && list.find(x => x.date === date)) || (list.length === 1 ? list[0] : null);
  return d ? { date: d.date, time: d.time || '' } : null;
}
handle('nlp:learned', () => {
  const L = settings.nlp.learn || {};
  return {
    on: L.on !== false,
    exact: Object.entries(L.exact || {}).map(([text, v]) => { const as = typeof v === 'string' ? v : v.as; const nr = NLP.numReads(text); return { text, as, name: NLP.READ_NAME[as] || as, shape: nr ? nr.shape : '', example: nr && nr.reads[as] ? NLP.describeRead(nr.reads[as]) : '', at: (v && v.at) || 0 }; }).sort((a, b) => b.at - a.at),
    votes: Object.entries(L.votes || {}).map(([shape, v]) => ({ shape, shapeName: NLP.SHAPE_NAME[shape] || shape, counts: Object.entries(v).map(([as, n]) => ({ as, name: NLP.READ_NAME[as] || as, n })).sort((a, b) => b.n - a.n) })),
    pending: Object.keys(user.inputs || {}).length,
  };
});
// 배운 것 지우기: { text } 하나, { shape } 모양 표, { all: true } 전부
handle('nlp:forget', (_e, w = {}) => {
  const L = settings.nlp.learn = { on: true, exact: {}, votes: {}, ...(settings.nlp.learn || {}) };
  L.exact = { ...(L.exact || {}) }; L.votes = { ...(L.votes || {}) };
  if (w.all) { L.exact = {}; L.votes = {}; }
  if (w.text) delete L.exact[w.text];
  if (w.shape) delete L.votes[w.shape];
  saveSettings(settings); broadcast('settings', settings); rebuild();
  return true;
});

// 변경 창에서 한꺼번에 바꾸기. dl: { from(지금 날짜|null), src, key(문서 일정), date, time, label, kind, remove, addNew }
handle('item:apply', (_e, id, ch) => {
  const u = user.items[id] || (user.items[id] = {});
  const setOrDel = (k, v) => { if (v === null || v === undefined || v === '' || v === false || v === 0) delete u[k]; else u[k] = v; };
  if ('title' in ch) setOrDel('title', ch.title);
  if ('area' in ch) setOrDel('area', ch.area);
  if ('group' in ch) setOrDel('group', ch.group);
  if ('imp' in ch) setOrDel('imp', ch.imp);
  if ('hidden' in ch) setOrDel('hidden', ch.hidden);
  if ('done' in ch) {
    if (ch.done) { u.done = true; u.doneAt = Date.now(); u.doneBand = ch.doneBand || 'none'; delete u.active; }
    else { delete u.done; delete u.doneAt; delete u.doneBand; if (ch.wasAiDone) u.active = true; }
  }
  if (ch.dl) {
    const d = ch.dl;
    const from = d.from || null;
    u.dl = u.dl || {};
    u.myDeadlines = u.myDeadlines || [];
    const mine = u.myDeadlines.find(x => x.date === from);
    if (d.remove && from) {
      if (d.src === 'doc' && d.key) { user.found = user.found || {}; user.found[d.key] = { ...(user.found[d.key] || {}) }; delete user.found[d.key].on; }
      else if (mine) u.myDeadlines = u.myDeadlines.filter(x => x !== mine);
      else u.dl[from] = { ...(u.dl[from] || {}), rejected: true };
    } else if (d.src === 'doc' && d.key && !d.addNew) {
      user.found = user.found || {};
      user.found[d.key] = { ...(user.found[d.key] || {}), on: true, date: d.date, time: d.time || null, label: d.label || null };
    } else if (d.date && (d.addNew || !from)) {
      u.myDeadlines = u.myDeadlines.filter(x => x.date !== d.date).concat([{ date: d.date, time: d.time || '', label: d.label || '마감', kind: d.kind || 'deadline' }]);
      if (u.dl[d.date]) delete u.dl[d.date].rejected;
    } else if (d.date && from && d.date !== from) {
      // 날짜 옮기기: 내가 넣은 마감은 그대로 옮기고, AI·글에서 찾은 마감은 옛 날짜를 빼고 새로 넣는다(확정)
      if (mine) Object.assign(mine, { date: d.date, time: d.time || mine.time, label: d.label || mine.label, kind: d.kind || mine.kind });
      else {
        u.dl[from] = { ...(u.dl[from] || {}), rejected: true };
        u.myDeadlines = u.myDeadlines.filter(x => x.date !== d.date).concat([{ date: d.date, time: d.time || '', label: d.label || '마감', kind: d.kind || 'deadline' }]);
      }
      if (u.dl[d.date]) delete u.dl[d.date].rejected;
    } else if (from) {
      if (mine) Object.assign(mine, { time: d.time ?? mine.time, label: d.label || mine.label, kind: d.kind || mine.kind });
      u.dl[from] = { ...(u.dl[from] || {}), ...(d.time !== undefined ? { time: d.time } : {}), ...(d.label ? { label: d.label } : {}), confirmed: true };
    }
    if (!u.myDeadlines.length) delete u.myDeadlines;
    if (!d.remove && d.src !== 'doc') learnFrom(id, myDue(id, d.date || from));
  }
  for (const k of Object.keys(u)) if (u[k] === null || u[k] === undefined) delete u[k];
  saveUser(); rebuild(); return true;
});

// 글로 쓴 변경 요청을 AI 에이전트로 해석(규칙 해석기를 돕는 용도)
handle('nl:ai', async (_e, text, cur) => {
  if (!llm.ready(settings.agent)) return { ok: false, msg: 'AI 에이전트가 없습니다. 설정 › AI 에이전트에서 고르세요.' };
  try { const r = await interpretChange(text, cur, { model: settings.ai.model }); return { ok: true, ...r }; }
  catch (e) { return { ok: false, msg: e.message }; }
});
const agentInfo = () => {
  const org = llm.resolve(agentFor('organize'));
  const readyBy = {};
  for (const k of ['claude', ...Object.keys(llm.PRESETS)]) readyBy[k] = llm.ready({ ...settings.agent, provider: k });
  return { presets: llm.PRESETS, kinds: llm.KIND_NAMES, claude: claudeAvailable(), ready: llm.ready(settings.agent), resolved: llm.resolve(settings.agent).provider,
    organize: { provider: org.provider, model: org.model || '', ready: llm.ready(agentFor('organize')) }, readyBy, platform: process.platform, packaged: PACKAGED };
};
handle('agent:info', agentInfo);
// 저장된 키: add · use · del · name (키는 이 PC의 설정 파일에만 둔다)
handle('agent:key', (_e, req) => {
  const r = llm.keyOp(settings.agent, req);
  if (r.ok) applySettings({ agent: r.agent });
  return { ok: r.ok, msg: r.msg, settings, info: agentInfo() };
});
handle('agent:test', async (_e, agent) => {
  try { return await llm.testAgent(agent || settings.agent); } catch (e) { return { ok: false, msg: e.message }; }
});

// ---------- 내 PC AI(로컬 LLM, v1.9) ----------
// 모델 목록은 ollama.com에서 읽고, 받기·지우기·속도 재기는 내 PC의 Ollama만 쓴다. 받기는 오래 걸리므로 바로 돌려주고 진행은 'local:progress'로 알린다.
const local = new localllm.LocalLLM({ dataDir: DATA, baseFn: () => (((settings.agent || {}).profiles || {}).ollama || {}).base || '' });
function localUse() {
  const a = settings.agent || {}, c = settings.circle || {};
  const om = (((a.profiles || {}).ollama) || {}).model || '';
  return { all: a.provider === 'ollama' ? (om || llm.PRESETS.ollama.model) : '', aide: c.aideAgent === 'ollama' ? (c.aideModel || om || llm.PRESETS.ollama.model) : '', aiOwn: (settings.ai || {}).agent === 'ollama' };
}
// scope: all(한눈에 전체 = AI 에이전트) · aide(서클 비서만)
function localApply(name, scope) {
  if (scope === 'aide') applySettings({ circle: { aideAgent: 'ollama', aideModel: name } });
  else applySettings({ agent: { provider: 'ollama', profiles: { ollama: { model: name } } } });
}
handle('local:status', async () => ({ ...(await local.status()), use: localUse(), families: localllm.FAMILIES }));
handle('local:library', async (_e, req) => {
  const r = await local.library(req || {});
  for (const c of r.cards || []) c.fits = local.guessFit(c.sizes);
  return r;
});
handle('local:tags', (_e, name) => local.tags(name));
handle('local:pull', async (_e, req) => {
  const { name, use } = req || {};
  const st = await local.status();
  if (!st.running) return { ok: false, msg: st.installed ? 'Ollama가 꺼져 있습니다. 먼저 ‘켜기’를 누르세요.' : 'Ollama가 설치되어 있지 않습니다. 먼저 ‘설치하기’를 누르세요.' };
  local.pull(name, p => broadcast('local:progress', p)).then(r => {
    if (r.ok && use) { localApply(String(name).trim(), use); r.used = use; }
    broadcast('local:progress', { name: String(name).trim(), finished: true, result: r, settings: r.used ? settings : undefined, info: r.used ? agentInfo() : undefined });
  });
  return { ok: true, started: true };
});
handle('local:cancel', (_e, name) => local.cancel(name));
handle('local:clear', (_e, name) => local.clearPull(name));
handle('local:remove', async (_e, name) => {
  const u = localUse();
  const r = await local.remove(name);
  if (r.ok && (u.all === name || u.aide === name)) r.msg += ` ${u.all === name ? '한눈에 AI' : '서클 비서'}가 이 모델을 쓰고 있었습니다. 다른 모델의 ‘쓰기’를 눌러 주세요.`;
  return r;
});
handle('local:unload', (_e, name) => local.unload(name));
handle('local:speed', (_e, name) => local.speed(name));
handle('local:start', () => local.start());
handle('local:install', () => local.install(u => { if (!process.env.HANNUNE_NO_OPEN) shell.openExternal(u); })); // 시험은 브라우저를 열지 않음
handle('local:use', (_e, req) => {
  const { name, scope } = req || {};
  if (!localllm.NAME_RE.test(String(name || ''))) return { ok: false, msg: '모델 이름이 이상합니다.' };
  localApply(name, scope);
  return { ok: true, msg: scope === 'aide' ? `서클 비서가 ${name}(내 PC)로 답합니다.` : `한눈에 AI가 ${name}(내 PC)를 씁니다. 글이 밖으로 나가지 않습니다.`, settings, info: agentInfo() };
});
handle('local:openDir', (_e, dir) => { if (dir && fs.existsSync(dir)) shell.openPath(dir); return true; });
// 모델 폴더 바꾸기: 사용자 환경 변수 OLLAMA_MODELS(setx). Ollama를 다시 켜야 적용된다. 이미 받은 모델은 옛 폴더에 남는다.
handle('local:modelsDir', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '모델을 둘 폴더 (C: 대신 여유가 큰 드라이브)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const dir = r.filePaths[0];
  if (process.env.HANNUNE_DATA) return { ok: true, dir, msg: '시험: 바꾸지 않음' };
  const out = require('child_process').spawnSync('setx', ['OLLAMA_MODELS', dir], { encoding: 'utf8', windowsHide: true });
  if (out.status !== 0) return { ok: false, msg: '바꾸지 못했습니다: ' + String(out.stderr || out.stdout).trim().slice(0, 120) };
  return { ok: true, dir, msg: `모델 폴더를 ${dir}(으)로 정했습니다. 트레이의 Ollama를 끝내고 다시 켜야(한눈에의 ‘켜기’) 새 폴더를 씁니다. 이미 받은 모델은 옛 폴더에 그대로 있습니다.` };
});
// 작업 폴더 고르기(뿌리 폴더)
handle('roots:add', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '작업 폴더 (이 아래 폴더 하나하나를 "일"로 봅니다)', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return settings.roots;
  const list = [...settings.roots];
  for (const p of r.filePaths) if (!list.some(x => x.toLowerCase() === p.toLowerCase())) list.push(p);
  applySettings({ roots: list });
  return settings.roots;
});
handle('manual:remove', (_e, id) => {
  user.manual = user.manual.filter(m => m.id !== id);
  delete user.items[id];
  saveUser(); rebuild(); return true;
});
handle('session:assign', (_e, sid, itemId) => {
  if (itemId) user.sessions[sid] = itemId; else delete user.sessions[sid];
  saveUser(); rebuild(); return true;
});

handle('open:path', (_e, p) => { const d = fs.existsSync(p) ? p : existingDir(p); return d ? shell.openPath(d) : '경로를 찾지 못했습니다.'; });
handle('open:reveal', (_e, p) => { if (fs.existsSync(p)) shell.showItemInFolder(p); return true; });
handle('open:code', (_e, p) => {
  const exe = vscodeExe();
  const d = existingDir(p);
  if (!exe || !d) return false;
  if (IS_MAC) spawn('open', ['-a', exe, d], { detached: true, stdio: 'ignore' }).unref();
  else spawn(exe, [d], { detached: true, stdio: 'ignore' }).unref();
  return true;
});
handle('open:resume', (_e, sid, cwd) => {
  const dir = existingDir(cwd || HOME) || HOME;
  const id = sid.replace(/[^a-f0-9-]/gi, '');
  if (IS_MAC) {
    const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "'\\''");
    spawn('osascript', ['-e', `tell application "Terminal" to do script "cd '${esc(dir)}' && claude --resume ${id}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  const cmd = `/c start "Claude" /D "${dir}" cmd /k claude --resume ${id}`;
  spawn('cmd.exe', [cmd], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, shell: false }).unref();
  return true;
});
handle('open:url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return true; });
handle('copy', (_e, t) => { clipboard.writeText(String(t)); return true; });
handle('open:data', () => shell.openPath(DATA));

handle('win:pin', (_e, v) => { togglePin(v); return settings.main.pinned; });
handle('win:mini', (_e, v) => { if (v === false || (v === undefined && miniWin)) closeMini(); else createMini(); return !!miniWin; });
handle('win:main', () => { showMain(); return true; });

// ---------- 음성 ----------
// 본 창을 띄우고 '바로 넣기' 칸에서 듣기 시작(전역 단축키·트레이·미니 창에서 부름)
function startVoice(where) { showMain(); setTimeout(() => send(mainWin, 'voice', { start: where || 'quick' }), mainWin && mainWin.webContents.isLoading() ? 1500 : 150); }
// 받아 적을 때 참고할 일 이름: 급한 것부터(hintTitles를 끄면 안 보냄)
const BAND_RANK = ['overdue', 'today', 'd3', 'd7', 'd14', 'd31', 'later', 'none', 'sleep'];
function activeTitles() {
  if (!settings.voice.hintTitles || !board) return [];
  return board.items.filter(it => it.band !== 'done' && !it.hidden && !it.done).sort((x, y) => BAND_RANK.indexOf(x.band) - BAND_RANK.indexOf(y.band)).slice(0, 40).map(it => String(it.title).slice(0, 30));
}
function voiceHint() {
  const d = new Date();
  return { today: `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`, areas: board ? board.areas.map(x => x.id) : [], words: [...(settings.nlp.custom || []).map(w => w.word), ...(settings.voice.dict || []).map(w => w.write)], titles: activeTitles() };
}
const fixVoice = raw => words.applyFixes(raw, { dict: settings.voice.dict, learned: settings.voice.learned, titles: activeTitles() });
const hub = new VoiceHub({
  settings: () => settings, dataDir: DATA, hint: voiceHint, fix: fixVoice,
  vocab: () => words.vocabulary({ dict: settings.voice.dict, learned: settings.voice.learned, custom: settings.nlp.custom, titles: activeTitles(), areas: board ? board.areas.map(x => x.id) : [] }),
  emit: ev => {
    send(mainWin, 'voice:evt', ev); send(miniWin, 'voice:evt', ev);
    if (phone) phone.voiceEvent(ev);
    if (process.env.HANNUNE_E2E && ev.type !== 'level') console.log('voice-evt', JSON.stringify({ type: ev.type, source: ev.source, text: ev.text, raw: ev.raw, ms: ev.ms, engine: ev.engine, msg: ev.msg }));
  },
  // 받아 적은 글만 남긴다(소리는 남기지 않음). 최근 500줄이면 충분
  log: rec => { if (SELFTEST) return; try { const f = path.join(DATA, 'cache', 'voice_log.jsonl'); fs.appendFileSync(f, JSON.stringify(rec) + '\n', 'utf8'); if (fs.statSync(f).size > 400000) { const lines = fs.readFileSync(f, 'utf8').trim().split('\n'); fs.writeFileSync(f, lines.slice(-500).join('\n') + '\n', 'utf8'); } } catch (_) { /* 기록 실패는 넘어감 */ } },
});
const voiceInfo = () => { const p = stt.pick(settings, DATA); return { enabled: settings.voice.enabled, engine: p.engine, label: p.label || '', model: p.model || '', ready: p.ready, why: p.why || '', platform: process.platform }; };
handle('voice:info', voiceInfo);
handle('voice:warm', () => { hub.warm(); return true; });
handle('voice:begin', (_e, u) => { hub.begin({ source: 'pc', ...u }); return true; });
ipcMain.on('voice:chunk', (_e, id, bytes) => hub.chunk(id, bytes));
handle('voice:end', (_e, id) => { hub.end(id); return true; });
handle('voice:cancel', (_e, id) => { hub.cancel(id); return true; });
// 받아 적은 글을 사용자가 고쳐서 넣었을 때: 소리가 비슷한 것만 배운다
function learnVoice(heard, fixed) {
  if (!heard || !fixed || heard === fixed) return [];
  const r = words.learnFrom(settings.voice.learned, heard, fixed);
  if (r.got.length) applySettings({ voice: { learned: r.learned } });
  return r.got;
}
handle('voice:learn', (_e, heard, fixed) => learnVoice(heard, fixed));
handle('voice:vocab', () => ({ list: words.vocabulary({ dict: settings.voice.dict, learned: settings.voice.learned, custom: settings.nlp.custom, titles: activeTitles(), areas: board ? board.areas.map(x => x.id) : [] }), acronyms: words.acronymsIn(activeTitles()) }));
handle('voice:compare', (_e, bytes, engines) => hub.compare(bytes, engines));
// 내 PC Whisper 내려받기(윈도우): whisper.cpp 실행 파일 + 받아쓰기 모델(small, 약 490MB)
let localBusy = null;
handle('voice:localStatus', () => { const p = stt.localPaths(settings, DATA); return { ready: stt.localReady(settings, DATA), exe: fs.existsSync(p.exe), model: fs.existsSync(p.model), dir: p.dir, busy: localBusy, win: IS_WIN }; });
handle('voice:localGet', async () => {
  if (localBusy) return { ok: false, msg: '이미 내려받는 중입니다.' };
  if (!IS_WIN) return { ok: false, msg: '지금은 윈도우에서만 내려받을 수 있습니다.' };
  const p = stt.localPaths(settings, DATA);
  const say = msg => { localBusy = msg; broadcast('voice:local', { busy: msg }); };
  const get = async (url, file, name) => {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${name} 받기 실패(${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    let got = 0, last = 0;
    for await (const c of res.body) {
      got += c.length;
      if (!out.write(c)) await new Promise(r => out.once('drain', r));
      if (Date.now() - last > 400) { last = Date.now(); say(`${name} ${Math.round(got / 1048576)}MB${total ? ' / ' + Math.round(total / 1048576) + 'MB' : ''}`); }
    }
    await new Promise(r => out.end(r));
    fs.renameSync(tmp, file);
  };
  try {
    fs.mkdirSync(p.dir, { recursive: true });
    if (!fs.existsSync(p.exe)) {
      say('실행 파일 찾는 중…');
      const rel = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=8', { headers: { 'User-Agent': 'hannune' } }).then(r => r.json());
      const asset = rel.flatMap(r => r.assets || []).find(x => x.name === 'whisper-bin-x64.zip');
      if (!asset) throw new Error('whisper 실행 파일을 찾지 못했습니다.');
      const zip = path.join(p.dir, 'whisper-bin-x64.zip');
      await get(asset.browser_download_url, zip, '실행 파일');
      say('푸는 중…');
      await new Promise((res, rej) => {
        const c = spawn('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${p.dir.replace(/'/g, "''")}' -Force`], { windowsHide: true });
        c.on('error', rej); c.on('close', code => (code === 0 ? res() : rej(new Error('압축을 풀지 못했습니다.'))));
      });
      fs.unlinkSync(zip);
      const rel2 = path.join(p.dir, 'Release');
      if (fs.existsSync(rel2)) { for (const n of fs.readdirSync(rel2)) fs.renameSync(path.join(rel2, n), path.join(p.dir, n)); fs.rmSync(rel2, { recursive: true, force: true }); }
    }
    if (!fs.existsSync(p.model)) await get('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', p.model, '모델');
    localBusy = null; broadcast('voice:local', { done: true });
    return { ok: true, msg: '내려받았습니다. 이제 내 PC Whisper를 고를 수 있습니다.' };
  } catch (e) { localBusy = null; broadcast('voice:local', { err: e.message }); return { ok: false, msg: e.message }; }
});

// ---------- 비서 ----------
const agentTools = new AgentTools({
  board: () => board, settings: () => settings, applySettings: p => applySettings(p), handlers: HANDLERS,
  snapshotUser: () => JSON.stringify(user),
  restoreUser: s => { user = JSON.parse(s); saveUser(); rebuild(); },
  screen: cmd => {
    if (cmd.mini) { createMini(); return; }
    showMain(); send(mainWin, 'agent:screen', cmd);
  },
  setRate: p => agent.setRate(p),
});
const agent = new VoiceAgent({
  key: () => stt.pick(settings, DATA, 'live').key || '', settings: () => settings, applySettings: p => applySettings(p), tools: agentTools, board: () => board,
  emit: ev => {
    send(mainWin, 'agent:evt', ev);
    if (phone) phone.agentEvent(ev);
    if (process.env.HANNUNE_E2E) console.log('agent-evt', JSON.stringify(ev));
  },
  audio: (buf, owner) => { if (owner === 'phone') { if (phone) phone.agentAudio(buf); } else send(mainWin, 'agent:audio', buf); if (process.env.HANNUNE_E2E) console.log('agent-audio', buf.length); },
});
handle('agent:avail', () => ({ ok: agent.available(), state: agent.state, ...agent.rateInfo(), memory: settings.voice.agentMemory.length }));
handle('agent:begin', () => { agent.begin('pc'); return true; });
ipcMain.on('agent:chunk', (_e, bytes) => agent.chunk(bytes));
handle('agent:end', () => { agent.end(); return true; });
handle('agent:cancel', () => { agent.cancel(); return true; });
handle('agent:text', (_e, t) => { agent.text(String(t || ''), 'pc'); return true; });
handle('agent:stop', () => { agent.stopTalking(); return true; });
handle('agent:close', () => { agent.close(); return true; });
handle('agent:rate', (_e, p) => agent.setRate(p || {}));
handle('agent:warm', () => { if (agent.available()) agent.connect().catch(() => { /* 말할 때 다시 */ }); return true; });
function startAgent() { showMain(); setTimeout(() => send(mainWin, 'agent:open', { listen: true }), mainWin && mainWin.webContents.isLoading() ? 1500 : 150); }

// ---------- 폰 캘린더(삼성 캘린더) ----------
let phoneCal = readJson(F.phoneCal, null);
function phoneCalStatus() {
  const p = phoneCal;
  return { at: p ? p.at : 0, count: p ? p.events.length : 0, cals: p ? p.cals : [], wrote: p ? p.wrote || 0 : 0, target: p ? p.target || '' : '', show: settings.phoneCal.show !== false, area: settings.phoneCal.area || '폰 캘린더' };
}
function setPhoneCal(p) {
  phoneCal = p;
  if (!SELFTEST) { try { if (p) writeJson(F.phoneCal, p); else fs.rmSync(F.phoneCal, { force: true }); } catch (_) { /* 다음에 다시 */ } }
  rebuild();
  broadcast('phonecal', phoneCalStatus());
}
handle('phonecal:status', () => phoneCalStatus());
handle('phonecal:clear', () => { setPhoneCal(null); return phoneCalStatus(); });

// ---------- 폰 연결 ----------
const phone = new PhoneLink({
  phoneCal: setPhoneCal,
  settings: () => settings, version: VERSION, board: () => board, handlers: HANDLERS, hub, agent, learn: learnVoice,
  setPhone: patch => { settings = deepMerge(settings, { phone: patch }); saveSettings(settings); },
  ui: st => { broadcast('phone', st); refreshTray(); },
  notice: ev => broadcast('voice:evt', ev),
});
function phoneTrayLabel() { const st = phone ? phone.state() : {}; return !st.on ? '폰 연결…' : st.phones ? `폰 연결됨 (${st.phones}대)` : '폰 연결 (폰 기다리는 중)'; }
handle('phone:state', () => ({ ...phone.state(), enabled: settings.phone.enabled, url: settings.phone.secret ? phone.pairUrl() : '', relay: settings.phone.relay }));
handle('phone:enable', async (_e, on) => {
  if (!PHONE_ON) return { ...phone.state(), enabled: false, url: '', relay: '' };
  settings = deepMerge(settings, { phone: { enabled: !!on } }); saveSettings(settings);
  if (on) await phone.start(); else phone.stop();
  return { ...phone.state(), enabled: settings.phone.enabled, url: phone.pairUrl(), relay: settings.phone.relay };
});
handle('phone:rotate', async () => { const url = await phone.rotate(); return { ...phone.state(), enabled: settings.phone.enabled, url, relay: settings.phone.relay }; });
handle('phone:relay', async (_e, url) => {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, msg: '주소 형식이 맞지 않습니다.' };
  settings = deepMerge(settings, { phone: { relay: u } }); saveSettings(settings);
  if (phone.state().on) await phone.start();
  return { ok: true, ...phone.state(), enabled: settings.phone.enabled, url: phone.pairUrl(), relay: u };
});
handle('voice:start', (_e, where) => { startVoice(where); return true; });
handle('win:select', (_e, id) => { showMain(); send(mainWin, 'select', id); return true; });

handle('brief:test', () => { showBrief('test'); return true; });
handle('brief:dismiss', (_e, keep) => { dismissBrief(!!keep); return true; });
handle('idle:status', () => ({ idleSec: powerMonitor.getSystemIdleTime(), enabled: settings.idle.enabled, quiet: inQuiet(), lastBrief: brief.last }));

handle('cal:status', () => calStatus());
handle('cal:sync', () => syncCalendar(true));
// 쉬운 연결: 비밀 열쇠를 만들어 넣은 스크립트 코드를 클립보드로
handle('cal:scriptCode', () => {
  if (!settings.calendar.script.token) applySettings({ calendar: { script: { token: crypto.randomBytes(18).toString('base64url') } } });
  const code = cal.appsScriptCode(settings.calendar.script.token);
  clipboard.writeText(code);
  return code.length;
});
handle('cal:scriptConnect', async (_e, url) => {
  url = String(url || '').trim();
  applySettings({ calendar: { mode: 'script', script: { url } } });
  try {
    const t = await gscript.test();
    applySettings({ calendar: { script: { enabled: true } } });
    const st = await syncCalendar(true);
    return { ok: true, calendar: t.calendar, ...st };
  } catch (e) {
    gscript.lastResult = { at: Date.now(), errors: [e.message] };
    return { ok: false, error: e.message, ...calStatus() };
  }
});
handle('cal:scriptOff', () => { applySettings({ calendar: { script: { enabled: false } } }); return calStatus(); });
// 고급(OAuth): 구글 콘솔에서 받은 클라이언트 JSON 파일을 그대로 불러온다
handle('cal:importClient', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '구글 OAuth 클라이언트 JSON 파일', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const c = j.installed || j.web || j;
    if (!c.client_id || !c.client_secret) throw new Error('client_id·client_secret이 없는 파일입니다.');
    applySettings({ calendar: { mode: 'oauth', google: { clientId: c.client_id, clientSecret: c.client_secret } } });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
handle('cal:connect', async () => {
  try { await google.connect(); applySettings({ calendar: { google: { enabled: true } } }); return await syncCalendar(true); }
  catch (e) { return { error: e.message, ...google.status() }; }
});
handle('cal:disconnect', () => { google.disconnect(); applySettings({ calendar: { google: { enabled: false } } }); return google.status(); });
handle('cal:openIcs', () => { if (fs.existsSync(F.ics)) shell.showItemInFolder(F.ics); return F.ics; });

handle('activity:state', () => ({ ...activity.state(), item: currentItemFor(activity.state().title) }));
handle('activity:clear', () => { const n = activity.clearAll(); rebuild(); return n; });
handle('activity:today', () => {
  const recs = activity.readDays(1);
  const byApp = {};
  for (const r of recs) { const k = r.app || '?'; byApp[k] = (byApp[k] || 0) + (r.e - r.s) / 60000; }
  return { count: recs.length, byApp: Object.entries(byApp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, m]) => [a, Math.round(m)]) };
});
handle('app:info', () => ({ version: VERSION, data: DATA, appDir: APP_DIR, edition: EDITION, packaged: PACKAGED, platform: process.platform, arch: process.arch }));

// ---------- 새 판 받기 ----------
const { Updater } = require('./svc/updater');
const updater = new Updater({
  app, net, shell, version: VERSION, edition: EDITION, isPackaged: PACKAGED, platform: process.platform, arch: process.arch,
  settings: () => settings, save: p => { applySettings(p); },
  downloads: () => app.getPath('downloads'),
  emit: st => { broadcast('update', st); if (st.status === 'ready' && st.latest && !updateToldReady[st.latest]) { updateToldReady[st.latest] = 1; notifyUpdate(st); } refreshTray(); },
});
const updateToldReady = {};
function notifyUpdate(st) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: `한눈에 새 판 ${st.latest} 준비됨`, body: process.platform === 'darwin' ? '다운로드 폴더에 받아 두었습니다. 눌러서 열고 Applications로 끌어 놓으세요.' : '끝낼 때 설치됩니다. 지금 바꾸려면 눌러서 ‘설치하고 다시 켜기’.', icon: ICON });
    n.on('click', () => { showMain(); send(mainWin, 'update:open', st); });
    n.show();
  } catch (_) { /* 알림은 덤 */ }
}
handle('update:state', () => updater.state());
handle('update:check', () => updater.check(true));
handle('update:download', () => updater.download());
handle('update:install', () => updater.install());
handle('update:skip', () => updater.skip());
handle('update:page', () => updater.page());

// ---------- 일정 찾을 폴더 · 찾은 일정 ----------
handle('folders:add', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '일정을 찾을 폴더 (여러 개 고를 수 있음)', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return settings.docFolders;
  const list = [...(settings.docFolders || [])];
  for (const p of r.filePaths) if (!list.some(f => f.path.toLowerCase() === p.toLowerCase())) list.push({ path: p, on: true, sub: true });
  applySettings({ docFolders: list });
  scanDocs();
  return settings.docFolders;
});
handle('folders:set', (_e, p, patch) => {
  const list = (settings.docFolders || []).map(f => (f.path === p ? { ...f, ...patch } : f));
  applySettings({ docFolders: list });
  scanDocs();
  return settings.docFolders;
});
handle('folders:remove', (_e, p) => {
  applySettings({ docFolders: (settings.docFolders || []).filter(f => f.path !== p) });
  scanDocs();
  return settings.docFolders;
});
handle('found:rescan', () => scanDocs().then(() => true));
handle('found:set', (_e, keys, patch) => {
  user.found = user.found || {};
  for (const k of [].concat(keys)) {
    user.found[k] = { ...(user.found[k] || {}), ...patch };
    for (const x of Object.keys(user.found[k])) if (user.found[k][x] === null) delete user.found[k][x];
  }
  saveUser(); rebuild(); return true;
});
// 찾은 일정을 AI로 다듬기: 앞뒤 문장만 보내 일정인지·꼬리표·시각을 정한다(문서 전체는 보내지 않음)
let foundAiBusy = false;
// 서클 비서에게 묻기: 묻는 사람(나)의 AI 에이전트로, 파일·도구 없이 글만 보낸다. 시험은 CIRCLE_FAKE_AI(AI를 부르지 않음).
function fakeAide(prompt) {
  const dr = /<초안 요청>([^:·<]*)/.exec(prompt);
  if (dr) { // 함께고침 초안(시험용): 고른 모양 이름과 자료의 첫 글 줄로 짧은 초안
    const title = (/<자료 제목="([^"]*)">/.exec(prompt) || [])[1] || '제목';
    const body = ((/<자료 제목="[^"]*">\n([\s\S]*?)\n<\/자료>/.exec(prompt) || [])[1] || '').split('\n').map(x => x.replace(/^[#\-\s]+/, '').trim()).filter(Boolean);
    return `# ${title} — ${dr[1].trim()}\n## 시험용 초안\n- ${body[1] || body[0] || '내용'}\n- (정할 것)\n\n시험용 AI가 만든 문장입니다. 둘째 문장입니다.`;
  }
  const q = (/<질문>([\s\S]*?)<\/질문>/.exec(prompt) || [])[1] || '';
  const prog = (/<진행 상황>\n([\s\S]*?)\n<\/진행 상황>/.exec(prompt) || [])[1] || '';
  const docs = [...prompt.matchAll(/<문서 제목="([^"]*)">([\s\S]*?)<\/문서>/g)];
  const words = q.split(/[\s,.?!]+/).filter(w => w.length >= 2);
  if (prog && prog !== '(없음)' && /어디까지|진행|상태|주제/.test(q)) return `시험용 답입니다. 진행 상황: ${prog.split('\n')[0]}\n[근거: 없음]`;
  const hit = docs.find(d => words.some(w => d[2].includes(w) || d[1].includes(w)));
  return hit ? `시험용 답입니다. 「${hit[1]}」에 관련 내용이 있습니다.\n[근거: ${hit[1]}]` : '자료에 없습니다. 주인에게 전해 보세요.\n[근거: 없음]';
}
// v1.8: 비서에게 물을 때 쓸 AI를 따로 고른다(settings.circle.aideAgent, same = 위 AI 에이전트). 키는 그대로 쓸 곳별 저장값을 쓴다.
function aideAgentObj() {
  const pick = (settings.circle && settings.circle.aideAgent) || 'same';
  const a = settings.agent || {};
  if (pick === 'same') return a;
  const model = (settings.circle && settings.circle.aideModel) || '';
  const prof = { ...((a.profiles || {})[pick] || {}) };
  if (model) prof.model = model;
  return { ...a, provider: pick, profiles: { ...(a.profiles || {}), [pick]: prof } };
}
const agentLabel = r => (r.provider === 'claude' ? 'Claude Code' : r.provider === 'none' ? '없음' : ((llm.PRESETS[r.provider] || {}).name || r.provider).replace(/\s*\(.*\)$/, '') + (r.provider === 'ollama' && r.model ? ' · ' + r.model : ''));
async function aideAsk({ system, prompt }) {
  const pick = (settings.circle && settings.circle.aideAgent) || 'same';
  if (process.env.CIRCLE_FAKE_AI) return { ok: true, text: fakeAide(prompt), by: pick === 'same' ? '시험용 AI' : '시험용 AI · ' + pick };
  const agent = aideAgentObj();
  if (!llm.ready(agent)) return { ok: false, msg: 'AI 에이전트가 없습니다. 비서 창의 ‘답하는 AI’에서 고르거나, 설정 › AI 에이전트에서 Claude Code나 Gemini 키 등을 준비해 주세요.' };
  try {
    const text = await llm.callLLM(agent, { system, prompt, timeoutMs: 150000 });
    return { ok: true, text: String(text || '').trim(), by: agentLabel(llm.resolve(agent)) };
  } catch (e) { return { ok: false, msg: e.message }; }
}
async function ollamaModels(base) {
  try {
    const u = String(base || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '') + '/api/tags';
    const r = await fetch(u, { signal: AbortSignal.timeout(900) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.models || []).map(m => m.name).filter(Boolean).slice(0, 12);
  } catch (_) { return null; }
}
async function aideAgents() {
  const a = settings.agent || {}, cur = (settings.circle && settings.circle.aideAgent) || 'same', curModel = (settings.circle && settings.circle.aideModel) || '';
  const same = llm.resolve(a), list = [];
  list.push({ key: 'same', label: `설정과 같게 (${agentLabel(same)})`, ready: llm.ready(a), on: cur === 'same', short: '설정에 없음', tip: '한눈에 설정 › AI 에이전트에서 고른 것을 그대로 씁니다' });
  list.push({ key: 'claude', label: 'Claude Code (이 PC, 구독)', ready: claudeAvailable(), on: cur === 'claude', short: '설치 안 됨', tip: claudeAvailable() ? '이 PC의 Claude Code로 답합니다. 파일·도구 권한 없이 글만 보냅니다' : 'Claude Code가 설치되어 있지 않습니다' });
  for (const p of ['gemini', 'groq', 'openrouter']) {
    const ag = { ...a, provider: p }, ok = llm.ready(ag);
    list.push({ key: p, label: llm.PRESETS[p].name, ready: ok, on: cur === p, short: '키 없음', tip: ok ? `모델 ${llm.resolve(ag).model}${p === 'gemini' ? '\n무료 Gemini는 보낸 글을 Google이 서비스 개선에 쓰고 사람이 읽을 수 있습니다' : ''}` : '키가 없습니다. 설정 › AI 에이전트에서 키를 저장하면 쓸 수 있습니다' });
  }
  const prof = (a.profiles || {}).ollama || {}, models = await ollamaModels(prof.base), want = curModel || prof.model || llm.PRESETS.ollama.model;
  if (models && models.length) for (const m of models) list.push({ key: 'ollama|' + m, label: `Ollama · ${m} (내 PC)`, ready: true, on: cur === 'ollama' && want === m, tip: '내 PC에서 도는 무료 모델입니다. 글이 인터넷으로 나가지 않습니다' });
  else list.push({ key: 'ollama', label: 'Ollama (내 PC, 무료)', ready: false, on: cur === 'ollama', short: models ? '모델 없음' : '꺼짐·설치 안 됨', tip: models ? '받아 둔 모델이 없습니다. 한눈에 설정 › 내 PC AI에서 모델을 눌러 받으세요' : 'Ollama가 설치되지 않았거나 꺼져 있습니다. 한눈에 설정 › 내 PC AI에서 ‘설치하기’·‘켜기’를 누르면 인터넷 없이 이 PC에서 답합니다' });
  const cprof = (a.profiles || {}).custom || {};
  if (cprof.base) list.push({ key: 'custom', label: `직접 입력 (${cprof.base})`, ready: llm.ready({ ...a, provider: 'custom' }), on: cur === 'custom', short: '모델 없음', tip: 'OpenAI 호환 주소(LM Studio 등)입니다' });
  const now = list.find(x => x.on) || list[0];
  return { current: cur, model: curModel, label: now.on && now.key === 'same' ? agentLabel(same) : now.label, list };
}
// 서클: 서버 연결·받은함·끌어내기·안전 모드 초안·비서. 한눈에의 일 목록은 서클 쪽에서 읽지 않는다(비서 일정은 사용자가 고른 일만 화면에서 보낸다).
if (circleMain) circleMain.setup({ ipcMain, DATA, nativeImage, dialog, shell, getWin: () => mainWin, assets: path.join(APP_DIR, 'assets'), ask: aideAsk, idleSec: () => powerMonitor.getSystemIdleTime() });
// 함께고침 연동: 서클 문서·비서로 만든 초안을 함께고침 주제로 올리고 창으로 연다(파일이 없는 판은 건너뜀)
let circleHamkke = null;
try { circleHamkke = circleMain ? require('./circle_hamkke') : null; } catch (_) { /* 함께고침 연동 없는 판 */ }
if (circleHamkke) circleHamkke.setup({ ipcMain, DATA, BrowserWindow, shell, net, getWin: () => mainWin, settings: () => settings, icon: ICON });
else ipcMain.handle('circle:info', () => null);
if (circleMain) handle('circle:agents', () => aideAgents());

handle('found:ai', async () => {
  if (foundAiBusy || !docCache) return { ok: false, msg: '이미 다듬는 중이거나 찾은 일정이 없습니다.' };
  foundAiBusy = true;
  broadcast('found:ai', { busy: true });
  try {
    const todo = [];
    for (const [file, c] of Object.entries(docCache.files)) for (const it of c.items) {
      if (it.ai) continue;
      const days = Math.round((new Date(it.date) - new Date(new Date().toDateString())) / 86400000);
      if (days >= -7) todo.push({ file, it });
    }
    const r = await refineFound(todo.map(t => ({ name: path.basename(t.file), ...t.it })), { model: settings.ai.model,
      onProgress: msg => broadcast('found:ai', { busy: true, msg }) });
    const byKey = new Map(r.map(x => [x.key, x]));
    for (const t of todo) { const x = byKey.get(t.it.key); if (x) t.it.ai = { ...x, at: new Date().toISOString() }; }
    writeJson(F.docscan, docCache);
    inputs.found = docfind.flatten(docCache);
    rebuild();
    return { ok: true, msg: `${byKey.size}개 다듬음` };
  } catch (e) { return { ok: false, msg: 'AI 다듬기 실패: ' + e.message }; }
  finally { foundAiBusy = false; broadcast('found:ai', { busy: false }); }
});

// ---------- 시험 화면 찍기 ----------
const wait = ms => new Promise(r => setTimeout(r, ms));
async function shoot(win, name) {
  try {
    win.webContents.invalidate();
    await wait(200);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(F.shots, name + '.png'), img.toPNG());
  } catch (e) { console.log('shot failed', name, e.message); }
}
async function selftest() {
  fs.mkdirSync(F.shots, { recursive: true });
  await scan();
  if (SELFTEST_AI) { const r = await runAI(false); console.log('AI:', r.msg); }
  mainWin.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
  mainWin.showInactive();
  await wait(1500);
  for (const v of ['list', 'matrix', 'timeline']) {
    send(mainWin, 'test', { view: v });
    await wait(900);
    await shoot(mainWin, 'view_' + v);
  }
  send(mainWin, 'test', { view: 'list', selectFirst: true });
  await wait(900);
  await shoot(mainWin, 'detail');
  send(mainWin, 'test', { settings: true });
  await wait(700);
  console.log('settings modal:', await mainWin.webContents.executeJavaScript(`JSON.stringify({ hidden: document.querySelector('#modal').hidden, modal: S.modal, len: document.querySelector('#modal').innerHTML.length })`).catch(e => 'ERR ' + e.message));
  await shoot(mainWin, 'settings');
  send(mainWin, 'test', { scrollCal: true });
  await wait(500);
  await shoot(mainWin, 'settings_calendar');
  send(mainWin, 'test', { settings: false, brief: true });
  await wait(700);
  await shoot(mainWin, 'brief');
  send(mainWin, 'test', { brief: false, found: 'recent' });
  await wait(900);
  await shoot(mainWin, 'found');
  send(mainWin, 'test', { view: 'list', check: true });
  await wait(1200);
  send(mainWin, 'test', { view: 'list' });
  await wait(700);
  await shoot(mainWin, 'list_check');
  // v1.2: 변경 창·글로 바꾸기 확인·빠른 입력·그래프 설정·낱말 관리·AI 에이전트 설정·좁은 창
  const steps = [
    [{ edit: true }, 'edit'], [{ editText: '이틀 미뤄 오후 3시 중요' }, 'edit_confirm'],
    [{ closeAll: true, quick: '내일 오후 3시까지 보고서 제출 ★★★ #업무' }, 'quick'],
    [{ closeAll: true, graph: true }, 'graph'], [{ closeAll: true, words: true }, 'words'],
    [{ closeAll: true, settings: true, scrollTo: 'agentsec' }, 'settings_agent'], [{ closeAll: true, settings: true, scrollTo: 'localsec' }, 'settings_local'],
    [{ closeAll: true, settings: true, scrollTo: 'aisec' }, 'settings_ai'],
    [{ closeAll: true, settings: true, scrollTo: 'voicesec' }, 'settings_voice'],
    [{ closeAll: true, settings: true, scrollTo: 'phonesec' }, 'settings_phone'],
    [{ closeAll: true, voiceState: 'listening' }, 'voice_listening'],
    [{ closeAll: true, voiceState: 'idle', quick: '' }, 'voice_idle'],
  ];
  // 음성: --voice-wav=파일 을 주면 실제 받아쓰기(화면 마이크 대신 파일)까지 돌려 본다
  const wavArg = (process.argv.find(a => a.startsWith('--voice-wav=')) || '').slice(12);
  if (wavArg) {
    for (const f of wavArg.split(';').filter(Boolean)) {
      try { const r = await hub.compare(stt.pcmFromWav(fs.readFileSync(f)), [{ engine: 'live' }]); console.log('voice:', path.basename(f), '→', JSON.stringify(r[0].text), r[0].engine, (r[0].ms || 0) + 'ms', r[0].err || ''); }
      catch (e) { console.log('voice:', path.basename(f), '실패', e.message); }
    }
  }
  console.log('voices:', await mainWin.webContents.executeJavaScript('Voice.voices().map(v => v.name + " (" + v.lang + ")").slice(0, 6).join(", ")').catch(e => 'ERR ' + e.message));
  console.log('설명 없는 조작:', await mainWin.webContents.executeJavaScript('tipAudit()').catch(e => 'ERR ' + e.message));
  for (const [t, name] of steps) {
    send(mainWin, 'test', t); await wait(800); await shoot(mainWin, name);
    if (name === 'edit_confirm') {
      // 확인 창의 "적용"까지 눌러 실제로 바뀌는지
      const before = await mainWin.webContents.executeJavaScript('JSON.stringify(E && E.cur)');
      send(mainWin, 'test', { applyConfirm: true });
      await wait(1200);
      const after = await mainWin.webContents.executeJavaScript('(() => { const it = S.board.items.find(i => i.id === E.id); return JSON.stringify({ title: it.title, imp: it.importance, deadlines: it.deadlines.map(d => d.date + " " + d.time + " " + d.label + " (" + d.src + ")") }); })()');
      console.log('apply before:', before);
      console.log('apply after :', after);
    }
  }
  send(mainWin, 'test', { closeAll: true, quick: '' });
  mainWin.setBounds({ x: 0, y: 0, width: 700, height: 520 });
  await wait(900);
  await shoot(mainWin, 'narrow');
  mainWin.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
  await wait(500);
  createMini();
  miniWin.showInactive();
  await wait(1500);
  await shoot(miniWin, 'mini');
  syncCalendar(false);
  await wait(500);
  // 트레이 메뉴의 모니터 항목과 가운데 옮기기
  console.log('monitors:', JSON.stringify(monitorItems().map(m => m.label)));
  for (const d of displaysInOrder()) {
    centerOn(d);
    await wait(400);
    const b = mainWin.getBounds(), w = d.workArea;
    console.log('center on', JSON.stringify(w), '→', JSON.stringify(b), 'centered:', Math.abs((b.x + b.width / 2) - (w.x + w.width / 2)) <= 2 && Math.abs((b.y + b.height / 2) - (w.y + w.height / 2)) <= 2);
  }
  console.log('items', board.items.length, 'shots', F.shots);
  app.isQuitting = true;
  app.exit(0);
}

// ---------- 시작 ----------
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain()); // 맥: 독 아이콘을 누르면 창을 다시 연다
  app.whenReady().then(() => {
    app.setAppUserModelId(AUMID);
    // 마이크(음성 입력)만 허용, 그 밖의 권한 요청은 거절
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => cb(perm === 'media' && (!details.mediaTypes || details.mediaTypes.every(t => t === 'audio'))));
    if (!SELFTEST) ensureStartMenuShortcut();
    if (settings.autoStart) setAutoStart(); // 등록이 지워졌거나 폴더가 옮겨졌어도 다시 맞춘다
    createMain();
    if (SELFTEST) { selftest(); return; }
    const trayImg = nativeImage.createFromPath(TRAY_ICON);
    tray = new Tray(IS_MAC ? trayImg.resize({ width: 18, height: 18 }) : trayImg);
    tray.on('click', () => (mainWin && mainWin.isVisible() ? mainWin.focus() : showMain()));
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
    refreshTray();
    if (settings.mini.open) createMini();
    if (IS_WIN && settings.activity.enabled) activity.start();
    try { globalShortcut.register('Control+Alt+H', () => (mainWin && mainWin.isVisible() && mainWin.isFocused() ? mainWin.hide() : showMain())); } catch (_) { /* 다른 프로그램이 씀 */ }
    try { globalShortcut.register('Control+Alt+M', () => (miniWin ? closeMini() : createMini())); } catch (_) { /* 다른 프로그램이 씀 */ }
    if (settings.voice.hotkey) { try { globalShortcut.register('Control+Alt+V', () => startVoice('quick')); globalShortcut.register('Control+Alt+B', () => startAgent()); } catch (_) { /* 다른 프로그램이 씀 */ } }
    scan().then(() => { checkAlarms(); if (settings.phone.enabled && PHONE_ON) phone.start().catch(() => { /* 다시 시도는 연결 코드가 함 */ }); });
    setInterval(idleTick, 2000);
    updater.start();
    setInterval(checkAlarms, 30000);
    setInterval(() => scan(), Math.max(1, settings.scanMin) * 60000);
    setInterval(() => rebuild(), 10 * 60000); // 날짜가 바뀌어도 D-day가 맞게
    setInterval(() => syncCalendar(true), 30 * 60000); // 구글 쪽에서 지워진 일정도 30분마다 다시 맞춤
    powerMonitor.on('resume', () => scan());
    powerMonitor.on('unlock-screen', () => scan());
  });
  app.on('window-all-closed', () => { /* 트레이에 남는다 */ });
  app.on('before-quit', () => { app.isQuitting = true; updater.stop(); activity.stop(); globalShortcut.unregisterAll(); hub.stop(); agent.close(); phone.stop(); if (circleMain) circleMain.stop(); });
}
