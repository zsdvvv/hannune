// 본 창·미니 창이 함께 쓰는 작은 도우미
const WD = '일월화수목금토';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysFromToday(s) {
  const t = new Date(); const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((parseYmd(s) - t0) / 86400000);
}
function shortDate(s, time) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} ${WD[d.getDay()]}${time ? ' ' + time : ''}`;
}
function areaColor(board, area) {
  const a = board && board.areas.find(x => x.id === area);
  return a ? a.color : '#5F6B73';
}
// 이 일의 "보여 줄 마감": 지난 것(확인 필요)이 있으면 그것, 아니면 다음 마감
function focusDl(it) { return it.fdl !== undefined ? it.fdl : (it.overdueDl || it.nextDl || null); }
function ddClass(days) {
  if (days == null) return 'none';
  if (days <= 3) return 'red';
  if (days <= 7) return 'orange';
  return '';
}
function ddHTML(it) {
  const d = focusDl(it);
  if (!d) return `<div class="dd none"><div class="big">—</div><div class="sub">${esc(it.lastRel || '')}</div></div>`;
  const n = d.days;
  let big;
  if (n < 0) big = `<span class="stamp">${-n}일 지남</span>`;
  else if (n === 0) big = '오늘';
  else if (n === 1) big = '내일';
  else big = `<small>D-</small>${n}`;
  return `<div class="dd ${ddClass(n)}"><div class="big">${big}</div><div class="sub">${shortDate(d.date, d.time)}</div></div>`;
}
function ddText(it) {
  const d = focusDl(it);
  if (!d) return '—';
  if (d.days < 0) return `${-d.days}일 지남`;
  if (d.days === 0) return '오늘';
  if (d.days === 1) return '내일';
  return 'D-' + d.days;
}
function starsHTML(it, n = 5) {
  let s = '<span class="stars">';
  for (let i = 1; i <= n; i++) s += `<b class="${i <= (it.importance || 0) ? 'on' : ''}" data-act="imp" data-id="${esc(it.id)}" data-v="${i}">${i <= (it.importance || 0) ? '★' : '☆'}</b>`;
  return s + '</span>';
}
// 활동 막대. g = 그래프 설정 { height, bar, color:'area'|'one', custom }
function sparkHTML(arr, g) {
  g = g || { height: 22, bar: 5 };
  const h = g.height || 22, w = g.bar || 5;
  const max = Math.max(3, ...arr);
  const col = g.color === 'one' ? `background:${g.custom || '#2B4C7E'};` : '';
  return `<div class="spark" style="height:${h}px" title="최근 ${arr.length}일 활동 · 오른쪽 클릭: 그래프 설정">` + arr.map(v => v
    ? `<i style="${col}width:${w}px;height:${Math.max(3, Math.round(h * Math.sqrt(v / max)))}px"></i>`
    : `<i class="z" style="width:${w}px"></i>`).join('') + '</div>';
}
// 일의 활동(날짜별 횟수)에서 최근 n일 막대 값
function sparkOf(it, days) {
  const t = new Date(); const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push((it.activity || {})[ymd(new Date(t0.getTime() - i * 86400000))] || 0);
  return out;
}
const BAND_ORDER = ['overdue', 'today', 'd3', 'd7', 'd14', 'd31', 'later', 'none', 'sleep', 'done'];
function urgencySort(a, b) {
  const ba = BAND_ORDER.indexOf(a.band), bb = BAND_ORDER.indexOf(b.band);
  if (ba !== bb) return ba - bb;
  if (a.band === 'none' || a.band === 'sleep' || a.band === 'done') return (b.lastTs || 0) - (a.lastTs || 0);
  const da = a.days ?? 9999, db = b.days ?? 9999;
  if (da !== db) return da - db;
  if ((b.importance || 0) !== (a.importance || 0)) return (b.importance || 0) - (a.importance || 0);
  return (b.lastTs || 0) - (a.lastTs || 0);
}
