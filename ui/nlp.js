// 글로 쓴 일정 변경 요청을 AI 없이 알아듣는 규칙 해석기.
//  - 날짜: 2026-11-05, 11/5, 11.5., 11월 5일, '26.11.5, 1105(숫자만), 5일, 오늘·내일·모레·글피, 다음주 금요일,
//          금요일, 주말, 월말, 다음달 3일, 3일 뒤, 일주일 후, 하루 미뤄, 이틀 당겨 …
//  - 시각: 15:30, 오후 3시 반, 3시30분, 세시, 정오, 자정, 1530, 30분 미뤄, 1시간 당겨 …
//  - 중요도: ★★★, 별 3개, 별셋, 중요도 4, 중요, 매우 중요, 조금 중요, 안 중요 …
//  - 동작: 변경·수정·옮겨, 미뤄·연기, 당겨, 등록·추가, 삭제, 완료·끝, 다시, 숨겨 …
//  - 띄어쓰기는 무시하고, 흔한 오타는 고치고, 동작 낱말은 자모 단위로 한 글자 정도 틀려도 알아듣는다.
//  - 사용자가 등록한 낱말(custom)을 먼저 본다.
// 본 창(브라우저)과 시험(Node) 양쪽에서 쓴다.
(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => { const t = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)); };
  const today0 = now => new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const WD = '일월화수목금토';
  const validDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
  const AREAS = ['업무', '개발', '학교', '연구', '집필', '창업', '개인'];

  // ---------- 숫자 날짜의 여러 읽기(고친 것에서 배우기) ----------
  // 같은 숫자도 사람마다 다르게 쓴다: 260101 = 26년 1월 1일(기본) · 1월 26일 1시 …
  // 사용자가 고친 값이 같은 입력의 다른 읽기와 같으면 그 읽기를 배운다(parse의 opts.learn).
  const yyOk = (n, t0) => { const y = 2000 + n; return y >= t0.getFullYear() - 5 && y <= t0.getFullYear() + 15 ? y : 0; };
  // 뒤에 오는 연도: 두 자리면 20xx, 네 자리면 그대로(올해 앞뒤 범위만)
  const yearOf = (str, t0) => { const n = +str; if (str.length === 2) return yyOk(n, t0); if (str.length === 4) return n >= t0.getFullYear() - 5 && n <= t0.getFullYear() + 15 ? n : 0; return 0; };
  const fullDate = (y, m, d) => (y && validDate(y, m, d) ? ymd(new Date(y, m - 1, d)) : '');
  // 연도 없는 날짜: 두 달 넘게 지났으면 내년
  const mdDate = (mo, d, t0) => {
    const y = t0.getFullYear();
    if (!validDate(y, mo, d)) return '';
    let dt = new Date(y, mo - 1, d);
    if (dt < addDays(t0, -60)) dt = new Date(y + 1, mo - 1, d);
    return ymd(dt);
  };
  const hmOf = (h, mi) => (h <= 23 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : '');
  // 숫자 덩어리의 모양: d8·d6·d4(숫자만), md.·md/·md-(월과 일 둘), y3.·y3/·y3-(셋)
  function numTok(text) {
    const t = String(text).replace(/\s+/g, '').replace(/\.$/, '');
    let m;
    if (/^(\d{8}|\d{6}|\d{4})$/.test(t)) return { text: t, shape: 'd' + t.length, p: [] };
    if ((m = t.match(/^(\d{1,2})([./-])(\d{1,2})$/))) return { text: t, shape: 'md' + m[2], p: [m[1], m[3]] };
    if ((m = t.match(/^(\d{1,4})([./-])(\d{1,2})[./-](\d{1,4})$/))) return { text: t, shape: 'y3' + m[2], p: [m[1], m[3], m[4]] };
    return null;
  }
  // 모양마다 읽을 수 있는 법을 모두 낸다: { 읽는 법: { date, time } } (안 맞는 법은 빠진다)
  function readings(tok, t0) {
    const s = tok.text, out = {};
    const put = (k, date, time = '') => { if (date || time) out[k] = { date, time }; };
    const both = (k, date, time) => { if (date && time) out[k] = { date, time }; };
    const sh = tok.shape.slice(0, 2);
    if (sh === 'd8') {
      put('ymd', fullDate(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6)));
      put('dmy', fullDate(yearOf(s.slice(4), t0), +s.slice(2, 4), +s.slice(0, 2)));
      put('mdy', fullDate(yearOf(s.slice(4), t0), +s.slice(0, 2), +s.slice(2, 4)));
    } else if (sh === 'd6') {
      const [a, b, c] = [s.slice(0, 2), s.slice(2, 4), s.slice(4)];
      put('ymd', fullDate(yyOk(+a, t0), +b, +c));
      put('dmy', fullDate(yyOk(+c, t0), +b, +a));
      put('mdy', fullDate(yyOk(+c, t0), +a, +b));
      both('mdh', mdDate(+a, +b, t0), hmOf(+c, 0));
      both('dmh', mdDate(+b, +a, t0), hmOf(+c, 0));
    } else if (sh === 'd4') {
      const a = +s.slice(0, 2), b = +s.slice(2);
      put('md', mdDate(a, b, t0));
      put('dm', mdDate(b, a, t0));
      put('hm', '', hmOf(a, b));
    } else if (sh === 'md') {
      const [a, b] = tok.p.map(Number);
      put('md', mdDate(a, b, t0));
      put('dm', mdDate(b, a, t0));
    } else if (sh === 'y3') {
      const [a, b, c] = tok.p;
      if (a.length === 2) put('ymd', fullDate(yyOk(+a, t0), +b, +c));
      if (c.length === 2 || c.length === 4) {
        put('dmy', fullDate(yearOf(c, t0), +b, +a));
        put('mdy', fullDate(yearOf(c, t0), +a, +b));
      }
    }
    return out;
  }
  // 배운 것이 없을 때의 읽기. d4(네 자리)는 parse가 앞뒤 글을 보고 따로 정한다.
  function defaultRead(tok, rs) {
    const sh = tok.shape.slice(0, 2);
    if (sh === 'd8' || sh === 'y3') {
      if (rs.ymd) return 'ymd';
      const alt = ['dmy', 'mdy'].filter(k => rs[k]);
      return alt.length === 1 ? alt[0] : 'none'; // 25/12/2026처럼 하나로만 읽히면 그것
    }
    if (sh === 'd6') return rs.ymd ? 'ymd' : 'none';
    if (sh === 'md') return rs.md ? 'md' : 'none';
    if (sh === 'd4') return rs.hm && !rs.md ? 'hm' : rs.md ? 'md' : 'none';
    return 'none';
  }
  // 배운 읽기 고르기: 똑같은 입력을 고친 적이 있으면 그것, 없으면 같은 모양을 두 번 이상 같은 쪽으로 고쳤을 때 그쪽
  function pickRead(tok, rs, def, learn) {
    if (!learn || learn.on === false) return { as: def, learned: false };
    const ex = learn.exact && learn.exact[tok.text];
    const exAs = ex && (typeof ex === 'string' ? ex : ex.as);
    if (exAs && (exAs === 'none' || rs[exAs])) return { as: exAs, learned: exAs !== def };
    const v = (learn.votes || {})[tok.shape];
    if (v) {
      let best = '', bn = 0;
      for (const [k, n] of Object.entries(v)) if (k !== 'none' && rs[k] && n > bn) { best = k; bn = n; }
      if (best && best !== def && bn >= 2 && bn > (v[def] || 0)) return { as: best, learned: true };
    }
    return { as: def, learned: false };
  }
  const READ_NAME = { ymd: '연·월·일', dmy: '일·월·연', mdy: '월·일·연', mdh: '월·일·시', dmh: '일·월·시', md: '월·일', dm: '일·월', hm: '시·분', none: '날짜 아님' };
  const SHAPE_NAME = { d8: '여덟 자리 숫자(20270301)', d6: '여섯 자리 숫자(270301)', d4: '네 자리 숫자(0301)', 'md.': '점으로 쓴 둘(3.1)', 'md/': '빗금으로 쓴 둘(3/1)', 'md-': '줄표로 쓴 둘(3-1)', 'y3.': '점으로 쓴 셋(27.3.1)', 'y3/': '빗금으로 쓴 셋(27/3/1)', 'y3-': '줄표로 쓴 셋(27-3-1)' };
  // 사람이 읽는 말: 2027년 1월 26일 1시
  function describeRead(r) {
    if (!r) return '';
    let out = '';
    if (r.date) { const [y, m, d] = r.date.split('-').map(Number); out = `${y}년 ${m}월 ${d}일`; }
    if (r.time) { const [h, mi] = r.time.split(':').map(Number); out += `${out ? ' ' : ''}${h}시${mi ? ` ${mi}분` : ''}`; }
    return out || '날짜 아님';
  }
  // 넣을 때 적어 둔 해석(entry)과 고친 값(after)을 견주어 배울 것을 찾는다.
  // entry: { toks:[{ text, shape, as }], date, time, day(넣은 날), at }, after: { date, time }
  function lessonFrom(entry, after) {
    if (!entry || !Array.isArray(entry.toks) || !after) return null;
    const aD = after.date || '', aT = after.time || '';
    if (aD === (entry.date || '') && aT === (entry.time || '')) return null;
    const t0 = entry.day ? parseYmd(entry.day) : today0(new Date(entry.at || Date.now()));
    for (const tk of entry.toks) {
      const nt = numTok(tk.text);
      if (!nt) continue;
      const rs = readings(nt, t0);
      for (const [k, r] of Object.entries(rs)) {
        if (k === tk.as) continue;
        // 시각만 있는 읽기(1130 → 11시 30분)면 날짜는 넣은 날 그대로여야 한다
        const okDate = r.date ? r.date === aD : aD === (entry.day || ymd(t0));
        const okTime = r.time ? r.time === aT : true;
        if (okDate && okTime) return { text: nt.text, shape: nt.shape, from: tk.as, as: k, date: r.date, time: r.time };
      }
    }
    return null;
  }
  // 배운 것을 더한 새 learn 값(원래 값은 그대로 둔다). 똑같은 입력은 200개까지 기억한다.
  function teach(learn, ls, at) {
    const L = { on: !learn || learn.on !== false, exact: { ...((learn && learn.exact) || {}) }, votes: JSON.parse(JSON.stringify((learn && learn.votes) || {})) };
    delete L.exact[ls.text];
    L.exact[ls.text] = { as: ls.as, shape: ls.shape, at: typeof at === 'number' ? at : Date.now() };
    const keys = Object.keys(L.exact);
    if (keys.length > 200) for (const k of keys.sort((x, y) => (L.exact[x].at || 0) - (L.exact[y].at || 0)).slice(0, keys.length - 200)) delete L.exact[k];
    const v = L.votes[ls.shape] = L.votes[ls.shape] || {};
    v[ls.as] = (v[ls.as] || 0) + 1;
    return L;
  }
  // 글 하나의 숫자 덩어리를 모든 읽기로(화면 설명·시험용)
  function numReads(text, now) {
    const tok = numTok(text);
    if (!tok) return null;
    const rs = readings(tok, today0(now || new Date()));
    return { text: tok.text, shape: tok.shape, reads: rs, def: defaultRead(tok, rs) };
  }

  // ---------- 오타·줄임말 바로잡기(자주 틀리는 것만) ----------
  const TYPO = [
    [/오젼|오젼|오쩐|오졀/g, '오전'], [/오휴|오훅|오흐/g, '오후'], [/저녘|저년/g, '저녁'], [/아칩|아칭/g, '아침'],
    [/낼\s*모레|내일\s*모래|낼모래/g, '모레'], [/모래(?=\s*(?:까지|로|에|오전|오후|\d|$|[까로에]))/g, '모레'], [/(^|[^가-힣])낼(?=[\s까로에\d]|오전|오후|아침|저녁|밤|새벽|낮|$)/g, '$1내일'],
    [/내알|내ㅣㄹ/g, '내일'], [/오눌|오늘날/g, '오늘'], [/담주|담쥬|다음\s*쥬|다음쭈|차주/g, '다음주'], [/담달|다음\s*딜/g, '다음달'],
    [/([월화수목금토일])욜/g, '$1요일'], [/([월화수목금토일])요알/g, '$1요일'], [/([월화수목금토일])오일/g, '$1요일'],
    [/일쭈일|일주얼/g, '일주일'], [/중오(?!일)/g, '중요'], [/즁요|쭝요/g, '중요'],
  ];
  function fixTypos(s) { for (const [rx, to] of TYPO) s = s.replace(rx, to); return s; }

  // ---------- 자모로 나눠 한 글자 정도 틀린 것도 찾기 ----------
  const JL = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JV = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JT = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  function jamo(s) {
    let o = '';
    for (const ch of s) {
      const c = ch.charCodeAt(0) - 0xAC00;
      if (c >= 0 && c < 11172) o += JL[Math.floor(c / 588)] + JV[Math.floor((c % 588) / 28)] + (c % 28 ? JT[c % 28] : '');
      else o += ch;
    }
    return o;
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 9;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  // 띄어쓰기를 지운 글과 원래 위치 표
  function compact(s) {
    let c = '';
    const map = [];
    for (let i = 0; i < s.length; i++) { if (/\s/.test(s[i])) continue; c += s[i]; map.push(i); }
    return { c, map };
  }

  // ---------- 낱말 사전 ----------
  const VERBS = {
    later: ['미뤄', '미루', '미룸', '연기', '늦춰', '늦추', '뒤로', '연장', '밀어', '미뤄줘'],
    earlier: ['당겨', '당기', '앞당', '땡겨', '땡기', '일찍', '앞으로', '빨리'],
    add: ['등록', '추가', '넣어', '새로', '새일정', '만들어'],
    remove: ['삭제', '지워', '지우', '없애', '취소'],
    done: ['완료', '끝냄', '끝났', '끝내', '끝남', '다했', '다함', '마침', '마쳤', '완성', '처리했', '체크'],
    undone: ['미완료', '안끝났', '안끝남', '다시열', '되돌', '완료취소', '체크해제', '다시살'],
    hide: ['숨겨', '숨김', '숨기', '감춰', '안보이게'],
    unhide: ['숨김해제', '숨김풀', '보이게'],
    change: ['변경', '바꿔', '바꾸', '바꿈', '수정', '고쳐', '옮겨', '옮기', '이동', '조정', '설정', '맞춰', '로해', '으로해'],
  };
  const IMP_WORDS = [ // 긴 것부터
    [0, ['중요도없', '중요도지워', '중요도빼', '별없애', '별지워', '별빼']],
    [1, ['전혀안중요', '안중요', '중요하지않', '중요안함', '중요치않', '사소', '안급함', '안급해', '하찮']],
    [5, ['매우중요', '아주중요', '엄청중요', '완전중요', '제일중요', '가장중요', '정말중요', '진짜중요', '최우선', '초긴급', '긴급', '급함', '시급', '최고중요']],
    [2, ['덜중요', '별로중요', '중요도낮', '조금덜중요', '낮음']],
    [3, ['조금중요', '약간중요', '좀중요', '보통', '중간정도', '적당히중요', '살짝중요']],
    [4, ['중요함', '중요해', '중요도높', '중요']],
  ];
  const KNOWN = new Set([...Object.values(VERBS).flat(), ...IMP_WORDS.flatMap(x => x[1]), ...AREAS,
    '연구', '연고', '변수', '면접', '수업', '회의', '보고', '보고서', '발표', '제출', '마감', '일정', '날짜', '시간', '중요도']);

  function findWord(cx, word, fuzzy) {
    let i = cx.c.indexOf(word);
    if (i >= 0) return { start: cx.map[i], end: cx.map[i + word.length - 1] + 1, word, exact: true };
    if (!fuzzy || word.length < 2) return null;
    const wj = jamo(word);
    const maxD = word.length >= 3 ? 2 : 1;
    for (let k = 0; k + word.length <= cx.c.length; k++) {
      const sub = cx.c.slice(k, k + word.length);
      if (!/^[가-힣]+$/.test(sub) || KNOWN.has(sub)) continue;
      if (lev(jamo(sub), wj) <= maxD) return { start: cx.map[k], end: cx.map[k + word.length - 1] + 1, word, exact: false, seen: sub };
    }
    return null;
  }
  function hasVerb(cx, kind, fuzzy = true) {
    for (const w of VERBS[kind]) { const f = findWord(cx, w, fuzzy && w.length >= 2); if (f) return f; }
    return null;
  }

  // ---------- 숫자 낱말 ----------
  const NATIVE = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 석: 3, 네: 4, 넷: 4, 넉: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
  const SINO = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 };
  const DAYW = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 여드레: 8, 아흐레: 9, 열흘: 10, 보름: 15 };
  const numOf = w => (/^\d+$/.test(w) ? +w : NATIVE[w] ?? SINO[w] ?? DAYW[w] ?? (w === '반' ? 0.5 : NaN));
  const STARW = { 하나: 1, 한개: 1, 한: 1, 둘: 2, 두개: 2, 두: 2, 셋: 3, 세개: 3, 세: 3, 넷: 4, 네개: 4, 네: 4, 다섯: 5, 다섯개: 5 };

  // ---------- 해석 ----------
  // opts: { now, mode: 'edit'|'quick', baseDate:'YYYY-MM-DD'(지금 마감), baseTime:'HH:MM', custom:[{word,action,value}] }
  function parse(text, opts = {}) {
    const now = opts.now || new Date();
    const t0 = today0(now);
    const mode = opts.mode || 'edit';
    const raw = String(text || '');
    let s = fixTypos(raw.normalize('NFC').replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' '));
    const spans = [];
    const acts = [];
    const notes = [];
    const take = (a, b) => { if (spans.some(([x, y]) => a < y && b > x)) return false; spans.push([a, b]); return true; };
    const add = (type, value, src, extra = {}) => { acts.push({ type, value, src, ...extra }); };
    const scan = (rx, fn) => { for (const m of s.matchAll(rx)) { const a = m.index, b = m.index + m[0].length; if (spans.some(([x, y]) => a < y && b > x)) continue; if (fn(m) !== false) take(a, b); } };
    // 숫자 날짜 하나 읽기: 기본 읽기 → 배운 읽기가 있으면 그것. 다르게 읽힐 수 있는 것은 toks에 적어 둔다(고친 것에서 배우려고).
    const learn = opts.learn || null;
    const toks = [];
    const readNum = (src, def0) => {
      const tok = numTok(src);
      if (!tok) return false;
      const rs = readings(tok, t0);
      const ch = pickRead(tok, rs, def0 || defaultRead(tok, rs), learn);
      if (Object.keys(rs).some(k => k !== ch.as)) toks.push({ text: tok.text, shape: tok.shape, as: ch.as, learned: ch.learned });
      if (ch.as === 'none' || !rs[ch.as]) return false;
      const r = rs[ch.as], ex = ch.learned ? { learned: true } : {};
      if (r.date) add('date', r.date, src, ex);
      if (r.time) add('time', r.time, src, ex);
    };

    // 0) 사용자가 등록한 낱말 (띄어쓰기 무시, 정확히)
    for (const cw of opts.custom || []) {
      const w = String(cw.word || '').replace(/\s+/g, '');
      if (!w) continue;
      const cx = compact(s);
      const f = findWord(cx, w, false);
      if (!f || !take(f.start, f.end)) continue;
      const v = cw.value;
      const src = s.slice(f.start, f.end);
      if (cw.action === 'date') {
        const sub = parse(String(v), { now, mode: 'quick' }).actions.find(a => a.type === 'date');
        if (sub) add('date', sub.value, src, { custom: true });
        else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) add('date', v, src, { custom: true });
      } else if (cw.action === 'weekday') {
        const sub = parse(`${v}요일`, { now, mode: 'quick' }).actions.find(a => a.type === 'date');
        if (sub) add('date', sub.value, src, { custom: true });
      } else if (cw.action === 'time') add('time', String(v), src, { custom: true });
      else if (cw.action === 'later') add('shiftDays', Math.abs(+v || 1), src, { custom: true });
      else if (cw.action === 'earlier') add('shiftDays', -Math.abs(+v || 1), src, { custom: true });
      else if (cw.action === 'imp') add('imp', Math.max(0, Math.min(5, +v || 0)), src, { custom: true });
      else if (['done', 'undone', 'hide', 'unhide', 'remove', 'add'].includes(cw.action)) add(cw.action, true, src, { custom: true });
      else if (cw.action === 'area') add('area', String(v), src, { custom: true });
      else if (cw.action === 'kind') add('kind', v === 'event' ? 'event' : 'deadline', src, { custom: true });
      // 'ignore'(제목에서만 빼기)는 자리만 차지한다
    }

    const cxAll = compact(s);
    const laterV = hasVerb(cxAll, 'later');
    const earlierV = hasVerb(cxAll, 'earlier');
    const shiftDir = laterV && !earlierV ? 1 : earlierV && !laterV ? -1 : 0;
    const base = opts.baseDate ? parseYmd(opts.baseDate) : null;

    // 1) 연도까지 있는 날짜
    scan(/(?<!\d)(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g, m => {
      if (!validDate(+m[1], +m[2], +m[3])) return false;
      add('date', ymd(new Date(+m[1], +m[2] - 1, +m[3])), m[0]);
    });
    scan(/[`'‘’](\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?/g, m => {
      if (!validDate(2000 + +m[1], +m[2], +m[3])) return false;
      add('date', ymd(new Date(2000 + +m[1], +m[2] - 1, +m[3])), m[0]);
    });
    // 두 자리 연도: 27.3.1 · 27/3/1 · 27-03-01 · 27.3.1. · 27년 3월 1일 → 2027년. 판 번호(10.2.1) 같은 것과 헷갈리지 않게 올해 앞뒤로만 받는다.
    const yy = n => { const y = 2000 + n; return y >= t0.getFullYear() - 5 && y <= t0.getFullYear() + 15 ? y : 0; };
    // 셋으로 쓴 것: 27.3.1(연·월·일)이 기본, 25/12/2026처럼 하나로만 읽히면 그것, 그 밖(1/3/2027)은 배운 대로
    scan(/(?<![\d.\-/])(\d{1,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,4})\.?(?![\d]|\.\d)/g, m => readNum(m[0]));
    scan(/(?<!\d)(\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g, m => {
      const y = yy(+m[1]);
      if (!y || !validDate(y, +m[2], +m[3])) return false;
      add('date', ymd(new Date(y, +m[2] - 1, +m[3])), m[0]);
    });
    // 2) 월·일
    const md = (mo, d, src) => {
      let y = t0.getFullYear();
      if (!validDate(y, mo, d)) return false;
      let dt = new Date(y, mo - 1, d);
      if (dt < addDays(t0, -60)) dt = new Date(y + 1, mo - 1, d); // 두 달 넘게 지난 날짜면 내년
      add('date', ymd(dt), src);
    };
    scan(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, m => md(+m[1], +m[2], m[0]));
    scan(/(\d{1,2})\s*월\s*(말|초|중순)/g, m => {
      const mo = +m[1];
      if (mo < 1 || mo > 12) return false;
      let y = t0.getFullYear();
      const d = m[2] === '말' ? new Date(y, mo, 0).getDate() : m[2] === '초' ? 1 : 15;
      md(mo, d, m[0]);
    });
    scan(/(?<![\d:.])(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*\.)?(?![\d:]|[.\-/]\d|\s*(?:시간|배|%|퍼|점|명|개|원|등|위|도|살|세|권|장|회|차|번|분|초|만|천|억|kg|km|cm|mm|ml|g|m|L)(?![가-힣])|\s*(?:점|만|천|억))/g, m => readNum(m[0]));
    // 오후 1500 · 오전 930 처럼 붙여 쓴 시각: '오후'까지 한 덩어리로 읽어 제목에 남지 않게
    scan(/(오전|오후|아침|저녁|밤|새벽)\s*(\d{1,2})(\d{2})(?![\d:]|\s*(?:원|분|명|개))/g, m => {
      let h = +m[2]; const mi = +m[3];
      if (h > 23 || mi > 59) return false;
      if (/오후|저녁|밤/.test(m[1]) && h < 12) h += 12;
      if (/오전|새벽|아침/.test(m[1]) && h === 12) h = 0;
      add('time', `${pad(h)}:${pad(mi)}`, m[0]);
    });
    // 3) 숫자만: 8자리 YYYYMMDD, 6자리 YYMMDD, 4자리 MMDD(시각처럼 보이면 시각)
    scan(/(?<![\d:.\-/])(\d{8}|\d{6}|\d{4})(?![\d:]|\s*(?:회차|번째|페이지|%|[만천억]|(?:원|개|명|년|번|호|회|건|쪽|장)(?![가-힣])))/g, m => {
      const n = m[1];
      if (n.length === 4) {
        // 앞뒤에 시각 말(오후·시·분)이 있으면 배운 것과 상관없이 시각
        const a = +n.slice(0, 2), b = +n.slice(2);
        const before = s.slice(Math.max(0, m.index - 4), m.index), after = s.slice(m.index + 4, m.index + 7);
        const timeCtx = /(오전|오후|아침|저녁|밤|새벽)\s*$/.test(before) || /^\s*(시|분)/.test(after) || /시각|시간을|몇\s*시/.test(s);
        if (timeCtx && a <= 23 && b <= 59) { add('time', `${pad(a)}:${pad(b)}`, m[0]); return; }
      }
      return readNum(n);
    });
    // 날짜 바로 뒤에 붙은 요일 괄호: 3/1(월) · 27.3.1 (월요일)
    scan(/\s*\(\s*[월화수목금토일](?:요일)?\s*\)/g, m => (spans.some(([, y]) => y === m.index || y === m.index - 1) ? undefined : false));
    // D-3 · D-day: 오늘에서 N일 뒤
    scan(/(?<![A-Za-z])[Dd]\s*-\s*(\d{1,3})(?!\d)/g, m => add('date', ymd(addDays(t0, +m[1])), m[0]));
    scan(/(?<![A-Za-z])[Dd]\s*-?\s*[Dd]ay(?![A-Za-z])/g, m => add('date', ymd(t0), m[0]));
    // 4) 말로 하는 날
    const REL = [['그글피', 4], ['글피', 3], ['내일모레', 2], ['모레', 2], ['내일', 1], ['명일', 1], ['오늘', 0], ['금일', 0], ['어제', -1]];
    for (const [w, n] of REL) scan(new RegExp(w, 'g'), m => add('date', ymd(addDays(t0, n)), m[0]));
    // 다음달·이번달 N일, 월말·연말
    scan(/(다다음\s*달|다음\s*달|이번\s*달|이달)\s*(\d{1,2})\s*일/g, m => {
      const k = /다다음/.test(m[1]) ? 2 : /다음/.test(m[1]) ? 1 : 0;
      const first = new Date(t0.getFullYear(), t0.getMonth() + k, 1);
      if (!validDate(first.getFullYear(), first.getMonth() + 1, +m[2])) return false;
      add('date', ymd(new Date(first.getFullYear(), first.getMonth(), +m[2])), m[0]);
    });
    scan(/(다음\s*달|이번\s*달|이달)?\s*(월말|말일|달\s*말)|(다음\s*달|이번\s*달|이달)\s*말/g, m => {
      const k = /다음/.test(m[0]) ? 1 : 0;
      add('date', ymd(new Date(t0.getFullYear(), t0.getMonth() + k + 1, 0)), m[0]);
    });
    scan(/연말|올해\s*말/g, m => add('date', `${t0.getFullYear()}-12-31`, m[0]));
    // 5) 요일
    const weekday = (when, ch, src) => {
      const idx = '월화수목금토일'.indexOf(ch);
      if (idx < 0) return false;
      const mon = addDays(t0, -((t0.getDay() + 6) % 7));
      let d;
      if (!when) { d = addDays(mon, idx); if (d < t0) d = addDays(d, 7); }
      else {
        const k = /다다음/.test(when) ? 14 : /다음/.test(when) ? 7 : /(지난|저번)/.test(when) ? -7 : 0;
        d = addDays(mon, idx + k);
      }
      add('date', ymd(d), src);
    };
    scan(/(이번\s*주|금주|다다음\s*주|다음\s*주|지난\s*주|저번\s*주)?\s*([월화수목금토일])\s*요일/g, m => weekday(m[1], m[2], m[0]));
    scan(/(이번\s*주|금주|다다음\s*주|다음\s*주|지난\s*주|저번\s*주)\s*([월화수목금토일])(?=$|[\s,.!?]|까지|에|부터|로|은|는|이|가|쯤|전)/g, m => weekday(m[1], m[2], m[0]));
    scan(/(이번\s*주|다음\s*주)?\s*주말/g, m => weekday(m[1] || null, '토', m[0]));
    // 6) 기간: "3일 뒤", "일주일 후", "이틀 미뤄", "1시간 당겨", "30분 늦춰"
    const DUR = /(\d+|하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘|보름|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|일|이|삼|사|오|육)\s*(일|날|주일|주|달|개월|시간|분)?(?:\s*(?:정도|쯤|가량))?\s*(뒤로|후로|뒤에|후에|뒤|후|이후|지나서|있다가|만에|전으로|전에|전|앞으로)?/g;
    scan(DUR, m => {
      const word = m[1], unit = m[2] || '', tail = m[3] || '';
      if (DAYW[word] === undefined && !unit) return false;            // "3" 혼자는 기간이 아님
      if (SINO[word] !== undefined && !/^(주일|주|개월)$/.test(unit)) return false; // 일주일·이주·삼개월만
      if (NATIVE[word] !== undefined && !/^(주|달|시간)$/.test(unit) && DAYW[word] === undefined) return false;
      if (unit === '일' && !tail && !shiftDir) return false;           // "5일"은 날짜(아래에서)
      const n = numOf(word);
      if (!(n > 0)) return false;
      const back = /전/.test(tail) || (shiftDir < 0 && !/뒤|후/.test(tail));
      const sign = back ? -1 : 1;
      if (unit === '시간' || unit === '분') {
        const mins = unit === '시간' ? Math.round(n * 60) : n;
        if (!shiftDir && !tail) return false;
        add('shiftMinutes', sign * mins, m[0]);
        return;
      }
      const days = unit === '주' || unit === '주일' ? n * 7 : unit === '달' || unit === '개월' ? null : n;
      // 미뤄·당겨·뒤로 → 지금 마감에서, 그냥 "뒤/후" → 오늘에서
      const fromBase = mode !== 'quick' && (shiftDir !== 0 || /로$/.test(tail)); // 새로 넣는 일에는 미룰 '지금 마감'이 없다 → 오늘에서 센다
      if (fromBase) {
        if (days === null) add('shiftMonths', sign * n, m[0]);
        else add('shiftDays', sign * days, m[0]);
      } else {
        const d = days === null ? addMonths(t0, sign * n) : addDays(t0, sign * days);
        add('date', ymd(d), m[0]);
      }
    });
    // 7) 그냥 "N일"(이번 달, 지났으면 다음 달)
    scan(/(?<![\d.])(\d{1,2})\s*일(?!\s*(?:뒤|후|전|간|동안|째|부터|마다|이내|정도|쯤))/g, m => {
      const d = +m[1];
      let dt = new Date(t0.getFullYear(), t0.getMonth(), d);
      if (d < 1 || d > 31 || dt.getDate() !== d) return false;
      if (dt < t0) dt = new Date(t0.getFullYear(), t0.getMonth() + 1, d);
      add('date', ymd(dt), m[0]);
    });
    // 8) 시각
    const hourOf = (w) => (/^\d+$/.test(w) ? +w : NATIVE[w]);
    const fixHour = (h, ap) => {
      if (ap === '오전' || ap === '아침' || ap === '새벽') return h === 12 ? 0 : h;
      if (ap === '오후' || ap === '저녁' || ap === '밤') return h < 12 ? h + 12 : (ap === '밤' && h === 12 ? 0 : h);
      if (ap === '점심' || ap === '낮') return h <= 5 ? h + 12 : h;
      return h >= 1 && h <= 6 ? h + 12 : h; // 오전·오후가 없으면 1~6시는 오후로 본다(업무 시간)
    };
    scan(/(오전|오후|아침|점심|낮|저녁|밤|새벽)?\s*(\d{1,2})\s*:\s*(\d{2})/g, m => {
      const h = fixHour(+m[2], m[1]), mi = +m[3];
      if (h > 23 || mi > 59) return false;
      add('time', `${pad(h)}:${pad(mi)}`, m[0]);
    });
    scan(/(오전|오후|아침|점심|낮|저녁|밤|새벽)?\s*(\d{1,2}|열한|열두|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*시(?!간)\s*(?:(\d{1,2})\s*분|(반))?/g, m => {
      const h0 = hourOf(m[2]);
      if (!(h0 >= 0) || h0 > 24) return false;
      const h = h0 === 24 ? 0 : fixHour(h0, m[1]);
      const mi = m[4] ? 30 : +(m[3] || 0);
      if (h > 23 || mi > 59) return false;
      add('time', `${pad(h)}:${pad(mi)}`, m[0]);
    });
    scan(/정오/g, m => add('time', '12:00', m[0]));
    scan(/자정/g, m => add('time', '23:59', m[0]));
    scan(/(오전|오후|아침|저녁|밤)\s*(?:에|중|까지|으로|로)?/g, m => {
      if (acts.some(a => a.type === 'time')) return false;
      add('time', { 오전: '10:00', 아침: '09:00', 오후: '15:00', 저녁: '19:00', 밤: '21:00' }[m[1]], m[0], { rough: true });
    });

    // 9) 중요도
    scan(/★+/g, m => add('imp', Math.min(5, m[0].length), m[0]));
    scan(/별\s*(\d|하나|한\s*개|한개|두\s*개|둘|세\s*개|셋|네\s*개|넷|다섯\s*개|다섯)\s*개?/g, m => {
      const k = m[1].replace(/\s+/g, '');
      const n = /^\d$/.test(k) ? +k : STARW[k];
      if (!(n >= 0 && n <= 5)) return false;
      add('imp', n, m[0]);
    });
    scan(/중요도\s*(?:를|을|는|은)?\s*(\d)\s*(?:점|개)?/g, m => { if (+m[1] > 5) return false; add('imp', +m[1], m[0]); });
    scan(/중요도\s*(?:를|을|는|은)?\s*(하나|한\s*개|둘|두\s*개|셋|세\s*개|넷|네\s*개|다섯|다섯\s*개)(?![가-힣])/g, m => add('imp', STARW[m[1].replace(/\s+/g, '')], m[0]));
    if (!acts.some(a => a.type === 'imp')) {
      // 정확히 맞는 낱말을 긴 것부터 먼저, 없을 때만 한 글자 틀린 것(세 글자 이상 낱말)
      const cx = compact(s);
      const all = IMP_WORDS.flatMap(([v, ws]) => ws.map(w => [v, w])).sort((a, b) => b[1].length - a[1].length);
      let hit = null;
      for (const [v, w] of all) { const f = findWord(cx, w, false); if (f && !spans.some(([x, y]) => f.start < y && f.end > x)) { hit = [v, f]; break; } }
      if (!hit) {
        for (const [v, w] of all) {
          if (w.length < 3) continue;
          const f = findWord(cx, w, true);
          if (f && !f.exact && lev(jamo(f.seen), jamo(w)) <= 1 && !spans.some(([x, y]) => f.start < y && f.end > x)) { hit = [v, f]; break; }
        }
      }
      if (hit) {
        const [v, f] = hit;
        add('imp', v, s.slice(f.start, f.end));
        // 빠른 입력에서는 말끝에 붙은 것("… 제출 중요", "…, 아주 중요.")만 제목에서 뺀다(제목 속 낱말은 남김)
        if (mode === 'edit' || /^[\s,.!?。]*$/.test(s.slice(f.end))) take(f.start, f.end);
      }
    }

    // 10) 동작 낱말 (편집 모드)
    if (mode === 'edit') {
      const cx = compact(s);
      const verb = (kind) => { const f = hasVerb(cx, kind); if (f && !spans.some(([x, y]) => f.start < y && f.end > x)) { take(f.start, f.end); return f; } return null; };
      // 정확히 맞는 낱말을 먼저 찾고, 비슷한 말은 그 뒤에 — "준비 완료"가 '미완료'로 읽히지 않게(짝이 되는 동작이 정확히 있으면 비슷한 말은 안 봄)
      const PAIR = { undone: 'done', done: 'undone', unhide: 'hide', hide: 'unhide' };
      const got = {};
      for (const k of ['undone', 'unhide', 'done', 'hide', 'remove', 'add']) { const f = hasVerb(cx, k, false); if (f && !spans.some(([x, y]) => f.start < y && f.end > x)) { take(f.start, f.end); got[k] = f; } }
      for (const k of ['undone', 'unhide', 'done', 'hide', 'remove', 'add']) { if (got[k] || got[PAIR[k]]) continue; const f = verb(k); if (f) got[k] = f; }
      for (const [k, f] of Object.entries(got)) add(k, true, s.slice(f.start, f.end), f.exact ? {} : { fuzzy: f.seen });
      // 영역: "업무로", "영역을 학교로", "#개발"
      scan(/(?:#|영역\s*(?:을|를|은|는|:)?\s*)(업무|개발|학교|연구|집필|창업|개인)|(업무|개발|학교|연구|집필|창업|개인)\s*(?:영역|으로|로)(?=\s*(?:옮|바꾸|바꿔|변경|이동|해|$))/g, m => add('area', m[1] || m[2], m[0]));
      // 제목·마감 이름
      // "제목을 X로", "이름을 X로"(마감·일정 이름은 아래), "X로 제목 바꿔", "X로 이름 바꿔"
      scan(/(?<!(?:마감|일정)\s*)(?:제목|일\s*이름|이름)\s*(?:을|를|은|는|:)?\s*["'“‘]?(.+?)["'”’]?\s*(?:으로|로)\s*(?:변경|바꿔|바꾸|수정|고쳐|해)?/g, m => add('title', m[1].trim(), m[0]));
      scan(/["'“‘]?([^"'“‘”’을를]+?)["'”’]?\s*(?:으로|로)\s*(?:제목|이름)\s*(?:을|를)?\s*(?:변경|바꿔|바꾸|수정|고쳐)/g, m => add('title', m[1].trim(), m[0]));
      scan(/(?:마감|일정)\s*(?:이름|내용|명)\s*(?:을|를|은|는|:)?\s*["'“‘]?(.+?)["'”’]?\s*(?:으로|로)\s*(?:변경|바꿔|바꾸|수정|해)?/g, m => add('label', m[1].trim(), m[0]));
      const ch = hasVerb(cx, 'change');
      if (ch) notes.push(ch.exact ? `‘${ch.word}’` : `‘${ch.seen}’→‘${ch.word}’`);
      if (laterV && !laterV.exact) notes.push(`‘${laterV.seen}’→‘${laterV.word}’`);
      if (earlierV && !earlierV.exact) notes.push(`‘${earlierV.seen}’→‘${earlierV.word}’`);
      // 방향만 있고 기간이 없으면 하루
      const nextMonth = /다음\s*달\s*로|한\s*달\s*(?:뒤로|미뤄|연기)/.exec(s);
      if (shiftDir && nextMonth && !acts.some(a => /^(date|shiftDays|shiftMonths|shiftMinutes)$/.test(a.type)) && take(nextMonth.index, nextMonth.index + nextMonth[0].length)) add('shiftMonths', shiftDir, nextMonth[0]);
      if (shiftDir && !acts.some(a => /^(date|shiftDays|shiftMonths|shiftMinutes)$/.test(a.type))) add('shiftDays', shiftDir, (laterV || earlierV).word, { assumed: true });
    } else {
      // 빠른 입력: 영역은 #표시·"영역:"·말끝에 홀로 붙은 영역 이름("… 제출, 업무", "… 예약 개인으로")
      scan(/(?:#|영역\s*:\s*)(업무|개발|학교|연구|집필|창업|개인)/g, m => add('area', m[1], m[0]));
      scan(/(?<=^|[\s,])(업무|개발|학교|연구|집필|창업|개인)\s*(?:영역|으로|로)?[\s,.!?。]*$/g, m => {
        if (m.index === 0) return false;
        const before = s.slice(0, m.index);
        const tag = /,\s*$/.test(before) || /영역|으로|로/.test(m[0]) || spans.some(([, y]) => /^[\s,]*$/.test(s.slice(y, m.index)));
        add('area', m[1], m[0]);
        return tag ? undefined : false;
      });
      scan(/(발표|회의|미팅|행사|시험|면접|세미나|교육|워크숍|출장|설명회)/g, m => { add('kind', 'event', m[0]); return false; });
      scan(/(마감|제출|회신|납기|접수|신청)/g, m => { add('kind', 'deadline', m[0]); return false; });
    }

    // 날짜가 여러 개면 마지막 것(보통 "A를 B로"의 B)
    const dates = acts.filter(a => a.type === 'date');
    if (dates.length > 1) for (const d of dates.slice(0, -1)) d.dropped = true;
    const times = acts.filter(a => a.type === 'time');
    if (times.length > 1) for (const t of times.slice(0, -1)) t.dropped = true;
    const kinds = acts.filter(a => a.type === 'kind');
    if (kinds.length > 1) for (const k of kinds.slice(1)) k.dropped = true;
    const final = acts.filter(a => !a.dropped);

    // 남은 글 = 제목(빠른 입력)
    // 떼어 낸 날짜·시각 바로 뒤에 붙은 조사("까지", "에" …)도 함께 뺀다
    let rest = '';
    let last = 0;
    const PART = /^\s*(까지는|까지|에서|부터|에는|에|으로|로|을|를|은|는)(?=\s|$)/;
    for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
      if (a > last) rest += s.slice(last, a) + ' ';
      let e = Math.max(last, b);
      const piece = s.slice(a, e);
      if (/\d$/.test(piece) && /^일(?=$|[\s,.]|날|에|까지|부터|로|은|는)/.test(s.slice(e))) e += 1; // 11.8일 · 27.3.1일
      if (/일$/.test(s.slice(a, e))) { const nm = s.slice(e).match(/^\s*날(?=$|[\s,.]|에|까지)/); if (nm) e += nm[0].length; } // 12월 13일 날
      const pm = s.slice(e).match(PART);
      if (pm) e += pm[0].length;
      last = e;
    }
    rest += s.slice(last);
    // 말로 받아 적은 글의 쉼표·마침표가 떼어 낸 자리에 남으면 지운다("제출, , 업무" → "제출")
    rest = rest.replace(/[★☆]/g, ' ').replace(/(?:\s*[,.!?。]+\s*)+(?=\s|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,·:\-~]+|[\s,·:\-~]+$/g, '').trim();
    return { actions: final, title: rest, notes, fixed: s !== raw ? s : '', toks };
  }

  // 해석 결과를 지금 값에 적용해 바뀔 값을 계산(화면의 확인 창에 씀)
  // cur: { date, time, imp, area, title, label, done, hidden }
  function apply(result, cur, opts = {}) {
    const now = opts.now || new Date();
    const out = { ...cur };
    const changes = [];
    const set = (k, v, why) => { if (out[k] !== v) { changes.push({ key: k, from: out[k], to: v, why }); out[k] = v; } };
    let baseDate = cur.date || ymd(today0(now));
    for (const a of result.actions) {
      if (a.type === 'date') { set('date', a.value, a.src); baseDate = a.value; }
    }
    for (const a of result.actions) {
      if (a.type === 'shiftDays') set('date', ymd(addDays(parseYmd(out.date || baseDate), a.value)), a.src + (a.assumed ? ' (하루로 봄)' : ''));
      if (a.type === 'shiftMonths') set('date', ymd(addMonths(parseYmd(out.date || baseDate), a.value)), a.src);
    }
    for (const a of result.actions) {
      if (a.type === 'time') set('time', a.value, a.src + (a.rough ? ' (대략)' : ''));
      if (a.type === 'shiftMinutes') {
        const [h, m] = String(out.time || opts.dueTime || '18:00').split(':').map(Number);
        let t = h * 60 + m + a.value, day = 0;
        while (t < 0) { t += 1440; day--; }
        while (t >= 1440) { t -= 1440; day++; }
        if (day) set('date', ymd(addDays(parseYmd(out.date || baseDate), day)), a.src);
        set('time', `${pad(Math.floor(t / 60))}:${pad(t % 60)}`, a.src);
      }
      if (a.type === 'imp') set('imp', a.value, a.src);
      if (a.type === 'area') set('area', a.value, a.src);
      if (a.type === 'title') set('title', a.value, a.src);
      if (a.type === 'label') set('label', a.value, a.src);
      if (a.type === 'kind') set('kind', a.value, a.src);
      if (a.type === 'done') set('done', true, a.src);
      if (a.type === 'undone') set('done', false, a.src);
      if (a.type === 'hide') set('hidden', true, a.src);
      if (a.type === 'unhide') set('hidden', false, a.src);
      if (a.type === 'remove') set('removeDl', true, a.src);
      if (a.type === 'add') set('addNew', true, a.src);
    }
    return { next: out, changes };
  }

  function fmtDate(s) {
    if (!s) return '없음';
    const d = parseYmd(s);
    return `${d.getMonth() + 1}.${pad(d.getDate())}(${WD[d.getDay()]})`;
  }

  const api = { parse, apply, fmtDate, jamo, lev, fixTypos, ymd, AREAS, numReads, lessonFrom, teach, describeRead, READ_NAME, SHAPE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NLP = api;
})(typeof window !== 'undefined' ? window : globalThis);
