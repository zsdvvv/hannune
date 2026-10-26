// 한눈에 일정판 — Electron 본체
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, powerMonitor, screen, Notification, globalShortcut, clipboard, dialog } = require('electron');
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
const { claudeAvailable } = require('./scan/claude');
const docfind = require('./scan/docfind');
const cal = require('./svc/calendar');
const { ActivityLog, titleMatcher, focusByItem } = require('./svc/activity');

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
  activity: path.join(DATA, 'activity'),
  shots: path.join(DATA, 'cache', 'shots'),
};
for (const d of ['cache', 'calendar', 'activity', 'secret']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } }
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
  nlp: { custom: [] }, // [{ word, action, value }]
  agent: { provider: 'auto', key: '', model: '', base: '' },
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
  ai: { model: 'sonnet' },
  mini: { open: false, bounds: null, opacity: 0.97, count: 8 },
  main: { bounds: null, maximized: false, pinned: false },
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
const TEST_FOLDER = (process.argv.find(a => a.startsWith('--found-folder=')) || '').slice(15);
if (SELFTEST && TEST_FOLDER) settings.docFolders = [{ path: TEST_FOLDER, on: true, sub: true }];

// 시험 찍기: 창이 다른 창에 가려져도 계속 그리게(가려지면 화면이 멈춰 캡처가 옛 화면이 됨)
if (SELFTEST) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// AI 에이전트: 설정에서 고른 곳(Claude Code·Gemini·Groq·OpenRouter·Ollama …)으로 부른다
useLLM(args => llm.callLLM(settings.agent, { ...args, model: settings.ai.model }));

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
  const b = buildBoard({ ...inputs, sessions: sessCache ? sessCache.sessions : {}, user, ai, settings, focus: focusMap() });
  texts = b.texts;
  delete b.texts;
  b.version = VERSION;
  b.scannedAt = inputs.scannedAt;
  board = b;
  matchTitle = titleMatcher(board.items);
  if (!SELFTEST) writeJson(F.board, board);
  broadcast('board', board);
  scheduleCalendar();
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
  if (!llm.ready(settings.agent)) { aiState = { running: false, msg: 'AI 에이전트가 없습니다 — 설정 › AI 에이전트에서 무료로 고를 수 있습니다.' }; broadcast('ai', aiState); return aiState; }
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
  mainWin.once('ready-to-show', () => { if (!START_HIDDEN && !SELFTEST) mainWin.show(); });
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
    { label: '미니 창', type: 'checkbox', checked: !!miniWin, click: () => (miniWin ? closeMini() : createMini()) },
    { label: '본 창 항상 위', type: 'checkbox', checked: !!settings.main.pinned, click: () => togglePin() },
    { type: 'separator' },
    { label: '다시 읽기', click: () => scan() },
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
  if (!IS_WIN || !DEV_LAYOUT) return;
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
ipcMain.handle('board:get', () => board);
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => applySettings(patch));
ipcMain.handle('scan', () => scan().then(() => true));
ipcMain.handle('ai:run', (_e, force) => runAI(!!force));
ipcMain.handle('ai:state', () => aiState);

ipcMain.handle('item:set', (_e, id, patch) => {
  const cur = user.items[id] || {};
  user.items[id] = { ...cur, ...patch };
  for (const k of Object.keys(user.items[id])) if (user.items[id][k] === null) delete user.items[id][k];
  saveUser(); rebuild(); return true;
});
ipcMain.handle('dl:set', (_e, id, date, patch) => {
  const cur = user.items[id] || (user.items[id] = {});
  cur.dl = cur.dl || {};
  cur.dl[date] = { ...(cur.dl[date] || {}), ...patch };
  for (const k of Object.keys(cur.dl[date])) if (cur.dl[date][k] === null) delete cur.dl[date][k];
  if (cur.myDeadlines && patch.time !== undefined) for (const d of cur.myDeadlines) if (d.date === date) d.time = patch.time;
  saveUser(); rebuild(); return true;
});
ipcMain.handle('dl:add', (_e, id, d) => {
  const cur = user.items[id] || (user.items[id] = {});
  cur.myDeadlines = (cur.myDeadlines || []).filter(x => x.date !== d.date).concat([{ date: d.date, time: d.time || '', label: d.label || '마감', kind: d.kind || 'deadline' }]);
  if (cur.dl && cur.dl[d.date]) delete cur.dl[d.date].rejected;
  saveUser(); rebuild(); return true;
});
ipcMain.handle('dl:removeMine', (_e, id, date) => {
  const cur = user.items[id];
  if (cur && cur.myDeadlines) cur.myDeadlines = cur.myDeadlines.filter(x => x.date !== date);
  saveUser(); rebuild(); return true;
});
ipcMain.handle('manual:add', (_e, m) => {
  const id = 'u:' + crypto.randomBytes(5).toString('hex');
  user.manual.push({ id, title: m.title, area: m.area || '개인', note: m.note || '', created: Date.now() });
  user.items[id] = { imp: m.imp || 0, ...(m.date ? { myDeadlines: [{ date: m.date, time: m.time || '', label: m.label || (m.kind === 'event' ? '일정' : '마감'), kind: m.kind || 'deadline' }] } : {}) };
  saveUser(); rebuild(); return id;
});

// 변경 창에서 한꺼번에 바꾸기. dl: { from(지금 날짜|null), src, key(문서 일정), date, time, label, kind, remove, addNew }
ipcMain.handle('item:apply', (_e, id, ch) => {
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
  }
  for (const k of Object.keys(u)) if (u[k] === null || u[k] === undefined) delete u[k];
  saveUser(); rebuild(); return true;
});

// 글로 쓴 변경 요청을 AI 에이전트로 해석(규칙 해석기를 돕는 용도)
ipcMain.handle('nl:ai', async (_e, text, cur) => {
  if (!llm.ready(settings.agent)) return { ok: false, msg: 'AI 에이전트가 없습니다. 설정 › AI 에이전트에서 고르세요.' };
  try { const r = await interpretChange(text, cur, { model: settings.ai.model }); return { ok: true, ...r }; }
  catch (e) { return { ok: false, msg: e.message }; }
});
ipcMain.handle('agent:info', () => ({ presets: llm.PRESETS, claude: claudeAvailable(), ready: llm.ready(settings.agent), resolved: llm.resolve(settings.agent).provider, platform: process.platform, packaged: PACKAGED }));
ipcMain.handle('agent:test', async (_e, agent) => {
  try { return await llm.testAgent(agent || settings.agent); } catch (e) { return { ok: false, msg: e.message }; }
});
// 작업 폴더 고르기(뿌리 폴더)
ipcMain.handle('roots:add', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '작업 폴더 (이 아래 폴더 하나하나를 "일"로 봅니다)', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return settings.roots;
  const list = [...settings.roots];
  for (const p of r.filePaths) if (!list.some(x => x.toLowerCase() === p.toLowerCase())) list.push(p);
  applySettings({ roots: list });
  return settings.roots;
});
ipcMain.handle('manual:remove', (_e, id) => {
  user.manual = user.manual.filter(m => m.id !== id);
  delete user.items[id];
  saveUser(); rebuild(); return true;
});
ipcMain.handle('session:assign', (_e, sid, itemId) => {
  if (itemId) user.sessions[sid] = itemId; else delete user.sessions[sid];
  saveUser(); rebuild(); return true;
});

ipcMain.handle('open:path', (_e, p) => { const d = fs.existsSync(p) ? p : existingDir(p); return d ? shell.openPath(d) : '경로를 찾지 못했습니다.'; });
ipcMain.handle('open:reveal', (_e, p) => { if (fs.existsSync(p)) shell.showItemInFolder(p); return true; });
ipcMain.handle('open:code', (_e, p) => {
  const exe = vscodeExe();
  const d = existingDir(p);
  if (!exe || !d) return false;
  if (IS_MAC) spawn('open', ['-a', exe, d], { detached: true, stdio: 'ignore' }).unref();
  else spawn(exe, [d], { detached: true, stdio: 'ignore' }).unref();
  return true;
});
ipcMain.handle('open:resume', (_e, sid, cwd) => {
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
ipcMain.handle('open:url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return true; });
ipcMain.handle('copy', (_e, t) => { clipboard.writeText(String(t)); return true; });
ipcMain.handle('open:data', () => shell.openPath(DATA));

ipcMain.handle('win:pin', (_e, v) => { togglePin(v); return settings.main.pinned; });
ipcMain.handle('win:mini', (_e, v) => { if (v === false || (v === undefined && miniWin)) closeMini(); else createMini(); return !!miniWin; });
ipcMain.handle('win:main', () => { showMain(); return true; });
ipcMain.handle('win:select', (_e, id) => { showMain(); send(mainWin, 'select', id); return true; });

ipcMain.handle('brief:test', () => { showBrief('test'); return true; });
ipcMain.handle('brief:dismiss', (_e, keep) => { dismissBrief(!!keep); return true; });
ipcMain.handle('idle:status', () => ({ idleSec: powerMonitor.getSystemIdleTime(), enabled: settings.idle.enabled, quiet: inQuiet(), lastBrief: brief.last }));

ipcMain.handle('cal:status', () => calStatus());
ipcMain.handle('cal:sync', () => syncCalendar(true));
// 쉬운 연결: 비밀 열쇠를 만들어 넣은 스크립트 코드를 클립보드로
ipcMain.handle('cal:scriptCode', () => {
  if (!settings.calendar.script.token) applySettings({ calendar: { script: { token: crypto.randomBytes(18).toString('base64url') } } });
  const code = cal.appsScriptCode(settings.calendar.script.token);
  clipboard.writeText(code);
  return code.length;
});
ipcMain.handle('cal:scriptConnect', async (_e, url) => {
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
ipcMain.handle('cal:scriptOff', () => { applySettings({ calendar: { script: { enabled: false } } }); return calStatus(); });
// 고급(OAuth): 구글 콘솔에서 받은 클라이언트 JSON 파일을 그대로 불러온다
ipcMain.handle('cal:importClient', async () => {
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
ipcMain.handle('cal:connect', async () => {
  try { await google.connect(); applySettings({ calendar: { google: { enabled: true } } }); return await syncCalendar(true); }
  catch (e) { return { error: e.message, ...google.status() }; }
});
ipcMain.handle('cal:disconnect', () => { google.disconnect(); applySettings({ calendar: { google: { enabled: false } } }); return google.status(); });
ipcMain.handle('cal:openIcs', () => { if (fs.existsSync(F.ics)) shell.showItemInFolder(F.ics); return F.ics; });

ipcMain.handle('activity:state', () => ({ ...activity.state(), item: currentItemFor(activity.state().title) }));
ipcMain.handle('activity:clear', () => { const n = activity.clearAll(); rebuild(); return n; });
ipcMain.handle('activity:today', () => {
  const recs = activity.readDays(1);
  const byApp = {};
  for (const r of recs) { const k = r.app || '?'; byApp[k] = (byApp[k] || 0) + (r.e - r.s) / 60000; }
  return { count: recs.length, byApp: Object.entries(byApp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, m]) => [a, Math.round(m)]) };
});
ipcMain.handle('app:info', () => ({ version: VERSION, data: DATA, appDir: APP_DIR }));

// ---------- 일정 찾을 폴더 · 찾은 일정 ----------
ipcMain.handle('folders:add', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: '일정을 찾을 폴더 (여러 개 고를 수 있음)', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return settings.docFolders;
  const list = [...(settings.docFolders || [])];
  for (const p of r.filePaths) if (!list.some(f => f.path.toLowerCase() === p.toLowerCase())) list.push({ path: p, on: true, sub: true });
  applySettings({ docFolders: list });
  scanDocs();
  return settings.docFolders;
});
ipcMain.handle('folders:set', (_e, p, patch) => {
  const list = (settings.docFolders || []).map(f => (f.path === p ? { ...f, ...patch } : f));
  applySettings({ docFolders: list });
  scanDocs();
  return settings.docFolders;
});
ipcMain.handle('folders:remove', (_e, p) => {
  applySettings({ docFolders: (settings.docFolders || []).filter(f => f.path !== p) });
  scanDocs();
  return settings.docFolders;
});
ipcMain.handle('found:rescan', () => scanDocs().then(() => true));
ipcMain.handle('found:set', (_e, keys, patch) => {
  user.found = user.found || {};
  for (const k of [].concat(keys)) {
    user.found[k] = { ...(user.found[k] || {}), ...patch };
    for (const x of Object.keys(user.found[k])) if (user.found[k][x] === null) delete user.found[k][x];
  }
  saveUser(); rebuild(); return true;
});
// 찾은 일정을 AI로 다듬기: 앞뒤 문장만 보내 일정인지·꼬리표·시각을 정한다(문서 전체는 보내지 않음)
let foundAiBusy = false;
ipcMain.handle('found:ai', async () => {
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
    [{ closeAll: true, settings: true, scrollTo: 'agentsec' }, 'settings_agent'],
  ];
  for (const [t, name] of steps) { send(mainWin, 'test', t); await wait(800); await shoot(mainWin, name); }
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
    scan().then(() => checkAlarms());
    setInterval(idleTick, 2000);
    setInterval(checkAlarms, 30000);
    setInterval(() => scan(), Math.max(1, settings.scanMin) * 60000);
    setInterval(() => rebuild(), 10 * 60000); // 날짜가 바뀌어도 D-day가 맞게
    setInterval(() => syncCalendar(true), 30 * 60000); // 구글 쪽에서 지워진 일정도 30분마다 다시 맞춤
    powerMonitor.on('resume', () => scan());
    powerMonitor.on('unlock-screen', () => scan());
  });
  app.on('window-all-closed', () => { /* 트레이에 남는다 */ });
  app.on('before-quit', () => { app.isQuitting = true; activity.stop(); globalShortcut.unregisterAll(); });
}
