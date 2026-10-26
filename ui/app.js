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
  const need = (ui.sideCollapsed ? 30 : (ui.sideW || 236)) + 380 + ($('#detail').hidden ? 0 : (ui.detailW || 400)) + 12;
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
  if (S.cal) {
    const c = S.cal;
    const on = c.mode === 'script' ? c.script && c.script.enabled : c.connected && c.enabled;
    const last = c.mode === 'script' ? c.script && c.script.last : c.last;
    const err = last && last.errors && last.errors[0];
    parts.push(`캘린더 ${c.count ?? 0}건${on ? (err ? ' · <span style="color:var(--red)">구글 오류</span>' : ' · 구글 연결됨') : ''}`);
  }
  if (S.act && S.act.on) parts.push(`<span style="color:var(--red)">창 기록 중${S.act.item ? ' · 지금: ' + esc(S.act.item.title) : ''}</span>`);
  $('#status').innerHTML = parts.join('<span>·</span>') + `<span class="r">v${esc(b.version || '')}</span>`;
}

// ---------- 쉴 때 브리핑 ----------
function openBrief() {
  S.brief = true; S.briefArmed = false;
  $('#brief').hidden = false;
  renderBrief();
  setTimeout(() => { S.briefArmed = true; }, 1200);
}
function closeBrief(fromMain) {
  S.brief = false;
  $('#brief').hidden = true;
  if (!fromMain) hn.dismissBrief(false);
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
      <div class="foot">아무 데나 누르거나 아무 키나 누르면 닫힙니다.<br>다음 알림은 ${S.set.idle.cooldownMin}분 뒤부터 · 설정에서 바꿀 수 있습니다.</div>
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

  <div class="fs" id="nlpsec"><h3>글로 바꾸기 · 내 낱말</h3>
    <p class="exp">목록에서 오른쪽 클릭 › 변경 창 아래 칸에 “이틀 미뤄 줘”, “다음주 금요일 오후 3시”, “별 넷”, “완료”처럼 쓰면 알아듣고 바꿉니다. 자주 쓰는 내 말(예: 칼퇴 = 18시, 땡겨 = 하루 당기기)을 등록할 수 있습니다.</p>
    <div class="fr"><button class="btn" data-act="words">내 낱말 관리 (${(s.nlp.custom || []).length}개)</button></div></div>

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

  <div class="fs"><h3>AI 정리</h3>
    <p class="exp">위 ‘AI 에이전트’로 일을 읽어 영역·주제·마감·다음 할 일을 정리합니다. 바뀐 일만 다시 읽습니다.</p>
    <div class="fr"><label>Claude 모델</label><select data-k="ai.model">${['sonnet', 'haiku', 'opus'].map(m => `<option ${s.ai.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <span class="exp" style="margin:0">(Claude Code를 쓸 때)</span>
      <button class="btn" data-act="aiall">전부 다시 정리</button></div></div>

  <div class="fs"><h3>화면·시작</h3>
    <div class="fr"><label>바탕</label><select data-k="theme"><option value="paper" ${s.theme === 'paper' ? 'selected' : ''}>종이</option><option value="night" ${s.theme === 'night' ? 'selected' : ''}>밤</option></select></div>
    <div class="fr"><label>미니 창 진하기</label><input type="range" min="0.5" max="1" step="0.05" data-k="mini.opacity" value="${s.mini.opacity}"> <label>줄 수</label><input type="number" min="3" max="20" data-k="mini.count" value="${s.mini.count}"></div>
    <div class="fr"><label>닫으면 트레이로</label>${sw('closeToTray', s.closeToTray)}</div>
    <div class="fr"><label>컴퓨터 켤 때 자동 실행</label>${sw('autoStart', s.autoStart)} <span class="exp" style="margin:0">트레이(맥은 메뉴 막대)에 숨긴 채 켜짐</span></div>
    <div class="fr"><label>단축키</label><span class="exp" style="margin:0">Ctrl+Alt+H 창 열기·숨기기 · Ctrl+Alt+M 미니 창 · 1/2/3 화면 · / 찾기 · ↑↓ 고르기 · Shift+1~5 중요도 · X 완료 체크 · E 변경 창 · N 할 일 넣기 · R 다시 읽기 · 오른쪽 클릭: 변경 창</span></div>
    <div class="fr"><label>저장 폴더</label><button class="btn small" data-act="opendata">data 폴더 열기</button></div></div>
  </div>`;
  $('#modal').hidden = false;
  S.modal = 'settings';
  refreshCal();
  tickIdle();
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
  else v = el.value;
  S.set = await hn.setSettings(patchFromKey(k, v));
  if (k === 'theme') applyTheme();
  if (k.startsWith('calendar')) refreshCal();
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
    case 'brieftest': closeModal(); hn.testBrief(); break;
    case 'icsopen': hn.calOpenIcs(); break;
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
  S.platform = S.agent.platform;
  document.body.classList.add(S.platform === 'darwin' ? 'mac' : S.platform === 'win32' ? 'win' : 'linux');
  hn.calStatus().then(c => { S.cal = c; renderStatus(); });
  hn.on('board', b => { S.board = b; if (S.sel && !byId(S.sel)) S.sel = null; render(); });
  // 미니 창에서 바꾼 설정(끝낸 일 감추기 등)도 바로 반영
  hn.on('settings', s => { S.set = s; applyTheme(); render(); });
  hn.on('scan', s => { S.scanBusy = s.busy; renderBar(); renderStatus(); });
  hn.on('ai', a => { const was = S.ai.running; S.ai = a; renderBar(); renderStatus(); if (was && !a.running && a.msg) toast(a.msg, /실패/.test(a.msg) ? 'error' : ''); });
  hn.on('cal', c => { S.cal = { ...(S.cal || {}), ...c }; renderStatus(); if (S.modal === 'settings') refreshCal(); });
  hn.on('activity', a => { S.act = a; renderBar(); renderStatus(); });
  hn.on('select', id => { S.f = { area: null, group: null, sp: null }; select(id); });
  hn.on('brief', b => (b.show ? openBrief() : closeBrief(true)));
  hn.on('toast', t => toast(t.text, t.kind));
  hn.on('found:scan', s => { S.foundScan = s; if (S.f.sp === 'found') renderMain(); });
  hn.on('found:ai', a => { S.foundAi = a; if (S.f.sp === 'found') renderMain(); });
  hn.on('test', t => {
    if (t.closeAll) { closeModal2(); closeModal(); closePop(); }
    if (t.edit) { S.f = { area: null, group: null, sp: null }; render(); const first = sorted(visible()).find(x => x.fdl); if (first) { select(first.id); openEdit(first.id); } }
    if (t.editText) { $('#nlIn').value = t.editText; nlPreview(); runNL(false); }
    if (t.quick !== undefined) { $('#quickIn').value = t.quick; quickPreview(); $('#quickIn').focus(); }
    if (t.graph) { const sp = $('#main .spark'); if (sp) { const r = sp.getBoundingClientRect(); openGraphPop(r.left, r.bottom + 4); } }
    if (t.words) { openWords(); W.push({ word: '칼퇴', action: 'time', value: '18:00' }, { word: '불금', action: 'weekday', value: '금' }); renderWords(); $('#wTry').value = '칼퇴 전까지 불금으로 별 넷'; wordsTry(); }
    if (t.found) { S.f = { area: null, group: null, sp: 'found' }; S.foundView.range = t.found; render(); }
    if (t.check) { const it = sorted(visible()).find(x => x.band === 'today' || x.band === 'd3' || x.band === 'd7'); if (it) toggleCheck(it, true); }
    if (t.view) setView(t.view, false);
    if (t.selectFirst) { const first = sorted(visible())[0]; if (first) select(first.id); }
    if (t.settings === true) openSettings();
    if (t.scrollTo) { const s = $('#' + t.scrollTo); if (s) s.scrollIntoView({ block: 'start' }); }
    if (t.scrollCal) { const c = $('#calsec'); if (c) c.scrollIntoView(); }
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
  return NLP.parse(v, { mode: 'quick', custom: S.set.nlp.custom });
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
  box.innerHTML = '→ ' + parts.join(' ');
}
$('#quickIn').addEventListener('input', quickPreview);
$('#quick').addEventListener('submit', async e => {
  e.preventDefault();
  e.stopPropagation();
  const r = quickParse();
  if (!r.title) { toast('할 일 이름을 함께 써 주세요. 예: 내일 3시 보고서 제출', 'error'); return; }
  const g = k => (r.actions.find(a => a.type === k) || {}).value;
  let date = g('date');
  if (!date && g('time')) date = NLP.ymd(new Date());
  const kind = g('kind') || 'deadline';
  const id = await hn.addManual({ title: r.title, area: g('area') || (S.f.area || '개인'), date, time: g('time') || '', label: kind === 'event' ? '일정' : '마감', imp: g('imp') || 0, kind });
  $('#quickIn').value = '';
  quickPreview();
  toast(`넣었습니다: ${r.title}${date ? ' · ' + NLP.fmtDate(date) : ''}${g('time') ? ' ' + g('time') : ''}`);
  setTimeout(() => select(id), 250);
});

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
    <div class="nl"><textarea id="nlIn" placeholder="글로 바꾸기 — 예: 이틀 미뤄 줘 · 다음주 금요일 오후 3시로 · 별 넷 · 조금 중요 · 1105로 변경 · 완료    (Enter: 확인 후 적용 · Shift+Enter: 줄바꿈)"></textarea>
      <div class="nlp" id="nlPrev">${agentOk ? '' : 'AI 없이도 알아듣습니다. 더 복잡한 말은 설정 › AI 에이전트를 연결하면 AI로도 해석합니다.'}</div></div>
    <div class="foot"><button class="btn on" data-act="e-save">저장</button><button class="btn" data-act="e-nl">글로 바꾸기</button>
      ${agentOk ? '<button class="btn" data-act="e-ai" title="AI 에이전트로 해석">AI로 해석</button>' : ''}<button class="btn" data-act="mclose">닫기</button>
      <span class="sp"></span><button class="tiny" data-act="words" title="내가 쓰는 낱말을 기능에 연결">변경 기능 설정</button></div>
  </div>`;
  $('#modal').hidden = false;
  S.modal = 'edit';
}
function nlResult(text) {
  return NLP.parse(text, { mode: 'edit', baseDate: E.draft.date || E.cur.date || undefined, custom: S.set.nlp.custom });
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
function agentSectionHTML() {
  const a = S.set.agent || {};
  const info = S.agent || { presets: {}, claude: false };
  const P = info.presets || {};
  const prov = a.provider || 'auto';
  const p = P[prov];
  const opt = (v, n) => `<option value="${v}" ${prov === v ? 'selected' : ''}>${esc(n)}</option>`;
  return `<div class="fs" id="agentsec"><h3>AI 에이전트 <span class="pill ${info.ready ? 'ok' : ''}">${info.ready ? '쓸 수 있음' : '없음'}</span></h3>
    <p class="exp">AI 정리, 찾은 일정 다듬기, ‘AI로 해석’에 씁니다. 없어도 프로그램은 다 돌아갑니다(글로 바꾸기는 규칙으로 알아들음). 무료로 오래 쓰려면 <b>Gemini 무료 키</b>나 <b>내 PC의 Ollama</b>를 권합니다.</p>
    <div class="fr"><label>쓸 곳</label><select data-k="agent.provider">
      ${opt('auto', `자동 (${info.claude ? 'Claude Code 있음' : 'Claude Code 없음 → 사용 안 함'})`)}${opt('claude', 'Claude Code (이 PC, 구독)')}
      ${Object.entries(P).map(([k, v]) => opt(k, v.name)).join('')}${opt('none', '사용 안 함')}</select>
      ${p && p.keyUrl ? `<button class="btn small" data-act="url" data-u="${esc(p.keyUrl)}">${p.needKey ? '무료 키 받으러 가기' : '내려받기'}</button>` : ''}</div>
    ${p ? `<div class="note-box">${esc(p.help)}</div>` : ''}
    ${p && p.needKey ? `<div class="fr"><label>API 키</label><input type="password" data-k="agent.key" value="${esc(a.key || '')}" placeholder="붙여넣기 (이 PC에만 저장)"></div>` : ''}
    ${p ? `<div class="fr"><label>모델</label><input type="text" data-k="agent.model" value="${esc(a.model || '')}" placeholder="${esc(p.model)} (비우면 이것)" list="agentModels"><datalist id="agentModels">${(S.agentModels || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>` : ''}
    ${prov === 'custom' || prov === 'ollama' ? `<div class="fr"><label>주소</label><input type="text" data-k="agent.base" value="${esc(a.base || '')}" placeholder="${esc(p ? p.base : '')}"></div>` : ''}
    <div class="fr"><label></label><button class="btn" data-act="agent-test">연결 시험</button><span class="exp" id="agentMsg" style="margin:0"></span></div></div>`;
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
    case 'e-save': { const d = draftFromFields(); if (await saveEdit(d)) closeModal(); break; }
    case 'e-nl': runNL(false); break;
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
      const m = $('#agentMsg');
      m.textContent = '시험하는 중…';
      const r = await hn.agentTest(S.set.agent);
      m.textContent = r.msg;
      m.style.color = r.ok ? 'var(--blue)' : 'var(--red)';
      if (r.models && r.models.length) { S.agentModels = r.models; const dl = $('#agentModels'); if (dl) dl.innerHTML = r.models.map(x => `<option value="${esc(x)}">`).join(''); }
      S.agent = await hn.agentInfo(); break;
    }
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
  if (t.closest && t.closest('#agentsec') && t.dataset.k) { setTimeout(async () => { S.agent = await hn.agentInfo(); if (t.dataset.k === 'agent.provider') { openSettings(); const s = $('#agentsec'); if (s) s.scrollIntoView(); } }, 150); }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'nlIn' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); runNL(false); }
}, true);
