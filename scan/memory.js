// Claude 메모리(~/.claude/projects/*/memory/*.md)를 읽는다. type: project 인 것이 곧 "일 단위"다.
const fs = require('fs');
const path = require('path');

function parseFront(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch (_) { v = v.slice(1, -1); } }
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    if (!(kv[1] in meta)) meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

function readIndex(dir) {
  const idx = {};
  let src = '';
  try { src = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'); } catch (_) { return idx; }
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.*)$/);
    if (m) idx[m[2].trim()] = { title: m[1].trim(), hook: m[3].trim() };
  }
  return idx;
}

function readMemories(projectsDir) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (_) { return out; }
  for (const d of dirs) {
    const mdir = path.join(projectsDir, d.name, 'memory');
    if (!fs.existsSync(mdir)) continue;
    const idx = readIndex(mdir);
    for (const f of fs.readdirSync(mdir)) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      const full = path.join(mdir, f);
      let src;
      try { src = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
      const { meta, body } = parseFront(src);
      const st = fs.statSync(full);
      const modified = meta.modified ? new Date(meta.modified) : st.mtime;
      out.push({
        name: meta.name || f.replace(/\.md$/, ''),
        file: full,
        type: meta.type || 'project',
        description: meta.description || '',
        title: idx[f] ? idx[f].title : '',
        hook: idx[f] ? idx[f].hook : '',
        body,
        modified: isNaN(modified) ? st.mtime.toISOString() : modified.toISOString(),
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    }
  }
  // 같은 메모리가 여러 프로젝트 폴더에 복사돼 있으면 가장 최근에 고친 것 하나만
  const best = new Map();
  const when = m => Date.parse(m.modified) || m.mtimeMs;
  for (const m of out) {
    const cur = best.get(m.name);
    if (!cur || when(m) > when(cur) || (when(m) === when(cur) && m.mtimeMs > cur.mtimeMs)) best.set(m.name, m);
  }
  return [...best.values()];
}

module.exports = { readMemories, parseFront };
