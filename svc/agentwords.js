// 비서용 계산: 말하기 좋은 날짜, 일 이름 찾기, 말 빠르기 판단. 순수 계산만(시험: Node).
const NLP = require('../ui/nlp');

const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function daysBetween(now, ymd) { const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return Math.round((parseYmd(ymd) - t0) / 86400000); }
function spokenTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? '오전' : '오후', hh = h % 12 || 12;
  return `${ap} ${hh}시${m ? ` ${m}분` : ''}`;
}
// "내일 오후 3시", "이번 주 금요일 오전 9시", "11월 19일 오후 2시 30분", "사흘 지남"
function spokenWhen(ymd, time, now = new Date()) {
  if (!ymd) return '날짜 없음';
  const d = parseYmd(ymd), n = daysBetween(now, ymd), wd = '일월화수목금토'[d.getDay()] + '요일';
  let day;
  if (n === 0) day = '오늘'; else if (n === 1) day = '내일'; else if (n === 2) day = '모레'; else if (n === -1) day = '어제';
  else if (n < -1) day = `${-n}일 지남(${d.getMonth() + 1}월 ${d.getDate()}일)`;
  else {
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    if (n <= 7 - dow) day = `이번 주 ${wd}`; else if (n <= 14 - dow) day = `다음 주 ${wd}`; else day = `${d.getMonth() + 1}월 ${d.getDate()}일 ${wd}`;
  }
  return [day, spokenTime(time)].filter(Boolean).join(' ');
}
function itemBrief(it, now = new Date()) {
  const d = it.fdl;
  return { title: it.title, when: d ? spokenWhen(d.date, d.time, now) : '마감 없음', what: d ? d.label : '', days_left: d ? daysBetween(now, d.date) : null, stars: it.importance || 0, area: it.area, topic: it.group, status: it.status || '', next: it.nextAction || '', done: !!it.done, other_deadlines: (it.deadlines || []).filter(x => !x.done && (!d || x.date !== d.date)).slice(0, 3).map(x => `${spokenWhen(x.date, x.time, now)} ${x.label}`) };
}

// 일 이름 찾기: 띄어쓰기 무시, 일부만 말해도, 약간 틀려도. 돌려줌 [{ it, score }] 높은 순
const norm = s => String(s || '').toLowerCase().replace(/[\s·,.\-_()[\]「」]/g, '');
function findItems(items, query) {
  const q = norm(query);
  if (!q) return [];
  const qj = NLP.jamo(q);
  const out = [];
  for (const it of items) {
    const t = norm(it.title), g = norm(it.group);
    let score = 0;
    if (t === q) score = 1;
    else if (t.includes(q)) score = 0.86 + 0.1 * (q.length / t.length);
    else if (q.includes(t) && t.length >= 2) score = 0.8;
    else if (g === q) score = 0.78;
    else if (g.includes(q) && q.length >= 2) score = 0.7;
    else {
      // 낱말이 얼마나 겹치나 + 소리가 얼마나 비슷한가
      const words = String(query).split(/\s+/).map(norm).filter(w => w.length >= 2);
      const hit = words.filter(w => t.includes(w) || g.includes(w)).length;
      if (words.length) score = 0.65 * (hit / words.length);
      const tj = NLP.jamo(t);
      let best = Infinity;
      if (qj.length <= tj.length) for (let i = 0; i + qj.length <= tj.length; i += 1) best = Math.min(best, NLP.lev(tj.slice(i, i + qj.length), qj));
      else best = NLP.lev(tj, qj);
      score = Math.max(score, 0.75 * (1 - best / Math.max(qj.length, 1)));
    }
    if (score >= 0.45) out.push({ it, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- 말 빠르기 ----------
const URGENT = /급해|급하|급합|바빠|바쁘|바쁩|서둘|얼른|빨리\s*(좀|요)?\s*$|시간\s*없|지금\s*당장|hurry|quick(ly)?|asap|urgent|rush|in a rush/i;
// 말 빠르기를 직접 시킨 말 → 무엇을 할지. 없으면 null
function rateCommand(text) {
  const t = String(text || '');
  let m;
  const speechWord = /(말|속도|빠르|배속|읽|얘기|이야기|speak|talk|speed)/i.test(t);
  if ((m = /(\d(?:\.\d)?)\s*배속/.exec(t))) return { set: Number(m[1]) };
  if (speechWord && (m = /(\d(?:\.\d)?)\s*(배|x\b|times)/i.exec(t))) return { set: Number(m[1]) };
  if (speechWord && /두\s*배/.test(t)) return { set: 2 };
  if (/(원래|보통|기본|정상)\s*(속도|빠르기|대로)|normal speed|regular speed/i.test(t)) return { set: 1 };
  if (/(좀|더|조금|훨씬)?\s*(천천히|느리게|느릿)|slow(er)?\s*down|speak\s*slow|talk\s*slow|more slowly/i.test(t)) return { step: -0.25 };
  if (/(좀|더|조금|훨씬)?\s*(빠르게|빨리)\s*(좀\s*)?(말|얘기|이야기|읽|해\s*줘|해줘|해\s*봐|하자)|말\s*(좀\s*)?(빠르게|빨리)|speak\s*(faster|quick)|talk\s*(faster|quick)|faster please|speed up/i.test(t)) return { step: +0.25 };
  return null;
}
function isUrgent(text) { return URGENT.test(String(text || '')); }
// 말한 글자 수와 실제 말한 시간으로 사용자의 말 속도(보통 대비 배수)
function paceOf(text, voicedSec) {
  const t = String(text || '').replace(/[\s.,!?。~·]/g, '');
  if (!t || voicedSec < 0.6) return 1;
  const han = (t.match(/[가-힣]/g) || []).length;
  const isKo = han >= t.length / 3;
  // 낱자 기준 보통 속도: 한국어 초당 약 5.5글자, 영어 초당 약 13글자
  return (t.length / voicedSec) / (isKo ? 5.5 : 13);
}
// 자동 배수: 말이 빠르거나 급한 말을 하거나 임박한 마감이 있으면 빨라진다. 느긋하게 말하면 살짝 느려진다.
function autoFactor({ pace = 1, urgent = false, soonMinutes = null } = {}) {
  let f = 1;
  if (pace > 1.15) f += Math.min(0.3, (pace - 1.15) * 0.8);
  else if (pace < 0.75) f -= 0.08;
  if (urgent) f += 0.25;
  if (soonMinutes != null && soonMinutes <= 60 && soonMinutes >= 0) f += 0.1;
  return Math.round(Math.max(0.9, Math.min(1.6, f)) * 100) / 100;
}

module.exports = { daysBetween, spokenTime, spokenWhen, itemBrief, findItems, rateCommand, isUrgent, paceOf, autoFactor };
