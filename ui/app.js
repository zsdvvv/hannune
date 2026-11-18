// 한눈에 — 본 창
const S = {
  board: null, set: null, view: 'list', sel: null, f: { area: null, group: null, sp: null }, q: '', sort: 'urgency',
  openAreas: {}, fold: {}, ai: {}, cal: null, act: null, scanBusy: false, brief: false, briefArmed: false, modal: null,
};
const byId = id => S.board && S.board.items.find(i => i.id === id);
const color = area => areaColor(S.board, area);

// ---------- 걸러내기 ----------
function visible() {
  const q = S.q.trim().toLowerCase();
  return S.board.items.filter(it => {
    if (S.f.sp === 'hidden') return it.hidden;
    if (it.hidden) return false;
    if (S.f.sp === 'done') return it.band === 'done' || it.done;
    if (S.set.hideDone && it.done) return false;
    if (S.f.sp === 'urgent' && !['overdue', 'today', 'd3'].includes(it.band)) return false;
    if (S.f.sp === 'mine' && it.kind !== 'manual') return false;
    if (S.f.area && it.area !== S.f.area) return false;
    if (S.f.group && it.group !== S.f.group) return false;
    if (q && !`${it.title} ${it.group} ${it.area} ${it.hook || ''} ${it.summary || ''} ${it.nextAction || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function sorted(items) {
  const a = [...items];
  if (S.sort === 'importance') a.sort((x, y) => (y.importance || 0) - (x.importance || 0) || urgencySort(x, y));
  else if (S.sort === 'recent') a.sort((x, y) => (y.lastTs || 0) - (x.lastTs || 0));
  else a.sort(urgencySort);
  return a;
}
const isActive = it => !it.hidden && it.band !== 'done' && !it.done;
// 완료 체크: 내가 체크했거나 AI가 끝난 것으로 본 일
const isChecked = it => it.done || it.band === 'done';
const ckHTML = (it, title = '완료 체크 (X)') => `<label class="ck" title="${title}"><input type="checkbox" data-act="check" data-id="${esc(it.id)}" ${isChecked(it) ? 'checked' : ''}><i></i></label>`;

// ---------- 그리기 ----------
function render() {
  if (!S.board) return;
  applyLayout();
  renderBar(); renderSide(); renderMain(); renderDetail(); renderStatus();
  if (S.brief) renderBrief();
}
// 칸 너비·그래프 칸 너비를 설정대로
function applyLayout() {
  const ui = S.set.ui || {};
  const fr = $('#frame');
  fr.style.setProperty('--side-w', (ui.sideW || 236) + 'px');
  fr.style.setProperty('--detail-w', (ui.detailW || 400) + 'px');
  const g = S.set.graph || {};
  const sw = Math.max(60, (g.days || 14) * ((g.bar || 5) + 2));
  fr.style.setProperty('--spark-w', sw + 'px');
  $('#splitL').hidden = !!ui.sideCollapsed;
  $('#splitR').hidden = $('#detail').hidden;
  // 창이 좁으면 칸들이 찌그러지지 않게 전체 최소 너비를 정하고 가로 스크롤로 본다
  const circleEl = document.getElementById('circle');
  const circleW = circleEl && !circleEl.hidden ? (document.body.classList.contains('circle-open') && document.body.classList.contains('circle-pinned') ? circleEl.offsetWidth : 18) : 0;
  const need = (ui.sideCollapsed ? 30 : (ui.sideW || 236)) + 380 + ($('#detail').hidden ? 0 : (ui.detailW || 400)) + 12 + circleW;
  fr.style.minWidth = Math.max(900, need) + 'px';
}

function renderBar() {
  const now = new Date();
  $('#today').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일`;
  $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  $('#btnPin').classList.toggle('on', !!(S.set && S.set.main.pinned));
  $('#btnScan').classList.toggle('busy', S.scanBusy);
  $('#btnScan').textContent = S.scanBusy ? '읽는 중…' : '다시 읽기';
  $('#btnAI').classList.toggle('busy', !!S.ai.running);
  $('#btnAI').textContent = S.ai.running ? 'AI 정리 중…' : 'AI 정리';
  $('#rec').hidden = !(S.act && S.act.on);
  $('#rec').textContent = S.act && S.act.away ? '● 창 기록 (자리 비움)' : '● 창 기록 중';
}

// 왼쪽 칸: 묶음(영역·정리 대기·찾은 일정·보관)마다 접기, 칸 전체 접기
const secOpen = name => !((S.set.ui && S.set.ui.collapsed) || {})[name];
const secHead = (name, label) => `<h4 data-act="sec" data-sec="${name}"><span class="tw2">${secOpen(name) ? '▾' : '▸'}</span>${label}</h4>`;
function renderSide() {
  const side = $('#side');
  if (S.set.ui && S.set.ui.sideCollapsed) {
    side.classList.add('collapsed');
    side.innerHTML = `<div class="rail" data-act="side-open" title="왼쪽 칸 펴기">▶ 영역 · 찾은 일정 · 보관</div>`;
    return;
  }
  side.classList.remove('collapsed');
  const items = S.board.items;
  const act = items.filter(isActive);
  const hot = it => ['overdue', 'today', 'd3'].includes(it.band);
  const row = (label, opts) => `<div class="srow ${opts.on ? 'on' : ''} ${opts.sub ? 'sub' : ''}" data-act="side" ${opts.data}>
    ${opts.tw !== undefined ? `<span class="tw" data-act="tw" data-area="${esc(opts.area)}">${opts.tw}</span>` : ''}
    ${opts.sw ? `<span class="sw" style="background:${opts.sw}"></span>` : ''}<span>${esc(label)}</span>
    <span class="cnt">${opts.cnt ?? ''}</span>${opts.hot ? `<span class="hot">${opts.hot}</span>` : ''}</div>`;
  const none = !S.f.area && !S.f.group && !S.f.sp;
  let h = `<div class="side-top"><button data-act="side-close" title="왼쪽 칸 접기 (가운데 경계선을 두 번 눌러도 됨)">◀ 접기</button></div>`;
  h += row('전체', { on: none, data: 'data-sp=""', cnt: act.length, hot: act.filter(hot).length });
  h += row('급한 일 (지남·오늘·3일)', { on: S.f.sp === 'urgent', data: 'data-sp="urgent"', cnt: act.filter(hot).length });
  const mine = act.filter(it => it.kind === 'manual').length;
  if (mine) h += row('내가 넣은 일', { on: S.f.sp === 'mine', data: 'data-sp="mine"', cnt: mine });
  h += secHead('area', '영역');
  if (secOpen('area')) for (const a of S.board.areas) {
    const list = act.filter(it => it.area === a.id);
    if (!list.length) continue;
    const open = S.openAreas[a.id] ?? (S.f.area === a.id);
    h += row(a.id, { on: S.f.area === a.id && !S.f.group, data: `data-area="${esc(a.id)}"`, sw: a.color, cnt: list.length, hot: list.filter(hot).length, tw: open ? '▾' : '▸', area: a.id });
    if (open) {
      const groups = {};
      for (const it of list) (groups[it.group] = groups[it.group] || []).push(it);
      for (const [g, gl] of Object.entries(groups).sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))) {
        h += row(g, { sub: true, on: S.f.group === g && S.f.area === a.id, data: `data-area="${esc(a.id)}" data-group="${esc(g)}"`, cnt: gl.length, hot: gl.filter(hot).length });
      }
    }
  }
  h += secHead('wait', '정리 대기');
  if (secOpen('wait')) {
    h += row('분류 안 된 Claude 대화', { on: S.f.sp === 'sessions', data: 'data-sp="sessions"', cnt: S.board.unassigned.length });
    h += row('분류 안 된 최근 문서', { on: S.f.sp === 'docs', data: 'data-sp="docs"', cnt: S.board.looseDocs.length });
  }
  h += secHead('found', '문서에서 찾은 일정');
  if (secOpen('found')) {
    const fu = (S.board.found || []).filter(f => f.days >= 0 && f.aiKeep !== false);
    h += row('찾은 일정', { on: S.f.sp === 'found', data: 'data-sp="found"', cnt: fu.length ? `${fu.filter(f => f.on).length}/${fu.length}` : ((S.set.docFolders || []).length ? '0' : '폴더 지정') });
  }
  h += secHead('keep', '보관');
  if (secOpen('keep')) {
    h += row('끝낸 일', { on: S.f.sp === 'done', data: 'data-sp="done"', cnt: items.filter(it => !it.hidden && isChecked(it)).length });
    h += row('숨긴 일', { on: S.f.sp === 'hidden', data: 'data-sp="hidden"', cnt: items.filter(it => it.hidden).length });
  }
  side.innerHTML = h;
}

function renderMain() {
  const m = $('#main');
  // 찾은 일정의 이름을 고치는 중이면 다시 그리지 않는다(입력이 날아가지 않게)
  if (m.contains(document.activeElement) && document.activeElement.classList.contains('flabel')) return;
  const keep = m.scrollTop, keepX = m.scrollLeft;
  if (S.f.sp === 'sessions') m.innerHTML = sessionsHTML();
  else if (S.f.sp === 'docs') m.innerHTML = docsHTML();
  else if (S.f.sp === 'found') m.innerHTML = foundHTML();
  else if (S.view === 'matrix') m.innerHTML = matrixHTML(visible());
  else if (S.view === 'timeline') m.innerHTML = timelineHTML(visible());
  else m.innerHTML = listHTML(visible());
  m.scrollTop = keep; m.scrollLeft = keepX;
}

// ----- 목록 -----
function summaryLine(items) {
  const act = items.filter(isActive);
  const wk = act.filter(it => it.nextDl && it.nextDl.days <= 7).length;
  const ov = act.filter(it => it.band === 'overdue').length;
  const ng = act.filter(it => it.neglect).length;
  return `7일 안 마감 <b>${wk}</b> · 지남 확인 <b>${ov}</b> · 손 안 댄 급한 일 <b>${ng}</b>`;
}
function listHTML(items) {
  const seg = [['urgency', '긴박한 순'], ['importance', '중요한 순'], ['recent', '최근 작업 순']]
    .map(([k, n]) => `<button class="${S.sort === k ? 'on' : ''}" data-act="sort" data-v="${k}">${n}</button>`).join('');
  const doneN = S.board.items.filter(it => it.doneInPlace && !it.hidden).length;
  let h = `<div class="toolbar"><span>정렬</span><div class="seg">${seg}</div>
    <div class="seg"><button class="${S.set.hideDone ? 'on' : ''}" data-act="hidedone" title="체크한 일을 목록에서 바로 감춤(끝낸 일 보관함에는 남음)">끝낸 일 감추기${doneN ? ` (${doneN})` : ''}</button></div>
    <span class="sum">${summaryLine(items)}</span></div>`;
  if (!S.f.sp && !S.f.area && !S.q) h += welcomeHTML();
  if (!items.length) return h + `<div class="empty">보일 일이 없습니다. 아래 ‘바로 넣기’에 할 일을 써 보세요.</div>`;
  if (S.sort !== 'urgency') return h + `<div class="band">${sorted(items).map(rowHTML).join('')}</div>`;
  const by = {};
  for (const it of sorted(items)) (by[it.band] = by[it.band] || []).push(it);
  for (const b of S.board.bands) {
    const list = by[b.id];
    if (!list) continue;
    const folded = S.fold[b.id] ?? !!b.collapsed;
    const hot = ['overdue', 'today', 'd3'].includes(b.id);
    h += `<div class="band"><div class="band-h ${hot ? 'hot' : ''}" data-act="fold" data-band="${b.id}"><span class="fold">${folded ? '▸' : '▾'}</span>${esc(b.name)}<span class="c">${list.length}</span></div>`;
    if (!folded) h += list.map(rowHTML).join('');
    h += '</div>';
  }
  return h;
}
function srcName(d) {
  if (d.src === 'me') return '내가 넣음';
  if (d.src === 'doc') return '문서에서';
  if (d.confirmed) return '확정';
  return d.src === 'ai' ? 'AI 추정' : '글에서 추정';
}
function rowHTML(it) {
  const a = color(it.area);
  const d = focusDl(it);
  const parts = [`<span class="chip" style="--a:${a}">${esc(it.group)}</span>`];
  if (d) parts.push(`<span class="lbl ${d.confirmed ? '' : 'guess'}" title="${srcName(d)}">${esc(d.label)}</span>`);
  const rest = it.deadlines.filter(x => !x.done && x.days >= 0 && (!d || x.date !== d.date));
  if (rest.length) parts.push(`<span>다음 ${esc(rest[0].label)} ${rest[0].days === 0 ? '오늘' : 'D-' + rest[0].days}${rest.length > 1 ? ` 외 ${rest.length - 1}` : ''}</span>`);
  if (it.overdueDl && d && d !== it.overdueDl) parts.push(`<span class="warn">지난 마감 확인: ${esc(it.overdueDl.label)}</span>`);
  if (it.neglect) parts.push(`<span class="warn">${it.neglect}일째 손 안 댐</span>`);
  if (it.nextAction) parts.push(`<span>→ ${esc(it.nextAction)}</span>`);
  else if (!d && it.hook) parts.push(`<span>${esc(String(it.hook).slice(0, 80))}</span>`);
  const focus = it.todayFocus ? `<span class="f">오늘 ${Math.round(it.todayFocus)}분</span>` : '';
  if (it.aiDone) parts.unshift('<span>AI가 끝난 것으로 봄</span>');
  return `<div class="row ${S.sel === it.id ? 'on' : ''} ${isChecked(it) ? 'done' : ''}" data-act="sel" data-id="${esc(it.id)}" style="--a:${a}">
    ${ckHTML(it)}
    ${ddHTML(it)}
    <div class="ttl"><div class="t">${esc(it.title)}</div><div class="m">${parts.join(' · ')}</div></div>
    <div class="sc" style="--a:${a}">${sparkHTML(sparkOf(it, S.set.graph.days), S.set.graph)}</div>
    ${starsHTML(it)}
    <div class="last">${esc(it.lastRel || '')}${focus}</div>
  </div>`;
}

// ----- 4분면 -----
function matrixHTML(items) {
  const set = S.set;
  const act = sorted(items.filter(it => (isActive(it) || it.doneInPlace) && it.band !== 'sleep'));
  const urgent = it => it.days != null && it.days <= set.urgentDays;
  const imp = it => (it.importance || 0) >= set.importantMin;
  const Q = [
    ['q1', '지금 하기', `급함 · 중요`, act.filter(it => urgent(it) && imp(it))],
    ['q2', '계획 잡기', `안 급함 · 중요 — 미리 시간을 떼어 둘 일`, act.filter(it => !urgent(it) && imp(it))],
    ['q3', '빨리 끝내기', `급함 · 덜 중요 — 짧게 처리하거나 맡길 일`, act.filter(it => urgent(it) && !imp(it))],
    ['q4', '나중에', `안 급함 · 덜 중요`, act.filter(it => !urgent(it) && !imp(it))],
  ];
  const unrated = act.filter(it => !it.importance && !it.done).length;
  let h = `<div class="toolbar"><span>급함 = D-${set.urgentDays} 이내 · 중요 = ★${set.importantMin} 이상</span>
    <span class="sum">${unrated ? `중요도 안 매긴 일 <b>${unrated}</b> — 점선 카드의 별을 누르거나 위·아래 칸으로 끌어 옮기세요` : summaryLine(items)}</span></div>`;
  h += `<div class="mx-axis"><span>← 급함 (마감 가까움)</span><span>여유 있음 →</span></div><div class="matrix">`;
  for (const [cls, name, hint, list] of [Q[0], Q[1], Q[2], Q[3]].sort((x, y) => ['q1', 'q2', 'q3', 'q4'].indexOf(x[0]) - ['q1', 'q2', 'q3', 'q4'].indexOf(y[0]))) {
    h += `<div class="quad ${cls}" data-q="${cls}"><h3>${name}<span class="c">${list.length}</span></h3><div class="hint">${esc(hint)}</div>${list.map(cardHTML).join('')}</div>`;
  }
  return h + '</div>';
}
// 화면 배치: 위 = 중요, 왼쪽 = 급함 → [q1 q2 / q3 q4]
function cardHTML(it) {
  const a = color(it.area);
  const d = focusDl(it);
  return `<div class="card ${it.importance ? '' : 'unrated'} ${S.sel === it.id ? 'on' : ''} ${isChecked(it) ? 'done' : ''}" draggable="true" data-act="sel" data-id="${esc(it.id)}" style="--a:${a}">
    ${ckHTML(it)}${ddHTML(it)}<div style="min-width:0"><div class="t">${esc(it.title)}</div><div class="g">${esc(it.group)}${d ? ' · ' + esc(d.label) : ''}</div></div>${starsHTML(it)}</div>`;
}

// ----- 달력 띠 -----
function timelineHTML(items) {
  const t = new Date(); const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const days = [];
  for (let i = -7; i < 50; i++) days.push(new Date(t0.getTime() + i * 86400000));
  const keys = days.map(ymd);
  const first = keys[0], last = keys[keys.length - 1];
  const rows = items.filter(it => !it.hidden && it.band !== 'done' &&
    (it.deadlines.some(d => d.date >= first && d.date <= last) || Object.keys(it.activity || {}).some(k => k >= first) || it.band !== 'sleep'));
  // 달 머리
  let mon = '<tr><th class="lab"></th>';
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j < days.length && days[j].getMonth() === days[i].getMonth()) j++;
    mon += `<th class="mon" colspan="${j - i}">${days[i].getMonth() + 1}월</th>`;
    i = j;
  }
  mon += '</tr>';
  let dayRow = '<tr><th class="lab"></th>';
  days.forEach((d, k) => {
    const we = d.getDay() === 0 || d.getDay() === 6;
    dayRow += `<th class="day ${we ? 'we' : ''} ${k === 7 ? 'td' : ''}">${d.getDate()}<span class="w">${WD[d.getDay()]}</span></th>`;
  });
  dayRow += '</tr>';
  const load = keys.map(k => rows.reduce((n, it) => n + it.deadlines.filter(d => d.date === k && !d.done).length, 0));
  let loadRow = `<tr class="load"><td class="lab" style="font-size:11.5px;color:var(--ink-3)">하루 마감 수</td>${load.map(n => `<td class="c">${n || ''}</td>`).join('')}</tr>`;
  let body = '';
  for (const a of S.board.areas) {
    const list = sorted(rows.filter(it => it.area === a.id));
    if (!list.length) continue;
    body += `<tr class="arow" style="--a:${a.color}"><td class="lab">${esc(a.id)}</td><td class="fill" colspan="${days.length}"></td></tr>`;
    for (const it of list) {
      const max = Math.max(3, ...keys.map(k => (it.activity || {})[k] || 0));
      let cells = '';
      days.forEach((d, k) => {
        const key = keys[k];
        const we = d.getDay() === 0 || d.getDay() === 6;
        const v = (it.activity || {})[key] || 0;
        const heat = v ? `<i class="h" style="opacity:${(0.15 + 0.6 * Math.sqrt(v / max)).toFixed(2)}"></i>` : '';
        const dl = it.deadlines.find(x => x.date === key);
        // 4일 안에 다음 표시가 있으면 꼬리표는 빼서 겹치지 않게
        const crowded = dl && it.deadlines.some(x => x.date > key && x.date <= keys[Math.min(k + 4, keys.length - 1)]);
        const mk = dl ? `<span class="mk ${dl.kind === 'event' ? 'ev' : ''} ${dl.done ? 'done' : ''}" title="${esc(dl.label)} · ${shortDate(dl.date, dl.time)}">${dl.kind === 'event' ? '●' : '◆'}</span>${crowded ? '' : `<span class="ml">${esc(dl.label)}</span>`}` : '';
        cells += `<td class="c ${we ? 'we' : ''} ${k === 7 ? 'td' : ''}">${heat}${mk}</td>`;
      });
      body += `<tr class="irow ${S.sel === it.id ? 'on' : ''} ${isChecked(it) ? 'done' : ''}" style="--a:${a.color}"><td class="lab" data-act="sel" data-id="${esc(it.id)}" title="${esc(it.title)}"><span class="num" style="display:inline-block;width:52px;color:${ddClass(it.days) === 'red' ? 'var(--red)' : 'var(--ink-3)'}">${ddText(it)}</span>${esc(it.title)}</td>${cells}</tr>`;
    }
  }
  return `<div class="tl"><div class="legend"><span>◆ 마감</span><span style="color:var(--blue)">● 발표·행사</span><span>칸 색 = 그날 작업한 양 (Claude 대화·문서·창 기록)</span><span>빨간 세로줄 = 오늘</span></div>
    <table><thead>${mon}${dayRow}</thead><tbody>${loadRow}${body}</tbody></table></div>`;
}

// ----- 정리 대기 -----
function itemOptions(selected) {
  const act = S.board.items.filter(isActive).sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  return `<option value="">— 어느 일? —</option><option value="-" ${selected === '-' ? 'selected' : ''}>관련 없음(목록에서 빼기)</option>` +
    act.map(it => `<option value="${esc(it.id)}" ${selected === it.id ? 'selected' : ''}>[${esc(it.area)}] ${esc(it.title)}</option>`).join('');
}
function sessionsHTML() {
  const list = S.board.unassigned;
  let h = `<div class="toolbar"><span>폴더를 건드리지 않아 어느 일인지 모르는 Claude 대화입니다. 일을 고르면 그 일의 활동으로 셉니다. (AI 정리를 하면 자동으로 짝지어 봅니다)</span></div><div class="plain">`;
  if (!list.length) h += '<div class="empty">모두 분류됐습니다.</div>';
  for (const s of list) {
    h += `<div class="prow"><div><div>${esc(s.title)}</div><div class="s">${esc(s.first)}</div></div><div class="s">${esc(s.lastRel)}</div>
      <div><select data-act="assign" data-sid="${esc(s.id)}">${itemOptions('')}</select></div></div>`;
  }
  return h + '</div>';
}
function docsHTML() {
  const list = S.board.looseDocs;
  let h = `<div class="toolbar"><span>최근 연 문서 가운데 작업 폴더 밖에 있어 어느 일인지 모르는 것들입니다. 설정 › 작업 폴더에 뿌리 폴더를 더하면 묶입니다.</span></div><div class="plain">`;
  if (!list.length) h += '<div class="empty">없습니다.</div>';
  for (const d of list) {
    h += `<div class="prow"><div><div>${esc(d.name)}</div><div class="s">${esc(d.path)}</div></div><div class="s">${new Date(d.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      <div><button class="btn small" data-act="openp" data-p="${esc(d.path)}">열기</button> <button class="btn small" data-act="reveal" data-p="${esc(d.path)}">폴더</button></div></div>`;
  }
  return h + '</div>';
}

// ----- 자세히 -----
function renderDetail() {
  const box = $('#detail');
  const it = S.sel && byId(S.sel);
  if (!it || S.f.sp === 'sessions' || S.f.sp === 'docs') { box.hidden = true; applyLayout(); return; }
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && box.dataset.id === it.id) return;
  box.hidden = false;
  applyLayout();
  box.dataset.id = it.id;
  const a = color(it.area);
  const areas = S.board.areas.map(x => `<option ${x.id === it.area ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
  const groups = [...new Set(S.board.items.map(x => x.group))].sort().map(g => `<option value="${esc(g)}">`).join('');
  const dls = it.deadlines.map(d => {
    const n = d.days;
    const big = n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `D-${n}`;
    return `<div class="dl ${d.done ? 'done' : ''}">
      <label class="ck" title="이 마감 완료 체크"><input type="checkbox" data-act="dl-check" data-date="${d.date}" ${d.done ? 'checked' : ''}><i></i></label>
      <div class="d ${n < 0 ? 'past' : n <= 3 ? 'red' : ''}"><b>${big}</b>${shortDate(d.date)}</div>
      <div class="l"><span>${esc(d.label)}</span><span class="src ${d.confirmed ? 'ok' : ''}">${srcName(d)}</span><br>
        <input type="time" value="${esc(d.time)}" data-act="dl-time" data-date="${d.date}" title="마감 시각 (알람 기준)">
        ${d.doc ? `<a class="doclink" data-act="openp" data-p="${esc(d.doc.file)}" title="${esc(d.doc.file)}">${esc(d.doc.name)}</a>` : ''}</div>
      <div class="acts">${!d.confirmed ? `<button data-act="dl-ok" data-date="${d.date}" title="맞는 날짜 — 캘린더·알람에 넣음">맞음</button>` : ''}
        ${d.src === 'me' ? `<button data-act="dl-del" data-date="${d.date}">지움</button>` : d.src === 'doc' ? `<button data-act="found-off" data-key="${esc(d.doc.key)}" title="찾은 일정에서 끔">끔</button>` : `<button data-act="dl-no" data-date="${d.date}" title="마감이 아님 — 목록에서 뺌">아님</button>`}</div>
    </div>`;
  }).join('') || '<div class="hook">찾은 마감이 없습니다. 아래에서 넣을 수 있습니다.</div>';
  const scopeNote = S.set.alarms.scope === 'confirmed' ? '‘맞음’을 누르거나 직접 넣은 마감만 알람·캘린더에 들어갑니다.' : 'AI 추정 마감도 알람·캘린더에 들어갑니다.';
  const t = new Date(); const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const heatKeys = []; for (let i = 29; i >= 0; i--) heatKeys.push(ymd(new Date(t0.getTime() - i * 86400000)));
  const hmax = Math.max(3, ...heatKeys.map(k => it.activity[k] || 0));
  const hcol = S.set.graph.color === 'one' ? S.set.graph.custom : a;
  const heat = heatKeys.map(k => { const v = it.activity[k] || 0; return `<i title="${k} · ${v}" style="${v ? `background:${hcol};opacity:${(0.2 + 0.8 * Math.sqrt(v / hmax)).toFixed(2)}` : ''}"></i>`; }).join('');
  const sess = it.sessions.map(s => `<li><span class="n" title="${esc(s.title)}">${esc(s.title)}</span><span class="w">${esc(String(s.lastTs).slice(5, 10).replace('-', '.'))}</span>
    <a data-act="resume" data-sid="${esc(s.id)}" data-cwd="${esc(s.cwd || '')}" title="터미널에서 claude --resume 으로 이어서">이어서</a></li>`).join('');
  const docs = it.docs.slice(0, 8).map(d => `<li><span class="n" title="${esc(d.path)}">${esc(d.name)}</span><span class="w">${new Date(d.ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
    <a data-act="openp" data-p="${esc(d.path)}">열기</a></li>`).join('');
  const paths = (it.paths || []).slice(0, 4).map(p => `<div class="path">${esc(p)} &nbsp;<a data-act="openp" data-p="${esc(p)}" style="color:var(--blue);cursor:pointer">열기</a> · <a data-act="code" data-p="${esc(p)}" style="color:var(--blue);cursor:pointer">VSCode</a></div>`).join('');
  box.innerHTML = `
  <div class="dhead" style="--a:${a}"><button class="x" data-act="close" title="닫기 (Esc)">×</button>
    <textarea class="dtitle" rows="2" data-act="title">${esc(it.title)}</textarea>
    <div class="dmeta"><select data-act="area" title="영역">${areas}</select>
      <input data-act="group" value="${esc(it.group)}" list="grouplist" title="주제"><datalist id="grouplist">${groups}</datalist>
      ${starsHTML(it)}</div>
  </div>
  <div class="dsec"><h5>마감·일정<span class="r">${it.aiAt ? 'AI 정리 ' + esc(it.aiAt.slice(5, 16).replace('T', ' ')) : '글에서 찾은 추정값'}</span></h5>${dls}
    <form class="dladd" data-act="dl-add"><input type="date" name="date" required><input type="time" name="time" value="${esc(S.set.dueTime)}">
      <input name="label" placeholder="무엇 (예: 제출, 발표)"><button class="btn small">넣기</button></form>
    <div class="hook" style="margin-top:6px;font-size:11.5px;color:var(--ink-3)">${scopeNote}</div></div>
  ${(it.summary || it.nextAction || it.hook) ? `<div class="dsec"><h5>지금 상태</h5>
    ${it.summary ? `<div class="ai-line"><span class="k">요약</span>${esc(it.summary)}</div>` : ''}
    ${it.nextAction ? `<div class="ai-line"><span class="k">다음</span>${esc(it.nextAction)}</div>` : ''}
    ${it.status ? `<div class="ai-line"><span class="k">상태</span>${esc(it.status)}</div>` : ''}
    ${it.hook ? `<div class="hook" style="margin-top:6px">${esc(it.hook)}</div>` : ''}</div>` : ''}
  <div class="dsec dsim" id="dSim" hidden></div>
  <div class="dsec"><h5>활동 · 최근 30일<span class="r">마지막 ${esc(it.lastRel || '-')}${it.todayFocus ? ` · 오늘 창 ${Math.round(it.todayFocus)}분` : ''}</span></h5><div class="heat">${heat}</div></div>
  ${sess ? `<div class="dsec"><h5>Claude 대화 ${it.sessions.length}</h5><ul class="lst">${sess}</ul></div>` : ''}
  ${docs ? `<div class="dsec"><h5>최근 연 문서</h5><ul class="lst">${docs}</ul></div>` : ''}
  ${paths ? `<div class="dsec"><h5>폴더</h5>${paths}</div>` : ''}
  <div class="dsec"><h5>메모</h5><textarea class="note" data-act="note" placeholder="이 일에 대한 메모 (이 PC에만 저장)">${esc(it.note || '')}</textarea></div>
  <div class="dfoot">
    ${isChecked(it) ? '<button class="btn" data-act="undone">다시 살림 (완료 체크 풀기)</button>' : '<button class="btn" data-act="done">일 전체 완료 체크</button>'}
    ${it.hidden ? '<button class="btn" data-act="unhide">숨김 풀기</button>' : '<button class="btn" data-act="hide">목록에서 숨기기</button>'}
    ${it.kind === 'manual' ? '<button class="btn red" data-act="delmanual">지우기</button>' : ''}
    ${it.memFile ? `<button class="btn" data-act="openp" data-p="${esc(it.memFile)}" title="Claude 메모리 파일">메모리 파일</button>` : ''}
  </div>`;
  if (window.CircleAPI && window.CircleAPI.similar) window.CircleAPI.similar(it, document.getElementById('dSim')); // v1.8 서클 비서·내 MD에서 비슷한 자료
}

function renderStatus() {
  if (!S.board) return;
  const b = S.board;
  const at = b.scannedAt ? new Date(b.scannedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';
  const parts = [];
  parts.push(S.scanBusy ? '<span class="busy">읽는 중…</span>' : `마지막 읽기 ${at}`);
  parts.push(`대화 ${b.stats.sessions} · 메모리 ${b.stats.memories} · 최근 항목 ${b.stats.recent}`);
  if (S.ai.running) parts.push(`<span class="busy">${esc(S.ai.msg)}</span>`);
  else if (S.ai.msg) parts.push(esc(S.ai.msg));
  const idle = S.set.idle;
  parts.push(idle.enabled ? `쉴 때 알림: 입력 없음 ${idle.inputSec >= 60 ? Math.round(idle.inputSec / 60) + '분' : idle.inputSec + '초'}` : '쉴 때 알림 꺼짐');
  if (S.phone && S.phone.enabled) parts.push(phoneStatusText(S.phone)[0]);
  if (S.cal) {
    const c = S.cal;
    const on = c.mode === 'script' ? c.script && c.script.enabled : c.connected && c.enabled;
    const last = c.mode === 'script' ? c.script && c.script.last : c.last;
    const err = last && last.errors && last.errors[0];
    parts.push(`캘린더 ${c.count ?? 0}건${on ? (err ? ' · <span style="color:var(--red)">구글 오류</span>' : ' · 구글 연결됨') : ''}`);
  }
  if (S.act && S.act.on) parts.push(`<span style="color:var(--red)">창 기록 중${S.act.item ? ' · 지금: ' + esc(S.act.item.title) : ''}</span>`);
  const up = S.upd || {};
  const upBtn = up.status === 'ready' ? `<button class="updpill ready" data-act="upd-open" title="새 판이 준비됐습니다. 눌러서 설치합니다">새 판 ${esc(up.latest)} 설치</button>`
    : up.status === 'available' && up.skip !== up.latest ? `<button class="updpill" data-act="upd-open" title="새 판이 나왔습니다. 눌러서 받습니다">새 판 ${esc(up.latest)}</button>`
    : up.status === 'downloading' ? `<button class="updpill" data-act="upd-open" title="새 판을 받는 중입니다">새 판 받는 중 ${up.progress || 0}%</button>` : '';
  $('#status').innerHTML = parts.join('<span>·</span>') + `<span class="r">${upBtn}v${esc(b.version || '')}</span>`;
}

// ---------- 쉴 때 브리핑 ----------
function openBrief() {
  S.brief = true; S.briefArmed = false;
  $('#brief').hidden = false;
  renderBrief();
  setTimeout(() => { S.briefArmed = true; }, 1200);
  if (S.set.voice && S.set.voice.readBrief) readBrief(false);
}
function closeBrief(fromMain) {
  S.brief = false;
  $('#brief').hidden = true;
  Voice.hush();
  if (AG.player) AG.player.stop();
  if (S._briefSaid) hn.agentStop();
  if (!fromMain) hn.dismissBrief(false);
}
// 쉴 때 화면을 말로: 개수 + 지금 챙길 것 세 개
function readBrief(force) {
  const act = S.board.items.filter(isActive);
  const c = k => act.filter(it => it.band === k).length;
  const top = act.filter(it => ['today', 'd3', 'overdue'].includes(it.band)).sort(urgencySort).slice(0, 3);
  const dd = it => (it.days < 0 ? `${-it.days}일 지난` : it.days === 0 ? '오늘' : it.days === 1 ? '내일' : `${it.days}일 뒤`);
  const parts = [c('overdue') ? `확인할 지난 마감 ${c('overdue')}개` : '', `오늘 ${c('today')}개`, `3일 안 ${c('d3')}개`].filter(Boolean);
  const list = top.map(it => { const d = focusDl(it); return `${dd(it)} ${it.title}${d && d.label ? ', ' + d.label : ''}`; });
  const text = `쉬는 김에 한 번 보세요. ${parts.join(', ')}. ${list.length ? '지금 챙길 것. ' + list.join('. ') + '.' : '7일 안에 마감이 없습니다.'}`;
  if (force || !S._briefSaid) { S._briefSaid = true; if (S.voice && S.voice.engine === 'live') agentBrief(); else Voice.say(text, { voiceName: S.set.voice.voiceName, rate: S.set.voice.rate }); setTimeout(() => { S._briefSaid = false; }, 60000); }
}
function renderBrief() {
  const now = new Date();
  const act = S.board.items.filter(isActive);
  // 쉴 때 화면은 다가오는 것(오늘·3일)을 지난 것보다 먼저
  const BRIEF_ORDER = ['today', 'd3', 'overdue', 'd7'];
  const urgentList = act.filter(it => BRIEF_ORDER.includes(it.band))
    .sort((a, b) => BRIEF_ORDER.indexOf(a.band) - BRIEF_ORDER.indexOf(b.band) || urgencySort(a, b)).slice(0, 6);
  const neglect = act.filter(it => it.neglect).slice(0, 4);
  const todayKey = ymd(now);
  const yKey = ymd(new Date(now.getTime() - 86400000));
  const worked = act.filter(it => (it.activity[todayKey] || 0) + (it.activity[yKey] || 0) > 0)
    .sort((a, b) => ((b.activity[todayKey] || 0) + (b.activity[yKey] || 0)) - ((a.activity[todayKey] || 0) + (a.activity[yKey] || 0))).slice(0, 5);
  const c = k => act.filter(it => it.band === k).length;
  const big = it => {
    const d = focusDl(it);
    return `<div class="big-row" data-act="brief-sel" data-id="${esc(it.id)}"><div class="n ${ddClass(it.days)}">${ddText(it)}</div>
      <div><div class="tt">${esc(it.title)}</div><div class="ss">${d ? esc(d.label) + ' · ' + shortDate(d.date, d.time) : ''}${it.nextAction ? ' — ' + esc(it.nextAction) : ''}</div></div></div>`;
  };
  $('#brief').innerHTML = `
    <div class="left">
      <div class="clk" id="bclock">${now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
      <div class="date">${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일</div>
      <div class="say">쉬는 김에 한 번 보세요.<br>
        ${c('overdue') ? `확인할 지난 마감 <b>${c('overdue')}</b>개, ` : ''}오늘 <b>${c('today')}</b>개, 3일 안 <b>${c('d3')}</b>개, 이번 주 ${c('d7')}개.</div>
      <div class="foot"><button class="btn" data-act="brief-say" style="margin-bottom:10px">읽어 주기</button><br>아무 데나 누르거나 아무 키나 누르면 닫힙니다.<br>다음 알림은 ${S.set.idle.cooldownMin}분 뒤부터 · 설정에서 바꿀 수 있습니다.</div>
    </div>
    <div class="right">
      <h2>지금 챙길 것</h2>${urgentList.map(big).join('') || '<div class="hook">7일 안에 마감이 없습니다.</div>'}
      ${neglect.length ? `<div class="sec"><h2>마감은 가까운데 손 안 댄 일</h2>${neglect.map(big).join('')}</div>` : ''}
      ${worked.length ? `<div class="sec"><h2>어제·오늘 한 일</h2>${worked.map(it => `<div class="big-row" data-act="brief-sel" data-id="${esc(it.id)}"><div class="n" style="font-size:22px;color:var(--ink-3)">${(it.activity[todayKey] || 0) + (it.activity[yKey] || 0)}회</div><div><div class="tt" style="font-size:16px">${esc(it.title)}</div></div></div>`).join('')}</div>` : ''}
    </div>`;
}

// ---------- 설정 ----------
const OFFSETS = [[1440, '1일 전'], [300, '5시간 전'], [180, '3시간 전'], [60, '1시간 전'], [30, '30분 전']];
function sw(k, v) { return `<label class="sw-t"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}><span></span></label>`; }
function openSettings() {
  const s = S.set;
  const offs = OFFSETS.map(([m, n]) => `<label><input type="checkbox" data-off="${m}" ${s.alarms.offsets.includes(m) ? 'checked' : ''}> ${n}</label>`).join(' ');
  const g = s.calendar.google;
  $('#modal').innerHTML = `<div class="sheet"><div class="sh"><h2>설정</h2><button class="x" data-act="mclose">×</button></div>
  <div class="fs"><h3>쉴 때 알림 ${sw('idle.enabled', s.idle.enabled)}</h3>
    <p class="exp">마우스·키보드 입력이 정한 시간 동안 없으면 이 창을 맨 앞으로 띄워 급한 일을 보여 줍니다. 화면은 찍지 않습니다.</p>
    <div class="fr"><label>입력 없음</label><input type="number" min="10" step="10" data-k="idle.inputSec" value="${s.idle.inputSec}"> 초 <span class="live" id="idleLive"></span></div>
    <div class="fr"><label>띄우는 방식</label><select data-k="idle.action"><option value="front" ${s.idle.action === 'front' ? 'selected' : ''}>창 크기 그대로 맨 앞으로</option><option value="full" ${s.idle.action === 'full' ? 'selected' : ''}>화면 가득</option></select></div>
    <div class="fr"><label>다시 띄우기 간격</label><input type="number" min="1" data-k="idle.cooldownMin" value="${s.idle.cooldownMin}"> 분</div>
    <div class="fr"><label>조용한 시간</label><input type="time" data-k="idle.quietStart" value="${s.idle.quietStart}"> ~ <input type="time" data-k="idle.quietEnd" value="${s.idle.quietEnd}"> <span class="exp" style="margin:0">이 시간엔 안 띄움</span></div>
    <div class="fr"><label></label><button class="btn" data-act="brieftest">지금 한 번 띄워 보기</button></div></div>

  <div class="fs"><h3>마감 알람 ${sw('alarms.enabled', s.alarms.enabled)}</h3>
    <p class="exp">마감 시각 기준으로 윈도우 알림을 띄웁니다. 같은 시점이 캘린더 알람에도 들어갑니다.</p>
    <div class="fr"><label>미리 알림</label>${offs} <label><input type="checkbox" data-k="alarms.morning" ${s.alarms.morning ? 'checked' : ''}> 당일 아침 9시</label></div>
    <div class="fr"><label>대상</label><select data-k="alarms.scope"><option value="confirmed" ${s.alarms.scope === 'confirmed' ? 'selected' : ''}>확정한 마감만 (‘맞음’ 누른 것·직접 넣은 것)</option><option value="all" ${s.alarms.scope === 'all' ? 'selected' : ''}>AI·글에서 찾은 추정 마감도</option></select></div>
    <div class="fr"><label>기본 마감 시각</label><input type="time" data-k="dueTime" value="${s.dueTime}"> <span class="exp" style="margin:0">시각이 없는 마감에 씀</span></div>
    <div class="fr"><label>하루 첫 요약 알림</label>${sw('alarms.digest', s.alarms.digest)}</div></div>

  <div class="fs" id="pcalsec"><h3>삼성 캘린더 (폰 캘린더) <span id="pcstat" class="pill" title="폰 앱이 마지막으로 보낸 때">확인 중</span></h3>
    <p class="exp">폰 앱이 폰의 캘린더를 읽어 여기로 보내고(삼성 캘린더에 보이는 삼성 계정·구글·폰에 저장한 일정 모두), 한눈에의 마감은 폰의 ‘한눈에’ 캘린더에 알림과 함께 넣습니다. 켜는 곳은 <b>폰 앱 › 설정 › 캘린더</b>이고, 폰 앱을 열 때마다 맞춥니다.</p>
    <div class="fr"><label>가져온 일정 보이기</label>${sw('phoneCal.show', s.phoneCal.show !== false)} <label style="margin-left:14px">영역 이름</label><input type="text" data-k="phoneCal.area" value="${esc(s.phoneCal.area || '폰 캘린더')}" style="width:140px" title="폰 캘린더에서 온 일정을 이 영역으로 모읍니다. 바꾸면 바로 적용됩니다."></div>
    <div class="fr"><label>받은 것</label><span class="exp" style="margin:0" id="pcinfo">아직 받은 일정이 없습니다.</span> <button class="btn small" data-act="pcal-clear" title="폰에서 가져온 일정을 이 PC에서 지웁니다. 폰의 캘린더는 그대로입니다. 폰 앱을 다시 열면 또 들어옵니다.">가져온 일정 지우기</button></div>
    <div class="note-box"><b>폰 앱 없이: 구글 ‘한눈에 마감’을 삼성 캘린더에 보이게 하기</b> (아래 구글 연결을 쓰는 경우)<ol>
      <li>폰 <b>설정 › 계정 및 백업 › 계정 관리</b>에 구글 연결에 쓴 그 구글 계정이 있는지 봅니다. 없으면 추가합니다.</li>
      <li>삼성 캘린더 › 왼쪽 위 <b>≡</b> › 그 구글 계정 아래 <b>‘한눈에 마감’</b>을 켭니다. 안 보이면 ≡ › 톱니 › <b>캘린더 관리</b>에서 켭니다.</li>
      <li>폰 앱으로도 넣으면 같은 마감이 두 번 보입니다. 폰 앱 쪽이나 구글 쪽 중 하나만 켜 두세요.</li></ol></div></div>

  <div class="fs" id="calsec"><h3>구글 캘린더 연결 <span id="gstat" class="pill">확인 중</span></h3>
    <p class="exp">마감이 바뀌면 구글 캘린더의 ‘한눈에 마감’ 캘린더에 알아서 넣고·고치고·지웁니다. 알람(위 ‘미리 알림’)도 함께 들어갑니다. 삼성 캘린더는 폰에서 같은 구글 계정을 연결해 두면 함께 보입니다.</p>
    <div class="note-box"><b>쉬운 연결 (2분, 처음 한 번만)</b><ol>
      <li><button class="btn small" data-act="gscript-copy">① 연결 코드 복사</button> — 내 비밀 열쇠가 든 짧은 코드가 클립보드에 들어갑니다.</li>
      <li><button class="btn small" data-act="gscript-open">② script.new 열기</button> — 구글에 로그인된 브라우저에서 새 스크립트가 열립니다. 안에 있는 글을 모두 지우고 <b>Ctrl+V</b>로 붙여 넣은 뒤 <b>Ctrl+S</b>(이름: 한눈에 캘린더).</li>
      <li>오른쪽 위 <b>배포 › 새 배포</b> › 톱니바퀴에서 <b>웹 앱</b> › 실행: <b>나</b> · 액세스 권한: <b>모든 사용자</b> › 배포.<br>‘액세스 승인’ › 내 계정 › ‘고급’ › ‘한눈에 캘린더(으)로 이동’ › 허용 — 내가 만든 스크립트라서 나오는 확인 화면입니다.</li>
      <li>나온 <b>웹 앱 URL</b>(…/exec)을 아래에 붙여 넣고 ③ 연결.</li></ol>
      <div class="fr" style="margin:8px 0 2px"><input type="text" id="gscriptUrl" value="${esc(s.calendar.script.url)}" placeholder="https://script.google.com/macros/s/…/exec" style="width:430px">
        <button class="btn on" data-act="gscript-connect">③ 연결</button>
        ${s.calendar.script.enabled ? '<button class="btn" data-act="gsync">지금 맞추기</button><button class="btn" data-act="gscript-off">끊기</button>' : ''}</div>
      <span style="font-size:11.5px;color:var(--ink-3)">비밀 열쇠가 맞아야만 스크립트가 움직입니다. 넣는 내용은 마감 이름·날짜·알람뿐이고 문서·대화는 보내지 않습니다.</span></div>
    <div class="fr"><label>보낼 마감</label><span class="exp" style="margin:0" id="calscope"></span></div>
    <div class="fr"><label>공통 파일(.ics)</label>${sw('calendar.ics', s.calendar.ics)} <button class="btn small" data-act="icsopen">파일 위치 열기</button> <span class="exp" style="margin:0">아웃룩·삼성 캘린더에 직접 가져올 때</span></div>
    <details class="adv"><summary>고급: Google Cloud OAuth로 연결</summary>
      <div class="note-box"><ol>
        <li><a data-act="url" data-u="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Calendar API 사용 설정</a> (프로젝트가 없으면 먼저 만들기)</li>
        <li><a data-act="url" data-u="https://console.cloud.google.com/auth/branding">OAuth 동의 화면</a> 만들기 · 대상 ‘외부’ · <a data-act="url" data-u="https://console.cloud.google.com/auth/audience">게시 상태를 ‘프로덕션’으로</a>(테스트로 두면 7일마다 다시 연결해야 함)</li>
        <li><a data-act="url" data-u="https://console.cloud.google.com/auth/clients/create">클라이언트 만들기</a> · 유형 ‘데스크톱 앱’ · JSON 내려받기 → <button class="btn small" data-act="gimport">JSON 불러오기</button></li>
        <li><button class="btn small" data-act="gconnect">구글 계정 연결</button> <button class="btn small" data-act="gdisconnect">끊기</button></li></ol></div>
      <div class="fr"><label>넣을 곳</label><select data-k="calendar.google.target"><option value="own" ${g.target !== 'primary' ? 'selected' : ''}>‘한눈에 마감’ 전용 캘린더</option><option value="primary" ${g.target === 'primary' ? 'selected' : ''}>기본 캘린더</option></select>
        <span class="exp" style="margin:0">클라이언트 ${g.clientId ? '불러옴' : '없음'}</span></div>
    </details></div>

  <div class="fs"><h3>일정 찾을 폴더</h3>
    <p class="exp">고른 폴더의 한글·워드·PDF·엑셀·파워포인트·텍스트 문서에서 날짜를 찾아 왼쪽 ‘찾은 일정’에 모읍니다. 켠 일정만 목록·알람·캘린더에 들어갑니다.</p>
    <div id="flistbox">${folderListHTML()}</div>
    <div class="fr"><button class="btn" data-act="folder-add">＋ 폴더 고르기</button><button class="btn" data-act="go-found">찾은 일정 보기</button></div>
    <div class="fr"><label>체크한 일 제자리 표시</label><input type="number" min="0" max="30" data-k="doneKeepDays" value="${s.doneKeepDays}"> 일 동안 줄 그어 둔 뒤 ‘끝낸 일’로</div></div>

  ${agentSectionHTML()}

  ${localSectionHTML()}

  <div class="fs" id="nlpsec"><h3>글로 바꾸기 · 내 낱말</h3>
    <p class="exp">목록에서 오른쪽 클릭 › 변경 창 아래 칸에 “이틀 미뤄 줘”, “다음주 금요일 오후 3시”, “별 넷”, “완료”처럼 쓰면 알아듣고 바꿉니다. 자주 쓰는 내 말(예: 칼퇴 = 18시, 땡겨 = 하루 당기기)을 등록할 수 있습니다.</p>
    <div class="fr"><button class="btn" data-act="words">내 낱말 관리 (${(s.nlp.custom || []).length}개)</button></div>
    <div class="fr"><label>고친 것에서 배우기</label>${sw('nlp.learn.on', (s.nlp.learn || {}).on !== false)}</div>
    <p class="exp">바로 넣기·말로 넣기로 넣은 숫자 날짜(260101 · 1130 · 3/1 · 1/3/2027)를 2주 안에 고치면, 고친 값이 같은 숫자의 다른 읽기인지 봅니다. 맞으면 그 숫자는 다음부터 그렇게 읽고, 같은 모양을 두 번 이상 같은 쪽으로 고치면 처음 보는 숫자도 그쪽으로 읽습니다. 마감을 미룬 것(다른 날로 옮김)은 배우지 않습니다.</p>
    <div id="learnbox" class="learnbox"></div></div>

  <div class="fs" ${S.platform && S.platform !== 'win32' ? 'hidden' : ''}><h3>창 사용 기록 <span class="pill">선택 기능 · 윈도우</span> ${sw('activity.enabled', s.activity.enabled)}</h3>
    <p class="exp">켜면 맨 앞 창의 프로그램 이름과 제목을 바뀔 때마다 적어, 어느 일을 몇 분 했는지 셉니다. 이 PC의 data\\activity 폴더에만 저장하고 밖으로 보내지 않습니다. 켜져 있는 동안 위쪽에 ‘● 창 기록 중’이 보입니다. 자리를 비운 시간은 세지 않습니다.</p>
    <div class="fr"><label>확인 간격</label><input type="number" min="2" data-k="activity.intervalSec" value="${s.activity.intervalSec}"> 초 <span class="exp" style="margin:0">(바꾸면 기록을 껐다 켜야 적용)</span></div>
    <div class="fr"><label>자리 비움 기준</label><input type="number" min="30" data-k="activity.idleCutSec" value="${s.activity.idleCutSec}"> 초</div>
    <div class="fr"><label>보관 기간</label><input type="number" min="1" data-k="activity.keepDays" value="${s.activity.keepDays}"> 일</div>
    <div class="fr"><label>제외할 프로그램</label><textarea data-k="activity.excludeApps" data-list="1">${esc(s.activity.excludeApps.join('\n'))}</textarea></div>
    <div class="fr"><label>제외할 제목 낱말</label><textarea data-k="activity.excludeWords" data-list="1">${esc(s.activity.excludeWords.join('\n'))}</textarea></div>
    <div class="fr"><label></label><button class="btn" data-act="acttoday">오늘 기록 요약</button><button class="btn red" data-act="actclear">기록 모두 지우기</button><span class="exp" id="actinfo" style="margin:0"></span></div></div>

  <div class="fs"><h3>기준</h3>
    <div class="fr"><label>급함</label>D- <input type="number" min="1" data-k="urgentDays" value="${s.urgentDays}"> 일 이내 (4분면)</div>
    <div class="fr"><label>중요</label>★ <input type="number" min="1" max="5" data-k="importantMin" value="${s.importantMin}"> 이상</div></div>

  <div class="fs" id="rootsec"><h3>작업 폴더</h3>
    <p class="exp">이 폴더들 바로 아래 폴더 하나하나를 ‘일’로 봅니다(예: 문서\\프로젝트 → 그 안의 폴더들). Claude Code를 쓰면 그 메모리·대화도 따로 정하지 않아도 읽습니다.</p>
    <div class="fr"><textarea data-k="roots" data-list="1" style="min-height:90px" placeholder="한 줄에 폴더 하나">${esc(s.roots.join('\n'))}</textarea></div>
    <div class="fr"><button class="btn" data-act="roots-add">＋ 폴더 고르기</button><label style="width:auto">다시 읽기 간격</label><input type="number" min="1" data-k="scanMin" value="${s.scanMin}"> 분</div></div>

  ${aiSectionHTML()}
  ${voiceSectionHTML()}
  ${agentVoiceSectionHTML()}
  ${phoneSectionHTML()}
  ${updateSectionHTML()}

  <div class="fs"><h3>화면·시작</h3>
    <div class="fr"><label>바탕</label><select data-k="theme"><option value="paper" ${s.theme === 'paper' ? 'selected' : ''}>종이</option><option value="night" ${s.theme === 'night' ? 'selected' : ''}>밤</option></select></div>
    <div class="fr"><label>미니 창 진하기</label><input type="range" min="0.5" max="1" step="0.05" data-k="mini.opacity" value="${s.mini.opacity}"> <label>줄 수</label><input type="number" min="3" max="20" data-k="mini.count" value="${s.mini.count}"></div>
    <div class="fr"><label>닫으면 트레이로</label>${sw('closeToTray', s.closeToTray)}</div>
    <div class="fr"><label>컴퓨터 켤 때 자동 실행</label>${sw('autoStart', s.autoStart)} <span class="exp" style="margin:0">트레이(맥은 메뉴 막대)에 숨긴 채 켜짐</span></div>
    <div class="fr"><label>단축키</label><span class="exp" style="margin:0">Ctrl+Alt+H 창 열기·숨기기 · Ctrl+Alt+M 미니 창 · Ctrl+Alt+V 말로 넣기 · Alt+V 이 창에서 말하기 · 1/2/3 화면 · / 찾기 · ↑↓ 고르기 · Shift+1~5 중요도 · X 완료 체크 · E 변경 창 · N 할 일 넣기 · R 다시 읽기 · 오른쪽 클릭: 변경 창</span></div>
    <div class="fr"><label>저장 폴더</label><button class="btn small" data-act="opendata">data 폴더 열기</button></div></div>
  </div>`;
  $('#modal').hidden = false;
  S.modal = 'settings';
  voiceSectionBind();
  phoneSectionBind();
  refreshCal();
  refreshPcal();
  refreshLearn();
  tickIdle();
}
// 설정 › 고친 것에서 배운 읽기 목록
async function refreshLearn() {
  const box = $('#learnbox');
  if (!box) return;
  const L = await hn.nlpLearned();
  const ex = L.exact.map(x => `<li><b>${esc(x.text)}</b> → ${esc(x.name)}${x.example ? ` <span class="ink3">(${esc(x.example)})</span>` : ''} <button class="tiny" data-act="learn-forget" data-text="${esc(x.text)}" title="이 숫자는 다시 기본 읽기로">지우기</button></li>`).join('');
  const vo = L.votes.map(v => `<li>${esc(v.shapeName)}: ${v.counts.map(c => `${esc(c.name)} ${c.n}번`).join(' · ')} <button class="tiny" data-act="learn-forget" data-shape="${esc(v.shape)}" title="이 모양의 고친 횟수를 지움">지우기</button></li>`).join('');
  box.innerHTML = ex || vo
    ? `${ex ? `<div class="lh">배운 숫자</div><ul>${ex}</ul>` : ''}${vo ? `<div class="lh">모양별로 고친 횟수 <span class="ink3">(두 번 이상 같은 쪽이면 처음 보는 숫자도 그쪽)</span></div><ul>${vo}</ul>` : ''}<button class="tiny" data-act="learn-forget" data-all="1">배운 것 모두 지우기</button>`
    : `<span class="ink3">아직 배운 것이 없습니다.${L.pending ? ` 지켜보는 입력 ${L.pending}개.` : ''}</span>`;
}
async function refreshPcal(st) {
  st = st || await hn.phoneCalStatus();
  const el = $('#pcstat'), info = $('#pcinfo');
  if (!el) return;
  const when = t => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!st.at) { el.className = 'pill'; el.textContent = '폰 앱에서 켜기 전'; if (info) info.textContent = '아직 받은 일정이 없습니다. 폰 앱 › 설정 › 캘린더에서 켜 주세요.'; return; }
  el.className = 'pill ok';
  el.textContent = `마지막 ${when(st.at)}`;
  if (info) info.innerHTML = `일정 <b>${st.count}</b>건${st.cals && st.cals.length ? ` · ${esc(st.cals.map(c => c.name).join(', '))}` : ''}${st.target ? ` · 폰 ‘${esc(st.target)}’ 캘린더에 <b>${st.wrote}</b>건 넣음` : ''}${st.show ? '' : ' · 지금은 숨김'}`;
}
async function refreshCal() {
  const st = await hn.calStatus();
  S.cal = { ...(S.cal || {}), ...st };
  const el = $('#gstat');
  if (!el) return;
  const script = st.mode === 'script';
  const on = script ? st.script.enabled : (st.connected && st.enabled);
  const last = script ? st.script.last : st.last;
  const hm = t => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (last && last.errors && last.errors.length) { el.className = 'pill red'; el.textContent = '오류: ' + last.errors[0]; }
  else if (on) {
    el.className = 'pill ok';
    el.textContent = `연결됨 (${script ? '쉬운 연결' : 'OAuth'})` + (last && last.at ? ` · 마지막 ${hm(last.at)}` + (last.total !== undefined ? ` · ${last.total}건 (+${last.added || 0} ~${last.changed || 0} -${last.removed || 0})` : '') : '');
  } else { el.className = 'pill'; el.textContent = '연결 전'; }
  const sc = $('#calscope');
  if (sc) sc.innerHTML = S.set.alarms.scope === 'confirmed'
    ? `확정한 마감 <b>${st.count ?? 0}</b>건만 보냅니다 (추정까지면 ${st.allCount ?? 0}건) <button class="btn small" data-act="scope" data-v="all">추정 마감도 보내기</button>`
    : `추정 마감까지 <b>${st.count ?? 0}</b>건을 보냅니다 <button class="btn small" data-act="scope" data-v="confirmed">확정한 것만 보내기</button>`;
}

// ----- 일정 찾을 폴더 -----
function folderListHTML() {
  const list = S.set.docFolders || [];
  if (!list.length) return '<div class="fr exp" style="margin:0 0 8px">아직 고른 폴더가 없습니다.</div>';
  const areas = ['<option value="">영역 자동</option>'].concat(S.board.areas.map(a => `<option value="${esc(a.id)}">${esc(a.id)}</option>`)).join('');
  return '<div class="flist">' + list.map(f => `<div class="frow">
    <label class="sw-t" title="이 폴더 읽기"><input type="checkbox" data-act="folder-on" data-p="${esc(f.path)}" ${f.on ? 'checked' : ''}><span></span></label>
    <span class="fp" title="${esc(f.path)}">${esc(f.path)}</span>
    <label class="fsub"><input type="checkbox" data-act="folder-sub" data-p="${esc(f.path)}" ${f.sub !== false ? 'checked' : ''}> 하위 폴더도</label>
    <select data-act="folder-area" data-p="${esc(f.path)}" title="이 폴더에서 켠 일정을 담을 일의 영역">${areas.replace(`value="${esc(f.area || '')}"`, `value="${esc(f.area || '')}" selected`)}</select>
    <button class="btn small" data-act="openp" data-p="${esc(f.path)}">열기</button>
    <button class="btn small red" data-act="folder-del" data-p="${esc(f.path)}">빼기</button></div>`).join('') + '</div>';
}

// ----- 찾은 일정 -----
S.foundView = { range: 'future', showDropped: false };
S.foundScan = { busy: false };
S.foundAi = { busy: false };
function foundTargetOptions(f) {
  const act = S.board.items.filter(isActive).sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  return `<option value="">자동: ${esc(f.autoTitle || '폴더 이름으로')}</option>` +
    act.map(it => `<option value="${esc(it.id)}" ${f.target === it.id && f.target !== f.autoTarget ? 'selected' : ''}>[${esc(it.area)}] ${esc(it.title)}</option>`).join('');
}
function hilite(ctx, raw) {
  const s = esc(ctx || '');
  const r = esc(raw || '');
  return r && s.includes(r) ? s.replace(r, `<mark>${r}</mark>`) : s;
}
function foundHTML() {
  const fv = S.foundView;
  const all = S.board.found || [];
  const st = S.board.foundStats;
  const folders = S.set.docFolders || [];
  let list = all.filter(f => (fv.range === 'future' ? f.days >= 0 : fv.range === 'recent' ? f.days >= -30 : true) || f.on);
  const dropped = list.filter(f => f.aiKeep === false && !f.on).length;
  if (!fv.showDropped) list = list.filter(f => f.aiKeep !== false || f.on);
  const seg = [['future', '앞으로'], ['recent', '지난 30일 포함']].map(([k, n]) => `<button class="${fv.range === k ? 'on' : ''}" data-act="found-range" data-v="${k}">${n}</button>`).join('');
  let h = `<div class="toolbar"><span>보기</span><div class="seg">${seg}</div>
    ${dropped || fv.showDropped ? `<div class="seg"><button class="${fv.showDropped ? 'on' : ''}" data-act="found-dropped">AI가 뺀 것 ${dropped}</button></div>` : ''}
    <span class="sum">${S.foundScan.busy ? `<span style="color:var(--blue)">문서 읽는 중… ${S.foundScan.done || 0}</span>` : st ? `문서 ${st.files}개 · 날짜 있는 문서 ${st.withDates}개${st.errors ? ` · 읽지 못함 ${st.errors}개` : ''}` : ''}</span>
    <button class="btn small" data-act="found-rescan">다시 찾기</button>
    <button class="btn small ${S.foundAi.busy ? 'busy' : ''}" data-act="found-ai" title="날짜 앞뒤 문장만 Claude에 보내 진짜 일정인지·이름·시각을 다듬습니다">${S.foundAi.busy ? (S.foundAi.msg || 'AI 다듬는 중…') : 'AI로 다듬기'}</button></div>`;
  h += `<div class="plain"><div class="fhead"><b>일정 찾을 폴더</b> ${folderListHTML()}<button class="btn small" data-act="folder-add">＋ 폴더 고르기</button></div>`;
  if (!folders.length) return h + `<div class="empty">폴더를 고르면 그 안의 한글·워드·PDF·엑셀·파워포인트·텍스트 문서에서 마감·회의·제출 날짜를 찾아 여기에 모읍니다.<br>찾은 일정은 꺼진 채로 들어오고, 스위치를 켠 것만 목록·알람·캘린더에 들어갑니다.</div></div>`;
  if (!list.length) return h + `<div class="empty">${fv.range === 'future' ? '앞으로 올 일정이 없습니다. ‘지난 30일 포함’으로 보거나 다른 폴더를 더해 보세요.' : '찾은 일정이 없습니다.'}</div></div>`;
  const byDoc = new Map();
  for (const f of list) { if (!byDoc.has(f.file)) byDoc.set(f.file, []); byDoc.get(f.file).push(f); }
  const docs = [...byDoc.entries()].sort((a, b) => a[1][0].date.localeCompare(b[1][0].date));
  for (const [file, fl] of docs) {
    const allOn = fl.every(f => f.on);
    h += `<div class="fdoc"><div class="fdoc-h"><label class="sw-t" title="이 문서의 일정 모두 켜기/끄기"><input type="checkbox" data-act="found-doc" data-keys="${esc(fl.map(f => f.key).join(','))}" ${allOn ? 'checked' : ''}><span></span></label>
      <a data-act="openp" data-p="${esc(file)}" class="fdoc-n" title="${esc(file)}">${esc(fl[0].name)}</a><span class="fdoc-p">${esc(file.slice(0, file.length - fl[0].name.length))}</span></div>`;
    for (const f of fl) {
      const n = f.days;
      const dd = n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `D-${n}`;
      h += `<div class="frow2 ${f.on ? 'on' : ''} ${f.aiKeep === false ? 'dropped' : ''}">
        <label class="sw-t"><input type="checkbox" data-act="found-on" data-key="${esc(f.key)}" ${f.on ? 'checked' : ''}><span></span></label>
        <div class="fd ${n >= 0 && n <= 3 ? 'red' : ''}"><b>${dd}</b>${shortDate(f.date, f.time)}</div>
        <div class="fl"><input class="flabel" data-act="found-label" data-key="${esc(f.key)}" value="${esc(f.label)}" title="이름 고치기">
          <span class="fk">${f.kind === 'event' ? '일정' : '마감'}${f.aiAt ? ' · AI' : ''}${f.aiKeep === false ? ' · AI: 일정 아님' : ''}</span>
          <div class="fctx">…${hilite(f.ctx, f.raw)}…</div></div>
        <div class="ft"><select data-act="found-target" data-key="${esc(f.key)}" title="켜면 이 일의 마감으로 들어감">${foundTargetOptions(f)}</select></div></div>`;
    }
    h += '</div>';
  }
  return h + '</div>';
}
async function tickIdle() {
  if (S.modal !== 'settings') return;
  const st = await hn.idleStatus();
  const el = $('#idleLive');
  if (el) el.textContent = `지금 입력 없음 ${st.idleSec}초${st.quiet ? ' · 조용한 시간' : ''}`;
  setTimeout(tickIdle, 1000);
}
function patchFromKey(k, v) {
  const parts = k.split('.');
  const o = {}; let cur = o;
  parts.forEach((p, i) => { if (i === parts.length - 1) cur[p] = v; else cur = cur[p] = {}; });
  return o;
}
async function onSettingChange(el) {
  if (el.dataset.off) {
    const offs = $$('[data-off]').filter(x => x.checked).map(x => Number(x.dataset.off));
    S.set = await hn.setSettings({ alarms: { offsets: offs } });
    return;
  }
  const k = el.dataset.k;
  if (!k) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number' || el.type === 'range') v = Number(el.value);
  else if (el.dataset.list) v = el.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  else if (el.value === 'true' || el.value === 'false') v = el.value === 'true';
  else v = el.value;
  // AI 주소 칸에는 http(s) 주소만(키·토큰을 붙여 넣으면 저장하지 않고 알려 줌)
  if (/^agent\.profiles\.\w+\.base$/.test(k) && String(v).trim() && !/^https?:\/\/\S+$/i.test(String(v).trim())) {
    el.value = '';
    agentMsg('주소 칸에는 http:// 나 https:// 로 시작하는 주소만 넣습니다. 키는 ‘API 키’ 칸(또는 새 키 넣기)에 넣으세요.', false);
    return;
  }
  S.set = await hn.setSettings(patchFromKey(k, v));
  if (k === 'theme') applyTheme();
  if (k.startsWith('calendar')) refreshCal();
  if (k === 'voice.engine' || k === 'voice.model') { S.voice = await hn.voiceInfo(); refreshVoiceSec(); renderMicState(); return; }
  if (k === 'voice.micMode') { Cap.opts.audio = micAudio(v); Cap.closeMic(); return; }
  if (k === 'voice.agentVoice') { hn.agentClose(); return; }
  if (k === 'voice.agentRate') { const l = $('#aRateLabel'); if (l) l.textContent = Number(v).toFixed(2) + '배'; hn.agentRate({ rate: Number(v) }); return; }
  if (k === 'voice.agentAuto') { hn.agentRate({ auto: !!v }); return; }
  if (k.startsWith('voice.')) return; // 설정 창을 다시 그리면 슬라이더가 튄다
  render();
}

function openAdd() {
  const areas = S.board.areas.map(a => `<option ${S.f.area === a.id ? 'selected' : ''}>${esc(a.id)}</option>`).join('');
  $('#modal').innerHTML = `<div class="sheet narrow"><div class="sh"><h2>할 일 넣기</h2><button class="x" data-act="mclose">×</button></div>
    <form class="fs" data-act="addform">
      <div class="fr"><label>무엇</label><input type="text" name="title" required style="width:260px" placeholder="예: 장학금 신청서 제출"></div>
      <div class="fr"><label>영역</label><select name="area">${areas}</select></div>
      <div class="fr"><label>마감</label><input type="date" name="date"> <input type="time" name="time" value="${esc(S.set.dueTime)}"></div>
      <div class="fr"><label>마감 이름</label><input type="text" name="label" style="width:160px" placeholder="제출"></div>
      <div class="fr"><label>중요도</label><select name="imp"><option value="0">안 매김</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></div>
      <div class="fr"><label></label><button class="btn on">넣기</button></div>
    </form></div>`;
  $('#modal').hidden = false;
  S.modal = 'add';
  setTimeout(() => $('#modal input[name=title]').focus(), 30);
}
function closeModal() { $('#modal').hidden = true; S.modal = null; }

// ---------- 동작 ----------
function select(id, scroll = true) {
  S.sel = id;
  renderMain(); renderDetail();
  if (scroll) { const el = $(`[data-id="${CSS.escape(id)}"]`, $('#main')); if (el) el.scrollIntoView({ block: 'nearest' }); }
}
function setView(v, save = true) {
  S.view = v;
  if (S.f.sp === 'sessions' || S.f.sp === 'docs' || S.f.sp === 'found') S.f.sp = null;
  if (save) hn.setSettings({ layout: v }).then(s => { S.set = s; });
  render();
}
function moveSel(dir) {
  const ids = $$('#main [data-act="sel"][data-id]').map(e => e.dataset.id);
  if (!ids.length) return;
  const i = ids.indexOf(S.sel);
  select(ids[Math.max(0, Math.min(ids.length - 1, i + dir))] || ids[0]);
}
let toastT;
function toast(text, kind) {
  const t = $('#toast');
  t.textContent = text; t.className = 'toast ' + (kind || ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500);
}
function applyTheme() { document.documentElement.dataset.theme = (S.set && S.set.theme) || 'paper'; }

document.addEventListener('click', async e => {
  if (S.brief) {
    const r = e.target.closest('[data-act="brief-sel"]');
    if (r) { S.brief = false; $('#brief').hidden = true; await hn.dismissBrief(true); select(r.dataset.id); }
    else if (S.briefArmed) closeBrief(false);
    return;
  }
  const v = e.target.closest('#views button');
  if (v) return setView(v.dataset.view);
  if (e.target.id === 'modal') return closeModal();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id || S.sel;
  switch (act) {
    case 'sel': if (!e.target.closest('.stars') && !e.target.closest('.ck')) select(el.dataset.id, false); break;
    case 'check': await toggleCheck(byId(el.dataset.id), el.checked); break;
    case 'dl-check': await hn.setDl(S.sel, el.dataset.date, { done: el.checked ? true : null }); break;
    case 'hidedone': S.set = await hn.setSettings({ hideDone: !S.set.hideDone }); render(); break;
    case 'found-on': await hn.setFound(el.dataset.key, { on: el.checked ? true : null }); if (el.checked) toast('켰습니다. 목록·알람·캘린더에 들어갑니다.'); break;
    case 'found-doc': await hn.setFound(el.dataset.keys.split(','), { on: el.checked ? true : null }); break;
    case 'found-off': await hn.setFound(el.dataset.key, { on: null }); break;
    case 'found-range': S.foundView.range = el.dataset.v; renderMain(); break;
    case 'found-dropped': S.foundView.showDropped = !S.foundView.showDropped; renderMain(); break;
    case 'found-rescan': hn.foundRescan(); break;
    case 'found-ai': { const r = await hn.foundAI(); toast(r.msg, r.ok ? '' : 'error'); break; }
    case 'folder-add': await hn.addFolders(); refreshFolders(); break;
    case 'folder-del': if (confirm('이 폴더를 빼면 거기서 켠 일정도 목록에서 빠집니다. 뺄까요?')) { await hn.removeFolder(el.dataset.p); refreshFolders(); } break;
    case 'folder-on': await hn.setFolder(el.dataset.p, { on: el.checked }); refreshFolders(); break;
    case 'folder-sub': await hn.setFolder(el.dataset.p, { sub: el.checked }); refreshFolders(); break;
    case 'go-found': closeModal(); S.f = { area: null, group: null, sp: 'found' }; render(); break;
    case 'url': hn.openUrl(el.dataset.u); break;
    case 'scope': S.set = await hn.setSettings({ alarms: { scope: el.dataset.v } }); await hn.calSync(); refreshCal(); { const s = $('[data-k="alarms.scope"]'); if (s) s.value = el.dataset.v; } break;
    case 'gscript-copy': await hn.calScriptCode(); toast('연결 코드를 복사했습니다. ② script.new에 붙여 넣으세요.'); break;
    case 'gscript-open': hn.openUrl('https://script.new'); break;
    case 'gscript-connect': {
      toast('연결을 시험하는 중…');
      const r = await hn.calScriptConnect($('#gscriptUrl').value);
      if (r.ok) toast(`연결됐습니다 · 구글 ‘${r.calendar}’ 캘린더에 ${r.count}건`);
      else toast(r.error, 'error');
      reopenCal(); break;
    }
    case 'gscript-off': await hn.calScriptOff(); reopenCal(); break;
    case 'gimport': { const r = await hn.calImportClient(); if (r.ok) { toast('클라이언트를 불러왔습니다. 이제 ‘구글 계정 연결’을 누르세요.'); reopenCal(); } else if (r.error) toast(r.error, 'error'); break; }
    case 'imp': {
      const it = byId(el.dataset.id); const nv = Number(el.dataset.v);
      await hn.setItem(el.dataset.id, { imp: it && it.importance === nv ? null : nv }); break;
    }
    case 'side': {
      if (e.target.closest('[data-act="tw"]')) break;
      S.f = { area: el.dataset.area || null, group: el.dataset.group || null, sp: el.dataset.sp || null };
      if (S.f.area) S.openAreas[S.f.area] = true;
      render(); break;
    }
    case 'tw': { const a = el.dataset.area; S.openAreas[a] = !(S.openAreas[a] ?? (S.f.area === a)); renderSide(); break; }
    case 'sort': S.sort = el.dataset.v; hn.setSettings({ sort: S.sort }); renderMain(); break;
    case 'fold': { const b = el.dataset.band; const band = S.board.bands.find(x => x.id === b); S.fold[b] = !(S.fold[b] ?? !!band.collapsed); renderMain(); break; }
    case 'close': S.sel = null; renderMain(); renderDetail(); break;
    case 'dl-ok': await hn.setDl(id, el.dataset.date, { confirmed: true }); toast('확정했습니다. 알람·캘린더에 들어갑니다.'); break;
    case 'dl-done': { const it = byId(id); const d = it.deadlines.find(x => x.date === el.dataset.date); await hn.setDl(id, el.dataset.date, { done: d && d.done ? null : true }); break; }
    case 'dl-no': await hn.setDl(id, el.dataset.date, { rejected: true }); toast('마감 목록에서 뺐습니다.'); break;
    case 'dl-del': await hn.removeMyDl(id, el.dataset.date); break;
    case 'done': await toggleCheck(byId(id), true); break;
    case 'undone': await toggleCheck(byId(id), false); break;
    case 'hide': await hn.setItem(id, { hidden: true }); S.sel = null; break;
    case 'unhide': await hn.setItem(id, { hidden: null }); break;
    case 'delmanual': if (confirm('이 할 일을 지울까요?')) { await hn.removeManual(id); S.sel = null; } break;
    case 'openp': { const r = await hn.openPath(el.dataset.p); if (r) toast(r, 'error'); break; }
    case 'reveal': hn.reveal(el.dataset.p); break;
    case 'code': { const ok = await hn.openCode(el.dataset.p); if (!ok) toast('VSCode나 폴더를 찾지 못했습니다.', 'error'); break; }
    case 'resume': hn.resume(el.dataset.sid, el.dataset.cwd); toast('터미널에서 이 대화를 이어 엽니다.'); break;
    case 'mclose': closeModal(); break;
    case 'upd-check': S.upd = await hn.update.check(); refreshUpdSec(); renderStatus(); if (S.upd.status === 'none') toast('지금 판이 최신입니다.'); break;
    case 'upd-download': S.upd = await hn.update.download(); refreshUpdSec(); break;
    case 'upd-install': { const r = await hn.update.install(); if (r && r.opened) toast('받은 새 판을 열었습니다. Hannune을 Applications로 끌어 놓으세요.'); break; }
    case 'upd-skip': S.upd = await hn.update.skip(); refreshUpdSec(); renderStatus(); toast('이 판은 건너뜁니다. 다음 새 판이 나오면 다시 알립니다.'); break;
    case 'upd-page': hn.update.page(); break;
    case 'upd-open': openSettings(); setTimeout(() => { const el = $('#updsec'); if (el) el.scrollIntoView({ block: 'center' }); }, 60); break;
    case 'brieftest': closeModal(); hn.testBrief(); break;
    case 'icsopen': hn.calOpenIcs(); break;
    case 'learn-forget': {
      if (el.dataset.all && !confirm('배운 숫자 읽기를 모두 지울까요? 다시 기본 읽기로 돌아갑니다.')) break;
      await hn.nlpForget(el.dataset.all ? { all: true } : el.dataset.text ? { text: el.dataset.text } : { shape: el.dataset.shape });
      S.set = await hn.settings(); refreshLearn(); toast('지웠습니다. 다음부터 기본 읽기로 읽습니다.'); break;
    }
    case 'pcal-clear': { const st = await hn.phoneCalClear(); refreshPcal(st); toast('폰에서 가져온 일정을 지웠습니다. 폰의 캘린더는 그대로입니다.'); break; }
    case 'gconnect': toast('브라우저에서 구글 허용을 눌러 주세요.'); { const r = await hn.calConnect(); if (r && r.error) toast(r.error, 'error'); else toast('구글 캘린더에 맞췄습니다.'); refreshCal(); } break;
    case 'gsync': { const r = await hn.calSync(); refreshCal(); toast(`캘린더 ${r ? r.count : 0}건 맞춤`); break; }
    case 'gdisconnect': await hn.calDisconnect(); refreshCal(); break;
    case 'acttoday': { const r = await hn.activityToday(); $('#actinfo').textContent = r.count ? r.byApp.map(([a, m]) => `${a} ${m}분`).join(' · ') : '오늘 기록 없음'; break; }
    case 'actclear': if (confirm('창 사용 기록을 모두 지울까요? 되돌릴 수 없습니다.')) { const n = await hn.activityClear(); toast(`기록 파일 ${n}개를 지웠습니다.`); } break;
    case 'aiall': closeModal(); hn.runAI(true); break;
    case 'opendata': hn.openData(); break;
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.closest('#modal') && (el.dataset.k || el.dataset.off)) return onSettingChange(el);
  const act = el.dataset.act;
  const id = S.sel;
  if (act === 'area') await hn.setItem(id, { area: el.value });
  else if (act === 'group') await hn.setItem(id, { group: el.value.trim() || null });
  else if (act === 'title') await hn.setItem(id, { title: el.value.trim() || null });
  else if (act === 'note') await hn.setItem(id, { note: el.value || null });
  else if (act === 'dl-time') await hn.setDl(id, el.dataset.date, { time: el.value || null });
  else if (act === 'assign') { if (el.value) { await hn.assignSession(el.dataset.sid, el.value); toast('짝지었습니다.'); } }
  else if (act === 'found-target') await hn.setFound(el.dataset.key, { target: el.value || null });
  else if (act === 'found-label') await hn.setFound(el.dataset.key, { label: el.value.trim() || null });
  else if (act === 'folder-area') { await hn.setFolder(el.dataset.p, { area: el.value || null }); }
});

// 완료 체크: 그 자리에 줄을 긋고(체크할 때 있던 띠 그대로) 며칠 뒤 '끝낸 일'로. 알람·캘린더에서는 바로 빠진다.
async function toggleCheck(it, on) {
  if (!it) return;
  if (on) await hn.setItem(it.id, { done: true, doneAt: Date.now(), doneBand: it.band, active: null });
  else await hn.setItem(it.id, { done: null, doneAt: null, doneBand: null, active: it.status === '완료' ? true : null });
}
function refreshFolders() {
  const b = $('#flistbox');
  if (b) b.innerHTML = folderListHTML();
  if (S.f.sp === 'found') renderMain();
  renderSide();
}
function reopenCal() {
  hn.settings().then(s => { S.set = s; openSettings(); const c = $('#calsec'); if (c) c.scrollIntoView(); });
}

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const fd = Object.fromEntries(new FormData(f));
  if (f.dataset.act === 'dl-add') {
    await hn.addDl(S.sel, { date: fd.date, time: fd.time, label: fd.label || '마감' });
    toast('마감을 넣었습니다.');
  } else if (f.dataset.act === 'addform') {
    const id = await hn.addManual({ title: fd.title, area: fd.area, date: fd.date, time: fd.time, label: fd.label || '마감', imp: Number(fd.imp) || 0 });
    closeModal();
    S.f = { area: null, group: null, sp: null };
    setTimeout(() => select(id), 200);
  }
});

$('#q').addEventListener('input', e => { S.q = e.target.value; renderMain(); });
$('#btnAdd').onclick = openAdd;
$('#btnAI').onclick = () => hn.runAI(false);
$('#btnScan').onclick = () => hn.scan();
$('#btnPin').onclick = async () => { await hn.pin(); };
$('#btnMini').onclick = () => hn.mini();
$('#btnSet').onclick = openSettings;
$('#rec').onclick = openSettings;

// 4분면 끌어 옮기기: 위 = 중요, 아래 = 덜 중요. 급함은 마감 날짜로 정해진다.
document.addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
document.addEventListener('dragover', e => { const q = e.target.closest('.quad'); if (q) { e.preventDefault(); $$('.quad').forEach(x => x.classList.toggle('over', x === q)); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget || !e.relatedTarget.closest('.quad')) $$('.quad').forEach(x => x.classList.remove('over')); });
document.addEventListener('drop', async e => {
  const q = e.target.closest('.quad');
  $$('.quad').forEach(x => x.classList.remove('over'));
  if (!q) return;
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  const it = byId(id);
  if (!it) return;
  const top = q.dataset.q === 'q1' || q.dataset.q === 'q2';
  const min = S.set.importantMin;
  const cur = it.importance || 0;
  if (top && cur < min) await hn.setItem(id, { imp: min });
  else if (!top && (cur >= min || !cur)) await hn.setItem(id, { imp: Math.max(1, min - (cur ? 1 : 2)) });
  const urgentNow = it.days != null && it.days <= S.set.urgentDays;
  const wantUrgent = q.dataset.q === 'q1' || q.dataset.q === 'q3';
  if (urgentNow !== wantUrgent) toast('급함은 마감 날짜로 정해집니다. 날짜는 오른쪽 자세히에서 바꾸세요.');
});

document.addEventListener('keydown', e => {
  if (S.brief) { e.preventDefault(); if (S.briefArmed) closeBrief(false); return; }
  if (e.key === 'Escape' && !$('#pop').hidden) { closePop(); return; }
  if (!$('#modal2').hidden) { if (e.key === 'Escape') closeModal2(); return; }
  if (S.modal) { if (e.key === 'Escape') closeModal(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.shiftKey && /^Digit[0-5]$/.test(e.code) && S.sel) { const n = Number(e.code.slice(5)); hn.setItem(S.sel, { imp: n || null }); e.preventDefault(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  switch (e.key) {
    case '/': e.preventDefault(); $('#q').focus(); break;
    case '1': setView('list'); break;
    case '2': setView('matrix'); break;
    case '3': setView('timeline'); break;
    case 'ArrowDown': case 'j': e.preventDefault(); moveSel(1); break;
    case 'ArrowUp': case 'k': e.preventDefault(); moveSel(-1); break;
    case 'Escape': S.sel = null; renderMain(); renderDetail(); break;
    case 'n': case 'N': e.preventDefault(); openAdd(); break;
    case 'r': case 'R': hn.scan(); break;
    case 'x': case 'X': { const it = byId(S.sel); if (it) toggleCheck(it, !isChecked(it)); break; }
    case 'e': case 'E': case 'F2': if (S.sel) { e.preventDefault(); openEdit(S.sel); } break;
    case 'q': case 'Q': e.preventDefault(); $('#quickIn').focus(); break;
  }
});
// Alt+V: 지금 열린 곳에서 말로 넣기(변경 창이 열려 있으면 거기). 입력 칸 안에서도 됨. 누르고 있으면 뗄 때 끝. Esc: 듣기 취소
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && VS && VS.source === 'pc' && voiceCancelNow()) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.key === 'Escape' && AG.open && !S.modal) { e.preventDefault(); e.stopPropagation(); agentClose(); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB' && !e.repeat) { e.preventDefault(); if (S.brief) closeBrief(false); agentOpen(true); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) {
    if (S.brief) return;
    e.preventDefault();
    if (e.repeat) return;
    pressAt = e.timeStamp;
    voiceStart(S.modal === 'edit' && $('#eMic') ? 'edit' : 'quick', { hold: true });
  }
}, true);
document.addEventListener('keyup', e => { if (e.code === 'KeyV' || e.key === 'Alt') voiceRelease(e.timeStamp); }, true);

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const b = $('#bclock');
  if (b) b.textContent = $('#clock').textContent;
  if (now.getSeconds() === 0 && now.getMinutes() === 0) renderBar();
}

async function init() {
  [S.board, S.set] = await Promise.all([hn.board(), hn.settings()]);
  S.view = S.set.layout || 'list';
  S.sort = S.set.sort || 'urgency';
  applyTheme();
  S.ai = await hn.aiState();
  S.act = await hn.activityState();
  S.agent = await hn.agentInfo();
  S.app = await hn.info();
  S.upd = await hn.update.state();
  S.platform = S.agent.platform;
  document.body.classList.add(S.platform === 'darwin' ? 'mac' : S.platform === 'win32' ? 'win' : 'linux');
  hn.calStatus().then(c => { S.cal = c; renderStatus(); });
  hn.on('update', st => {
    const was = S.upd || {};
    S.upd = st; refreshUpdSec(); renderStatus();
    if (st.status === 'ready' && was.status !== 'ready') toast(st.mode === 'manual' ? `새 판 ${st.latest}을 다운로드 폴더에 받았습니다. 설정 › 새 판 받기에서 여세요.` : `새 판 ${st.latest}을 받아 두었습니다. 끝낼 때 설치됩니다(지금 바꾸려면 아래 ‘새 판 설치’).`);
  });
  hn.on('update:open', () => { openSettings(); setTimeout(() => { const el = $('#updsec'); if (el) el.scrollIntoView({ block: 'center' }); }, 60); });
  hn.on('board', b => { S.board = b; if (S.sel && !byId(S.sel)) S.sel = null; render(); });
  // 미니 창에서 바꾼 설정(끝낸 일 감추기 등)도 바로 반영
  hn.on('settings', async s => { S.set = s; applyTheme(); render(); if ($('#learnbox')) refreshLearn(); S.voice = await hn.voiceInfo(); renderMicState(); });
  hn.on('voice:evt', ev => { if (ev.type === 'check') onVoiceCheck(ev); else onVoiceEvt(ev); });
  hn.on('voice:local', st => { if (st.done) toast('내 PC Whisper를 내려받았습니다.'); if (st.err) toast(st.err, 'error'); hn.voiceLocalStatus().then(paintLocal); });
  hn.on('phone', st => paintPhone(st));
  hn.on('local:progress', p => lmProgress(p));
  S.phone = await hn.phoneState();
  hn.on('scan', s => { S.scanBusy = s.busy; renderBar(); renderStatus(); });
  hn.on('ai', a => { const was = S.ai.running; S.ai = a; renderBar(); renderStatus(); if (was && !a.running && a.msg) toast(a.msg, /실패/.test(a.msg) ? 'error' : ''); });
  hn.on('phonecal', st => { if (S.modal === 'settings') refreshPcal(st); });
  hn.on('cal', c => { S.cal = { ...(S.cal || {}), ...c }; renderStatus(); if (S.modal === 'settings') refreshCal(); });
  hn.on('activity', a => { S.act = a; renderBar(); renderStatus(); });
  hn.on('select', id => { S.f = { area: null, group: null, sp: null }; select(id); });
  hn.on('brief', b => (b.show ? openBrief() : closeBrief(true)));
  hn.on('toast', t => toast(t.text, t.kind));
  hn.on('voice', v => {
    if (v.openPhone) { closeModal2(); openSettings(); const p = $('#phonesec'); if (p) p.scrollIntoView(); return; }
    if (v.start) { if (S.brief) closeBrief(false); closeModal2(); if (S.modal !== 'edit') closeModal(); voiceStart(v.start === 'edit' && S.modal === 'edit' ? 'edit' : 'quick'); }
  });
  S.voice = await hn.voiceInfo();
  renderMicState();
  Cap.opts.audio = micAudio(S.set.voice.micMode);
  Cap.prepare(); // 소리 장치를 미리 깨워 둔다(누르자마자 말해도 첫 낱말을 잃지 않게)
  hn.on('agent:evt', onAgentEvt);
  hn.on('agent:audio', buf => { agentPlayer().push(new Uint8Array(buf)); });
  hn.on('agent:open', o => { if (S.brief) closeBrief(false); agentOpen(!!o.listen); });
  hn.on('agent:screen', onAgentScreen);
  hn.on('found:scan', s => { S.foundScan = s; if (S.f.sp === 'found') renderMain(); });
  hn.on('found:ai', a => { S.foundAi = a; if (S.f.sp === 'found') renderMain(); });
  hn.on('test', t => {
    if (t.closeAll) { closeModal2(); closeModal(); closePop(); }
    if (t.applyConfirm) { const b = $('#modal2 [data-act="c-apply"]'); if (b) b.click(); }
    if (t.edit) { S.f = { area: null, group: null, sp: null }; render(); const first = sorted(visible()).find(x => x.fdl); if (first) { select(first.id); openEdit(first.id); } }
    if (t.editText) { $('#nlIn').value = t.editText; nlPreview(); runNL(false); }
    if (t.quick !== undefined) { $('#quickIn').value = t.quick; quickPreview(); $('#quickIn').focus(); }
    if (t.voiceState) {
      if (t.voiceState === 'idle') { VS = null; voiceDone(); }
      else if (t.voiceState === 'agent') { agentOpen(false); AG.log = [{ who: 'me', text: '오늘 뭐 있어? 나 좀 급해' }, { who: 'ai', text: '오늘은 오후 3시 팀 회의 하나입니다. 내일 저녁 6시까지 보고서 제출도 있어요.' }]; AG.state = 'speaking'; AG.rate = 1.25; agentLogPaint(); agentPaint(); for (let i = 0; i < 30; i++) agentBars.push(0.2 + 0.6 * Math.abs(Math.sin(i / 2))); AG.level = 0.6; agentMicPaint(); }
      else { VS = { id: 'test', where: 'quick', source: t.voiceSource || 'pc', state: t.voiceState, t0: Date.now() - 2000, hold: false, base: '', text: '' }; for (let i = 0; i < 40; i++) { const lv = 0.25 + 0.55 * Math.abs(Math.sin(i / 2.3)) * Math.abs(Math.cos(i / 7)); voicePaint(lv); } setInterim(t.voiceText || ''); clearInterval(S._voiceTick); S._voiceTick = 1; }
    }
    if (t.graph) { const sp = $('#main .spark'); if (sp) { const r = sp.getBoundingClientRect(); openGraphPop(r.left, r.bottom + 4); } }
    if (t.words) { openWords(); W.push({ word: '칼퇴', action: 'time', value: '18:00' }, { word: '불금', action: 'weekday', value: '금' }); renderWords(); $('#wTry').value = '칼퇴 전까지 불금으로 별 넷'; wordsTry(); }
    if (t.found) { S.f = { area: null, group: null, sp: 'found' }; S.foundView.range = t.found; render(); }
    if (t.check) { const it = sorted(visible()).find(x => x.band === 'today' || x.band === 'd3' || x.band === 'd7'); if (it) toggleCheck(it, true); }
    if (t.view) setView(t.view, false);
    if (t.selectFirst) { const first = sorted(visible())[0]; if (first) select(first.id); }
    if (t.settings === true) openSettings();
    if (t.scrollTo) { const s = $('#' + t.scrollTo); if (s) s.scrollIntoView({ block: 'start' }); }
    if (t.scrollCal) { const c = $('#pcalsec') || $('#calsec'); if (c) c.scrollIntoView(); }
    if (t.settings === false) closeModal();
    if (t.brief === true) openBrief();
    if (t.brief === false) { S.brief = false; $('#brief').hidden = true; }
  });
  setInterval(tickClock, 1000);
  tickClock();
  if (S.board) render();
  else $('#main').innerHTML = '<div class="empty">처음 읽는 중입니다… Claude 대화 기록을 훑는 데 몇 초 걸립니다.</div>';
}
init();

// =====================================================================
// v1.2 — 칸 너비 조절 · 빠른 입력 · 변경 창(글로 바꾸기) · 내 낱말 · 그래프 설정 · AI 에이전트
// =====================================================================
const KEY_NAMES = { date: '마감 날짜', time: '시각', imp: '중요도', area: '영역', group: '주제', title: '일 이름', label: '마감 이름', kind: '종류', done: '완료', hidden: '숨김', removeDl: '마감 지우기', addNew: '새 마감으로 추가' };
function fmtVal(k, v) {
  if (k === 'date') return v ? NLP.fmtDate(v) : '없음';
  if (k === 'imp') return v ? '★'.repeat(v) : '안 매김';
  if (k === 'done') return v ? '끝냄' : '안 끝남';
  if (k === 'hidden') return v ? '숨김' : '보임';
  if (k === 'kind') return v === 'event' ? '일정(발표·회의)' : '마감(제출·회신)';
  if (k === 'removeDl' || k === 'addNew') return v ? '예' : '아니오';
  return v === undefined || v === null || v === '' ? '없음' : String(v);
}
const closeModal2 = () => { $('#modal2').hidden = true; $('#modal2').innerHTML = ''; };
const closePop = () => { $('#pop').hidden = true; };

// ---------- 칸 너비 끌기 ----------
function startDrag(which, e) {
  e.preventDefault();
  const sp = which === 'L' ? $('#splitL') : $('#splitR');
  sp.classList.add('drag');
  document.body.classList.add('dragging');
  const startX = e.clientX;
  const ui = S.set.ui || {};
  const start = which === 'L' ? (ui.sideW || 236) : (ui.detailW || 400);
  let val = start;
  const move = ev => {
    const dx = ev.clientX - startX;
    val = which === 'L' ? Math.max(150, Math.min(520, start + dx)) : Math.max(260, Math.min(760, start - dx));
    $('#frame').style.setProperty(which === 'L' ? '--side-w' : '--detail-w', val + 'px');
  };
  const up = async () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    sp.classList.remove('drag');
    document.body.classList.remove('dragging');
    S.set = await hn.setSettings({ ui: which === 'L' ? { sideW: val } : { detailW: val } });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
$('#splitL').addEventListener('mousedown', e => startDrag('L', e));
$('#splitR').addEventListener('mousedown', e => startDrag('R', e));
$('#splitL').addEventListener('dblclick', async () => { S.set = await hn.setSettings({ ui: { sideCollapsed: true } }); render(); });

// ---------- 아래 빠른 입력 ----------
function quickParse() {
  const v = $('#quickIn').value;
  return NLP.parse(v, { mode: 'quick', custom: S.set.nlp.custom, learn: S.set.nlp.learn });
}
function quickPreview() {
  const v = $('#quickIn').value.trim();
  const box = $('#quickPrev');
  if (!v) { box.innerHTML = ''; return; }
  const r = quickParse();
  const g = k => (r.actions.find(a => a.type === k) || {}).value;
  const parts = [`<b>${esc(r.title || '(이름 없음)')}</b>`];
  if (g('date')) parts.push(`<span class="tag">${NLP.fmtDate(g('date'))}${g('time') ? ' ' + g('time') : ''}</span>`);
  else if (g('time')) parts.push(`<span class="tag">오늘 ${g('time')}</span>`);
  if (g('imp')) parts.push(`<span class="tag">${'★'.repeat(g('imp'))}</span>`);
  if (g('area')) parts.push(`<span class="tag">${esc(g('area'))}</span>`);
  if (g('kind')) parts.push(`<span class="tag">${g('kind') === 'event' ? '일정' : '마감'}</span>`);
  if (r.actions.some(a => a.learned)) parts.push('<span class="tag learn" title="전에 고친 대로 읽었습니다. 설정 › 글로 바꾸기에서 지울 수 있습니다">배운 대로</span>');
  box.innerHTML = '→ ' + parts.join(' ');
}
$('#quickIn').addEventListener('input', quickPreview);
$('#quick').addEventListener('submit', async e => {
  e.preventDefault();
  e.stopPropagation();
  const r = quickParse();
  const typed = $('#quickIn').value.trim();
  if (!r.title) { toast('할 일 이름을 함께 써 주세요. 예: 내일 3시 보고서 제출', 'error'); return; }
  const g = k => (r.actions.find(a => a.type === k) || {}).value;
  let date = g('date');
  if (!date && g('time')) date = NLP.ymd(new Date());
  const kind = g('kind') || 'deadline';
  const id = await hn.addManual({ title: r.title, area: g('area') || (S.f.area || '개인'), date, time: g('time') || '', label: kind === 'event' ? '일정' : '마감', imp: g('imp') || 0, kind, src: typed });
  $('#quickIn').value = '';
  quickPreview();
  const when = `${date ? NLP.fmtDate(date) : ''}${g('time') ? ' ' + g('time') : ''}`.trim();
  toast(`넣었습니다: ${r.title}${when ? ' · ' + when : ''}`);
  const heard = S._heard; voiceLearnOnSubmit(typed);
  if (heard && heard.source !== 'phone' && S.set.voice.speak) Voice.say(`넣었습니다. ${r.title}${when ? ', ' + when : ''}`, { voiceName: S.set.voice.voiceName, rate: S.set.voice.rate });
  setTimeout(() => select(id), 250);
});

// ---------- 음성 ----------
// 소리는 voicecore.js가 모으고, 받아쓰기는 본체(svc/voicehub.js)가 한다. 이 PC 마이크와 폰 마이크가 같은 길을 쓴다.
// 눌렀다 바로 떼면 → 말이 끝날 때 알아서 멈춤 / 누르고 있으면 → 떼는 순간 끝.
const Cap = new VoiceCore.Capture({ preRollMs: 300, warmMs: 20000 });
const HOLD_MS = 350;
const micAudio = mode => ({ channelCount: 1, echoCancellation: mode !== 'raw', noiseSuppression: mode === 'noisy', autoGainControl: mode !== 'raw' });
let pressAt = 0; // 누른 때(눌렀다 뗐는지 오래 눌렀는지는 실제 입력 시각으로 잰다. 창이 바빠도 틀리지 않게)
let VS = null; // 지금 진행 중인 말: { id, where, source, state:'listening'|'busy', t0, hold, base, text }
let qWaveBars = null;

const micOf = where => $({ quick: '#qMic', edit: '#eMic', test: '#vMic', compare: '#vCmpMic' }[where] || '#qMic');
const secText = t0 => { const s = Math.floor((Date.now() - t0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function voiceMsg(text, color) { const m = $('#voiceMsg'); if (m) { m.textContent = text; m.style.color = color || ''; } }

// 마이크 단추·안내·소리 막대를 지금 상태대로 그린다
function voicePaint(level) {
  const v = VS;
  const q = $('#qMic');
  if (q && !(v && v.where === 'quick')) { q.className = 'mic' + (S.voice && !S.voice.ready ? ' off' : ''); q.style.removeProperty('--lv'); }
  if (!v) { document.body.classList.remove('voice-on'); clearInterval(S._voiceTick); S._voiceTick = null; const w = $('#qWave'); if (w) w.hidden = true; return; }
  const mic = micOf(v.where);
  if (mic) {
    mic.className = `mic ${v.state}${v.source === 'phone' ? ' phone' : ''}`;
    if (level !== undefined) mic.style.setProperty('--lv', level.toFixed(2));
  }
  if (v.where === 'quick') {
    document.body.classList.add('voice-on');
    const box = $('#quickPrev'), wave = $('#qWave');
    wave.hidden = v.state !== 'listening';
    if (!qWaveBars) qWaveBars = Voice.bars(wave);
    if (level !== undefined && v.state === 'listening') qWaveBars.push(level);
    const who = v.source === 'phone' ? '폰에서 ' : '';
    box.className = 'qp ' + (v.state === 'busy' ? 'busy' : 'listen');
    box.textContent = v.state === 'opening' ? '마이크 여는 중… 소리가 나면 말하세요'
      : v.state === 'listening' ? `${who}듣는 중 ${secText(v.t0)}${v.source === 'phone' ? '' : v.hold ? ' · 손을 떼면 끝' : ' · 말이 끝나면 알아서 멈춤 · Esc 취소'}`
        : `${who}받아 적는 중…`;
  }
  if (v.where === 'edit') { const p = $('#nlPrev'); if (p) p.textContent = v.state === 'opening' ? '마이크 여는 중…' : v.state === 'listening' ? `듣는 중 ${secText(v.t0)} — “이틀 미뤄 줘”, “다음 주 금요일 오후 3시로”, “완료”` : '받아 적는 중…'; }
  if (where2(v) === 'msg') voiceMsg(v.state === 'opening' ? '마이크 여는 중…' : v.state === 'listening' ? `듣는 중 ${secText(v.t0)} · 아무 말이나 해 보세요` : '받아 적는 중…');
  if (!S._voiceTick) S._voiceTick = setInterval(() => voicePaint(), 500);
}
function where2(v) { return v.where === 'test' || v.where === 'compare' ? 'msg' : v.where; }
function renderMicState() {
  const q = $('#qMic');
  if (!q) return;
  if (!VS) q.className = 'mic' + (S.voice && !S.voice.ready ? ' off' : '');
  const pc = S.phone && S.phone.phones ? ' · 폰 연결됨' : '';
  q.title = S.voice && !S.voice.ready ? `말로 넣기 — ${S.voice.why}` : `말로 넣기 — 눌렀다 떼면 말이 끝날 때 알아서 멈추고, 누르고 있으면 손을 뗄 때 끝납니다 (Alt+V · 어디서나 Ctrl+Alt+V)${S.voice ? ' · ' + S.voice.label : ''}${pc}`;
}
function setInterim(text) {
  if (!VS) return;
  VS.text = text;
  const full = [VS.base, text].filter(Boolean).join(' ');
  if (VS.where === 'quick') { const i = $('#quickIn'); i.value = full; i.classList.add('interim'); i.scrollLeft = i.scrollWidth; }
  if (VS.where === 'edit') { const t = $('#nlIn'); if (t) { t.value = full; t.classList.add('interim'); } }
  if (VS.where === 'test' || VS.where === 'compare') voiceMsg(`듣는 중: ${text}`);
}
function voiceDone() {
  VS = null;
  const i = $('#quickIn'); if (i) i.classList.remove('interim');
  const t = $('#nlIn'); if (t) t.classList.remove('interim');
  voicePaint();
  renderMicState();
}
// 소리 난다: 눌렀다는 것을 귀로도 알림(짧게, 받아쓰기에 안 들어갈 만큼 작게)
let toneCtx = null;
function startTone() {
  if (!S.set.voice.tone) return;
  try {
    toneCtx = toneCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = toneCtx.createOscillator(), g = toneCtx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.045, toneCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.0008, toneCtx.currentTime + 0.07);
    o.connect(g); g.connect(toneCtx.destination); o.start(); o.stop(toneCtx.currentTime + 0.08);
  } catch (_) { /* 소리는 없어도 됨 */ }
}
const micErrText = e => (/NotAllowed|Permission|denied/i.test(e.name + e.message) ? '마이크 사용이 막혀 있습니다. 윈도우 설정 › 개인 정보 › 마이크에서 데스크톱 앱을 허용하세요.'
  : /NotFound|DevicesNotFound/i.test(e.name) ? '마이크가 없습니다. 폰 앱을 연결하면 폰 마이크로 말할 수 있습니다.' : '마이크를 열지 못했습니다: ' + e.message);

// 듣기 시작. hold: true면 손을 뗄 때까지(눌렀다 바로 떼면 voiceRelease가 자동 끝내기로 바꾼다)
async function voiceStart(where, { hold = false, itemId = null } = {}) {
  if (VS && VS.source === 'pc' && (VS.state === 'listening' || VS.state === 'opening')) { if (Cap.active) Cap.stop('user'); return; }
  if (VS) return;
  if (!S.voice || !S.voice.ready) {
    S.voice = await hn.voiceInfo();
    if (!S.voice.ready) { toast(S.voice.why, 'error'); if (where === 'test' || where === 'compare') voiceMsg(S.voice.why, 'var(--red)'); if (where === 'quick') $('#quickIn').focus(); return; }
  }
  Voice.hush();
  const id = LinkCore.newId();
  const baseEl = where === 'quick' ? $('#quickIn') : null;
  VS = { id, where, source: 'pc', state: Cap.isOpen ? 'listening' : 'opening', t0: Date.now(), hold, base: baseEl ? baseEl.value.trim() : '', text: '', chunks: where === 'compare' ? [] : null };
  voicePaint(0);
  if (where !== 'compare') hn.voiceBegin({ id, where, itemId });
  Cap.touch();
  try { await Cap.openMic(); }
  catch (e) { if (where !== 'compare') hn.voiceCancel(id); voiceDone(); toast(micErrText(e), 'error'); if (where === 'test' || where === 'compare') voiceMsg(micErrText(e), 'var(--red)'); return; }
  if (!VS || VS.id !== id) return; // 여는 사이에 취소
  VS.state = 'listening'; VS.t0 = Date.now();
  voicePaint(0);
  startTone();
  const v = S.set.voice;
  Cap.begin({
    onChunk: b => { if (VS && VS.id === id) { if (VS.chunks) VS.chunks.push(b.slice(0)); else hn.voiceChunk(id, b); } },
    onLevel: lv => { if (VS && VS.id === id) { VS.lvl = lv; voicePaint(lv); } },
    onEnd: why => voiceEnded(id, why),
  }, { auto: !VS.hold, silenceMs: v.silenceMs, maxSec: v.maxSec });
}
// 단추를 뗐을 때: 잠깐 눌렀으면 자동 끝내기로, 오래 눌렀으면 여기서 끝
function voiceRelease(atMs) {
  if (!VS || VS.source !== 'pc' || VS.state === 'busy' || !VS.hold) return;
  const held = (atMs === undefined ? performance.now() : atMs) - pressAt;
  if (held < HOLD_MS) {
    VS.hold = false;
    if (Cap.active) Cap.setAuto(true, { silenceMs: S.set.voice.silenceMs, maxMs: S.set.voice.maxSec * 1000 });
    voicePaint();
  } else if (Cap.active) Cap.stop('user');
}
function voiceEnded(id, why) {
  if (!VS || VS.id !== id) return;
  if (why === 'nospeech') {
    if (VS.where !== 'compare') hn.voiceCancel(id);
    const w = VS.where;
    voiceDone();
    const msg = '아무 말도 들리지 않았습니다. 마이크 가까이에서 다시 말해 보세요.';
    toast(msg); if (w === 'test' || w === 'compare') voiceMsg(msg, 'var(--red)');
    return;
  }
  VS.state = 'busy';
  voicePaint();
  if (VS.where === 'compare') return voiceCompareRun(VS.chunks);
  hn.voiceEnd(id);
}
function voiceCancelNow() {
  if (!VS) return false;
  if (VS.source === 'phone') return false;
  const base = VS.base, w = VS.where;
  if (w !== 'compare') hn.voiceCancel(VS.id);
  Cap.cancel();
  voiceDone();
  if (w === 'quick') { $('#quickIn').value = base; quickPreview(); }
  return true;
}
function sayIt(text) { const v = S.set.voice; if (v.speak) Voice.say(text, { voiceName: v.voiceName, rate: v.rate }); }

// 본체에서 온 음성 소식
function onVoiceEvt(ev) {
  if (ev.type === 'phone-added' || ev.type === 'phone-cancel') {
    // 폰에서 넣거나 취소했으면 이 PC 칸에 띄워 둔 글을 치운다
    if (S._heard && S._heard.id === ev.id) { const i = $('#quickIn'); if (i.value === S._heard.full) { i.value = ''; quickPreview(); } S._heard = null; }
    if (VS && VS.id === ev.id) voiceDone();
    return;
  }
  // 늦게 온 글자로 고친 결과: 사용자가 아직 안 고쳤으면 칸의 글을 바꾼다
  if (ev.type === 'final' && ev.revised) {
    const i = $('#quickIn');
    if (S._heard && S._heard.id === ev.id && i.value === S._heard.full) { const base = S._heard.base || ''; const full = [base, ev.text].filter(Boolean).join(' '); i.value = full; S._heard.full = full; S._heard.text = full; quickPreview(); }
    return;
  }
  // 폰에서 말하기 시작: 이 PC의 바로 넣기 칸에 그대로 보여 준다
  if (ev.source === 'phone' && ev.where === 'quick' && !VS && (ev.type === 'level' || ev.type === 'interim')) {
    const i = $('#quickIn');
    VS = { id: ev.id, where: 'quick', source: 'phone', state: 'listening', t0: Date.now(), hold: false, base: i.value.trim(), text: '' };
  }
  if (!VS || VS.id !== ev.id) return;
  switch (ev.type) {
    case 'level': if (VS.source === 'phone') voicePaint(ev.v); break; // 이 PC 마이크는 화면이 직접 재서 더 빠르다
    case 'interim': setInterim(ev.text); break;
    case 'busy': VS.state = 'busy'; voicePaint(); break;
    case 'error': { const w = VS.where; voiceDone(); toast(ev.msg, 'error'); if (w === 'test') voiceMsg(ev.msg, 'var(--red)'); break; }
    case 'final': voiceFinal(ev); break;
  }
}
function voiceFinal(ev) {
  const { where, source, base } = VS;
  if (!ev.text) {
    voiceDone();
    if (where === 'test') voiceMsg('들린 말이 없습니다.', 'var(--red)'); else if (source !== 'phone') toast('들린 말이 없습니다. 다시 말해 보세요.');
    if (where === 'quick') { $('#quickIn').value = base; quickPreview(); }
    return;
  }
  voiceDone();
  const took = ev.ms && ev.ms.afterEnd != null ? `${(ev.ms.afterEnd / 1000).toFixed(1)}초` : '';
  if (where === 'test') {
    voiceMsg(`들은 말: “${ev.text}” — ${S.voice.label || ev.engine}${took ? ' · 말이 끝나고 ' + took : ''}${ev.fixes && ev.fixes.length ? ' · 고침: ' + ev.fixes.map(f => `${f.from}→${f.to}`).join(', ') : ''}`, 'var(--blue)');
    sayIt(ev.text);
    return;
  }
  if (where === 'edit') {
    const t = $('#nlIn'); if (!t) return;
    t.value = ev.text; nlPreview();
    runNL(false); // 확인 창이 떠서 적용 전에 한 번 본다
    return;
  }
  const inp = $('#quickIn');
  const full = [base, ev.text].filter(Boolean).join(' ');
  inp.value = full; quickPreview();
  S._heard = { id: ev.id, text: full, full, source, base };
  const p = quickParse();
  if (source === 'phone') { toast(`폰에서 들어옴: ${ev.text}`); return; }
  inp.focus();
  if (S.set.voice.autoSubmit && p.title) { $('#quick').requestSubmit(); return; }
  const g = k => (p.actions.find(a => a.type === k) || {}).value;
  const when = g('date') ? NLP.fmtDate(g('date')) + (g('time') ? ' ' + g('time') : '') : (g('time') ? '오늘 ' + g('time') : '');
  sayIt(p.title ? `${p.title}${when ? ', ' + when : ''}` : '할 일 이름을 함께 말해 주세요.');
}
// 정확도 확인 모드: 다른 모델이 다르게 들었으면 후보로 보여 준다
function onVoiceCheck(ev) {
  if (!S._heard || S._heard.id !== ev.id) return;
  const box = $('#quickPrev');
  if (!box || $('#quickIn').value !== S._heard.full) return;
  S._heard.alt = ev.text;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'qcand'; b.title = `다른 모델(${ev.model})은 이렇게 들었습니다. 누르면 이 글로 바꿉니다.`;
  b.textContent = `혹시: ${ev.text}`;
  b.onclick = () => { const i = $('#quickIn'); i.value = ev.text; S._heard.full = ev.text; quickPreview(); i.focus(); };
  box.appendChild(b);
}
// 받아 적은 글을 고쳐서 넣었으면 배운다
function voiceLearnOnSubmit(finalText) {
  if (S._heard && S._heard.text && S._heard.text !== finalText) hn.voiceLearn(S._heard.text, finalText).then(got => { if (got && got.length) toast(`배웠습니다: ${got.map(x => `${x.heard} → ${x.fixed}`).join(', ')}`); });
  S._heard = null;
}

// 마이크 단추 다루기: 누르는 즉시 듣고, 떼는 시간으로 방식을 정한다
function bindMic(el, where, opts) {
  if (!el) return;
  el.addEventListener('pointerdown', e => { e.preventDefault(); pressAt = e.timeStamp; try { el.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } voiceStart(where, { hold: true, ...(opts || {}) }); });
  el.addEventListener('pointerup', e => voiceRelease(e.timeStamp));
  el.addEventListener('pointercancel', e => voiceRelease(e.timeStamp));
  // 마우스를 올리면 미리 준비: 받아쓰기 연결을 열고 마이크도 잠깐 열어 둔다(누르기 직전 소리부터 담음, 20초 안 쓰면 닫음)
  el.addEventListener('mouseenter', () => { if (VS) return; hn.voiceWarm(); if (S.voice && S.voice.ready) Cap.warm(20000).catch(() => { /* 누를 때 다시 알림 */ }); });
  el.addEventListener('click', e => e.preventDefault());
}
bindMic($('#qMic'), 'quick');
$('#qAgent').addEventListener('click', () => { if (AG.open) agentClose(); else agentOpen(true); });
$('#agentPanel').addEventListener('keydown', e => { if (e.target.id === 'aText' && e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); e.stopPropagation(); agentPlayer().stop(); const t = e.target.value.trim(); e.target.value = ''; hn.agentText(t); } });
window.addEventListener('blur', () => { if (VS && VS.hold) voiceRelease(); });

// 내 목소리로 비교: 같은 말을 여러 엔진에 보내 나란히 본다
async function voiceCompareRun(chunks) {
  const n = chunks.reduce((a, b) => a + b.length, 0);
  const all = new Uint8Array(n); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  voiceDone();
  voiceMsg('엔진마다 받아 적는 중…');
  const box = $('#vCmp');
  if (box) box.innerHTML = '<div class="exp">받아 적는 중… (느린 엔진은 20초쯤 걸릴 수 있습니다)</div>';
  const engines = [{ engine: 'live', label: 'Gemini 실시간' }, { engine: 'gemini', model: 'gemini-3.5-flash-lite', label: 'Gemini flash-lite' }, { engine: 'gemini', model: 'gemini-3.5-flash', label: 'Gemini flash' }];
  if ((S.agent && S.agent.readyBy && S.agent.readyBy.groq)) engines.push({ engine: 'groq', label: 'Groq Whisper' });
  if (S.set.voice.clovaId) engines.push({ engine: 'clova', label: '네이버 CLOVA' });
  const st = await hn.voiceLocalStatus(); if (st.ready) engines.push({ engine: 'local', label: '내 PC Whisper' });
  const rows = await hn.voiceCompare(all, engines);
  voiceMsg(`${(n / 32000).toFixed(1)}초 녹음을 ${rows.length}개 엔진에 보냈습니다.`);
  if (box) box.innerHTML = `<table class="keys"><thead><tr><th style="width:24%">엔진</th><th>받아 적은 글</th><th style="width:60px">시간</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td class="kp">${esc(r.label)}</td><td>${r.err ? `<span style="color:var(--red)">${esc(r.err)}</span>` : esc(r.text || '(글 없음)')}</td><td class="kp">${r.ms != null ? (r.ms / 1000).toFixed(1) + '초' : ''}</td><td class="kact">${r.err ? '' : `<button class="btn small" data-act="v-use" data-e="${esc(r.engine)}" data-m="${esc(r.engine === 'gemini' ? r.model || '' : '')}" title="앞으로 이 엔진으로 받아 적습니다">이걸로 쓰기</button>`}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- 비서 ----------
// 말을 걸면 목소리로 답하고, 일정·설정을 바로 처리한다. 답한 뒤 잠깐(6초) 이어서 듣되, 말을 시작하기 전까지는 소리를 보내지 않는다.
const AG = { open: false, state: 'off', log: [], rate: 1, base: 1, auto: true, listening: false, follow: false, player: null, level: 0, pending: null };
let agentBars = null;

function agentPlayer() {
  if (!AG.player) AG.player = new VoiceCore.Player({ ctx: null, onLevel: lv => { AG.level = lv; agentMicPaint(); if (AG.state === 'speaking' && agentBars) agentBars.push(lv); }, onEnd: () => agentAfterTalk() });
  AG.player.rate = AG.rate;
  return AG.player;
}
const AG_STATE = { off: '', connecting: '연결 중…', idle: '말을 걸어 보세요', listening: '듣는 중', thinking: '생각하는 중…', speaking: '말하는 중' };
function agentPanelHTML() {
  return `<div class="ah"><span class="aname" title="한눈에 비서">비서</span><span class="astat" id="aStat"></span><span class="sp"></span>
      <span class="aspeed" title="비서의 말 빠르기. 음높이는 그대로 빨라집니다. “빠르게 말해”, “천천히”, “1.5배속”이라고 말해도 됩니다."><button data-act="a-slow" title="조금 느리게">−</button><b id="aRate" title="지금 말 빠르기"></b><button data-act="a-fast" title="조금 빠르게">＋</button></span>
      <button class="tiny aauto" id="aAuto" data-act="a-auto" title="켜 두면 내가 빠르게 말하거나 ‘급해’라고 하거나 마감이 임박할 때 비서도 알아서 빨라집니다"></button>
      <button class="x" data-act="a-close" title="비서 창을 닫습니다 (Esc)">×</button></div>
    <div class="alog" id="aLog"></div>
    <div class="af"><button class="mic big" id="aMic" title="눌렀다 떼면 말이 끝날 때 알아서 멈추고, 누르고 있으면 손을 뗄 때 끝납니다. 비서가 말하는 중에 누르면 말을 끊습니다.">${MIC_SVG}</button>
      <canvas class="qwave awave" id="aWave" width="240" height="44"></canvas>
      <input id="aText" placeholder="글로 물어보기 — Enter" title="말 대신 글로 물어봅니다. 답은 목소리로 합니다." autocomplete="off"></div>`;
}
function agentOpen(listen) {
  const p = $('#agentPanel');
  if (!AG.open) {
    AG.open = true;
    p.innerHTML = agentPanelHTML();
    p.hidden = false;
    agentBars = Voice.bars($('#aWave'));
    bindAgentMic($('#aMic'));
    agentPaint();
    hn.agentAvail().then(a => { AG.rate = a.rate; AG.base = a.base; AG.auto = a.auto; agentPlayer(); agentPaint(); if (!a.ok) agentNote('비서는 Gemini 키가 있어야 합니다. 설정 › AI 에이전트에서 저장하세요.'); });
    hn.agentWarm();
    Cap.warm(30000).catch(() => { /* 누를 때 다시 알림 */ });
  }
  if (listen) { pressAt = performance.now(); agentListen({ hold: false }); }
}
function agentClose() {
  AG.open = false; AG.follow = false;
  $('#agentPanel').hidden = true;
  if (AG.listening) { Cap.cancel(); AG.listening = false; hn.agentCancel(); }
  if (AG.player) AG.player.stop();
  hn.agentStop();
}
function agentNote(t) { AG.log.push({ who: 'note', text: t }); agentLogPaint(); }
function agentLogPaint() {
  const el = $('#aLog');
  if (!el) return;
  const rows = AG.log.slice(-20);
  el.innerHTML = rows.length ? rows.map(r => r.who === 'note' ? `<div class="al note">${esc(r.text)}</div>` : `<div class="al ${r.who}"><span class="w">${r.who === 'me' ? '나' : '비서'}</span><span class="t">${esc(r.text)}</span></div>`).join('')
    : '<div class="al note">“오늘 뭐 있어?”, “주간 보고 이틀 미뤄 줘”, “쉴 때 알림 꺼 줘”, “빠르게 말해”, “What’s on my plate today?”처럼 말해 보세요.</div>';
  el.scrollTop = el.scrollHeight;
}
function agentMicPaint() {
  const m = $('#aMic');
  if (!m) return;
  const st = AG.listening ? 'listening' : AG.state === 'speaking' ? 'speaking' : (AG.state === 'thinking' || AG.state === 'connecting') ? 'busy' : '';
  m.className = 'mic big ' + st + (AG.follow ? ' follow' : '');
  m.style.setProperty('--lv', (AG.level || 0).toFixed(2));
}
function agentPaint() {
  const s = $('#aStat'), r = $('#aRate'), a = $('#aAuto');
  if (s) s.textContent = AG.follow ? '이어서 듣는 중… 말을 시작하면 보냅니다' : AG.listening ? '듣는 중' : (AG_STATE[AG.state] ?? '');
  if (r) r.textContent = `${AG.rate.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}배`;
  if (a) { a.textContent = AG.auto ? '자동' : '고정'; a.classList.toggle('on', AG.auto); }
  agentMicPaint();
}
function agentSpeechLog(who, text) {
  const last = AG.log[AG.log.length - 1];
  if (last && last.who === who && last.live) last.text = text; else AG.log.push({ who, text, live: true });
  agentLogPaint();
}
// 듣기 시작. follow: 답한 뒤 이어서 듣기(말을 시작해야 보낸다)
async function agentListen({ hold = false, follow = false } = {}) {
  if (VS) return;
  if (AG.listening) { if (Cap.active) { if (AG.follow) { Cap.cancel(); AG.listening = false; AG.follow = false; agentPaint(); } else Cap.stop('user'); } return; }
  if (AG.player) AG.player.stop();
  Voice.hush();
  AG.listening = true; AG.hold = hold; AG.follow = follow;
  const last = AG.log[AG.log.length - 1]; if (last) last.live = false;
  agentPaint();
  let sent = !follow;
  const held = [];
  if (sent) hn.agentBegin();
  Cap.touch();
  try { await Cap.openMic(); }
  catch (e) { AG.listening = false; AG.follow = false; if (sent) hn.agentCancel(); agentNote(micErrText(e)); agentPaint(); return; }
  if (!AG.listening) return;
  if (!follow) startTone();
  const v = S.set.voice;
  Cap.begin({
    onChunk: b => { if (sent) hn.agentChunk(b); else { held.push(b.slice(0)); if (held.length > 8) held.shift(); } },
    onLevel: lv => { AG.level = lv; agentMicPaint(); if (agentBars) agentBars.push(lv); },
    onSpeech: () => { if (!sent) { sent = true; AG.follow = false; hn.agentBegin(); for (const b of held) hn.agentChunk(b); agentPaint(); } },
    onEnd: why => {
      AG.listening = false; AG.follow = false; AG.level = 0;
      if (!sent) { agentPaint(); return; } // 이어 듣는 동안 아무 말 없음
      if (why === 'nospeech') { hn.agentCancel(); agentNote('아무 말도 들리지 않았습니다.'); agentPaint(); return; }
      hn.agentEnd(); agentPaint();
    },
  }, { auto: follow || !hold, silenceMs: Math.min(v.silenceMs, 1200), maxSec: 60, noSpeechMs: follow ? 6000 : 7000 });
  if (follow) Cap.det && (Cap.det.noSpeechMs = 6000);
}
function agentRelease(atMs) {
  if (!AG.listening || !AG.hold) return;
  const held = (atMs === undefined ? performance.now() : atMs) - pressAt;
  AG.hold = false;
  if (held < HOLD_MS) { if (Cap.active) Cap.setAuto(true, { silenceMs: Math.min(S.set.voice.silenceMs, 1200), maxMs: 60000 }); agentPaint(); }
  else if (Cap.active) Cap.stop('user');
}
function bindAgentMic(el) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); pressAt = e.timeStamp; try { el.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } agentListen({ hold: true }); });
  el.addEventListener('pointerup', e => agentRelease(e.timeStamp));
  el.addEventListener('pointercancel', e => agentRelease(e.timeStamp));
  el.addEventListener('mouseenter', () => { hn.agentWarm(); Cap.warm(30000).catch(() => { /* 누를 때 다시 */ }); });
}
// 비서가 말을 마쳤을 때: 설정이 켜져 있으면 잠깐 이어서 듣는다
function agentAfterTalk() {
  AG.level = 0; agentMicPaint();
  if (AG.turnEnded && AG.open && S.set.voice.agentFollow && !AG.listening && !VS) { AG.turnEnded = false; agentListen({ follow: true }); }
}
function onAgentEvt(ev) {
  if (ev.owner === 'phone') return; // 폰과 나누는 대화는 폰에서 보여 준다
  switch (ev.type) {
    case 'state': AG.state = ev.state; if (ev.state === 'speaking') agentPlayer(); agentPaint(); break;
    case 'heard': agentSpeechLog('me', ev.text); break;
    case 'say': agentSpeechLog('ai', ev.text); break;
    case 'rate': AG.rate = ev.rate; AG.base = ev.base; AG.auto = ev.auto; if (AG.player) AG.player.rate = ev.rate; agentPaint(); break;
    case 'interrupted': if (AG.player) AG.player.stop(); break;
    case 'error': agentNote(ev.msg); if (!AG.open) toast(ev.msg, 'error'); break;
    case 'turn-end': { const last = AG.log[AG.log.length - 1]; if (last) last.live = false; AG.turnEnded = true; if (AG.player) AG.player.finish(); else agentAfterTalk(); break; }
    case 'tool': { const s = $('#aStat'); if (s) s.textContent = AG_TOOL[ev.name] || '처리하는 중…'; break; }
  }
}
const AG_TOOL = { get_schedule: '일정 보는 중…', add_item: '넣는 중…', change_item: '바꾸는 중…', complete_item: '체크하는 중…', delete_item: '확인하는 중…', undo: '되돌리는 중…', get_settings: '설정 보는 중…', set_setting: '설정 바꾸는 중…', remember: '기억하는 중…', show_on_screen: '화면 바꾸는 중…' };
function onAgentScreen(c) {
  if (c.view) { closeModal2(); closeModal(); setView(c.view, false); }
  if (c.item) { S.f = { area: null, group: null, sp: null }; select(c.item); }
  if (c.settings) openSettings();
}
// 쉴 때 화면을 비서 목소리로
function agentBrief() {
  agentPlayer();
  AG.turnEnded = false;
  hn.agentText('지금 사용자가 잠깐 쉬고 있습니다. get_schedule로 확인해 지금 챙길 일을 급한 순으로 세 가지만, 인사 없이 아주 짧게 알려 주세요.');
}
function agentVoiceSectionHTML() {
  const v = S.set.voice || {};
  const VOICES = [['Kore', '단단한 목소리'], ['Aoede', '산뜻한 목소리'], ['Leda', '젊은 목소리'], ['Zephyr', '밝은 목소리'], ['Puck', '경쾌한 목소리'], ['Charon', '차분한 목소리'], ['Fenrir', '힘 있는 목소리'], ['Orus', '굵은 목소리']];
  const mem = v.agentMemory || [];
  return `<div class="fs" id="agentvoicesec"><h3>비서 <span class="exp" style="margin:0;font-weight:400">아래 ‘비서’ 단추 · Ctrl+Alt+B · Alt+B</span></h3>
    <p class="exp">일정을 말로 알려 주고, 말로 넣고 바꾸고 설정도 고칩니다. 한국어로 말하면 한국어로, 영어로 말하면 영어로 답합니다. 일 이름·마감과 말한 소리가 Gemini로 갑니다.</p>
    <div class="fr"><label>목소리</label><select data-k="voice.agentVoice" title="비서 목소리. 바꾸면 다음 말부터 적용됩니다.">${VOICES.map(([k, n]) => `<option value="${k}" ${(v.agentVoice || 'Kore') === k ? 'selected' : ''}>${k} — ${n}</option>`).join('')}</select>
      <button class="btn small" data-act="a-try" title="지금 고른 목소리와 빠르기로 한 문장 들어 봅니다">들어 보기</button></div>
    <div class="fr"><label>기본 빠르기</label><input type="range" min="0.8" max="2" step="0.05" data-k="voice.agentRate" value="${v.agentRate || 1}" style="width:160px" title="비서의 기본 말 빠르기(배속). 음높이는 그대로입니다."><span class="live" id="aRateLabel">${(v.agentRate || 1).toFixed(2)}배</span></div>
    <div class="fr"><label>상황 따라 자동</label>${sw('voice.agentAuto', v.agentAuto !== false)} <span class="exp" style="margin:0">내가 빠르게 말하거나 ‘급해’라고 하거나 1시간 안에 마감이 있으면 비서도 빨라짐</span></div>
    <div class="fr"><label>답한 뒤 이어서 듣기</label>${sw('voice.agentFollow', v.agentFollow !== false)} <span class="exp" style="margin:0">답한 뒤 6초 동안 마이크를 켜 둠. 말을 시작해야 소리를 보냄</span></div>
    <div class="fr" style="margin-bottom:4px"><label>기억한 것 ${mem.length}개</label><span class="exp" style="margin:0">“기억해 둬”라고 한 것. 다음 대화에도 씁니다.</span></div>
    ${mem.length ? `<table class="keys"><tbody>${mem.map((m, i) => `<tr><td>${esc(m)}</td><td class="kact"><button class="btn small red" data-act="a-forget" data-i="${i}" title="이것을 잊게 합니다">잊기</button></td></tr>`).join('')}</tbody></table>` : ''}</div>`;
}

// ---------- 설정: 음성 ----------
function voiceDictRows() {
  const d = S.set.voice.dict || [];
  return d.map((x, i) => `<tr><td><input class="kname" data-vd="say" data-i="${i}" value="${esc(x.say)}" placeholder="이렇게 들리면" title="받아 적을 때 이렇게 나오는 말(띄어쓰기는 상관없음)"></td><td><input class="kname" data-vd="write" data-i="${i}" value="${esc(x.write)}" placeholder="이렇게 적기" title="대신 적을 글"></td><td class="kact"><button class="btn small red" data-act="vd-del" data-i="${i}" title="이 줄을 지웁니다">지우기</button></td></tr>`).join('');
}
function voiceLearnedRows() {
  const l = S.set.voice.learned || [];
  return l.slice(0, 30).map(x => `<tr><td class="kp">${esc(x.heard)}</td><td>${esc(x.fixed)}</td><td class="kp" title="두 번째 고칠 때부터 자동으로 바꿉니다">${x.n >= 2 ? '자동으로 고침' : '한 번 고침'} (${x.n}번)</td><td class="kact"><button class="btn small red" data-act="vl-del" data-h="${esc(x.heard)}" data-f="${esc(x.fixed)}" title="이 말을 잊습니다">잊기</button></td></tr>`).join('');
}
function voiceSectionHTML() {
  const v = S.set.voice || {};
  const info = S.voice || {};
  const vs = Voice.voices();
  const engines = [['auto', `알아서 (지금: ${info.label || '없음'})`], ['live', 'Gemini 실시간 — 말하는 동안 글자가 뜸, 가장 빠름'], ['gemini', 'Gemini 일반 — 끝난 뒤 한 번에'], ['groq', 'Groq Whisper (저장된 키)'], ['clova', '네이버 CLOVA (유료 키)'], ['local', '내 PC Whisper — 소리가 밖으로 안 나감'], ['custom', '직접 입력 주소 (/audio/transcriptions)'], ['none', '사용 안 함 (Win+H 윈도우 받아쓰기만)']];
  return `<div class="fs" id="voicesec"><h3>음성 <span class="pill ${info.ready ? 'ok' : ''}" title="지금 받아쓰기에 쓰는 엔진">${info.ready ? esc(info.label) : '받아쓰기 없음'}</span></h3>
    <p class="exp">마이크를 <b>눌렀다 떼면</b> 말이 끝날 때 알아서 멈추고, <b>누르고 있으면</b> 손을 뗄 때 끝납니다. 어디서나 <b>Ctrl+Alt+V</b>, 이 창에서는 <b>Alt+V</b>, 취소는 <b>Esc</b>. 받아 적은 글은 ‘글로 바꾸기’와 같은 규칙으로 알아듣습니다.</p>
    <div class="fr"><label>받아쓰기</label><select data-k="voice.engine" title="어떤 엔진으로 받아 적을지 고릅니다. 바꾸면 바로 적용됩니다.">${engines.map(([k, n]) => `<option value="${k}" ${(v.engine || 'auto') === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <button class="mic" id="vMic" title="눌러서 시험합니다. 받아 적은 글과 걸린 시간을 오른쪽에 보여 줍니다.">${MIC_SVG}</button><span class="exp" id="voiceMsg" style="margin:0">${info.ready ? '마이크를 누르고 말해 보세요.' : esc(info.why || '')}</span></div>
    ${(v.engine === 'clova') ? `<div class="fr"><label>CLOVA 키</label><input type="text" data-k="voice.clovaId" value="${esc(v.clovaId || '')}" placeholder="Client ID" style="width:170px" title="네이버 클라우드 콘솔의 Client ID"><input type="password" data-k="voice.clovaSecret" value="${esc(v.clovaSecret || '')}" placeholder="Client Secret" style="width:170px" title="네이버 클라우드 콘솔의 Client Secret"><input type="text" data-k="voice.clovaUrl" value="${esc(v.clovaUrl || '')}" placeholder="주소(비우면 기본)" style="width:170px" title="콘솔에 나온 호출 주소. 비우면 기본 주소를 씁니다."><span class="exp" style="margin:0">(유료, 아직 실제 시험 못 함)</span></div>` : ''}
    <div class="fr"><label>내 PC Whisper</label><span class="exp" id="vLocal" style="margin:0">확인 중…</span><button class="btn small" data-act="v-local" id="vLocalBtn" title="whisper.cpp 실행 파일과 받아쓰기 모델(약 490MB)을 내려받습니다. 소리가 밖으로 나가지 않지만 실시간 표시는 없습니다.">내려받기</button></div>
    <div class="fr"><label>정확도</label><select data-k="voice.quality" title="한 번 더 확인을 고르면 다른 모델로도 받아 적어, 다르게 들었을 때만 후보를 보여 줍니다."><option value="fast" ${v.quality !== 'check' ? 'selected' : ''}>빠르게 — 실시간 결과만</option><option value="check" ${v.quality === 'check' ? 'selected' : ''}>한 번 더 확인 — 다르면 ‘혹시:’ 후보 표시</option></select>
      <button class="mic small" id="vCmpMic" title="한 문장을 말하면 여러 엔진으로 받아 적어 나란히 보여 줍니다. 내 목소리에 어느 엔진이 맞는지 고를 수 있습니다.">${MIC_SVG}</button><span class="exp" style="margin:0">← 내 목소리로 엔진 비교</span></div>
    <div id="vCmp"></div>
    <div class="fr"><label>마이크 소리</label><select data-k="voice.micMode" title="받아쓰기에는 소리를 덜 건드릴수록 좋습니다. 시끄러운 곳이면 소음 제거를 켜 보세요."><option value="std" ${(v.micMode || 'std') === 'std' ? 'selected' : ''}>보통 — 소음 제거 끔 (받아쓰기에 좋음)</option><option value="noisy" ${v.micMode === 'noisy' ? 'selected' : ''}>시끄러운 곳 — 소음 제거 켬</option><option value="raw" ${v.micMode === 'raw' ? 'selected' : ''}>원음 — 처리 모두 끔</option></select></div>
    <div class="fr"><label>받아 적은 뒤</label><select data-k="voice.autoSubmit" title="받아 적은 글을 바로 넣을지, 한 번 보고 넣을지 고릅니다."><option value="false" ${!v.autoSubmit ? 'selected' : ''}>칸에 넣고 보여 주기 — Enter로 넣음 (권장)</option><option value="true" ${v.autoSubmit ? 'selected' : ''}>바로 넣기</option></select></div>
    <div class="fr"><label>말 끝 기다림</label><input type="number" min="600" max="4000" step="100" data-k="voice.silenceMs" value="${v.silenceMs || 1500}" title="조용해진 뒤 이만큼 지나면 말이 끝난 것으로 봅니다. 말하다 잘리면 늘리세요."> ms <span class="exp" style="margin:0">최대 <input type="number" min="5" max="120" data-k="voice.maxSec" value="${v.maxSec || 30}" style="width:56px" title="한 번에 들을 수 있는 가장 긴 시간"> 초</span></div>
    <div class="fr"><label>시작 소리</label>${sw('voice.tone', v.tone !== false)} <span class="exp" style="margin:0">듣기 시작할 때 ‘띡’ 작은 소리</span></div>
    <div class="fr"><label>결과 읽어 주기</label>${sw('voice.speak', v.speak)} <span class="exp" style="margin:0">알아들은 것을 소리로 알려 줌</span></div>
    <div class="fr"><label>쉴 때 화면 읽어 주기</label>${sw('voice.readBrief', v.readBrief)} <span class="exp" style="margin:0">쉴 때 알림이 뜨면 급한 것 세 개를 읽음</span></div>
    <div class="fr"><label>목소리</label><select data-k="voice.voiceName" title="읽어 줄 목소리"><option value="">기본 (한국어)</option>${vs.map(x => `<option value="${esc(x.name)}" ${v.voiceName === x.name ? 'selected' : ''}>${esc(x.name.replace(/^Microsoft /, ''))} (${esc(x.lang)})</option>`).join('')}</select>
      빠르기 <input type="range" min="0.7" max="1.6" step="0.05" data-k="voice.rate" value="${v.rate || 1}" style="width:120px" title="읽는 빠르기. 바꾸면 ‘들어 보기’로 바로 확인할 수 있습니다."> <button class="btn small" data-act="voice-say" title="지금 고른 목소리와 빠르기로 읽어 봅니다">들어 보기</button></div>
    <div class="fr"><label>어디서나 Ctrl+Alt+V</label>${sw('voice.hotkey', v.hotkey)} <span class="exp" style="margin:0">(바꾸면 다음에 켤 때부터)</span></div>
    <div class="fr"><label>일 이름 참고</label>${sw('voice.hintTitles', v.hintTitles)} <span class="exp" style="margin:0">내 일 이름을 받아쓰기 서버에 미리 알려 정확도를 높임(끄면 안 보냄)</span></div>
    <div class="fr" style="margin-bottom:4px"><label>발음 사전</label><span class="exp" style="margin:0">이렇게 들리면 이렇게 적습니다. 낱말도 미리 알려 줘서 처음부터 더 잘 듣습니다. 일 이름 속 영어 약어는 따로 넣지 않아도 알아서 합니다<span id="vAcr"></span>.</span></div>
    <table class="keys"><tbody id="vDict">${voiceDictRows()}</tbody></table>
    <div class="fr"><label></label><button class="btn small" data-act="vd-add" title="발음 사전에 한 줄을 넣습니다">＋ 넣기</button>
      <span class="exp" style="margin:0">보기: <a data-act="vd-sample" data-s="케이티엑스|KTX" title="이 보기를 사전에 넣습니다">케이티엑스→KTX</a> · <a data-act="vd-sample" data-s="한눈애|한눈에" title="이 보기를 사전에 넣습니다">한눈애→한눈에</a></span></div>
    <div class="fr" style="margin-bottom:4px"><label>배운 말 ${(v.learned || []).length}개</label><span class="exp" style="margin:0">받아 적은 글을 고쳐서 넣으면 소리가 비슷한 것만 배웁니다(“내일”을 “모레”로 고친 건 안 배움). 두 번째부터 자동으로 고칩니다.</span></div>
    ${(v.learned || []).length ? `<table class="keys"><tbody>${voiceLearnedRows()}</tbody></table>` : ''}
    <div class="note-box">소리는 받아 적은 뒤 버립니다(파일로 남기지 않음, 받아 적은 글만 data\\cache\\voice_log.jsonl에 최근 500줄). 소리는 고른 받아쓰기 서버로 가고, 무료 Gemini는 보낸 내용을 Google이 서비스 개선에 쓸 수 있습니다. 서버 없이 쓰려면 <b>내 PC Whisper</b>나 입력 칸의 <b>Win+H</b>를 쓰세요.${vs.some(x => /^ko/i.test(x.lang)) ? '' : ' ⚠ 이 PC에 한국어 목소리가 없습니다(윈도우 설정 › 시간 및 언어 › 음성에서 한국어 추가).'}</div></div>`;
}
function voiceSectionBind() {
  bindMic($('#vMic'), 'test');
  bindMic($('#vCmpMic'), 'compare');
  hn.voiceLocalStatus().then(paintLocal);
  hn.voiceVocab().then(r => { const a = $('#vAcr'); if (a && r.acronyms.length) a.textContent = ` (지금: ${r.acronyms.slice(0, 8).join(', ')})`; });
}
function paintLocal(st) {
  const el = $('#vLocal'), b = $('#vLocalBtn');
  if (!el) return;
  el.textContent = st.busy ? `내려받는 중: ${st.busy}` : st.ready ? '내려받음. 위 ‘받아쓰기’에서 고를 수 있습니다.' : st.win === false ? '지금은 윈도우에서만 됩니다.' : '소리가 밖으로 안 나가는 받아쓰기(약 500MB).';
  if (b) b.hidden = !!st.ready || !!st.busy || st.win === false;
}
function refreshVoiceSec() {
  const sec = $('#voicesec');
  if (!sec) return;
  sec.outerHTML = voiceSectionHTML();
  voiceSectionBind();
}
async function saveDict(d) { S.set = await hn.setSettings({ voice: { dict: d } }); }

// ---------- 설정: 폰 연결 ----------
function phoneStatusText(st) {
  if (!st || !st.enabled) return ['꺼짐', ''];
  if (st.server !== 'on') return ['서버 연결 중…', ''];
  return st.phones ? [`폰 ${st.phones}대 연결됨`, 'ok'] : ['폰 기다리는 중', ''];
}
function phoneSectionHTML() {
  if (S.app && S.app.edition && S.app.edition.phone === false) return ''; // 무료 공개 판에는 폰 연결이 없다
  const st = S.phone || {};
  const [txt, cls] = phoneStatusText(st);
  return `<div class="fs" id="phonesec"><h3>폰 연결 ${sw('phone.on', !!st.enabled)} <span class="pill ${cls}" id="phonePill" title="지금 연결 상태">${esc(txt)}</span></h3>
    <p class="exp">폰 앱에서 마이크를 누르면 이 PC의 바로 넣기 칸에 말한 대로 바로 들어옵니다. 일정 목록·완료 체크·마감 변경도 폰과 함께 맞춰집니다. 폰과 이 PC가 다른 망(집·회사·LTE)에 있어도 됩니다.</p>
    ${st.enabled ? `<div class="phone-pair"><div class="qr" id="phoneQr" title="폰 앱에서 이 QR을 찍으면 연결됩니다. 이 QR은 비밀 열쇠이니 다른 사람에게 보이지 마세요."></div>
      <ol><li><b>안드로이드</b>: 배포 폴더의 <code>한눈에_v*.apk</code>를 폰에 옮겨 설치 → 앱을 열고 이 QR 찍기</li>
        <li><b>아이폰</b>: 카메라로 이 QR을 찍어 Safari로 열기 → 공유 › 홈 화면에 추가 → 홈 화면의 ‘한눈에’를 열고 앱 안에서 이 QR을 한 번 더 찍기</li>
        <li>QR을 찍을 수 없으면 <button class="btn small" data-act="phone-copy" title="연결 주소를 복사합니다. 이 주소는 비밀 열쇠이니 다른 사람에게 보내지 마세요.">연결 주소 복사</button></li></ol></div>
    <div class="fr"><label>중계 서버</label><input type="text" id="phoneRelay" value="${esc(st.relay || '')}" title="폰과 이 PC 사이에서 암호문만 옮기는 서버 주소. 바꾸면 바로 다시 연결합니다."><button class="btn small" data-act="phone-rotate" title="새 비밀 열쇠를 만듭니다. 지금까지 연결한 폰은 모두 끊기고 QR을 다시 찍어야 합니다.">폰 연결 모두 끊기(새 열쇠)</button></div>
    <div class="note-box">폰과 이 PC는 QR에 든 비밀 열쇠로 암호화해 주고받습니다. 중계 서버는 내용을 볼 수 없고 저장도 하지 않습니다. 폰으로는 일 이름·마감·상태만 보내고 폴더 경로·문서·대화 기록·AI 키는 보내지 않습니다. 폰에서 할 수 있는 일도 일정 넣기·바꾸기·완료 체크뿐입니다.</div>` : ''}</div>`;
}
// ---------- 설정: 새 판 받기 ----------
const UPD_WORD = { idle: '아직 확인 안 함', checking: '확인하는 중…', none: '지금이 최신', available: '새 판 있음', downloading: '받는 중', ready: '설치 준비됨', error: '문제 있음' };
function updateSectionHTML() {
  const u = S.upd || { mode: 'dev' }, v = (S.app && S.app.version) || '';
  const cls = u.status === 'ready' || u.status === 'available' ? 'ok' : u.status === 'error' ? 'red' : '';
  const how = {
    dev: '개발본입니다. 새 판은 버전_선택.bat로 고릅니다. 자동 업데이트는 설치본(윈도우·맥)에서만 돕니다.',
    auto: '윈도우: 새 판을 찾으면 받아 두었다가, 앱을 끝낼 때 또는 [설치하고 다시 켜기]를 누를 때 바꿉니다. 설정·할 일 기록은 그대로입니다.',
    manual: '맥: 새 판을 찾으면 dmg를 다운로드 폴더에 받아 열어 드립니다. 열린 창에서 Hannune을 Applications로 끌어 놓아 바꾸면 됩니다(설정·할 일 기록은 그대로). 유료 개발자 서명이 없어 맥은 저절로 바꿔 끼울 수 없습니다.',
    page: '이 컴퓨터에서는 저절로 바꿀 수 없어 내려받는 곳을 알려 드립니다.',
    off: '이 판은 새 판 받기를 쓰지 않습니다.',
  }[u.mode] || '';
  const ed = S.app && S.app.edition ? S.app.edition : {};
  const when = u.lastCheck ? new Date(u.lastCheck).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const act = u.mode === 'dev' || u.mode === 'off' ? '' : `<div class="fr"><label></label>
      <button class="btn" data-act="upd-check" title="지금 새 판이 있는지 봅니다"${u.status === 'checking' || u.status === 'downloading' ? ' disabled' : ''}>지금 확인</button>
      ${u.status === 'available' ? `<button class="btn on" data-act="upd-download" title="새 판 ${esc(u.latest)}을 받습니다">새 판 ${esc(u.latest)} 받기</button><button class="btn" data-act="upd-skip" title="이 판은 알리지 않습니다. 다음 새 판이 나오면 다시 알립니다">이 판 건너뛰기</button>` : ''}
      ${u.status === 'ready' ? `<button class="btn on" data-act="upd-install" title="${u.mode === 'manual' ? '받은 dmg를 엽니다' : '앱을 끝내고 새 판을 설치한 뒤 다시 켭니다'}">${u.mode === 'manual' ? '받은 새 판 열기' : '설치하고 다시 켜기'}</button>` : ''}
      <button class="btn" data-act="upd-page" title="새 판을 직접 내려받는 곳(GitHub)을 엽니다">내려받는 곳</button></div>`;
  return `<div class="fs" id="updsec"><h3>새 판 받기 <span class="pill ${cls}" id="updPill" title="새 판 상태">${esc(UPD_WORD[u.status] || '')}${u.status === 'downloading' ? ' ' + (u.progress || 0) + '%' : ''}</span></h3>
    <p class="exp">지금 판 <b>v${esc(v)}</b>${ed.name && ed.name !== 'dev' ? ` · ${esc(ed.name === 'free' ? '무료 판' : ed.name === 'paid' ? '유료 판' : ed.name)}` : ''}${u.latest && u.status !== 'none' ? ` · 새 판 <b>v${esc(u.latest)}</b>` : ''}${when ? ` · 마지막 확인 ${esc(when)}` : ''}. ${esc(how)}</p>
    ${u.mode === 'dev' || u.mode === 'off' ? '' : `<div class="fr"><label>자동으로 확인</label>${sw('update.auto', u.auto)} 켤 때와 6시간마다 새 판이 있는지 봅니다</div>
    <div class="fr"><label>찾으면 바로 받기</label>${sw('update.autoDownload', u.autoDownload)} ${u.mode === 'manual' ? '끄면 알림만 하고 받기는 직접 누릅니다' : '받아 두기만 하고, 바꾸는 것은 끝낼 때입니다'}</div>`}
    ${ed.paidUpdates ? `<div class="fr"><label>라이선스 열쇠</label><input type="text" data-k="license.key" value="${esc((S.set.license || {}).key || '')}" placeholder="유료 판 열쇠" style="width:260px"></div>` : ''}
    ${act}
    ${u.error ? `<p class="exp" style="color:var(--red)">${esc(u.error)}</p>` : ''}
    ${u.notes && (u.status === 'available' || u.status === 'ready' || u.status === 'downloading') ? `<details class="updnotes"><summary>새 판에서 바뀐 것</summary><pre>${esc(u.notes)}</pre></details>` : ''}</div>`;
}
function refreshUpdSec() { const sec = $('#updsec'); if (sec) sec.outerHTML = updateSectionHTML(); }
function phoneSectionBind() {
  const st = S.phone || {};
  const q = $('#phoneQr');
  if (q && st.url) { const qr = qrcode(0, 'M'); qr.addData(st.url); qr.make(); q.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
  const r = $('#phoneRelay');
  if (r) r.addEventListener('change', async () => { const x = await hn.phoneRelay(r.value); if (x.ok) { S.phone = x; refreshPhoneSec(); toast('중계 서버를 바꿨습니다.'); } else { toast(x.msg, 'error'); r.value = S.phone.relay; } });
  const sw2 = $('#phonesec [data-k="phone.on"]');
  if (sw2) { sw2.removeAttribute('data-k'); sw2.title = '폰 연결을 켜고 끕니다'; sw2.addEventListener('change', async () => { S.phone = await hn.phoneEnable(sw2.checked); refreshPhoneSec(); }); }
}
function refreshPhoneSec() { const sec = $('#phonesec'); if (sec) { sec.outerHTML = phoneSectionHTML(); phoneSectionBind(); } }
function paintPhone(st) {
  S.phone = { ...(S.phone || {}), ...st };
  const [txt, cls] = phoneStatusText(S.phone);
  const p = $('#phonePill'); if (p) { p.textContent = txt; p.className = 'pill ' + cls; }
  renderMicState();
  renderStatus();
}

// ---------- 오른쪽 클릭: 변경 창 / 그래프 설정 ----------
document.addEventListener('contextmenu', e => {
  if (e.target.closest('.spark, .heat')) { e.preventDefault(); openGraphPop(e.clientX, e.clientY); return; }
  const host = e.target.closest('[data-id]');
  if (host && (host.closest('#main') || host.closest('.card'))) { e.preventDefault(); openEdit(host.dataset.id); }
});

// ---------- 변경 창 ----------
let E = null; // { id, it, dl(고른 마감), cur, draft }
function curOf(it, dl) {
  return { title: it.title, area: it.area, group: it.group, imp: it.importance || 0, done: isChecked(it), hidden: !!it.hidden,
    date: dl ? dl.date : '', time: dl ? dl.time : '', label: dl ? dl.label : '', kind: dl ? dl.kind : 'deadline' };
}
function openEdit(id, dlDate) {
  const it = byId(id);
  if (!it) return;
  closePop();
  const dls = it.deadlines.filter(d => !d.done);
  const dl = dlDate ? it.deadlines.find(d => d.date === dlDate) : (focusDl(it) || dls[0] || null);
  E = { id, it, dl, cur: curOf(it, dl) };
  E.draft = { ...E.cur };
  renderEdit();
  setTimeout(() => { const t = $('#nlIn'); if (t) t.focus(); }, 40);
}
function renderEdit() {
  const { it, dl, draft } = E;
  const opts = it.deadlines.map(d => `<option value="${d.date}" ${dl && d.date === dl.date ? 'selected' : ''}>${NLP.fmtDate(d.date)} ${esc(d.label)} (${srcName(d)})${d.done ? ' · 끝냄' : ''}</option>`).join('') + `<option value="" ${!dl ? 'selected' : ''}>＋ 새 마감</option>`;
  const areas = S.board.areas.map(a => `<option ${a.id === draft.area ? 'selected' : ''}>${esc(a.id)}</option>`).join('');
  const stars = [1, 2, 3, 4, 5].map(i => `<b class="${i <= draft.imp ? 'on' : ''}" data-act="e-imp" data-v="${i}">${i <= draft.imp ? '★' : '☆'}</b>`).join('');
  const agentOk = S.agent && S.agent.ready;
  $('#modal').innerHTML = `<div class="sheet edit"><div class="sh"><h2>변경 · ${esc(it.title)}</h2><button class="x" data-act="mclose">×</button></div>
    <div class="eg">
      <label>일 이름</label><input type="text" data-e="title" value="${esc(draft.title)}">
      <label>어느 마감</label><select data-act="e-pick">${opts}</select>
      <label>날짜</label><div class="row2"><input type="date" data-e="date" value="${esc(draft.date)}">
        <button class="qb" data-act="e-date" data-v="0">오늘</button><button class="qb" data-act="e-date" data-v="1">내일</button><button class="qb" data-act="e-date" data-v="2">모레</button>
        <button class="qb" data-act="e-shift" data-v="1">+1일</button><button class="qb" data-act="e-shift" data-v="7">+1주</button><button class="qb" data-act="e-shift" data-v="-1">−1일</button>
        <button class="qb" data-act="e-nextmon">다음주 월</button>${dl ? '<button class="qb" data-act="e-remove">이 마감 지우기</button>' : ''}</div>
      <label>시각</label><div class="row2"><input type="time" data-e="time" value="${esc(draft.time)}">
        ${['09:00', '12:00', '14:00', '15:00', '18:00'].map(t => `<button class="qb" data-act="e-time" data-v="${t}">${t}</button>`).join('')}</div>
      <label>마감 이름</label><div class="row2"><input type="text" data-e="label" value="${esc(draft.label)}" placeholder="제출, 회의, 발표 …" style="width:200px">
        <select data-e="kind"><option value="deadline" ${draft.kind !== 'event' ? 'selected' : ''}>마감(제출·회신)</option><option value="event" ${draft.kind === 'event' ? 'selected' : ''}>일정(발표·회의)</option></select></div>
      <label>중요도</label><div class="row2"><span class="stars">${stars}</span><button class="qb" data-act="e-imp" data-v="0">별 지우기</button></div>
      <label>영역·주제</label><div class="row2"><select data-e="area">${areas}</select><input type="text" data-e="group" value="${esc(draft.group)}" style="width:180px"></div>
      <label>상태</label><div class="row2"><label><input type="checkbox" data-e="done" ${draft.done ? 'checked' : ''}> 완료</label> <label><input type="checkbox" data-e="hidden" ${draft.hidden ? 'checked' : ''}> 목록에서 숨김</label></div>
    </div>
    <div class="nl"><textarea id="nlIn" placeholder="글로 바꾸기 — 예: 이틀 미뤄 줘 · 다음주 금요일 오후 3시로 · 별 넷 · 조금 중요 · 1105로 변경 · 완료    (Enter: 확인 후 적용 · Shift+Enter: 줄바꿈 · Alt+V: 말로)"></textarea>
      <button type="button" class="mic" id="eMic" title="말로 바꾸기 — 누르고 “이틀 미뤄 줘”처럼 말하면 확인 창이 뜹니다 (Alt+V)">${MIC_SVG}</button>
      <div class="nlp" id="nlPrev">${agentOk ? '' : 'AI 없이도 알아듣습니다. 더 복잡한 말은 설정 › AI 에이전트를 연결하면 AI로도 해석합니다.'}</div></div>
    <div class="foot"><button class="btn on" data-act="e-save">저장</button><button class="btn" data-act="e-nl">글로 바꾸기</button>${window.CircleAPI ? '<button class="btn" data-act="e-aide" title="이 일의 폴더에 있는 MD로 서클 비서를 만듭니다. 서클 사람이 이 일에 대해 묻고 의견을 남길 수 있습니다">서클 비서</button>' : ''}
      ${agentOk ? '<button class="btn" data-act="e-ai" title="AI 에이전트로 해석">AI로 해석</button>' : ''}<button class="btn" data-act="mclose">닫기</button>
      <span class="sp"></span><button class="tiny" data-act="words" title="내가 쓰는 낱말을 기능에 연결">변경 기능 설정</button></div>
  </div>`;
  $('#modal').hidden = false;
  S.modal = 'edit';
  bindMic($('#eMic'), 'edit');
}
function nlResult(text) {
  return NLP.parse(text, { mode: 'edit', baseDate: E.draft.date || E.cur.date || undefined, custom: S.set.nlp.custom, learn: S.set.nlp.learn });
}
function nlPreview() {
  const t = $('#nlIn').value.trim();
  const box = $('#nlPrev');
  if (!t) { box.innerHTML = ''; return; }
  const r = nlResult(t);
  const { changes } = NLP.apply(r, E.draft, { dueTime: S.set.dueTime });
  box.innerHTML = changes.length
    ? '알아들은 것: ' + changes.map(c => `<span class="ch">${KEY_NAMES[c.key] || c.key} → ${esc(fmtVal(c.key, c.to))}</span>`).join('') + (r.notes.length ? ` <span>(${esc(r.notes.join(', '))})</span>` : '')
    : '아직 알아들은 것이 없습니다' + (S.agent && S.agent.ready ? ' — ‘AI로 해석’을 눌러 보세요.' : '.');
}
// 확인 창: 바뀌는 것을 보여 주고 고른 것만 적용
function confirmChanges(changes, notes, title) {
  if (!changes.length) {
    $('#modal2').innerHTML = `<div class="sheet narrow confirm"><div class="sh"><h2>알아듣지 못했습니다</h2><button class="x" data-act="m2close">×</button></div>
      <div class="note">예: “내일로”, “이틀 미뤄”, “오후 3시”, “별 셋”, “완료”, “학교로 옮겨”, “제목을 주간보고로 바꿔”${S.agent && S.agent.ready ? '<br>AI 에이전트가 연결돼 있으니 ‘AI로 해석’도 해 볼 수 있습니다.' : ''}</div>
      <div class="foot" style="padding:14px 22px 0">${S.agent && S.agent.ready ? '<button class="btn on" data-act="e-ai">AI로 해석</button>' : ''}<button class="btn" data-act="m2close">닫기</button></div></div>`;
    $('#modal2').hidden = false;
    return;
  }
  $('#modal2').innerHTML = `<div class="sheet narrow confirm"><div class="sh"><h2>${esc(title || '이렇게 바꿀까요?')}</h2><button class="x" data-act="m2close">×</button></div>
    <ul class="cl">${changes.map((c, i) => `<li><input type="checkbox" data-ci="${i}" checked><span class="k">${KEY_NAMES[c.key] || c.key}</span>
      <span class="from">${esc(fmtVal(c.key, c.from))}</span> → <span class="to">${esc(fmtVal(c.key, c.to))}</span><span class="why">${esc(c.why || '')}</span></li>`).join('')}</ul>
    ${notes && notes.length ? `<div class="note">${esc(notes.join(' · '))}</div>` : ''}
    <div class="foot" style="padding:14px 22px 0"><button class="btn on" data-act="c-apply">적용</button><button class="btn" data-act="m2close">취소</button></div></div>`;
  $('#modal2').hidden = false;
  E.pending = changes;
}
async function saveEdit(next) {
  const { it, dl, cur } = E;
  const ch = {};
  for (const k of ['title', 'area', 'group', 'imp', 'hidden']) if (next[k] !== cur[k]) ch[k] = next[k];
  if (next.done !== cur.done) Object.assign(ch, { done: next.done, doneBand: it.band, wasAiDone: it.aiDone || it.status === '완료' });
  const dlChanged = ['date', 'time', 'label', 'kind'].some(k => next[k] !== cur[k]) || next.removeDl || next.addNew;
  if (dlChanged && (next.date || next.removeDl)) {
    ch.dl = { from: dl ? dl.date : null, src: dl ? dl.src : null, key: dl && dl.doc ? dl.doc.key : null, date: next.date, time: next.time || '', label: next.label || (next.kind === 'event' ? '일정' : '마감'), kind: next.kind, remove: !!next.removeDl, addNew: !!next.addNew || !dl };
  }
  if (!Object.keys(ch).length) { toast('바뀐 것이 없습니다.'); return false; }
  await hn.applyChanges(it.id, ch);
  toast('바꿨습니다.');
  return true;
}
function draftFromFields() {
  const d = { ...E.draft };
  for (const el of $$('#modal [data-e]')) {
    const k = el.dataset.e;
    d[k] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return d;
}
async function runNL(useAI) {
  const text = ($('#nlIn') || {}).value || E.lastText || '';
  if (!text.trim()) { toast('아래 칸에 바꿀 내용을 글로 써 주세요.'); return; }
  E.lastText = text;
  E.draft = draftFromFields();
  if (useAI) {
    toast('AI가 해석하는 중…');
    const r = await hn.nlAI(text, E.draft);
    if (!r.ok) { toast(r.msg, 'error'); return; }
    const { changes } = NLP.apply({ actions: r.actions }, E.draft, { dueTime: S.set.dueTime });
    confirmChanges(changes, r.note ? [r.note] : [], 'AI가 알아들은 대로 바꿀까요?');
    return;
  }
  const r = nlResult(text);
  const { changes } = NLP.apply(r, E.draft, { dueTime: S.set.dueTime });
  const notes = r.notes.length ? [`오타·비슷한 말: ${r.notes.join(', ')}`] : [];
  if (r.fixed && r.fixed !== text) notes.push(`고쳐 읽음: “${r.fixed}”`);
  confirmChanges(changes, notes);
}

// ---------- 내 낱말 관리(변경 기능 설정) ----------
const WORD_ACTIONS = [
  ['date', '날짜로 (값: 다음주 금요일 · 2026-12-31 같은 말)'], ['weekday', '요일로 (값: 월~일)'], ['time', '시각으로 (값: 18:00)'],
  ['later', '며칠 미루기 (값: 일수)'], ['earlier', '며칠 당기기 (값: 일수)'], ['imp', '중요도 (값: 0~5)'],
  ['done', '완료'], ['undone', '완료 취소'], ['hide', '숨기기'], ['remove', '마감 지우기'], ['area', '영역 (값: 업무 등)'],
  ['kind', '종류 (값: event 또는 deadline)'], ['ignore', '무시할 말(제목에서만 뺌)'],
];
let W = null;
function openWords() {
  W = (S.set.nlp.custom || []).map(x => ({ ...x }));
  renderWords();
}
function renderWords() {
  const rows = W.map((w, i) => `<tr><td><input data-w="word" data-i="${i}" value="${esc(w.word || '')}" placeholder="예: 칼퇴"></td>
    <td><select data-w="action" data-i="${i}">${WORD_ACTIONS.map(([k, n]) => `<option value="${k}" ${w.action === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></td>
    <td><input data-w="value" data-i="${i}" value="${esc(w.value ?? '')}" placeholder="값"></td>
    <td><button class="btn small red" data-act="w-del" data-i="${i}">빼기</button></td></tr>`).join('');
  $('#modal2').innerHTML = `<div class="sheet words"><div class="sh"><h2>변경 기능 설정 · 내 낱말</h2><button class="x" data-act="m2close">×</button></div>
    <p class="exp" style="margin:10px 22px 0">글로 바꿀 때 이 낱말이 보이면 고른 기능을 합니다. 띄어쓰기는 상관없습니다. 기본으로 알아듣는 말(내일, 이틀 미뤄, 오후 3시, 별 셋, 중요, 완료 …)은 따로 넣지 않아도 됩니다.</p>
    <table><thead><tr><th style="width:24%">낱말</th><th>기능</th><th style="width:22%">값</th><th style="width:60px"></th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="color:var(--ink-3)">아직 없습니다.</td></tr>'}</tbody></table>
    <div class="fr" style="margin:0 22px 10px"><button class="btn" data-act="w-add">＋ 낱말 넣기</button>
      <span class="exp" style="margin:0">보기: <a data-act="w-sample" data-s="칼퇴|time|18:00">칼퇴=18:00</a> · <a data-act="w-sample" data-s="땡겨|earlier|1">땡겨=하루 당김</a> · <a data-act="w-sample" data-s="불금|weekday|금">불금=금요일</a> · <a data-act="w-sample" data-s="급해|imp|5">급해=★5</a> · <a data-act="w-sample" data-s="월급날|date|25일">월급날=25일</a></span></div>
    <div class="try"><span>시험:</span><input id="wTry" placeholder="예: 칼퇴 전까지 불금으로"><span id="wTryOut" class="exp" style="margin:0"></span></div>
    <div class="foot" style="padding:14px 22px 0"><button class="btn on" data-act="w-save">저장</button><button class="btn" data-act="m2close">닫기</button></div></div>`;
  $('#modal2').hidden = false;
}
function wordsTry() {
  const v = ($('#wTry') || {}).value || '';
  const out = $('#wTryOut');
  if (!out) return;
  if (!v.trim()) { out.textContent = ''; return; }
  const r = NLP.parse(v, { mode: 'edit', custom: W.filter(w => w.word) });
  out.textContent = r.actions.length ? r.actions.map(a => `${KEY_NAMES[a.type] || a.type}: ${a.type === 'date' ? NLP.fmtDate(a.value) : a.value}`).join(' · ') : '알아들은 것 없음';
}

// ---------- 그래프 설정 ----------
function openGraphPop(x, y) {
  const g = S.set.graph;
  const pop = $('#pop');
  pop.innerHTML = `<h4>그래프 설정</h4>
    <div class="fr"><label>기간</label><div class="seg">${[7, 14, 30, 60].map(d => `<button class="${g.days === d ? 'on' : ''}" data-act="g-set" data-k="days" data-v="${d}">${d}일</button>`).join('')}</div></div>
    <div class="fr"><label>높이</label><input type="range" min="12" max="48" value="${g.height}" data-g="height"> <span class="num">${g.height}px</span></div>
    <div class="fr"><label>막대 굵기</label><input type="range" min="2" max="10" value="${g.bar}" data-g="bar"> <span class="num">${g.bar}px</span></div>
    <div class="fr"><label>색</label><div class="seg"><button class="${g.color !== 'one' ? 'on' : ''}" data-act="g-set" data-k="color" data-v="area">영역 색</button><button class="${g.color === 'one' ? 'on' : ''}" data-act="g-set" data-k="color" data-v="one">한 가지 색</button></div>
      <input type="color" value="${esc(g.custom)}" data-g="custom" title="한 가지 색" style="width:34px;height:24px;border:0;background:transparent"></div>
    <div class="fr"><button class="btn small" data-act="g-reset">기본값</button><button class="btn small" data-act="g-close">닫기</button></div>`;
  pop.hidden = false;
  const w = 300, h = 210;
  pop.style.left = Math.min(x, window.innerWidth - w - 10) + 'px';
  pop.style.top = Math.min(y, window.innerHeight - h - 10) + 'px';
}
async function setGraph(patch) {
  S.set = await hn.setSettings({ graph: patch });
  applyLayout();
  renderMain(); renderDetail();
  const pop = $('#pop');
  if (!pop.hidden) { const r = pop.getBoundingClientRect(); openGraphPop(r.left, r.top); }
}

// ---------- AI 에이전트 설정 ----------
// 쓸 곳(Gemini·Groq …)마다 키·모델·주소를 따로 두고, 키는 '저장된 키'에 이름을 붙여 모아 두었다가 고른다
const maskKey = k => { const s = String(k || ''); return s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : '••••'; };
const AGENT_SHOW = new Set(); // '보기'를 누른 키
function agentSectionHTML() {
  const a = S.set.agent || {};
  const info = S.agent || { presets: {}, kinds: {}, claude: false };
  const P = info.presets || {};
  const prov = a.provider || 'auto';
  const p = P[prov];
  const prof = (a.profiles || {})[prov] || {};
  const keys = a.keys || [];
  const mine = keys.filter(k => k.provider === prov);
  const cur = mine.find(k => k.id === prof.keyId) || mine[0];
  const provLabel = k => (P[k] ? P[k].name.replace(/\s*\(.*\)$/, '') : (info.kinds || {})[k] || k);
  const opt = (v, n) => `<option value="${v}" ${prov === v ? 'selected' : ''}>${esc(n)}</option>`;
  const wantKey = p && (p.needKey || prov === 'custom');
  const newRow = `<div class="fr"><label>${mine.length ? '새 키' : 'API 키'}</label><input type="password" id="agentNewKey" placeholder="붙여넣기 (이 PC에만 저장)" autocomplete="off">
      <input type="text" id="agentNewName" placeholder="이름 (선택, 예: 개인 계정)" style="width:170px"><button class="btn" data-act="agent-key-add">저장</button></div>`;
  const rows = keys.map(k => {
    const use = cur && k.id === cur.id;
    return `<tr class="${use ? 'use' : ''}"><td><input class="kname" data-act="agent-key-name" data-id="${esc(k.id)}" value="${esc(k.name)}" title="눌러서 이름 바꾸기"></td>
      <td class="kp">${esc(provLabel(k.provider))}${use ? ' · <b style="color:var(--blue)">쓰는 중</b>' : ''}</td>
      <td><code>${esc(AGENT_SHOW.has(k.id) ? k.key : maskKey(k.key))}</code></td>
      <td class="kact"><button class="btn small" data-act="agent-key-show" data-id="${esc(k.id)}">${AGENT_SHOW.has(k.id) ? '가리기' : '보기'}</button>
        <button class="btn small" data-act="agent-key-copy" data-id="${esc(k.id)}">복사</button>
        ${P[k.provider] && !use ? `<button class="btn small" data-act="agent-key-use" data-id="${esc(k.id)}">이걸로 쓰기</button>` : ''}
        <button class="btn small red" data-act="agent-key-del" data-id="${esc(k.id)}">지우기</button></td></tr>`;
  }).join('');
  return `<div class="fs" id="agentsec"><h3>AI 에이전트 <span class="pill ${info.ready ? 'ok' : ''}">${info.ready ? '쓸 수 있음' : '없음'}</span></h3>
    <p class="exp">‘AI로 해석’에 쓰고, 아래 ‘AI 정리’에서 따로 고르지 않으면 AI 정리·찾은 일정 다듬기에도 씁니다. 없어도 프로그램은 다 돌아갑니다(글로 바꾸기는 규칙으로 알아들음). 무료로 오래 쓰려면 <b>Gemini 무료 키</b>나 <b>내 PC의 Ollama</b>를 권합니다.</p>
    <div class="fr"><label>쓸 곳</label><select data-k="agent.provider">
      ${opt('auto', `자동 (${info.claude ? 'Claude Code 있음' : 'Claude Code 없음 → 사용 안 함'})`)}${opt('claude', 'Claude Code (이 PC, 구독)')}
      ${Object.entries(P).map(([k, v]) => opt(k, v.name)).join('')}${opt('none', '사용 안 함')}</select>
      ${p && p.keyUrl ? `<button class="btn small" data-act="url" data-u="${esc(p.keyUrl)}">${p.needKey ? '무료 키 받으러 가기' : '내려받기'}</button>` : ''}</div>
    ${p ? `<div class="note-box">${esc(p.help)}</div>` : ''}
    ${wantKey && mine.length ? `<div class="fr"><label>API 키</label><select data-act="agent-pick">${mine.map(k => `<option value="${esc(k.id)}" ${cur && cur.id === k.id && !S.agentNew ? 'selected' : ''}>${esc(k.name)} · ${esc(maskKey(k.key))}</option>`).join('')}<option value="__new" ${S.agentNew ? 'selected' : ''}>＋ 새 키 넣기…</option></select></div>` : ''}
    ${wantKey && (!mine.length || S.agentNew) ? newRow : ''}
    ${p ? `<div class="fr"><label>모델</label><input type="text" data-k="agent.profiles.${prov}.model" value="${esc(prof.model || '')}" placeholder="${esc(p.model)} (비우면 이것)" list="agentModels"><datalist id="agentModels">${(S.agentModels || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>` : ''}
    ${prov === 'custom' || prov === 'ollama' ? `<div class="fr"><label>주소</label><input type="text" data-k="agent.profiles.${prov}.base" value="${esc(prof.base || '')}" placeholder="${esc(p ? p.base : '')}"></div>` : ''}
    <div class="fr"><label></label><button class="btn" data-act="agent-test">연결 시험</button><span class="exp" id="agentMsg" style="margin:0"></span></div>
    ${keys.length ? `<div class="fr" style="margin-bottom:4px"><label>저장된 키 ${keys.length}개</label><span class="exp" style="margin:0">이 PC의 설정 파일에만 저장됩니다. 고른 AI 서버 말고는 어디로도 보내지 않습니다.</span></div>
    <table class="keys"><thead><tr><th style="width:24%">이름</th><th>어디</th><th>키</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : ''}</div>`;
}
function agentMsg(msg, ok) {
  const m = $('#agentMsg');
  if (!m) return;
  m.textContent = msg;
  m.style.color = ok ? 'var(--blue)' : 'var(--red)';
}
function refreshAgentSec(msg, ok) {
  const sec = $('#agentsec');
  if (!sec) return;
  sec.outerHTML = agentSectionHTML();
  if (msg) agentMsg(msg, ok);
  refreshAiSec();
}

// ---------- 내 PC AI(로컬 LLM, v1.9) ----------
// 사용자: "로컬 LLM 기반만 준비해 두고, Gemma4·Qwen 등 새 모델이 나오면 클릭만 하면 바로 쓰게".
// 상태(Ollama 설치·켜짐·받은 모델·메모리) → 받는 중 → 받은 모델(쓰기·비서에게만·속도·내리기·지우기) → 목록(추천·새로 나온 것·찾기 → 태그 → 받기).
const LM = { st: null, tab: 'pick', lib: {}, q: '', open: null, tags: {}, all: {}, speed: {}, pulls: {}, busy: '', loading: false, poll: null };
const LM_CAP = { vision: '그림', tools: '도구', thinking: '생각', audio: '소리', embedding: '찾기용', decision: '판단', cloud: '클라우드', code: '코드' };
const lmGB = b => (!b ? '' : b >= 10 * 1024 ** 3 ? (b / 1024 ** 3).toFixed(0) + 'GB' : b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + 'GB' : Math.max(1, Math.round(b / 1024 ** 2)) + 'MB');
const lmEta = s => (s == null ? '' : s < 60 ? `약 ${Math.max(1, s)}초 남음` : s < 3600 ? `약 ${Math.round(s / 60)}분 남음` : `약 ${(s / 3600).toFixed(1)}시간 남음`);
const lmAgo = d => (d == null ? '' : d === 0 ? '오늘' : d < 7 ? `${d}일 전` : d < 30 ? `${Math.round(d / 7)}주 전` : d < 365 ? `${Math.round(d / 30)}달 전` : `${Math.round(d / 365)}년 전`);
const lmHave = name => ((LM.st && LM.st.models) || []).some(m => m.name === name || (m.name === name + ':latest'));

function localSectionHTML() {
  const st = LM.st;
  if (st && Date.now() - (LM.stAt || 0) > 15000) setTimeout(localLoad, 0); // 설정을 다시 열면 상태도 새로
  if (!st) { setTimeout(localLoad, 0); return `<div class="fs" id="localsec"><h3>내 PC AI <span class="pill">확인 중…</span></h3><p class="exp">이 PC의 Ollama를 찾는 중입니다.</p></div>`; }
  const pill = !st.installed ? '<span class="pill red">설치 안 됨</span>' : !st.running ? '<span class="pill">꺼짐</span>' : `<span class="pill ok">켜짐 · 모델 ${st.models.length}개</span>`;
  const head = `<div class="fs" id="localsec"><h3>내 PC AI ${pill}<button class="btn small" data-act="local-refresh" style="margin-left:auto" data-tip="Ollama 상태와 받은 모델을 다시 봅니다">다시 보기</button></h3>
    <p class="exp">인터넷·키 없이 이 PC에서 도는 AI입니다(Ollama, 무료). 새 모델(Gemma·Qwen 등)이 나오면 아래 목록에 저절로 올라옵니다. 눌러서 받고 ‘쓰기’를 한 번 누르면 한눈에와 서클 비서가 그 모델로 답합니다. 묻는 글이 밖으로 나가지 않아 업무 글에 알맞습니다.</p>`;
  let state = '';
  if (!st.installed) {
    state = `<div class="note-box lm-step"><b>1단계 · Ollama 설치</b> — 모델을 이 PC에서 돌려 주는 무료 프로그램입니다. ‘설치하기’를 누르면 설치 창이 열립니다(약 1~3분). 끝나면 ‘다시 보기’를 누르세요.
      <div class="fr" style="margin:8px 0 0"><button class="btn" data-act="local-install">설치하기</button><button class="btn small" data-act="url" data-u="https://ollama.com/download">ollama.com에서 받기</button>${LM.busy ? `<span class="exp" style="margin:0">${esc(LM.busy)}</span>` : ''}</div></div>`;
  } else if (!st.running) {
    state = `<div class="note-box lm-step"><b>Ollama가 꺼져 있습니다.</b> 켜 두면 트레이에 라마 그림이 생기고, 한눈에·서클 비서가 부를 때 답합니다.
      <div class="fr" style="margin:8px 0 0"><button class="btn" data-act="local-start">켜기</button>${LM.busy ? `<span class="exp" style="margin:0">${esc(LM.busy)}</span>` : ''}</div></div>`;
  }
  const mem = st.mem || {}, disk = st.disk || {}, gpu = st.gpu || {};
  const gpuTxt = gpu.nvidia ? 'NVIDIA 그래픽 카드 있음 → 빠름' : gpu.amd ? 'AMD 그래픽 카드 → 모델에 따라 빠름' : 'AI용 그래픽 카드 없음 → CPU로 돌아 느린 편(작은 모델 권장)';
  const lowDisk = disk.free != null && disk.free < 40 * 1024 ** 3;
  const pc = `<div class="lm-pc"><span data-tip="이 PC의 메모리. 모델은 받은 크기만큼 메모리에 올라갑니다. 이 PC는 페이지 파일이 없어 메모리가 모자라면 다른 프로그램이 꺼질 수 있습니다">메모리 <b>${lmGB(mem.total)}</b> · 지금 여유 <b>${lmGB(mem.free)}</b></span>
      <span>${esc(gpuTxt)}</span>
      <span class="lm-dir" data-tip="${esc(st.dir || '')}">모델 폴더 <b>${esc(String(st.dir || '').replace(/^([A-Za-z]:\\Users\\)[^\\]+/, '$1…'))}</b>${disk.free != null ? ` · 남은 공간 <b class="${lowDisk ? 'lm-warn' : ''}">${lmGB(disk.free)}</b>` : ''}</span>
      <span class="lm-acts"><button class="btn small" data-act="local-opendir" data-tip="받은 모델 파일이 있는 폴더를 엽니다">폴더 열기</button><button class="btn small" data-act="local-movedir" data-tip="모델을 다른 드라이브(G: 등)에 받게 합니다. Ollama를 다시 켜야 적용됩니다">폴더 바꾸기</button></span></div>
    ${lowDisk ? `<div class="note-box">모델 폴더의 남은 공간이 ${lmGB(disk.free)}뿐입니다. 큰 모델을 여러 개 받을 거면 ‘폴더 바꾸기’로 여유가 큰 드라이브를 고르세요.</div>` : ''}`;
  return head + state + pc + lmPullsHTML() + (st.running ? lmModelsHTML() : '') + lmCatalogHTML() + '</div>';
}

function lmPullsHTML() {
  const list = Object.values(LM.pulls);
  if (!list.length) return '';
  return `<div class="lm-pulls">${list.map(p => {
    const err = p.err || (p.result && !p.result.ok && p.result.msg);
    const pct = Math.max(0, Math.min(100, p.pct || 0));
    const sub = err ? esc(err) : p.finished ? '다 받음' : `${esc(p.status || '받는 중')}${p.total ? ` · ${lmGB(p.done)} / ${lmGB(p.total)}` : ''}${p.speed ? ` · 초당 ${lmGB(p.speed)}` : ''}${p.eta != null && !p.finished ? ' · ' + lmEta(p.eta) : ''}`;
    const acts = !p.finished ? `<button class="btn small" data-act="local-cancel" data-n="${esc(p.name)}" data-tip="멈춰도 받은 데까지는 남아 다시 누르면 이어 받습니다">멈추기</button>`
      : err ? `<button class="btn small" data-act="local-pull" data-n="${esc(p.name)}" data-use="${esc(p.use || '')}">이어 받기</button><button class="btn small" data-act="local-clear" data-n="${esc(p.name)}">닫기</button>`
        : `<button class="btn small" data-act="local-clear" data-n="${esc(p.name)}">닫기</button>`;
    return `<div class="lm-pull ${err ? 'err' : p.finished ? 'done' : ''}" data-pull="${esc(p.name)}"><b>${esc(p.name)}</b>
      <span class="lm-bar"><i style="width:${pct.toFixed(1)}%"></i></span><span class="lm-pct">${pct.toFixed(0)}%</span><span class="lm-sub">${sub}</span><span class="lm-pacts">${acts}</span></div>`;
  }).join('')}</div>`;
}

function lmModelsHTML() {
  const st = LM.st, use = st.use || {};
  const loaded = new Set((st.loaded || []).map(m => m.name));
  if (!st.models.length) return `<div class="note-box">아직 받은 모델이 없습니다. 아래 목록에서 <b class="lm-fit ok">넉넉함</b> 표시가 붙은 작은 모델부터 받아 보세요. ‘받고 바로 쓰기’를 누르면 다 받은 뒤 바로 한눈에 AI로 씁니다.</div>`;
  const rows = st.models.map(m => {
    const tags = [use.all === m.name ? '<span class="pill ok">한눈에 AI</span>' : '', use.aide === m.name ? '<span class="pill ok">서클 비서</span>' : '', loaded.has(m.name) ? '<span class="pill" data-tip="지금 메모리에 올라가 있습니다. 5분 동안 안 쓰면 저절로 내려갑니다">메모리에 있음</span>' : '', m.remote ? '<span class="pill">클라우드</span>' : ''].join('');
    const sp = LM.speed[m.name];
    return `<tr><td><b>${esc(m.name)}</b><div class="lm-meta">${esc([m.params, m.quant, m.family].filter(Boolean).join(' · '))}</div>${sp ? `<div class="lm-speed ${sp.ok === false ? 'err' : ''}">${esc(sp.msg)}${sp.answer ? ` — “${esc(sp.answer)}”` : ''}</div>` : ''}</td>
      <td class="kp">${esc(m.size)}</td><td>${tags}</td>
      <td class="kact">${use.all === m.name ? '' : `<button class="btn small" data-act="local-use" data-n="${esc(m.name)}" data-scope="all" data-tip="한눈에의 AI(정리·해석·비서 기본값)를 이 모델로">쓰기</button>`}
        ${use.aide === m.name ? '' : `<button class="btn small" data-act="local-use" data-n="${esc(m.name)}" data-scope="aide" data-tip="서클 비서만 이 모델로 답하게">비서에게만</button>`}
        <button class="btn small" data-act="local-speed" data-n="${esc(m.name)}" data-tip="짧은 한국어 답 하나로 속도를 잽니다(처음에는 불러오는 데 시간이 걸림)">속도 재기</button>
        ${loaded.has(m.name) ? `<button class="btn small" data-act="local-unload" data-n="${esc(m.name)}" data-tip="메모리를 비웁니다. 받은 파일은 그대로">메모리에서 내리기</button>` : ''}
        <button class="btn small red" data-act="local-remove" data-n="${esc(m.name)}">지우기</button></td></tr>`;
  }).join('');
  return `<table class="keys lm-models"><thead><tr><th style="width:40%">받은 모델</th><th>크기</th><th>쓰는 곳</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function lmCatalogHTML() {
  const tab = (k, n, tip) => `<button data-act="local-tab" data-t="${k}" aria-pressed="${LM.tab === k}" data-tip="${esc(tip)}">${n}</button>`;
  const lib = LM.lib[LM.tab === 'search' ? 'search:' + LM.q : LM.tab];
  let body = '';
  if (LM.tab === 'search' && !LM.q) body = `<p class="exp">모델 이름 일부를 넣고 Enter. 예: gemma, qwen, exaone(LG 한국어), kanana(카카오, 개인이 올린 것)</p>`;
  else if (!lib || LM.loading) body = `<p class="exp">ollama.com에서 목록을 받는 중…</p>`;
  else if (!lib.ok) body = `<div class="note-box">${esc(lib.msg || '목록을 받지 못했습니다.')}</div>`;
  else {
    let fam = '';
    body = (lib.msg ? `<div class="note-box">${esc(lib.msg)}</div>` : '') + (lib.cards.length ? lib.cards.map(c => {
      const famRow = LM.tab === 'pick' && c.family !== fam ? `<div class="lm-fam">${esc(c.family)} <span>${esc(c.who || '')}</span></div>` : '';
      fam = c.family;
      return famRow + lmCardHTML(c);
    }).join('') : '<p class="exp">찾은 모델이 없습니다.</p>');
  }
  const when = lib && lib.at ? `${lmAgo(Math.floor((Date.now() - lib.at) / 86400e3)) === '오늘' ? (Date.now() - lib.at < 3600e3 ? '방금' : Math.floor((Date.now() - lib.at) / 3600e3) + '시간 전') : lmAgo(Math.floor((Date.now() - lib.at) / 86400e3))} 받은 목록` : '';
  return `<div class="lm-cat"><div class="lm-tabs"><span class="seg">${tab('pick', '추천', '집안(Gemma·Qwen·EXAONE·Llama·Phi·Mistral·DeepSeek)마다 새 판부터 3개씩')}${tab('new', '새로 나온 것', 'ollama.com에 새로 올라온 순서(받을 수 있는 것만)')}${tab('search', '찾기', '이름으로 찾기')}</span>
      ${LM.tab === 'search' ? `<input type="text" id="lmQ" value="${esc(LM.q)}" placeholder="예: gemma, qwen, exaone" autocomplete="off"><button class="btn small" data-act="local-search">찾기</button>` : ''}
      <span class="lm-when">${esc(when)}</span><button class="btn small" data-act="local-relist" data-tip="ollama.com에서 목록을 새로 받습니다(6시간마다 저절로 새로 받음)">목록 새로 받기</button></div>
    ${body}
    <div class="fr lm-byname"><label>이름으로 받기</label><input type="text" id="lmName" placeholder="예: gemma4:e4b, qwen3.8:4b, exaone3.5:2.4b" autocomplete="off">
      <button class="btn small" data-act="local-pullname" data-tip="목록에 없는 새 모델도 이름만 알면 받습니다">받기</button><button class="btn small" data-act="local-pullname" data-use="all">받고 바로 쓰기</button></div></div>`;
}

function lmCardHTML(c) {
  const open = LM.open === c.name;
  const fresh = c.days != null && c.days <= 30;
  const caps = c.caps.filter(x => x !== 'cloud').map(x => LM_CAP[x] || x).join(' · ');
  const sizes = (c.fits || c.sizes.map(s => ({ s, level: 'unknown' }))).map(f => `<i class="lm-fit ${f.level}" data-tip="${esc(f.s)}: 받는 양 어림 ${f.needGB ? f.needGB + 'GB 메모리' : '모름'} · ${esc(f.text || '')}${f.speed ? ' · ' + f.speed : ''}">${esc(f.s)}</i>`).join('');
  const t = LM.tags[c.name];
  let tags = '';
  if (open) {
    if (!t) tags = '<div class="lm-tags"><p class="exp">크기별 목록을 받는 중…</p></div>';
    else if (!t.ok) tags = `<div class="lm-tags"><div class="note-box">${esc(t.msg)}</div></div>`;
    else {
      const all = LM.all[c.name];
      const rows = t.rows.filter(r => all || r.main);
      const hidden = t.rows.length - t.rows.filter(r => r.main).length;
      tags = `<div class="lm-tags"><table class="keys"><thead><tr><th>받을 이름</th><th>받는 크기</th><th data-tip="한 번에 읽을 수 있는 글 길이(조각 수)">기억 길이</th><th>이 PC에서</th><th></th></tr></thead><tbody>${rows.map(r => {
        const have = lmHave(r.name);
        const busy = LM.pulls[r.name] && !LM.pulls[r.name].finished;
        return `<tr><td><code>${esc(r.name)}</code></td><td class="kp">${esc(r.size)}${r.sizeMax && r.sizeMax !== r.size ? '~' + esc(r.sizeMax) : ''}</td><td class="kp">${esc(r.ctx)}</td>
          <td><span class="lm-fit ${r.fit.level}">${esc(r.fit.text)}</span>${r.fit.speed && r.fit.level !== 'cloud' ? ` <span class="kp">· ${esc(r.fit.speed)}</span>` : ''}</td>
          <td class="kact">${r.cloud ? '' : have ? `<span class="pill ok">받아 둠</span> <button class="btn small" data-act="local-use" data-n="${esc(r.name)}" data-scope="all">쓰기</button>` : busy ? '<span class="pill">받는 중</span>'
            : `<button class="btn small" data-act="local-pull" data-n="${esc(r.name)}"${r.fit.level === 'no' ? ' data-warn="1"' : ''}>받기</button><button class="btn small" data-act="local-pull" data-n="${esc(r.name)}" data-use="all"${r.fit.level === 'no' ? ' data-warn="1"' : ''}>받고 바로 쓰기</button>`}</td></tr>`;
      }).join('')}</tbody></table>${hidden ? `<button class="btn small" data-act="local-alltags" data-n="${esc(c.name)}">${all ? '줄이기' : `다른 압축판 ${hidden}개도 보기`}</button>` : ''}
        <button class="btn small" data-act="url" data-u="${esc(t.url)}">ollama.com에서 보기</button></div>`;
    }
  }
  return `<div class="lm-card${open ? ' open' : ''}${c.cloudOnly ? ' cloud' : ''}"><div class="lm-ch" data-act="local-card" data-n="${esc(c.name)}" role="button" tabindex="0">
      <span class="lm-arrow">${open ? '▾' : '▸'}</span><b>${esc(c.name)}</b>${c.official ? '' : '<span class="pill" data-tip="Ollama가 아닌 개인이 올린 모델입니다. 믿을 만한지 살펴보고 받으세요">개인이 올림</span>'}${c.cloudOnly ? '<span class="pill" data-tip="Ollama 서버에서만 도는 모델이라 이 PC로 받을 수 없습니다. 묻는 글이 밖으로 나갑니다">클라우드 전용 · 받을 수 없음</span>' : ''}${fresh ? `<span class="lm-new" data-tip="ollama.com에 이 모델이 새로 올라오거나 새 크기·판이 더해진 때입니다">최근 올라옴 · ${esc(lmAgo(c.days))}</span>` : c.days != null ? `<span class="lm-age" data-tip="ollama.com에서 마지막으로 바뀐 때">${esc(lmAgo(c.days))}</span>` : ''}
      ${caps ? `<span class="lm-caps">${esc(caps)}</span>` : ''}<span class="lm-sizes">${sizes}</span>${c.pulls ? `<span class="lm-pulln">${esc(c.pulls)}번 받음</span>` : ''}</div>
    ${c.desc ? `<div class="lm-desc" title="${esc(c.desc)}">${esc(c.desc)}</div>` : ''}${tags}</div>`;
}

function refreshLocalSec() {
  const sec = $('#localsec');
  if (!sec) return;
  const f = document.activeElement && document.activeElement.id;
  const keep = { q: ($('#lmQ') || {}).value, n: ($('#lmName') || {}).value };
  sec.outerHTML = localSectionHTML();
  if (keep.q != null && $('#lmQ')) $('#lmQ').value = keep.q;
  if (keep.n != null && $('#lmName')) $('#lmName').value = keep.n;
  if (f && (f === 'lmQ' || f === 'lmName') && $('#' + f)) $('#' + f).focus();
}
async function localLoad(refreshList) {
  if (LM.loadingSt) return;
  LM.loadingSt = true;
  try {
    LM.st = await hn.local.status();
    LM.stAt = Date.now();
    for (const p of LM.st.pulling || []) LM.pulls[p.name] = { ...(LM.pulls[p.name] || {}), ...p };
  } finally { LM.loadingSt = false; }
  refreshLocalSec();
  lmList(!!refreshList);
}
async function lmList(refresh) {
  const key = LM.tab === 'search' ? 'search:' + LM.q : LM.tab;
  if (LM.tab === 'search' && !LM.q) { refreshLocalSec(); return; }
  if (LM.lib[key] && !refresh) return;
  LM.loading = true; refreshLocalSec();
  try { LM.lib[key] = await hn.local.library({ mode: LM.tab, q: LM.q, refresh: !!refresh }); } finally { LM.loading = false; }
  refreshLocalSec();
}
async function lmPull(name, use, warn) {
  name = String(name || '').trim();
  if (!name) { toast('받을 모델 이름을 넣어 주세요. 예: gemma4:e4b'); return; }
  if (warn && !confirm(`${name}은(는) 이 PC의 지금 메모리 여유로는 돌리기 어렵습니다.\n이 PC는 페이지 파일이 없어 메모리가 모자라면 다른 프로그램이 꺼질 수 있습니다.\n그래도 받을까요?`)) return;
  LM.pulls[name] = { name, pct: 0, status: '준비 중', use: use || '' };
  refreshLocalSec();
  const r = await hn.local.pull(name, use || '');
  if (!r.ok) { LM.pulls[name] = { ...LM.pulls[name], finished: true, err: r.msg }; refreshLocalSec(); toast(r.msg, 'error'); }
}
function lmProgress(p) {
  const cur = LM.pulls[p.name] || { name: p.name };
  LM.pulls[p.name] = { ...cur, ...p, result: p.result || cur.result };
  if (p.finished && p.result) {
    if (p.settings) { S.set = p.settings; S.agent = p.info || S.agent; refreshAgentSec(); }
    toast(p.result.ok ? (p.result.used ? `${p.name} 받았습니다. 이제 한눈에 AI가 이 모델(내 PC)로 답합니다.` : `${p.name} 받았습니다. ‘쓰기’를 누르면 씁니다.`) : p.result.msg, p.result.ok ? '' : 'error');
    if (p.result.ok) { LM.speed[p.name] = null; localLoad(); return; }
  }
  // 막대만 바꾸고 칸 전체는 다시 그리지 않는다(입력 중인 글·스크롤 그대로)
  const row = document.querySelector(`#localsec [data-pull="${CSS.escape(p.name)}"]`);
  if (!row || p.finished) { refreshLocalSec(); return; }
  const q = LM.pulls[p.name];
  row.querySelector('.lm-bar i').style.width = Math.min(100, q.pct || 0).toFixed(1) + '%';
  row.querySelector('.lm-pct').textContent = Math.min(100, q.pct || 0).toFixed(0) + '%';
  row.querySelector('.lm-sub').textContent = `${q.status || '받는 중'}${q.total ? ` · ${lmGB(q.done)} / ${lmGB(q.total)}` : ''}${q.speed ? ` · 초당 ${lmGB(q.speed)}` : ''}${q.eta != null ? ' · ' + lmEta(q.eta) : ''}`;
}
// 설치를 누른 뒤에는 칸이 열려 있는 동안 5초마다 다시 본다(최대 10분)
function lmWatchInstall() {
  clearInterval(LM.poll);
  const t0 = Date.now();
  LM.poll = setInterval(async () => {
    if (!$('#localsec') || Date.now() - t0 > 600e3) { clearInterval(LM.poll); return; }
    const st = await hn.local.status();
    if (st.installed !== LM.st.installed || st.running !== LM.st.running) { LM.st = st; LM.busy = ''; refreshLocalSec(); if (st.running) { clearInterval(LM.poll); toast('Ollama가 준비됐습니다. 아래 목록에서 모델을 받으세요.'); } }
  }, 5000);
}
async function localAct(act, el) {
  const n = el.dataset.n;
  switch (act) {
    case 'local-refresh': LM.st = null; refreshLocalSec(); break;
    case 'local-install': { LM.busy = '설치 창을 여는 중…'; refreshLocalSec(); const r = await hn.local.install(); LM.busy = r.msg; refreshLocalSec(); lmWatchInstall(); break; }
    case 'local-start': { LM.busy = '켜는 중… (처음엔 10초쯤)'; refreshLocalSec(); const r = await hn.local.start(); LM.busy = r.ok ? '' : r.msg; if (r.ok) toast(r.msg); await localLoad(); break; }
    case 'local-tab': LM.tab = el.dataset.t; LM.open = null; refreshLocalSec(); lmList(false); if (LM.tab === 'search') { const q = $('#lmQ'); if (q) q.focus(); } break;
    case 'local-search': { LM.q = (($('#lmQ') || {}).value || '').trim(); LM.open = null; lmList(false); break; }
    case 'local-relist': LM.tags = {}; lmList(true); break;
    case 'local-card': {
      LM.open = LM.open === n ? null : n;
      refreshLocalSec();
      if (LM.open && !(LM.tags[n] && LM.tags[n].ok)) { LM.tags[n] = await hn.local.tags(n); refreshLocalSec(); }
      break;
    }
    case 'local-alltags': LM.all[n] = !LM.all[n]; refreshLocalSec(); break;
    case 'local-pull': await lmPull(n, el.dataset.use, el.dataset.warn === '1'); break;
    case 'local-pullname': { const v = (($('#lmName') || {}).value || '').trim(); await lmPull(v, el.dataset.use); if (v && $('#lmName')) $('#lmName').value = ''; break; }
    case 'local-cancel': await hn.local.cancel(n); break;
    case 'local-clear': await hn.local.clear(n); delete LM.pulls[n]; refreshLocalSec(); break;
    case 'local-use': {
      const r = await hn.local.use(n, el.dataset.scope);
      if (r.ok) { S.set = r.settings; S.agent = r.info; refreshAgentSec(); LM.st = await hn.local.status(); }
      refreshLocalSec(); toast(r.msg, r.ok ? '' : 'error');
      break;
    }
    case 'local-speed': {
      LM.speed[n] = { msg: '재는 중… 처음에는 모델을 메모리에 올리느라 1분쯤 걸릴 수 있습니다' };
      refreshLocalSec();
      LM.speed[n] = await hn.local.speed(n);
      LM.st = await hn.local.status(); refreshLocalSec();
      break;
    }
    case 'local-unload': { const r = await hn.local.unload(n); toast(r.msg, r.ok ? '' : 'error'); LM.st = await hn.local.status(); refreshLocalSec(); break; }
    case 'local-remove': {
      const m = (LM.st.models || []).find(x => x.name === n);
      if (!confirm(`${n}을(를) 지울까요?\n받은 파일(${m ? m.size : ''})이 지워집니다. 다시 쓰려면 다시 받아야 합니다.`)) break;
      const r = await hn.local.remove(n); toast(r.msg, r.ok ? '' : 'error'); LM.st = await hn.local.status(); refreshLocalSec();
      break;
    }
    case 'local-opendir': hn.local.openDir(LM.st && LM.st.dir); break;
    case 'local-movedir': {
      if (!confirm('모델을 받을 폴더를 바꿀까요?\n\n· 이 PC 사용자 환경 변수 OLLAMA_MODELS를 정합니다.\n· 트레이의 Ollama를 끝내고 다시 켜야 적용됩니다.\n· 이미 받은 모델은 옛 폴더에 남습니다(옮기려면 models 폴더째 옮기기).')) break;
      const r = await hn.local.modelsDir();
      if (!r.canceled) { toast(r.msg, r.ok ? '' : 'error'); LM.st = null; refreshLocalSec(); }
      break;
    }
  }
}

// ---------- AI 정리: 쓸 곳 따로 고르기 ----------
// 위 AI 에이전트와 같게 · Claude Code · Gemini(저장된 키) … 를 고르고, 모델은 쓸 곳마다 저장된 값을 같이 쓴다
function aiSectionHTML() {
  const s = S.set;
  const info = S.agent || {};
  const P = info.presets || {};
  const rb = info.readyBy || {};
  const org = info.organize || { provider: 'none' };
  const sel = (s.ai && s.ai.agent) || 'same';
  const short = k => (k === 'claude' ? 'Claude Code' : k === 'none' ? '없음' : P[k] ? P[k].name.replace(/\s*\(.*\)$/, '') : k);
  const why = k => (rb[k] ? '' : k === 'claude' ? ' — 이 PC에 없음' : P[k] && P[k].needKey ? ' — 키 없음(위에서 저장)' : '');
  const opt = (v, n) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${esc(n)}</option>`;
  const opts = opt('same', `위 AI 에이전트와 같게 (지금: ${short(info.resolved || 'none')})`) + opt('claude', 'Claude Code (이 PC, 구독)' + why('claude'))
    + Object.entries(P).map(([k, v]) => opt(k, v.name + why(k))).join('');
  let model = '';
  if (org.provider === 'claude') {
    model = `<div class="fr"><label>Claude 모델</label><select data-k="ai.model">${['sonnet', 'haiku', 'opus'].map(m => `<option ${s.ai.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>`;
  } else if (P[org.provider]) {
    const own = sel !== 'same' && sel !== (s.agent || {}).provider; // 위 칸에 안 보이는 쓸 곳이면 여기서 모델을 고침
    const pm = ((s.agent.profiles || {})[org.provider] || {}).model || '';
    model = own
      ? `<div class="fr"><label>모델</label><input type="text" data-k="agent.profiles.${org.provider}.model" value="${esc(pm)}" placeholder="${esc(P[org.provider].model)} (비우면 이것)" list="agentModels"></div>`
      : `<div class="fr"><label>모델</label><span class="exp" style="margin:0">${esc(org.model)} — 위 ‘AI 에이전트’의 모델 칸에서 바꿉니다</span></div>`;
  }
  const cloud = { gemini: '무료 Gemini는 보낸 글을 Google이 서비스 개선에 쓰고, 사람이 읽어 볼 수도 있습니다(유료 결제 계정은 제외).', groq: '무료 Groq로 글이 보내집니다.', openrouter: '무료 OpenRouter 모델은 제공한 회사가 글을 학습에 쓸 수 있습니다.' }[org.provider];
  return `<div class="fs" id="aisec"><h3>AI 정리 <span class="pill ${org.ready ? 'ok' : ''}">${org.ready ? '정리: ' + short(org.provider) : '쓸 곳 없음'}</span></h3>
    <p class="exp">일을 읽어 영역·주제·마감·다음 할 일을 정리합니다. 바뀐 일만 다시 읽습니다. 찾은 일정 ‘AI로 다듬기’도 여기서 고른 곳을 씁니다.</p>
    <div class="fr"><label>쓸 곳</label><select data-k="ai.agent">${opts}</select>
      <button class="btn" data-act="aiall">전부 다시 정리</button></div>
    ${model}
    ${cloud ? `<div class="note-box">${esc(cloud)} 일 이름·폴더 이름·메모 앞부분(일마다 2,600자까지)이 보내집니다. 업무 글이 걸리면 <b>Claude Code</b>나 <b>내 PC의 Ollama</b>를 고르세요.${org.provider === 'gemini' ? ' 한 번 정리에 일 8개마다 한 번씩 부르므로(일 60개면 9번 안팎) 무료 사용량 안에서 됩니다.' : ''}</div>` : ''}
    ${org.ready ? '' : `<div class="note-box">고른 곳이 준비되지 않았습니다. ${sel === 'claude' ? '이 PC에 Claude Code가 없습니다.' : '위 ‘AI 에이전트’에서 그곳을 고르고 키를 저장하세요.'}</div>`}</div>`;
}
function refreshAiSec() {
  const sec = $('#aisec');
  if (sec) sec.outerHTML = aiSectionHTML();
}
async function agentKey(req) {
  const r = await hn.agentKey(req);
  S.set = r.settings; S.agent = r.info;
  S.voice = await hn.voiceInfo(); renderMicState();
  if (r.ok) S.agentNew = false;
  refreshAgentSec(r.msg, r.ok);
  return r;
}

// ---------- 처음 쓰는 사람 안내 ----------
function welcomeHTML() {
  const fresh = !(S.set.roots || []).length && S.board.items.filter(it => it.kind !== 'manual').length === 0;
  if (!fresh || (S.set.ui && S.set.ui.welcomeOff)) return '';
  return `<div class="welcome"><button class="btn small" data-act="welcome-off" style="float:right">다시 보지 않기</button><h2>한눈에 일정판을 시작합니다</h2>
    <div class="exp">마감이 가까운 순으로 할 일을 한눈에 봅니다. 아래 가운데 하나부터 해 보세요.</div>
    <ol>
      <li>아래 <b>바로 넣기</b> 칸에 “내일 오후 3시 보고서 제출 ★★★”처럼 쓰고 Enter</li>
      <li>프로젝트 폴더가 모인 곳을 <button class="btn small" data-act="roots-add">작업 폴더 고르기</button> — 그 안의 폴더 하나하나가 ‘일’이 됩니다</li>
      <li>공문·안내문이 쌓이는 폴더를 <button class="btn small" data-act="folder-add">일정 찾을 폴더 고르기</button> — 문서 속 마감 날짜를 찾아 줍니다</li>
      <li>(선택) <button class="btn small" data-act="open-agent">AI 에이전트 연결</button> — 무료 키나 내 PC의 Ollama로 자동 정리</li>
      <li>(선택) <button class="btn small" data-act="open-cal">구글 캘린더 연결</button> — 마감이 폰 캘린더·알람으로</li>
    </ol></div>`;
}

// ---------- 새 동작들 ----------
document.addEventListener('click', async e => {
  if (e.target.id === 'modal2') { closeModal2(); return; }
  if (!e.target.closest('#pop') && !$('#pop').hidden && !e.target.closest('.spark, .heat')) closePop();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act.startsWith('local-')) { localAct(act, el); return; }
  switch (act) {
    case 'sec': { const c = { ...((S.set.ui || {}).collapsed || {}) }; c[el.dataset.sec] = secOpen(el.dataset.sec); S.set = await hn.setSettings({ ui: { collapsed: c } }); renderSide(); break; }
    case 'side-close': S.set = await hn.setSettings({ ui: { sideCollapsed: true } }); render(); break;
    case 'side-open': S.set = await hn.setSettings({ ui: { sideCollapsed: false } }); render(); break;
    case 'm2close': closeModal2(); break;
    case 'e-date': { E.draft = draftFromFields(); const d = new Date(); d.setDate(d.getDate() + Number(el.dataset.v)); E.draft.date = NLP.ymd(d); renderEdit(); break; }
    case 'e-shift': { E.draft = draftFromFields(); const b = E.draft.date ? new Date(E.draft.date + 'T00:00') : new Date(); b.setDate(b.getDate() + Number(el.dataset.v)); E.draft.date = NLP.ymd(b); renderEdit(); break; }
    case 'e-nextmon': { E.draft = draftFromFields(); const r = NLP.parse('다음주 월요일', { mode: 'quick' }); E.draft.date = r.actions[0].value; renderEdit(); break; }
    case 'e-time': E.draft = draftFromFields(); E.draft.time = el.dataset.v; renderEdit(); break;
    case 'e-imp': { E.draft = draftFromFields(); const v = Number(el.dataset.v); E.draft.imp = E.draft.imp === v ? 0 : v; renderEdit(); break; }
    case 'e-remove': if (confirm('이 마감을 지울까요?')) { E.draft = draftFromFields(); E.draft.removeDl = true; if (await saveEdit(E.draft)) closeModal(); } break;
    case 'e-aide': { const it = E.it; closeModal(); window.CircleAPI.makeAide({ id: it.id, title: it.title, paths: it.paths || [] }); break; }
    case 'e-save': { const d = draftFromFields(); if (await saveEdit(d)) closeModal(); break; }
    case 'e-nl': runNL(false); break;
    case 'brief-say': readBrief(true); break;
    case 'vd-add': { const d = [...(S.set.voice.dict || []), { say: '', write: '' }]; await saveDict(d); const b = $('#vDict'); if (b) b.innerHTML = voiceDictRows(); break; }
    case 'vd-del': { const d = [...(S.set.voice.dict || [])]; d.splice(Number(el.dataset.i), 1); await saveDict(d); const b = $('#vDict'); if (b) b.innerHTML = voiceDictRows(); break; }
    case 'vd-sample': { const [say, write] = el.dataset.s.split('|'); const d = S.set.voice.dict || []; if (!d.some(x => x.say === say)) { await saveDict([...d, { say, write }]); const b = $('#vDict'); if (b) b.innerHTML = voiceDictRows(); } break; }
    case 'vl-del': { const l = (S.set.voice.learned || []).filter(x => !(x.heard === el.dataset.h && x.fixed === el.dataset.f)); S.set = await hn.setSettings({ voice: { learned: l } }); refreshVoiceSec(); break; }
    case 'v-use': { S.set = await hn.setSettings({ voice: { engine: el.dataset.e, model: el.dataset.m || '' } }); S.voice = await hn.voiceInfo(); refreshVoiceSec(); renderMicState(); toast('받아쓰기 엔진을 바꿨습니다.'); break; }
    case 'v-local': { el.hidden = true; const r = await hn.voiceLocalGet(); toast(r.msg, r.ok ? '' : 'error'); hn.voiceLocalStatus().then(paintLocal); break; }
    case 'phone-copy': if (S.phone && S.phone.url) { await hn.copy(S.phone.url); toast('연결 주소를 복사했습니다. 비밀 열쇠이니 다른 사람에게 보내지 마세요.'); } break;
    case 'phone-rotate': if (confirm('지금까지 연결한 폰이 모두 끊기고 QR을 다시 찍어야 합니다. 새 열쇠로 바꿀까요?')) { S.phone = await hn.phoneRotate(); refreshPhoneSec(); toast('새 열쇠로 바꿨습니다. 폰에서 QR을 다시 찍으세요.'); } break;
    case 'a-close': agentClose(); break;
    case 'a-slow': hn.agentRate({ rate: Math.max(0.8, Math.round((AG.rate - 0.25) * 100) / 100) }); break;
    case 'a-fast': hn.agentRate({ rate: Math.min(2.5, Math.round((AG.rate + 0.25) * 100) / 100) }); break;
    case 'a-auto': hn.agentRate({ auto: !AG.auto }); break;
    case 'a-try': agentPlayer(); hn.agentText('지금 목소리와 빠르기를 들려주려고 합니다. 자연스럽게 한 문장만 인사해 주세요.'); break;
    case 'a-forget': { const m = [...(S.set.voice.agentMemory || [])]; m.splice(Number(el.dataset.i), 1); S.set = await hn.setSettings({ voice: { agentMemory: m } }); const sec = $('#agentvoicesec'); if (sec) sec.outerHTML = agentVoiceSectionHTML(); break; }
    case 'voice-say': Voice.say('안녕하세요. 한눈에 일정판입니다. 내일 오후 3시, 보고서 제출.', { voiceName: S.set.voice.voiceName, rate: S.set.voice.rate }); break;
    case 'e-ai': closeModal2(); runNL(true); break;
    case 'c-apply': {
      const keep = $$('#modal2 [data-ci]').filter(x => x.checked).map(x => E.pending[Number(x.dataset.ci)]);
      const next = { ...E.draft };
      for (const c of keep) next[c.key] = c.to;
      closeModal2();
      if (await saveEdit(next)) closeModal();
      break;
    }
    case 'words': openWords(); break;
    case 'w-add': W.push({ word: '', action: 'date', value: '' }); renderWords(); break;
    case 'w-del': W.splice(Number(el.dataset.i), 1); renderWords(); break;
    case 'w-sample': { const [word, action, value] = el.dataset.s.split('|'); if (!W.some(w => w.word === word)) W.push({ word, action, value }); renderWords(); break; }
    case 'w-save': {
      const clean = W.filter(w => String(w.word || '').trim()).map(w => ({ word: String(w.word).trim(), action: w.action, value: w.value }));
      S.set = await hn.setSettings({ nlp: { custom: clean } });
      closeModal2();
      toast(`내 낱말 ${clean.length}개를 저장했습니다.`);
      if (S.modal === 'edit') nlPreview();
      break;
    }
    case 'g-set': { const v = el.dataset.k === 'days' ? Number(el.dataset.v) : el.dataset.v; await setGraph({ [el.dataset.k]: v }); break; }
    case 'g-reset': await setGraph({ days: 14, height: 22, bar: 5, color: 'area', custom: '#2B4C7E' }); break;
    case 'g-close': closePop(); break;
    case 'agent-test': {
      const nk = $('#agentNewKey');
      if (nk && nk.value.trim()) { const r = await agentKey({ op: 'add', key: nk.value, name: ($('#agentNewName') || {}).value, provider: S.set.agent.provider }); if (!r.ok) break; } // 넣어 둔 새 키부터 저장
      agentMsg('시험하는 중…', true);
      const r = await hn.agentTest(S.set.agent);
      if (r.models && r.models.length) S.agentModels = r.models;
      S.agent = await hn.agentInfo();
      refreshAgentSec(r.msg, r.ok);
      break;
    }
    case 'agent-key-add': {
      const nk = $('#agentNewKey');
      await agentKey({ op: 'add', key: nk ? nk.value : '', name: ($('#agentNewName') || {}).value, provider: S.set.agent.provider });
      break;
    }
    case 'agent-key-use': await agentKey({ op: 'use', id: el.dataset.id }); break;
    case 'agent-key-del': {
      const k = (S.set.agent.keys || []).find(x => x.id === el.dataset.id);
      if (k && confirm(`‘${k.name}’ 키를 지울까요? (${maskKey(k.key)})`)) await agentKey({ op: 'del', id: k.id });
      break;
    }
    case 'agent-key-show': { const id = el.dataset.id; if (AGENT_SHOW.has(id)) AGENT_SHOW.delete(id); else AGENT_SHOW.add(id); refreshAgentSec(); break; }
    case 'agent-key-copy': { const k = (S.set.agent.keys || []).find(x => x.id === el.dataset.id); if (k) { await hn.copy(k.key); toast(`‘${k.name}’ 키를 복사했습니다.`); } break; }
    case 'roots-add': await hn.addRoots(); S.set = await hn.settings(); if (S.modal === 'settings') openSettings(); render(); break;
    case 'welcome-off': S.set = await hn.setSettings({ ui: { welcomeOff: true } }); renderMain(); break;
    case 'open-agent': openSettings(); { const s = $('#agentsec'); if (s) s.scrollIntoView(); } break;
    case 'open-cal': openSettings(); { const s = $('#calsec'); if (s) s.scrollIntoView(); } break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'nlIn') nlPreview();
  if (e.target.id === 'wTry') wordsTry();
  if (e.target.dataset && e.target.dataset.w !== undefined && W) { W[Number(e.target.dataset.i)][e.target.dataset.w] = e.target.value; wordsTry(); }
  if (e.target.dataset && e.target.dataset.g) {
    const k = e.target.dataset.g;
    const v = k === 'custom' ? e.target.value : Number(e.target.value);
    const lab = e.target.nextElementSibling;
    if (lab && lab.classList.contains('num')) lab.textContent = v + 'px';
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => setGraph({ [k]: v }), 120);
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset && t.dataset.act === 'e-pick') {
    if (t.value) openEdit(E.id, t.value);
    else { E.dl = null; E.cur = curOf(E.it, null); E.draft = { ...E.cur, addNew: true }; renderEdit(); }
  }
  if (t.dataset && t.dataset.w === 'action' && W) { W[Number(t.dataset.i)].action = t.value; wordsTry(); }
  if (t.dataset && t.dataset.vd) { const d = (S.set.voice.dict || []).map(x => ({ ...x })); if (d[Number(t.dataset.i)]) { d[Number(t.dataset.i)][t.dataset.vd] = t.value.trim(); saveDict(d); } }
  if (t.dataset && t.dataset.act === 'agent-pick') {
    if (t.value === '__new') { S.agentNew = true; refreshAgentSec(); const nk = $('#agentNewKey'); if (nk) nk.focus(); }
    else await agentKey({ op: 'use', id: t.value });
  }
  if (t.dataset && t.dataset.act === 'agent-key-name') await agentKey({ op: 'name', id: t.dataset.id, name: t.value });
  if (t.dataset && t.dataset.k === 'voice.engine') { S.agent = await hn.agentInfo(); }
  if (t.closest && (t.closest('#agentsec') || t.closest('#aisec')) && t.dataset.k) {
    setTimeout(async () => {
      S.agent = await hn.agentInfo();
      if (t.dataset.k === 'agent.provider') { S.agentNew = false; S.agentModels = null; refreshAgentSec(); }
      else {
        const h = $('#agentsec h3 .pill'); if (h) { h.className = 'pill ' + (S.agent.ready ? 'ok' : ''); h.textContent = S.agent.ready ? '쓸 수 있음' : '없음'; }
        refreshAiSec();
      }
    }, 150);
  }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'nlIn' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); runNL(false); }
  if (e.target.id === 'lmQ' && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); localAct('local-search', e.target); return; }
  if (e.target.id === 'lmName' && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const b = $('[data-act="local-pullname"]'); if (b) b.click(); return; }
  if (e.target.classList && e.target.classList.contains('lm-ch') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.target.click(); return; }
  if ((e.target.id === 'agentNewKey' || e.target.id === 'agentNewName') && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const b = $('[data-act="agent-key-add"]'); if (b) b.click(); }
}, true);
