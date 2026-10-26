// Claude Code 대화 기록(~/.claude/projects/**/*.jsonl)을 이어 읽기로 훑는다.
// 대화 파일은 뒤에 덧붙기만 하므로 지난번에 읽은 바이트 위치부터 읽는다.
// 결과: 대화마다 제목·시간·사용자 첫 질문들·"어느 폴더를 며칠에 몇 번 건드렸나".
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PrefixMatcher, norm } = require('./paths');

const PATH_FIELDS = ['file_path', 'path', 'notebook_path', 'command', 'cwd', 'url'];
const SKIP_HEAD = ['"type":"queue-operation"', '"type":"file-history-snapshot"', '"type":"attachment"', '"type":"atis-latch"'];

function dayOf(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && c.type === 'text').map(c => c.text).join('\n');
}

function cleanPrompt(t) {
  return String(t)
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, ' ')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, ' ')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, ' [붙여넣음] ')
    .replace(/<[^>]{1,40}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function memKey(p) {
  const n = norm(p);
  const m = n.match(/\\\.claude\\projects\\[^\\]+\\memory\\([^\\]+)\.md$/);
  return m && m[1] !== 'memory' ? 'mem:' + m[1] : null;
}

function addHit(sess, key, day, n = 1) {
  if (!day) return;
  const h = sess.hits[key] || (sess.hits[key] = {});
  h[day] = (h[day] || 0) + n;
}

async function scanFile(file, sess, matcher, homeKey) {
  const st = fs.statSync(file);
  if (sess.size === st.size && sess.mtimeMs === st.mtimeMs) return false;
  if (st.size < sess.offset) { Object.assign(sess, freshSession(file)); }
  const stream = fs.createReadStream(file, { start: sess.offset, encoding: 'utf8', highWaterMark: 1 << 20 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let consumed = sess.offset, lastStart = sess.offset;
  for await (const line of rl) {
    lastStart = consumed;
    consumed += Buffer.byteLength(line, 'utf8') + 1;
    if (line.length < 20) continue;
    const head = line.slice(0, 300);
    if (SKIP_HEAD.some(k => head.includes(k))) continue;
    // 도구 결과(큰 이미지·출력)는 건너뛴다: 경로 정보는 도구 호출 쪽에 이미 있다
    if (line.includes('"tool_use_id"') && line.includes('"type":"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    const ts = o.timestamp;
    if (ts) {
      if (!sess.firstTs || ts < sess.firstTs) sess.firstTs = ts;
      if (!sess.lastTs || ts > sess.lastTs) sess.lastTs = ts;
    }
    if (o.cwd && !sess.cwd) sess.cwd = o.cwd;
    if (o.type === 'ai-title' && o.aiTitle) { sess.title = o.aiTitle; continue; }
    if (o.type === 'summary' && o.summary && !sess.title) { sess.title = o.summary; continue; }
    const day = ts ? dayOf(ts) : null;
    const cwdKey = o.cwd ? norm(o.cwd) : '';
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (!c || c.type !== 'tool_use' || !c.input) continue;
        sess.tools++;
        if (day) sess.days[day] = (sess.days[day] || 0) + 1;
        const hits = new Map();
        for (const f of PATH_FIELDS) {
          const v = c.input[f];
          if (typeof v !== 'string') continue;
          const mk = (f === 'file_path' || f === 'path') && memKey(v);
          if (mk) hits.set(mk, 1);
          matcher.find(v, hits);
        }
        if (!hits.size && cwdKey && cwdKey !== homeKey) matcher.find(cwdKey, hits);
        for (const [k] of hits) addHit(sess, k, day);
      }
    } else if (o.type === 'user' && o.message && !o.isMeta) {
      const raw = promptText(o.message.content);
      if (!raw || raw.startsWith('<command-') || raw.startsWith('<local-command') || raw.startsWith('Caveat:')) continue;
      sess.prompts++;
      if (day) sess.days[day] = (sess.days[day] || 0) + 1;
      const hits = matcher.find(raw);
      for (const [k] of hits) addHit(sess, k, day, 2); // 사용자가 직접 가리킨 경로는 무게 2
      const t = cleanPrompt(raw);
      if (t.length >= 4) {
        const item = { ts, t: t.slice(0, 160) };
        if (sess.firstPrompts.length < 3) sess.firstPrompts.push(item);
        else { sess.lastPrompts.push(item); if (sess.lastPrompts.length > 4) sess.lastPrompts.shift(); }
      }
    }
  }
  // 마지막 줄이 아직 쓰이는 중이면(줄바꿈 없음) 다음에 그 줄부터 다시 읽는다
  let endsWithNl = true;
  if (st.size > 0) {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, st.size - 1);
    fs.closeSync(fd);
    endsWithNl = b[0] === 0x0a;
  }
  sess.offset = endsWithNl ? Math.min(consumed, st.size) : lastStart;
  sess.size = st.size;
  sess.mtimeMs = st.mtimeMs;
  return true;
}

function freshSession(file) {
  return {
    id: path.basename(file, '.jsonl'), file, offset: 0, size: 0, mtimeMs: 0,
    title: '', cwd: '', firstTs: '', lastTs: '', tools: 0, prompts: 0,
    days: {}, hits: {}, firstPrompts: [], lastPrompts: [],
  };
}

// 같은 대화가 여러 프로젝트 폴더에 복사돼 있을 수 있다(작업 폴더를 옮기며 대화 기록을 복사한 경우).
// 대화 id마다 하나만: 가장 최근에 고쳐진 파일(같으면 더 큰 파일).
function listSessionFiles(projectsDir) {
  const best = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (_) { return []; }
  for (const d of dirs) {
    const pdir = path.join(projectsDir, d.name);
    let names = [];
    try { names = fs.readdirSync(pdir); } catch (_) { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(pdir, f);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      const id = f.slice(0, -6);
      const cur = best.get(id);
      if (!cur || st.mtimeMs > cur.mtimeMs + 1000 || (Math.abs(st.mtimeMs - cur.mtimeMs) <= 1000 && st.size > cur.size)) best.set(id, { full, mtimeMs: st.mtimeMs, size: st.size });
    }
  }
  return [...best.values()].map(b => b.full);
}

// cache: { prefixHash, sessions: { id: sess } }
async function scanSessions({ projectsDir, prefixes, prefixHash, cache, homeDir, onProgress }) {
  if (!cache || cache.prefixHash !== prefixHash) cache = { prefixHash, sessions: {} };
  const matcher = new PrefixMatcher(prefixes);
  const homeKey = norm(homeDir);
  const files = listSessionFiles(projectsDir);
  const alive = new Set();
  let i = 0, changed = 0;
  for (const file of files) {
    const id = path.basename(file, '.jsonl');
    alive.add(id);
    let sess = cache.sessions[id];
    // 읽던 파일이 다른 폴더의 사본으로 바뀌면 처음부터 다시 읽는다(바이트 위치가 맞지 않으므로)
    if (!sess || sess.file !== file) sess = cache.sessions[id] = freshSession(file);
    try { if (await scanFile(file, sess, matcher, homeKey)) changed++; } catch (e) { sess.error = String(e.message || e); }
    i++;
    if (onProgress) onProgress(i, files.length);
  }
  for (const id of Object.keys(cache.sessions)) if (!alive.has(id)) delete cache.sessions[id];
  return { cache, changed };
}

module.exports = { scanSessions, dayOf };
