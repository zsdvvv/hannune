// 음성에서 쓰는 낱말: ① 받아쓰기 모델에 미리 알려 줄 낱말 ② 발음 사전 ③ 사용자가 고친 것에서 배운 말
// 순수 계산만 한다(시험: Node에서 바로).
const LETTER = { A: ['에이'], B: ['비'], C: ['씨', '시'], D: ['디'], E: ['이'], F: ['에프'], G: ['지'], H: ['에이치'], I: ['아이'], J: ['제이'], K: ['케이'], L: ['엘'], M: ['엠'], N: ['엔'], O: ['오'], P: ['피'], Q: ['큐'], R: ['알'], S: ['에스'], T: ['티'], U: ['유'], V: ['브이'], W: ['더블유'], X: ['엑스'], Y: ['와이'], Z: ['제트', '지'] };

const COMMAND_WORDS = ['별 하나', '별 둘', '별 셋', '별 넷', '별 다섯', '오전', '오후', '내일', '모레', '글피', '다음 주', '이번 주', '미뤄 줘', '당겨 줘', '완료', '완료 취소', '중요', '아주 중요', '제출', '회신', '마감', '회의', '발표', '보고서', '업무', '개발', '학교', '연구', '집필', '창업', '개인'];

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 띄어쓰기를 무시하고 찾는 틀: "오이시디" → 오\s*이\s*시\s*디
const loose = s => [...String(s).replace(/\s+/g, '')].map(esc).join('\\s*');

// 약어를 읽는 소리 틀: KTX → 케이\s*티\s*엑스
function acronymRx(word) {
  const parts = [...word].map(ch => { const l = LETTER[ch]; if (!l) return null; return l.length > 1 ? `(?:${l.map(loose).join('|')})` : loose(l[0]); });
  if (parts.some(p => !p)) return null;
  return parts.join('\\s*');
}
// 앞뒤가 한글 낱말 속이면 건드리지 않는다("오이시디" 앞뒤에 조사는 허용)
function wordRx(body) { return new RegExp(`(^|[^가-힣A-Za-z0-9])(${body})(?=$|[^가-힣A-Za-z0-9]|[은는이가을를의에로와과도만까])`, 'g'); }

// 활성 일 이름에서 약어 찾기(3자 이상 대문자)
function acronymsIn(titles) {
  const out = new Set();
  for (const t of titles || []) for (const m of String(t).matchAll(/(?<![A-Za-z])[A-Z]{3,8}(?![A-Za-z])/g)) out.add(m[0]);
  return [...out];
}

// 받아쓰기 결과를 고친다. dict: [{say, write}], learned: [{heard, fixed, n}], titles: 일 이름들
function applyFixes(text, { dict = [], learned = [], titles = [] } = {}) {
  let s = String(text || '');
  const fixes = [];
  const rep = (rx, to, from) => { s = s.replace(rx, (m, a) => { fixes.push({ from: m.slice(a.length), to, why: from }); return a + to; }); };
  for (const d of dict) if (d.say && d.write) rep(wordRx(loose(d.say)), d.write, '발음 사전');
  for (const l of learned) if (l.heard && l.fixed && (l.n || 0) >= 2) rep(wordRx(loose(l.heard)), l.fixed, '배운 말');
  for (const a of acronymsIn(titles)) { const body = acronymRx(a); if (body) rep(wordRx(body), a, '일 이름의 약어'); }
  return { text: s, fixes };
}

// 받아쓰기 모델에 미리 알려 줄 낱말(가장 잘 먹히는 100개 안쪽, 앞쪽이 우선)
function vocabulary({ dict = [], learned = [], custom = [], titles = [], areas = [] } = {}, limit = 100) {
  const out = [];
  const add = w => { const v = String(w || '').trim(); if (v && v.length <= 30 && !out.includes(v) && out.length < limit) out.push(v); };
  dict.forEach(d => add(d.write));
  learned.forEach(l => add(l.fixed));
  custom.forEach(c => add(c.word));
  acronymsIn(titles).forEach(add);
  COMMAND_WORDS.forEach(add);
  areas.forEach(add);
  // 일 이름 속 낱말: 긴 것부터(짧은 낱말은 모델이 원래 잘 안다)
  const toks = new Set();
  for (const t of titles) for (const w of String(t).split(/[\s·,()\[\]「」/]+/)) if (w.length >= 2 && !/^\d+$/.test(w)) toks.add(w);
  [...toks].sort((a, b) => b.length - a.length).forEach(add);
  return out;
}

// ---------- 고친 것에서 배우기 ----------
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
function jamo(s) {
  let o = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c >= 0 && c < 11172) { o += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)]; if (c % 28) o += JONG[c % 28]; } else o += ch;
  }
  return o;
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const clean = t => String(t).replace(/^[\s,.!?。~·]+|[\s,.!?。~·]+$/g, '');
const tokens = s => String(s).split(/\s+/).map(clean).filter(Boolean);
// 영어 약어를 소리로 바꿔 비교한다(KTX ↔ 케이티엑스)
function sound(s) { return jamo(String(s).replace(/[A-Z]/g, ch => (LETTER[ch] || [ch])[0]).replace(/[a-z]/g, ch => (LETTER[ch.toUpperCase()] || [ch])[0]).replace(/\s+/g, '')); }
function similar(a, b) { const x = sound(a), y = sound(b); return 1 - lev(x, y) / Math.max(x.length, y.length, 1); }

// 받아쓴 글과 사용자가 고친 글을 견줘 바뀐 낱말 묶음을 찾는다
function diffPairs(heard, fixed) {
  const a = tokens(heard), b = tokens(fixed);
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) m[i][j] = a[i] === b[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0, ga = [], gb = [];
  const flush = () => { if (ga.length && gb.length) pairs.push({ heard: ga.join(' '), fixed: gb.join(' ') }); ga = []; gb = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < b.length && (i >= a.length || m[i][j + 1] >= m[i + 1][j])) gb.push(b[j++]);
    else ga.push(a[i++]);
  }
  flush();
  return pairs;
}
// 소리가 비슷할 때만 배운다: "내일"을 "모레"로 고친 건 잘못 들은 게 아니라 마음을 바꾼 것이니 배우면 안 된다
function worthLearning(p) {
  if (/\d/.test(p.heard) || /\d/.test(p.fixed)) return false;
  if (p.heard.length > 24 || p.fixed.length > 24) return false;
  return similar(p.heard, p.fixed) >= 0.5;
}
// learned 목록을 고쳐 돌려준다. 한 번 고치면 힌트로만 쓰고, 두 번째부터 자동으로 바꾼다(n >= 2).
function learnFrom(learned, heard, fixed, now = Date.now()) {
  const list = (learned || []).map(x => ({ ...x }));
  const got = [];
  for (const p of diffPairs(heard, fixed)) {
    if (!worthLearning(p)) continue;
    const old = list.find(x => x.heard === p.heard && x.fixed === p.fixed);
    if (old) { old.n = (old.n || 1) + 1; old.at = now; got.push(old); }
    else { const e = { heard: p.heard, fixed: p.fixed, n: 1, at: now }; list.push(e); got.push(e); }
  }
  list.sort((x, y) => (y.at || 0) - (x.at || 0));
  return { learned: list.slice(0, 200), got };
}

module.exports = { applyFixes, vocabulary, learnFrom, diffPairs, worthLearning, similar, acronymsIn, COMMAND_WORDS };
