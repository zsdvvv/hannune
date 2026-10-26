// 윈도우 "최근 항목"(바로가기 .lnk)과 VSCode 최근 폴더, 프로젝트 폴더의 CLAUDE.md 를 읽는다.
// 새로 기록을 남기는 감시는 하지 않는다 — 윈도우가 이미 남긴 흔적만 본다.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOC_EXT = new Set(['.hwp', '.hwpx', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.xlsm', '.pdf', '.md', '.txt', '.html', '.htm', '.csv']);

// readLink: (lnkPath) => targetPath  (Electron shell.readShortcutLink 를 넘겨받는다)
function recentItems(readLink, limit = 400) {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.lnk')); } catch (_) { return []; }
  const items = [];
  for (const n of names) {
    const full = path.join(dir, n);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    items.push({ lnk: full, ts: st.mtimeMs });
  }
  items.sort((a, b) => b.ts - a.ts);
  const out = [];
  for (const it of items.slice(0, limit)) {
    let target = '';
    try { target = readLink(it.lnk) || ''; } catch (_) { continue; }
    if (!/^[A-Za-z]:\\/.test(target)) continue;
    const ext = path.extname(target).toLowerCase();
    out.push({ path: target, name: path.basename(target), ext, isDoc: DOC_EXT.has(ext), isDir: !ext, ts: it.ts });
  }
  return out;
}

function vscodeRecents() {
  const base = path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch (_) { return out; }
  for (const d of dirs) {
    const w = path.join(base, d, 'workspace.json');
    try {
      const j = JSON.parse(fs.readFileSync(w, 'utf8'));
      if (!j.folder) continue;
      let p = decodeURIComponent(j.folder.replace(/^file:\/\/\//, '')).replace(/\//g, '\\');
      p = p.charAt(0).toUpperCase() + p.slice(1);
      out.push({ path: p, ts: fs.statSync(path.join(base, d)).mtimeMs });
    } catch (_) { /* 건너뜀 */ }
  }
  return out;
}

// 프로젝트 폴더에 있는 안내 글(CLAUDE.md 등) 앞부분 — AI 분석과 날짜 찾기에 쓴다
function readProjectNotes(dir, maxChars = 5000) {
  for (const n of ['CLAUDE.md', 'README.md', '읽어보기.txt', 'BOOK-NOTES.md']) {
    const f = path.join(dir, n);
    try {
      const st = fs.statSync(f);
      const txt = fs.readFileSync(f, 'utf8').slice(0, maxChars);
      return { file: f, text: txt, mtimeMs: st.mtimeMs };
    } catch (_) { /* 다음 */ }
  }
  return null;
}

module.exports = { recentItems, vscodeRecents, readProjectNotes, DOC_EXT };
