// 문서에서 글자만 꺼낸다. 한글(hwp·hwpx)·워드·파워포인트·엑셀·PDF·텍스트.
// 외부 프로그램 없이 파일을 직접 읽는다(PDF만 runtime\node_modules\pdfjs-dist 사용).
// 암호·DRM이 걸린 문서는 읽지 못하고 오류를 돌려준다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const EXTS = new Set(['.hwp', '.hwpx', '.docx', '.pptx', '.xlsx', '.pdf', '.txt', '.md', '.csv', '.html', '.htm']);

// ---------- zip (docx·pptx·xlsx·hwpx) ----------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 형식이 아님(암호·DRM 문서일 수 있음)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commLen = buf.readUInt16LE(off + 32);
    entries.push({
      name: buf.slice(off + 46, off + 46 + nameLen).toString('utf8'),
      method: buf.readUInt16LE(off + 10), csize: buf.readUInt32LE(off + 20), local: buf.readUInt32LE(off + 42),
    });
    off += 46 + nameLen + extraLen + commLen;
  }
  const get = e => {
    const ln = buf.readUInt16LE(e.local + 26), le = buf.readUInt16LE(e.local + 28);
    const start = e.local + 30 + ln + le;
    const data = buf.slice(start, start + e.csize);
    return e.method === 8 ? zlib.inflateRawSync(data) : data;
  };
  return { entries, get };
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}
// 문단·줄·셀 끝을 줄바꿈으로 바꾸고 태그를 지운다
function xmlText(xml) {
  return decodeEntities(String(xml)
    .replace(/<(?:\w+:)?(?:tab)\b[^>]*\/?>/g, ' ')
    .replace(/<(?:\w+:)?(?:br|lineBreak|cr)\b[^>]*\/?>/g, '\n')
    .replace(/<\/(?:\w+:)?(?:p|tr|si|row|tc)>/g, '\n')
    .replace(/<[^>]+>/g, ''));
}

function zipText(buf, ext) {
  const z = readZip(buf);
  const pick = {
    '.docx': n => /^word\/(document|header\d*|footer\d*|footnotes)\.xml$/.test(n),
    '.pptx': n => /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(n),
    '.xlsx': n => /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(n),
    '.hwpx': n => /^Contents\/section\d+\.xml$/.test(n),
  }[ext];
  const num = n => Number((n.match(/(\d+)\.xml$/) || [0, 0])[1]);
  return z.entries.filter(e => pick(e.name)).sort((a, b) => a.name.localeCompare(b.name) || num(a.name) - num(b.name))
    .map(e => xmlText(z.get(e).toString('utf8'))).join('\n');
}

// ---------- 한글 hwp (OLE 복합 문서 + 압축된 BodyText 레코드) ----------
const END = 0xFFFFFFFA;
function readCfb(buf) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xE011CFD0) throw new Error('HWP(복합 문서) 형식이 아님');
  const ssz = 1 << buf.readUInt16LE(30);
  const mssz = 1 << buf.readUInt16LE(32);
  const nFat = buf.readUInt32LE(44);
  const dirStart = buf.readUInt32LE(48);
  const cutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  let difat = buf.readUInt32LE(68);
  const nDifat = buf.readUInt32LE(72);
  const per = ssz / 4;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = buf.readUInt32LE(76 + i * 4); if (s < END) fatSecs.push(s); }
  for (let k = 0; k < nDifat && difat < END; k++) {
    const o = (difat + 1) * ssz;
    for (let i = 0; i < per - 1 && fatSecs.length < nFat; i++) { const s = buf.readUInt32LE(o + i * 4); if (s < END) fatSecs.push(s); }
    difat = buf.readUInt32LE(o + (per - 1) * 4);
  }
  const fat = new Uint32Array(fatSecs.length * per).fill(0xFFFFFFFE);
  fatSecs.forEach((s, i) => {
    const o = (s + 1) * ssz;
    for (let j = 0; j < per && o + j * 4 + 4 <= buf.length; j++) fat[i * per + j] = buf.readUInt32LE(o + j * 4);
  });
  const readBig = start => {
    const parts = [];
    let s = start, guard = 0;
    while (s < END && s < fat.length && guard++ < 1e6) { parts.push(buf.slice((s + 1) * ssz, (s + 2) * ssz)); s = fat[s]; }
    return Buffer.concat(parts);
  };
  const dir = readBig(dirStart);
  const ents = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 64);
    ents.push({
      name: dir.slice(o, o + Math.max(0, nl - 2)).toString('utf16le'), type: dir[o + 66],
      left: dir.readUInt32LE(o + 68), right: dir.readUInt32LE(o + 72), child: dir.readUInt32LE(o + 76),
      start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120),
    });
  }
  const root = ents[0];
  const mini = root && root.start < END ? readBig(root.start) : Buffer.alloc(0);
  const mfBuf = miniFatStart < END ? readBig(miniFatStart) : Buffer.alloc(0);
  const minifat = [];
  for (let o = 0; o + 4 <= mfBuf.length; o += 4) minifat.push(mfBuf.readUInt32LE(o));
  const readStream = e => {
    if (e.size < cutoff) {
      const parts = [];
      let s = e.start, guard = 0;
      while (s < END && guard++ < 1e6) { parts.push(mini.slice(s * mssz, (s + 1) * mssz)); s = minifat[s]; }
      return Buffer.concat(parts).slice(0, e.size);
    }
    return readBig(e.start).slice(0, e.size);
  };
  const childrenOf = idx => {
    const out = [];
    const seen = new Set();
    const walk = i => {
      if (i >= ents.length || seen.has(i)) return;
      seen.add(i);
      walk(ents[i].left); out.push(ents[i]); walk(ents[i].right);
    };
    walk(ents[idx].child);
    return out;
  };
  const find = parts => {
    let idx = 0;
    for (const p of parts) {
      const c = childrenOf(idx).find(e => e.name === p);
      if (!c) return null;
      idx = ents.indexOf(c);
    }
    return ents[idx];
  };
  return { readStream, find, childrenOf: e => childrenOf(ents.indexOf(e)) };
}

// 문단 글자(레코드 67) 안의 조절 문자: 0·10·13·24~31은 1글자, 나머지 1~31은 8글자 묶음
function paraText(b) {
  let s = '', i = 0;
  while (i + 1 < b.length) {
    const ch = b.readUInt16LE(i);
    if (ch >= 32) { s += String.fromCharCode(ch); i += 2; continue; }
    if (ch === 0 || ch === 10 || ch === 13 || ch >= 24) { if (ch === 10 || ch === 13) s += '\n'; else if (ch >= 30) s += ' '; i += 2; continue; }
    if (ch === 9) s += '\t';
    i += 16;
  }
  return s;
}
function hwpText(buf) {
  const c = readCfb(buf);
  const fh = c.find(['FileHeader']);
  if (!fh) throw new Error('HWP 머리가 없음');
  const flags = c.readStream(fh).readUInt32LE(36);
  const prv = () => { const p = c.find(['PrvText']); return p ? c.readStream(p).toString('utf16le') : ''; };
  if (flags & 6) { const t = prv(); if (t) return t; throw new Error('암호·배포용 문서'); }
  const body = c.find(['BodyText']);
  const secs = body ? c.childrenOf(body).filter(e => /^Section\d+$/.test(e.name)).sort((a, b) => Number(a.name.slice(7)) - Number(b.name.slice(7))) : [];
  let out = '';
  for (const s of secs) {
    let d = c.readStream(s);
    if (flags & 1) d = zlib.inflateRawSync(d);
    let o = 0;
    while (o + 4 <= d.length) {
      const h = d.readUInt32LE(o); o += 4;
      const tag = h & 0x3FF;
      let size = (h >>> 20) & 0xFFF;
      if (size === 0xFFF) { size = d.readUInt32LE(o); o += 4; }
      if (tag === 67) out += paraText(d.slice(o, o + size)) + '\n';
      o += size;
    }
  }
  return out.trim() ? out : prv();
}

// ---------- PDF ----------
let pdfjs = null;
// 설치본은 앱 안의 node_modules, 개발본은 프로젝트의 runtime\node_modules
const PDFJS_DIR = (() => {
  try {
    const d = path.dirname(require.resolve('pdfjs-dist/package.json'));
    // 설치본: app.asar 밖으로 풀어 둔 사본을 쓴다(import·cmap 파일 읽기가 안전하게)
    const un = d.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    return fs.existsSync(un) ? un : d;
  } catch (_) { /* 개발본 */ }
  return path.resolve(__dirname, '..', '..', '..', 'runtime', 'node_modules', 'pdfjs-dist');
})();
async function pdfText(buf, maxPages = 40) {
  if (!pdfjs) {
    pdfjs = await import(pathToFileURL(path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(PDFJS_DIR, 'legacy', 'build', 'pdf.worker.mjs')).href;
  }
  const base = PDFJS_DIR.replace(/\\/g, '/'); // pdfjs는 '/'로 끝나는 경로만 받는다
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf), cMapUrl: base + '/cmaps/', cMapPacked: true,
    standardFontDataUrl: base + '/standard_fonts/', isEvalSupported: false, disableFontFace: true, verbosity: 0,
  });
  let out = '';
  try {
    const doc = await task.promise;
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out += tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('') + '\n';
      page.cleanup();
    }
  } finally { await task.destroy(); }
  return out;
}

// ---------- 텍스트 ----------
function plainText(buf, ext) {
  let s = buf.toString('utf8');
  if (s.includes('�')) { try { s = new TextDecoder('euc-kr').decode(buf); } catch (_) { /* 그대로 */ } }
  if (ext === '.html' || ext === '.htm') s = decodeEntities(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '));
  return s;
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  const buf = await fs.promises.readFile(file);
  if (ext === '.hwp') return hwpText(buf);
  if (ext === '.pdf') return pdfText(buf);
  if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx' || ext === '.hwpx') return zipText(buf, ext);
  return plainText(buf, ext);
}

module.exports = { extractText, EXTS };
