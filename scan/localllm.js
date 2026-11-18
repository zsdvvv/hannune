// 내 PC AI(로컬 LLM) — v1.9
// 사용자: "로컬 LLM을 쓸 수 있는 기반만 준비해 두고, Gemma4·Qwen 등 새 모델이 나오면 클릭만 하면 바로 쓰게".
//  - Ollama(내 PC에서 모델을 돌리는 무료 프로그램)를 찾고, 꺼져 있으면 켜고, 없으면 설치 창을 띄운다(사용자가 누를 때만).
//  - 모델 목록은 ollama.com 웹 페이지를 읽는다(공식 목록 API가 없다). 모양이 바뀌어 못 읽으면 '이름으로 받기'로 받는다.
//  - 받기·지우기·속도 재기·메모리에서 내리기는 Ollama의 내 PC 주소(127.0.0.1:11434)만 쓴다. 묻는 글은 밖으로 나가지 않는다.
//  - 이 PC처럼 페이지 파일이 없고 그래픽 카드가 없는 PC에서는 큰 모델이 다른 프로그램을 죽일 수 있어, 받기 전에 메모리 여유로 맞는지 알려 준다.
// Electron 없이도 돌아간다(node 시험이 이 파일을 그대로 부른다).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFile } = require('child_process');

const DEF_BASE = 'http://127.0.0.1:11434';
const GB = 1024 ** 3;
const libUrl = () => String(process.env.OLLAMA_LIB_URL || 'https://ollama.com').replace(/\/+$/, '');
// 추천 칸에 늘 보여 줄 모델 집안. 집안마다 ollama.com 검색 상위(공식 모델만)를 보여 주므로 새 판(gemma5, qwen4 …)이 나오면 저절로 올라온다.
const FAMILIES = [
  { q: 'gemma', name: 'Gemma', who: 'Google' },
  { q: 'qwen', name: 'Qwen', who: 'Alibaba' },
  { q: 'exaone', name: 'EXAONE', who: 'LG · 한국어' },
  { q: 'llama', name: 'Llama', who: 'Meta' },
  { q: 'phi', name: 'Phi', who: 'Microsoft' },
  { q: 'mistral', name: 'Mistral', who: 'Mistral AI' },
  { q: 'deepseek', name: 'DeepSeek', who: 'DeepSeek' },
];
const CAPS = new Set(['vision', 'tools', 'thinking', 'cloud', 'embedding', 'audio', 'decision', 'code', 'insert']);
const SIZE_RE = /^(?:\d+(?:\.\d+)?[bm]|e\d+(?:\.\d+)?b|\d+x\d+(?:\.\d+)?b)$/; // 9b · 0.8b · 270m · e4b · 8x7b (작은 글자 b만: 내려받은 수 4.2B와 구별)
const COUNT_RE = /^[\d][\d,.]*[KMB]?$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?(?::[a-z0-9][a-z0-9._-]*)?$/i;

const unesc = s => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const tokens = html => String(html).split(/<[^>]*>/).map(t => unesc(t).replace(/\s+/g, ' ').trim()).filter(Boolean);

// '1w' '3mo' '5 days ago' '1 week ago' 'yesterday' → 며칠 전
function agoDays(t) {
  const s = String(t || '').toLowerCase().trim();
  if (!s) return null;
  if (/^(just now|today|now)$|hours? ago|minutes? ago|seconds? ago/.test(s)) return 0;
  if (s === 'yesterday') return 1;
  let m = /^(\d+)\s*(h|d|w|mo|y|yr)$/.exec(s);
  if (m) return Math.round(Number(m[1]) * { h: 0, d: 1, w: 7, mo: 30, y: 365, yr: 365 }[m[2]]);
  m = /^(an?|\d+)\s+(hour|day|week|month|year)s?\s+ago$/.exec(s);
  if (m) return Math.round((/^\d/.test(m[1]) ? Number(m[1]) : 1) * { hour: 0, day: 1, week: 7, month: 30, year: 365 }[m[2]]);
  return null;
}
const agoText = d => (d == null ? '' : d === 0 ? '오늘' : d < 7 ? `${d}일 전` : d < 30 ? `${Math.round(d / 7)}주 전` : d < 365 ? `${Math.round(d / 30)}달 전` : `${Math.round(d / 365)}년 전`);
// 크기 글자('9b', 'e4b', '270m', '8x7b')로 받는 양을 어림한다(보통 받는 4비트 기준 1B ≈ 0.62GB). 정확한 값은 태그 목록에서.
function sizeGuess(s) {
  const m = /^(?:(\d+)x)?(e?)(\d+(?:\.\d+)?)([bm])$/.exec(String(s || '').toLowerCase());
  if (!m) return null;
  // e4b처럼 e가 붙은 것은 '실제로 일하는 몫'만 적은 것이라 받는 양은 2.7배쯤(gemma4:e4b 6.6GB 실측)
  const b = Number(m[3]) * (m[4] === 'm' ? 0.001 : 1) * (m[1] ? Number(m[1]) : 1) * (m[2] ? 2.7 : 1);
  return Math.round((b * 0.62 + 0.3) * GB);
}
function parseBytes(t) {
  const m = /([\d.]+)\s*([KMGT])B/i.exec(String(t || ''));
  return m ? Math.round(Number(m[1]) * { K: 1024, M: 1024 ** 2, G: GB, T: 1024 * GB }[m[2].toUpperCase()]) : null;
}

// 모델 목록 페이지(새로 나온 것 · 검색 결과). 두 페이지의 카드 모양이 달라 글자 조각을 차례로 보고 알아본다.
//   새로 나온 것: 이름 · 설명 · 기능 · 크기 · 4,262 Pulls · 7 Tags · Updated 5 days ago
//   검색 결과:   이름 · 1w · 기능 · 설명 · 6.8M · 13 tags · 크기
function parseCards(html) {
  const out = [], seen = new Set();
  for (const part of String(html || '').split(/<li\b/i).slice(1)) {
    const li = part.split(/<\/li>/i)[0];
    const m = /href="\/(library\/)?([a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)?)"/i.exec(li);
    if (!m) continue;
    const official = !!m[1], name = m[2];
    if (!official && !name.includes('/')) continue; // 메뉴 링크(/search, /models 등)
    if (seen.has(name)) continue;
    const t = tokens(li.slice(li.indexOf('>') + 1));
    const c = { name, official, desc: '', caps: [], sizes: [], pulls: '', tags: null, days: null };
    let i = t.indexOf(name.split('/').pop());
    if (i < 0) i = t.findIndex(x => x.toLowerCase() === name.toLowerCase());
    if (i < 0) continue;
    for (let k = i + 1; k < t.length; k++) {
      const x = t[k], lx = x.toLowerCase();
      if (CAPS.has(lx)) { if (!c.caps.includes(lx)) c.caps.push(lx); continue; }
      if (SIZE_RE.test(lx) && x === lx) { if (!c.sizes.includes(lx)) c.sizes.push(lx); continue; }
      if (lx === 'updated' && t[k + 1]) { const d = agoDays(t[k + 1]); if (d != null) { c.days = d; k++; } continue; }
      const tg = /^(\d+)\s*tags?$/i.exec(x);
      if (tg) { c.tags = Number(tg[1]); continue; }
      if (/^tags?$/i.test(x) || /^pulls$/i.test(x)) continue;
      if (COUNT_RE.test(x)) {
        if (/^pulls$/i.test(t[k + 1] || '')) { c.pulls = x; continue; }
        if (/^tags?$/i.test(t[k + 1] || '')) { c.tags = Number(x.replace(/\D/g, '')); continue; }
        if (!c.pulls && /^\d+\s*tags?$/i.test(t[k + 1] || '')) { c.pulls = x; continue; }
      }
      if (c.days == null) { const d = agoDays(x); if (d != null && x.length <= 12) { c.days = d; continue; } }
      if (!c.desc && x.length >= 18 && /\s/.test(x)) c.desc = x.slice(0, 300);
    }
    c.cloudOnly = c.caps.includes('cloud') && !c.sizes.length;
    c.chat = !c.caps.includes('embedding') && !/embed/i.test(name);
    seen.add(name);
    out.push(c);
  }
  return out;
}

// 태그 목록 페이지(/library/gemma4/tags): 받을 이름 · 받는 크기 · 기억 길이(context). 큰 화면용 줄은 크기 칸 모양이 달라 작은 화면용 줄만 읽는다.
function parseTags(html, name) {
  const s = String(html || '');
  const out = [], seen = new Set();
  const esc = String(name).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`href="/(?:library/)?(${esc}:[a-z0-9._-]+)"[^>]*class="md:hidden[\\s\\S]{0,900}?(?:•|&bull;)\\s*([\\d.]+\\s*[GMKT]B)(?:\\s*-\\s*([\\d.]+\\s*[GMKT]B))?\\s*(?:•|&bull;)\\s*(\\d+[KM]?)\\s*context`, 'gi');
  let m;
  while ((m = re.exec(s))) {
    const full = m[1];
    if (seen.has(full)) continue;
    seen.add(full);
    const tag = full.split(':')[1];
    const bytes = parseBytes(m[2]), bytesMax = parseBytes(m[3]) || bytes;
    // 이름에 -가 붙은 것(e4b-it-q8_0, 31b-cloud 등)은 같은 모델의 다른 압축·클라우드판 → '더 보기'로 숨김
    out.push({ name: full, tag, size: m[2].replace(/\s+/g, ''), sizeMax: m[3] ? m[3].replace(/\s+/g, '') : '', bytes, bytesMax, ctx: m[4], main: !tag.includes('-') || tag === 'latest', cloud: /cloud/i.test(tag) });
  }
  return out;
}

// 메모리·디스크에 맞는지: 받는 크기 + 돌릴 때 더 쓰는 몫(최소 1GB, 15%)을 지금 남은 메모리와 비교
// ok: 넉넉함 · tight: 다른 프로그램을 닫으면 됨 · no: 이 PC에서 돌리면 위험
function fit(bytes, mem, disk) {
  if (!bytes) return { level: 'unknown', text: '크기 모름' };
  const need = bytes + Math.max(GB, bytes * 0.15);
  const free = mem.free, total = mem.total;
  let level = need <= Math.min(free - 3 * GB, total * 0.45) ? 'ok' : need <= free - GB ? 'tight' : 'no';
  const speed = bytes <= 3 * GB ? '빠른 편' : bytes <= 7 * GB ? '보통' : '느린 편';
  let text = level === 'ok' ? '넉넉함' : level === 'tight' ? '빠듯함 · 다른 프로그램을 닫고' : '메모리 부족';
  if (disk && disk.free != null && bytes > disk.free - 2 * GB) { level = 'no'; text = '저장 공간 부족'; }
  return { level, text, speed, needGB: +(need / GB).toFixed(1) };
}

const exists = p => { try { return !!p && fs.existsSync(p); } catch (_) { return false; } };
function findExe() {
  if (process.env.OLLAMA_EXE !== undefined) return { cli: process.env.OLLAMA_EXE && exists(process.env.OLLAMA_EXE) ? process.env.OLLAMA_EXE : null, app: null };
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const dirs = [path.join(la, 'Programs', 'Ollama'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama')];
  let cli = null, appExe = null;
  for (const d of dirs) {
    if (!cli && exists(path.join(d, 'ollama.exe'))) cli = path.join(d, 'ollama.exe');
    if (!appExe && exists(path.join(d, 'ollama app.exe'))) appExe = path.join(d, 'ollama app.exe');
  }
  if (!cli && process.platform === 'win32') {
    try { const r = spawnSync('where', ['ollama'], { encoding: 'utf8', windowsHide: true, timeout: 3000 }); const f = String(r.stdout || '').split(/\r?\n/).find(x => x.trim()); if (f) cli = f.trim(); } catch (_) { /* 없음 */ }
  }
  return { cli, app: appExe };
}
function modelsDir() {
  const env = process.env.OLLAMA_MODELS || (process.platform === 'win32' ? readUserEnv('OLLAMA_MODELS') : '');
  return env || path.join(os.homedir(), '.ollama', 'models');
}
// setx로 바꾼 값은 이미 켜진 프로그램의 환경 변수에 안 들어오므로 레지스트리에서 읽는다
function readUserEnv(name) {
  if (process.env.HANNUNE_DATA) return ''; // 시험에서는 실제 PC 값을 보지 않음
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const m = new RegExp(`${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`).exec(String(r.stdout || ''));
    return m ? m[1].trim() : '';
  } catch (_) { return ''; }
}
function diskFree(dir) {
  let d = dir;
  for (let i = 0; i < 8 && d && !exists(d); i++) d = path.dirname(d);
  try { const s = fs.statfsSync(d); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (_) { return { free: null, total: null }; }
}
// 이 PC의 메모리 여유. Windows는 os.freemem()이 '사용 가능'과 같다.
function memInfo() { return { total: os.totalmem(), free: os.freemem() }; }
// 그래픽 카드: 한 번만 묻고 기억(묻는 데 1~3초 걸려 프로그램을 멈추지 않게 따로 돌린다)
let gpuCache = null;
function gpuInfo() {
  if (gpuCache) return gpuCache;
  const none = { names: [], nvidia: false, amd: false };
  if (process.platform !== 'win32' || process.env.HANNUNE_DATA) return (gpuCache = Promise.resolve(none));
  gpuCache = new Promise(res => {
    execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'], { encoding: 'utf8', windowsHide: true, timeout: 8000 }, (_err, out) => {
      const names = String(out || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      res({ names, nvidia: names.some(n => /nvidia|geforce|rtx|quadro/i.test(n)), amd: names.some(n => /radeon|amd/i.test(n)) });
    });
  });
  return gpuCache;
}
// 설치 위치·모델 폴더는 몇 초 기억(상태를 자주 물어도 명령을 매번 돌리지 않게)
const memo = (fn, ms) => { let at = 0, v; return () => { if (Date.now() - at > ms) { v = fn(); at = Date.now(); } return v; }; };
const findExeM = memo(findExe, 4000);
const modelsDirM = memo(modelsDir, 15000);

class LocalLLM {
  constructor({ dataDir, baseFn } = {}) {
    this.dataDir = dataDir || os.tmpdir();
    this.baseFn = baseFn || (() => '');
    this.pulls = new Map(); // 이름 → { ctl, pct, done, total, speed, eta, status, err }
  }
  base() {
    const b = process.env.OLLAMA_URL || String(this.baseFn() || '').replace(/\/v1\/?$/, '').trim();
    return (/^https?:\/\//i.test(b) ? b : DEF_BASE).replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');
  }
  async api(p, { method = 'GET', body, timeout = 4000 } = {}) {
    const r = await fetch(this.base() + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    const raw = await r.text();
    let j = {};
    try { j = raw ? JSON.parse(raw) : {}; } catch (_) { j = { raw }; }
    if (!r.ok) { const e = new Error(j.error || `${r.status} ${r.statusText}`); e.status = r.status; throw e; }
    return j;
  }

  async status() {
    const exe = findExeM();
    const dir = modelsDirM();
    const st = { installed: !!(exe.cli || exe.app), exe: exe.cli || exe.app || null, running: false, version: '', models: [], loaded: [], base: this.base(),
      mem: memInfo(), disk: diskFree(dir), dir, gpu: await gpuInfo(), pulling: this.pullList() };
    try {
      st.version = (await this.api('/api/version', { timeout: 1500 })).version || '';
      st.running = true;
      st.installed = true; // 다른 곳에 깔렸어도 돌고 있으면 깔린 것
    } catch (_) { return st; }
    try {
      const t = await this.api('/api/tags');
      st.models = (t.models || []).map(m => ({ name: m.name || m.model, bytes: m.size || 0, size: gb(m.size), modified: m.modified_at || '', family: (m.details || {}).family || '', params: (m.details || {}).parameter_size || '', quant: (m.details || {}).quantization_level || '', remote: !!m.remote_host || /cloud/i.test(m.name || '') }));
    } catch (_) { /* 목록 실패는 빈 목록 */ }
    try {
      const ps = await this.api('/api/ps');
      st.loaded = (ps.models || []).map(m => ({ name: m.name || m.model, bytes: m.size || 0, size: gb(m.size), vram: m.size_vram || 0, until: m.expires_at || '' }));
    } catch (_) { /* 옛 판 */ }
    return st;
  }

  // 목록 읽기: pick(추천) · new(새로 나온 것) · search(찾기). 6시간 보관해 두고, 인터넷이 안 되면 보관본을 쓴다.
  async library({ mode = 'pick', q = '', refresh = false } = {}) {
    const key = mode === 'search' ? 'search_' + String(q).toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 40) : mode;
    if (mode === 'search' && !String(q).trim()) return { ok: true, mode, cards: [], at: 0 };
    const file = path.join(this.dataDir, 'cache', 'ollama_lib', key + '.json');
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* 처음 */ }
    if (cached && !refresh && Date.now() - cached.at < 6 * 3600e3) return { ok: true, mode, ...cached, cached: true };
    try {
      let cards;
      if (mode === 'new') cards = parseCards(await getText(libUrl() + '/library?sort=newest')).filter(c => c.official && c.chat && !c.cloudOnly).slice(0, 40);
      else if (mode === 'search') cards = parseCards(await getText(libUrl() + '/search?q=' + encodeURIComponent(String(q).trim()))).slice(0, 30);
      else {
        const lists = await Promise.all(FAMILIES.map(f => getText(libUrl() + '/search?q=' + f.q).then(parseCards).catch(() => null)));
        if (lists.every(l => !l)) throw new Error('목록을 받지 못했습니다');
        cards = [];
        FAMILIES.forEach((f, i) => {
          // 인기순 상위 6개 가운데 새로 나온 것부터 3개 → 새 판이 나오면 인기가 쌓이기 전에도 맨 앞에 온다
          const mine = (lists[i] || []).filter(c => c.official && c.chat && !c.cloudOnly && c.name.toLowerCase().includes(f.q)).slice(0, 6)
            .sort((a, b) => (a.days == null ? 9999 : a.days) - (b.days == null ? 9999 : b.days)).slice(0, 3);
          for (const c of mine) cards.push({ ...c, family: f.name, who: f.who });
        });
      }
      if (!cards.length && mode !== 'search') throw new Error('목록 페이지 모양이 바뀌어 읽지 못했습니다');
      const data = { at: Date.now(), cards };
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch (_) { /* 보관 실패는 넘어감 */ }
      return { ok: true, mode, ...data };
    } catch (e) {
      if (cached) return { ok: true, mode, ...cached, cached: true, stale: true, msg: '인터넷에서 새 목록을 받지 못해 ' + agoText(Math.floor((Date.now() - cached.at) / 86400e3)) + ' 받아 둔 목록을 보여 줍니다.' };
      return { ok: false, mode, cards: [], msg: /fetch failed|ENOTFOUND|ECONN|abort|timeout/i.test(String(e.message) + String(e.cause)) ? '인터넷에 연결되지 않아 모델 목록을 받지 못했습니다. 아래 ‘이름으로 받기’는 Ollama가 직접 받으므로 쓸 수 있습니다.' : e.message };
    }
  }
  async tags(name) {
    if (!NAME_RE.test(String(name || '')) || String(name).includes(':')) return { ok: false, msg: '모델 이름이 이상합니다.' };
    const url = libUrl() + (name.includes('/') ? '/' : '/library/') + name + '/tags';
    try {
      const rows = parseTags(await getText(url), name);
      if (!rows.length) return { ok: false, msg: '태그 목록을 읽지 못했습니다. ‘이름으로 받기’에 ' + name + ' 처럼 넣어도 됩니다.', url };
      const mem = memInfo(), disk = diskFree(modelsDirM());
      // 맞는지는 큰 쪽(돌릴 때 쓰는 몫까지)으로 넉넉히, 빠르기는 받는 크기로
      for (const r of rows) r.fit = r.cloud ? { level: 'cloud', text: '클라우드(받지 않음)' } : { ...fit(r.bytesMax || r.bytes, mem, disk), speed: fit(r.bytes, mem, disk).speed };
      return { ok: true, name, rows, url };
    } catch (e) { return { ok: false, msg: '태그 목록을 받지 못했습니다: ' + e.message, url }; }
  }
  // 카드의 크기 글자에 '맞는지'를 미리 붙인다(어림값)
  guessFit(sizes) {
    const mem = memInfo(), disk = diskFree(modelsDirM());
    return (sizes || []).map(s => ({ s, ...fit(sizeGuess(s), mem, disk) }));
  }

  pullList() {
    return [...this.pulls.entries()].map(([name, p]) => ({ name, pct: p.pct, done: p.done, total: p.total, speed: p.speed, eta: p.eta, status: p.status, err: p.err || '', finished: !!p.finished }));
  }
  // 받기: /api/pull 의 줄 단위 진행(층마다 total·completed)을 모아 하나의 %로
  async pull(name, onProgress = () => {}) {
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) return { ok: false, msg: '모델 이름이 이상합니다. 예: gemma4:e4b, qwen3.8:4b' };
    if (/cloud/i.test(name)) return { ok: false, msg: '클라우드 모델은 내 PC로 받지 않습니다(Ollama 계정이 필요하고 글이 밖으로 나갑니다).' };
    const old = this.pulls.get(name);
    if (old && !old.finished) return { ok: false, msg: '이미 받는 중입니다.' };
    const ctl = new AbortController();
    const p = { ctl, pct: 0, done: 0, total: 0, speed: 0, eta: null, status: '준비 중', layers: new Map(), t0: Date.now(), last: [], finished: false };
    this.pulls.set(name, p);
    const tell = () => onProgress({ name, pct: p.pct, done: p.done, total: p.total, speed: p.speed, eta: p.eta, status: p.status, err: p.err || '', finished: p.finished });
    tell();
    try {
      const r = await fetch(this.base() + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, name, stream: true }), signal: ctl.signal });
      if (!r.ok) { let j = {}; try { j = await r.json(); } catch (_) { /* */ } throw new Error(j.error || `${r.status} ${r.statusText}`); }
      const dec = new TextDecoder();
      let buf = '', lastTell = 0, ended = false;
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let j;
          try { j = JSON.parse(line); } catch (_) { continue; }
          if (j.error) throw new Error(j.error);
          if (j.digest && j.total) p.layers.set(j.digest, { total: j.total, completed: j.completed || 0 });
          p.status = statusWord(j.status);
          if (j.status === 'success') ended = true;
          let tot = 0, got = 0;
          for (const l of p.layers.values()) { tot += l.total; got += Math.min(l.completed, l.total); }
          p.total = tot; p.done = got;
          p.pct = tot ? Math.min(99.9, (got / tot) * 100) : 0;
          const now = Date.now();
          p.last.push([now, got]);
          while (p.last.length > 2 && now - p.last[0][0] > 8000) p.last.shift();
          const [t0, g0] = p.last[0];
          p.speed = now > t0 ? Math.max(0, ((got - g0) / (now - t0)) * 1000) : 0;
          p.eta = p.speed > 0 && tot ? Math.round((tot - got) / p.speed) : null;
          if (now - lastTell > 400) { lastTell = now; tell(); }
        }
      }
      if (!ended) throw new Error('받기가 중간에 끊겼습니다. 다시 누르면 받은 곳부터 이어 받습니다.');
      p.pct = 100; p.status = '다 받음'; p.finished = true; p.eta = 0;
      tell();
      return { ok: true, msg: `${name} 받았습니다.` };
    } catch (e) {
      p.finished = true;
      p.err = e.name === 'AbortError' ? '멈춤 · 다시 누르면 이어 받습니다' : /fetch failed|ECONNREFUSED/.test(String(e.message) + String(e.cause)) ? 'Ollama가 꺼져 있습니다' : /file does not exist|not found|manifest/i.test(e.message) ? '그런 이름의 모델이 없습니다' : e.message;
      p.status = '멈춤';
      tell();
      return { ok: false, msg: p.err };
    }
  }
  cancel(name) { const p = this.pulls.get(name); if (p && !p.finished) { p.ctl.abort(); return true; } return false; }
  clearPull(name) { const p = this.pulls.get(name); if (p && p.finished) this.pulls.delete(name); return true; }
  async remove(name) {
    try { await this.api('/api/delete', { method: 'DELETE', body: { model: name, name } }); return { ok: true, msg: `${name} 지웠습니다.` }; } catch (e) { return { ok: false, msg: '지우지 못했습니다: ' + e.message }; }
  }
  // 메모리에서 내리기(keep_alive 0). 받은 파일은 그대로.
  async unload(name) {
    try { await this.api('/api/generate', { method: 'POST', body: { model: name, keep_alive: 0 }, timeout: 15000 }); return { ok: true, msg: `${name}을(를) 메모리에서 내렸습니다.` }; } catch (e) { return { ok: false, msg: e.message }; }
  }
  // 속도 재기: 짧은 한국어 답 하나. 처음 불러오는 시간과 초당 낱말 조각(토큰) 수.
  async speed(name) {
    const mem0 = memInfo().free;
    try {
      const j = await this.api('/api/generate', { method: 'POST', timeout: 300000, body: { model: name, prompt: '한국어로 한 문장만: 오늘 할 일을 정리하는 방법 하나.', stream: false, think: false, options: { num_predict: 64, temperature: 0.2 } } });
      const tps = j.eval_count && j.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : 0;
      const load = j.load_duration ? j.load_duration / 1e9 : 0;
      const verdict = tps >= 15 ? '빠름' : tps >= 6 ? '쓸 만함' : tps >= 2 ? '느림 · 짧은 일에만' : '매우 느림';
      return { ok: true, tps: +tps.toFixed(1), load: +load.toFixed(1), total: j.total_duration ? +(j.total_duration / 1e9).toFixed(1) : null, answer: String(j.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 140), verdict, memUsedGB: +((mem0 - memInfo().free) / GB).toFixed(1),
        msg: `초당 ${tps.toFixed(1)}조각(${verdict}) · 처음 불러오기 ${load.toFixed(1)}초` };
    } catch (e) {
      return { ok: false, msg: e.name === 'TimeoutError' ? '5분 안에 답하지 않았습니다. 이 PC에는 너무 큰 모델입니다.' : /fetch failed|ECONNREFUSED/.test(String(e.message) + String(e.cause)) ? 'Ollama가 꺼져 있습니다.' : '시험 실패: ' + e.message };
    }
  }

  // 켜기: 트레이 앱이 있으면 그것(다음부터 Windows와 함께 켜짐 설정은 Ollama 쪽), 없으면 ollama serve를 창 없이
  async start() {
    try { await this.api('/api/version', { timeout: 1200 }); return { ok: true, msg: '이미 켜져 있습니다.' }; } catch (_) { /* 꺼짐 */ }
    const exe = findExe();
    if (!exe.cli && !exe.app) return { ok: false, msg: 'Ollama가 설치되어 있지 않습니다.' };
    try {
      if (exe.app) spawn(exe.app, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      else spawn(exe.cli, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_MODELS: modelsDirM() } }).unref();
    } catch (e) { return { ok: false, msg: '켜지 못했습니다: ' + e.message }; }
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      try { await this.api('/api/version', { timeout: 1000 }); return { ok: true, msg: 'Ollama를 켰습니다.' }; } catch (_) { /* 기다림 */ }
    }
    return { ok: false, msg: '켜는 데 20초가 넘게 걸립니다. 잠시 뒤 ‘다시 보기’를 눌러 주세요.' };
  }
  // 설치: winget이 있으면 보이는 명령창에서 설치(사용자가 진행 상황을 봄), 없으면 내려받기 페이지
  install(openUrl) {
    if (process.platform === 'win32' && !process.env.HANNUNE_DATA) {
      const w = spawnSync('where', ['winget'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      if (w.status === 0) {
        const cmd = 'title Ollama 설치 & winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements & echo. & echo 끝나면 이 창을 닫고 한눈에서 [다시 보기]를 누르세요. & pause';
        spawn('cmd.exe', ['/c', 'start', '"Ollama"', 'cmd', '/c', cmd], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        return { ok: true, how: 'winget', msg: '설치 창을 열었습니다. 끝나면 ‘다시 보기’를 누르세요(약 1~3분).' };
      }
    }
    openUrl('https://ollama.com/download');
    return { ok: true, how: 'web', msg: '내려받기 페이지를 열었습니다. 설치한 뒤 ‘다시 보기’를 누르세요.' };
  }
}
const gb = b => (b ? (b / GB >= 10 ? (b / GB).toFixed(0) : (b / GB).toFixed(1)) + 'GB' : '');
const STATUS = { 'pulling manifest': '목록 받는 중', 'verifying sha256 digest': '받은 파일 확인 중', 'writing manifest': '정리 중', 'removing any unused layers': '정리 중', success: '다 받음' };
const statusWord = s => STATUS[s] || (/^pulling/.test(s || '') ? '받는 중' : s || '받는 중');
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Hannune (local model list)', Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

module.exports = { LocalLLM, parseCards, parseTags, fit, sizeGuess, agoDays, agoText, parseBytes, FAMILIES, NAME_RE, GB };
