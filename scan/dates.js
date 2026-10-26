// 글에서 날짜를 찾고 "마감·행사·작업 기록·그냥 언급" 중 무엇인지 앞뒤 낱말로 가린다.
// AI 분석 전에 쓰는 바탕값이라 확신이 낮다(conf). AI 결과가 있으면 그쪽을 쓴다.

const DAY = 86400000;
const DL_KW = /(마감|기한|제출|회신|납기|납품|접수|신청|까지|due|deadline)/i;
const EV_KW = /(발표|본선|예선|심사|출장|시험|대회|행사|면접|회의|세미나|워크숍|주차|개최|출국|귀국|설명회|평가회|시연|방문|수업)/;
const HIST_KW = /(완료|완성|등록|실측|배포|옮김|변경|수정|추가|만듦|만들|시작|확정|저장|반영|생성|교체|결정|지적|요청|받음|보냄|했|됨|작성|버전|판\b|교정|기준)/;
// 공문·안내문 같은 문서에서는 일정 낱말을 더 넓게 본다(wide)
const EV_WIDE = /(발표|본선|예선|심사|출장|시험|대회|행사|면접|회의|세미나|워크숍|주차|개최|출국|귀국|설명회|평가|시연|방문|수업|보고|착수|중간|최종|간담회|교육|공고|선정|결과|일정|기간|예정|개강|종강|납부|모집|오리엔테이션|OT|시행|운영)/i;
const SEP = /[\n·;|—•]|\.\s|\*\*/;

function ymd(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function today0(now = new Date()) { return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
function daysUntil(dateStr, now = new Date()) { return Math.round((parseYmd(dateStr) - today0(now)) / DAY); }

function validMD(m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= 31; }

// 연도가 없는 날짜: 글을 쓴 때(anchor)에서 반년 안쪽이 되는 해로
function pickYear(m, d, anchor) {
  let best = null;
  for (const y of [anchor.getFullYear() - 1, anchor.getFullYear(), anchor.getFullYear() + 1]) {
    const t = new Date(y, m - 1, d);
    const diff = (t - anchor) / DAY;
    if (diff > -183 && diff <= 183) best = t;
  }
  return best || new Date(anchor.getFullYear(), m - 1, d);
}

function clauseAround(text, start, end) {
  let a = start, b = end;
  const left = text.slice(Math.max(0, start - 40), start);
  const parts = left.split(SEP);
  const before = parts[parts.length - 1];
  a = start - before.length;
  const right = text.slice(end, end + 30);
  const cut = right.search(SEP);
  const after = cut === -1 ? right : right.slice(0, cut);
  b = end + after.length;
  return { before, after, clause: text.slice(a, b) };
}

// 날짜 앞뒤 낱말 가운데 마감·행사 낱말을 중심으로 짧은 꼬리표를 만든다
function makeLabel(before, after, wide) {
  const tok = s => s.replace(/[`*_#>\[\]()（）'"“”{}]/g, ' ').split(/\s+/)
    .filter(w => w && w.length <= 14 && !/[\\/:=]/.test(w) && !/^\d+$/.test(w) && !/^[월화수목금토일]$/.test(w));
  const b = tok(before).slice(-3), a = tok(after).slice(0, 3);
  const kw = w => DL_KW.test(w) || EV_KW.test(w) || (wide && EV_WIDE.test(w));
  let words;
  const bi = b.findIndex(kw), ai = a.findIndex(kw);
  if (bi !== -1) words = b.slice(Math.max(0, bi - 1));
  else if (ai !== -1) words = a.slice(0, ai + 1);
  else words = b.length ? b : a;
  return words.join(' ').replace(/까지$/, '').replace(/^[,:\-~.]+|[,:\-~.]+$/g, '').trim().slice(0, 20);
}

function classify(before, after, raw, text, start, wide) {
  const b6 = text.slice(Math.max(0, start - 8), start);
  if (/v\d+(\.\d+)*\s*[(（]\s*$/i.test(b6)) return 'history';
  const near = before.slice(-16) + ' ' + after.slice(0, 12);
  const dl = DL_KW.test(near);
  const ev = EV_KW.test(near) || (wide && EV_WIDE.test(before.slice(-24) + ' ' + after.slice(0, 16)));
  if (wide) return dl ? 'deadline' : ev ? 'event' : 'mention';
  const hist = HIST_KW.test(after.slice(0, 8)) || /[(（]\s*$/.test(before) && HIST_KW.test(after);
  if (dl) return 'deadline';
  if (ev && !hist) return 'event';
  if (hist) return 'history';
  return 'mention';
}

// 날짜 바로 뒤의 시각: "(금) 14:00", "오후 2시 30분"
function timeAfter(s, end) {
  const m = s.slice(end, end + 22).match(/^\.?\s*(?:[(（][월화수목금토일][)）])?\s*(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|\s*시(?:\s*(\d{1,2})\s*분)?)/);
  if (!m) return '';
  let h = +m[2];
  const min = +(m[3] || m[4] || 0);
  if (m[1] === '오후' && h < 12) h += 12;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// text에서 날짜 후보를 모두 찾는다. anchor = 그 글을 쓴(고친) 때
// opts.wide: 문서(공문·안내문)용 — 일정 낱말을 넓게 보고, 시각·앞뒤 문장(ctx)도 붙인다
function extractDates(text, anchor = new Date(), opts = {}) {
  const s = String(text || '');
  const wide = !!opts.wide;
  const taken = [];
  const out = [];
  const overlap = (a, b) => taken.some(([x, y]) => a < y && b > x);
  const add = (date, start, end) => {
    if (overlap(start, end)) return;
    taken.push([start, end]);
    const raw = s.slice(start, end);
    const { before, after } = clauseAround(s, start, end);
    const kind = classify(before, after, raw, s, start, wide);
    const rec = { date: ymd(date), raw, kind, label: makeLabel(before, after, wide), at: start };
    if (wide) {
      rec.time = timeAfter(s, end);
      rec.ctx = s.slice(Math.max(0, start - 70), Math.min(s.length, end + 70)).replace(/\s+/g, ' ').trim();
    }
    out.push(rec);
  };
  const pats = [
    [/(?<!\d)(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?:\s*일)?(?!\d)/g, m => validMD(+m[2], +m[3]) && new Date(+m[1], +m[2] - 1, +m[3])],
    // 공문식 '26. 10. 30.
    [/[`'‘’](\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g, m => validMD(+m[2], +m[3]) && new Date(2000 + +m[1], +m[2] - 1, +m[3])],
    [/(?<![\d.])(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, m => validMD(+m[1], +m[2]) && pickYear(+m[1], +m[2], anchor)],
    [/(?<![\dvV.])(\d{1,2})\.\s?(\d{1,2})\.(?!\d)/g, m => validMD(+m[1], +m[2]) && pickYear(+m[1], +m[2], anchor)],
    [/(?<![\dvV.\-/])(\d{1,2})[-/](\d{1,2})(?![\d\-/%])/g, m => validMD(+m[1], +m[2]) && pickYear(+m[1], +m[2], anchor)],
  ];
  for (const [rx, fn] of pats) {
    for (const m of s.matchAll(rx)) {
      const d = fn(m);
      if (d) add(d, m.index, m.index + m[0].length);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// 마감·행사만 골라 같은 날은 하나로
function deadlinesFrom(text, anchor, src) {
  const map = new Map();
  for (const d of extractDates(text, anchor)) {
    if (d.kind !== 'deadline' && d.kind !== 'event') continue;
    const prev = map.get(d.date);
    if (!prev || (prev.kind === 'event' && d.kind === 'deadline')) {
      map.set(d.date, { date: d.date, label: d.label || (d.kind === 'deadline' ? '마감' : '일정'), kind: d.kind, conf: d.kind === 'deadline' ? 0.6 : 0.45, src });
    }
  }
  return [...map.values()];
}

module.exports = { ymd, parseYmd, today0, daysUntil, extractDates, deadlinesFrom, DAY };
