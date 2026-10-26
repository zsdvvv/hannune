// 경로 정규화와 "알려진 폴더" 찾기. 세션·메모리·최근 문서에 흩어진 경로를 같은 열쇠로 맞춘다.
const fs = require('fs');
const path = require('path');

const GENERIC_TAIL = new Set(['versions', 'releases', 'src', 'dist', 'build', 'node_modules', '.git']);

function norm(p) {
  if (!p) return '';
  let s = String(p).trim().replace(/^["'`]+|["'`]+$/g, '');
  if (/^file:\/\/\//i.test(s)) {
    s = s.replace(/^file:\/\/\//i, '');
    try { s = decodeURIComponent(s); } catch (_) { /* 그대로 */ }
  }
  const bash = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (bash) s = bash[1] + ':/' + bash[2];
  s = s.replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
  if (/^[a-zA-Z]:$/.test(s)) s += '\\';
  if (s.length > 3) s = s.replace(/\\+$/, '');
  return s.toLowerCase();
}

// 긴 글 안의 경로 표기를 한 모양으로: 소문자, 역슬래시, /g/… → g:\…
function normText(t) {
  if (!t) return '';
  let s = String(t).toLowerCase().replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
  s = s.replace(/(^|[\s"'=(`])\\([a-z])\\/g, '$1$2:\\');
  return s;
}

const BOUNDARY = new Set(['\\', '"', "'", '`', ' ', '\r', '\n', '\t', ',', ';', ')', '|', '>', '<', ']', '}', '*', '?', '·']);

// 알려진 접두 경로 목록(긴 것부터)으로 글 안에서 맞는 것을 모두 찾는다.
class PrefixMatcher {
  constructor(prefixes) {
    this.byDrive = new Map();
    const uniq = [...new Set(prefixes.filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const p of uniq) {
      const d = p.slice(0, 3);
      if (!this.byDrive.has(d)) this.byDrive.set(d, []);
      this.byDrive.get(d).push(p);
    }
    this.size = uniq.length;
  }
  find(text, out = new Map()) {
    if (!text || !this.size) return out;
    const s = normText(text);
    for (const [drive, list] of this.byDrive) {
      let i = s.indexOf(drive);
      while (i !== -1) {
        for (const p of list) {
          if (s.startsWith(p, i)) {
            const next = s[i + p.length];
            if (next === undefined || BOUNDARY.has(next)) { out.set(p, (out.get(p) || 0) + 1); break; }
          }
        }
        i = s.indexOf(drive, i + 3);
      }
    }
    return out;
  }
}

// 작업 뿌리 폴더 바로 아래 폴더들 = 기본 "프로젝트 폴더" 후보
function listRootChildren(roots) {
  const out = [];
  const nameMap = new Map();
  for (const r of roots) {
    let entries = [];
    try { entries = fs.readdirSync(r, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (/^[.$]/.test(e.name) || /={3,}/.test(e.name)) continue;
      const full = path.join(r, e.name);
      const key = norm(full);
      if (roots.some(x => norm(x) === key)) continue; // 뿌리 자체는 제외
      out.push({ key, name: e.name, path: full, root: r });
      if (!nameMap.has(e.name.toLowerCase())) nameMap.set(e.name.toLowerCase(), key);
    }
  }
  return { children: out, nameMap };
}

const FILE_EXT = /\.(md|py|js|json|bat|html?|pdf|pptx?|docx?|hwpx?|xlsx?|xlsm|txt|zip|png|jpe?g|csv|ps1|cjs|mjs|ts|css|svg|mp4|stl|exe|lnk)$/i;

// 메모리 글에 적힌 경로를 꺼낸다(백틱 안, 맨 경로, D:\...\Projects 같은 줄임 표기까지)
function extractPaths(text, nameMap) {
  const found = [];
  const push = raw => {
    let p = norm(raw.replace(/[.。,·:;)\]」』*]+$/, ''));
    if (!/^[a-z]:\\/.test(p)) return;
    let segs = p.split('\\');
    const dots = segs.indexOf('...');
    if (dots !== -1) {
      const after = segs[dots + 1];
      const hit = after && nameMap.get(after);
      if (!hit) return;
      segs = hit.split('\\').concat(segs.slice(dots + 2));
    }
    while (segs.length > 2 && (FILE_EXT.test(segs[segs.length - 1]) || GENERIC_TAIL.has(segs[segs.length - 1]) || /[*?<>|"]/.test(segs[segs.length - 1]))) segs.pop();
    if (segs.length < 3) return; // 드라이브 바로 아래 폴더 하나만 있는 건 너무 넓다
    found.push(segs.join('\\'));
  };
  const s = String(text || '');
  for (const m of s.matchAll(/`([A-Za-z]:[\\/][^`\r\n]+)`/g)) push(m[1]);
  for (const m of s.matchAll(/(?:^|[\s(（"'])([A-Za-z]:[\\/][^\s`"'(（)）,·]+)/g)) push(m[1]);
  return [...new Set(found)];
}

function isUnder(child, parent) {
  return child === parent || child.startsWith(parent + '\\');
}

module.exports = { norm, normText, PrefixMatcher, listRootChildren, extractPaths, isUnder };
