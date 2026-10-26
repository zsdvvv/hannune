// 사용자가 정한 폴더의 문서를 읽어 날짜(마감·일정) 후보를 찾는다 → 화면의 "찾은 일정"
// 문서마다 고친 시각·크기를 기억해 바뀐 것만 다시 읽는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractText, EXTS } = require('./extract');
const { extractDates } = require('./dates');
const { norm } = require('./paths');

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '$recycle.bin', 'system volume information', '.venv', 'venv']);
const MAX_FILES = 600, MAX_DEPTH = 5;
// 그림이 든 한글·오피스 문서는 커도 글자만 꺼내므로 넉넉히, PDF·텍스트는 작게
const MB = 1024 * 1024;
const maxBytes = ext => (ext === '.pdf' ? 80 * MB : ['.txt', '.md', '.csv', '.html', '.htm'].includes(ext) ? 8 * MB : 200 * MB);

const keyOf = (file, date, ctx) => crypto.createHash('sha1')
  .update(norm(file) + '|' + date + '|' + String(ctx || '').replace(/\s+/g, '').slice(0, 60)).digest('hex').slice(0, 16);

async function listDocs(folder, sub) {
  const out = [];
  const walk = async (dir, depth) => {
    if (out.length >= MAX_FILES) return;
    let es = [];
    try { es = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of es) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (sub && depth < MAX_DEPTH && !SKIP_DIRS.has(e.name.toLowerCase())) await walk(f, depth + 1); continue; }
      if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(f);
    }
  };
  await walk(folder, 0);
  return out;
}

// cache: { files: { 경로: { mtimeMs, size, folder, items:[...], err } } }
async function findInFolders({ folders, cache, onProgress }) {
  cache = cache && cache.files ? cache : { files: {} };
  const alive = new Set();
  let changed = 0, done = 0;
  const all = [];
  for (const fo of folders) {
    if (!fo.on) continue;
    const files = await listDocs(fo.path, fo.sub !== false);
    for (const f of files) all.push([fo.path, f]);
  }
  for (const [folder, file] of all) {
    alive.add(file);
    let st;
    try { st = await fs.promises.stat(file); } catch (_) { continue; }
    const c = cache.files[file];
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) { c.folder = folder; continue; }
    const rec = { mtimeMs: st.mtimeMs, size: st.size, folder, items: [], err: '' };
    if (st.size > maxBytes(path.extname(file).toLowerCase())) rec.err = '파일이 너무 큼';
    else {
      try {
        const text = await extractText(file);
        const seen = new Set();
        for (const d of extractDates(text, new Date(st.mtimeMs), { wide: true })) {
          if (d.kind !== 'deadline' && d.kind !== 'event') continue;
          const k = keyOf(file, d.date, d.ctx);
          if (seen.has(k)) continue;
          seen.add(k);
          rec.items.push({ key: k, date: d.date, time: d.time || '', kind: d.kind, label: d.label || (d.kind === 'deadline' ? '마감' : '일정'), raw: d.raw, ctx: d.ctx });
        }
      } catch (e) { rec.err = String(e.message || e).slice(0, 120); }
    }
    cache.files[file] = rec;
    changed++;
    done++;
    if (onProgress) onProgress(done);
    await new Promise(r => setImmediate(r)); // 화면이 멈추지 않게 한 문서마다 쉰다
  }
  for (const f of Object.keys(cache.files)) if (!alive.has(f)) delete cache.files[f];
  return { cache, changed };
}

// 화면·보드용 평평한 목록
function flatten(cache) {
  const out = [];
  for (const [file, c] of Object.entries(cache.files || {})) {
    for (const it of c.items) out.push({ ...it, file, name: path.basename(file), folder: c.folder, mtimeMs: c.mtimeMs });
  }
  return out;
}

function fileStats(cache) {
  const files = Object.values(cache.files || {});
  return { files: files.length, withDates: files.filter(f => f.items.length).length, errors: files.filter(f => f.err).length };
}

module.exports = { findInFolders, flatten, fileStats };
